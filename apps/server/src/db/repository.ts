import { eq, and, desc, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "./client.js";
import { users, consents, sessions, messages, skillsStats } from "./schema.js";
import { redact } from "../privacy/redact.js";
import type {
  User, Consent, Session, SessionMessage, SessionState,
  Outcome, Lesson, InterestTag, ChannelType, RedFlagSpan, SkillsSummary, CategoryStats, RedFlagCategory
} from "@safe-signal/shared";

// ── Users ─────────────────────────────────────────────────────────────────────
export async function upsertUser(phone: string, name?: string): Promise<User> {
  const db = getDb();
  const existing = db.select().from(users).where(eq(users.phone, phone)).get();
  if (existing) return rowToUser(existing);

  const id = nanoid();
  const now = new Date().toISOString();
  db.insert(users).values({ id, phone, name, createdAt: now }).run();
  return { id, phone, name, createdAt: now };
}

export function getUserById(id: string): User | undefined {
  const row = getDb().select().from(users).where(eq(users.id, id)).get();
  return row ? rowToUser(row) : undefined;
}

// ── Consents ──────────────────────────────────────────────────────────────────
export async function saveConsent(c: Omit<Consent, "id">): Promise<Consent> {
  const db = getDb();
  // Deactivate old consents for this user
  db.update(consents).set({ active: false }).where(eq(consents.userId, c.userId)).run();

  const id = nanoid();
  db.insert(consents).values({
    id,
    userId: c.userId,
    phone: c.phone,
    channel: c.channel,
    interests: JSON.stringify(c.interests),
    quietHoursStart: c.quietHours?.startHour ?? null,
    quietHoursEnd: c.quietHours?.endHour ?? null,
    maxPerDay: c.maxPerDay,
    consentVersion: c.consentVersion,
    consentAt: c.consentAt,
    active: true,
  }).run();
  return { ...c, id };
}

export function getActiveConsent(userId: string): Consent | undefined {
  const row = getDb()
    .select()
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.active, true)))
    .get();
  return row ? rowToConsent(row) : undefined;
}

// ── Sessions ──────────────────────────────────────────────────────────────────
export function createSession(s: Omit<Session, "messages" | "lesson">): Session {
  const db = getDb();
  db.insert(sessions).values({
    id: s.id,
    userId: s.userId,
    scenarioId: s.scenarioId,
    channel: s.channel,
    state: s.state,
    currentStageIndex: s.currentStageIndex,
    token: s.token,
    startedAt: s.startedAt,
    endedAt: s.endedAt ?? null,
    outcome: s.outcome ?? null,
    lessonJson: null,
    expiresAt: s.endedAt ?? new Date(Date.now() + sessionTimeoutMs()).toISOString(),
  }).run();
  return { ...s, messages: [] };
}

export function getSessionById(id: string): Session | undefined {
  const row = getDb().select().from(sessions).where(eq(sessions.id, id)).get();
  if (!row) return undefined;
  return rowToSession(row);
}

export function getSessionByToken(token: string): Session | undefined {
  const row = getDb().select().from(sessions).where(eq(sessions.token, token)).get();
  if (!row) return undefined;
  return rowToSession(row);
}

export function getUserSessions(userId: string): Session[] {
  const rows = getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.startedAt))
    .all();
  return rows.map(rowToSession);
}

export function updateSessionState(
  id: string,
  state: SessionState,
  opts: { currentStageIndex?: number; outcome?: Outcome; endedAt?: string; lesson?: Lesson } = {}
): void {
  const db = getDb();
  db.update(sessions)
    .set({
      state,
      ...(opts.currentStageIndex !== undefined && { currentStageIndex: opts.currentStageIndex }),
      ...(opts.outcome !== undefined && { outcome: opts.outcome }),
      ...(opts.endedAt !== undefined && { endedAt: opts.endedAt }),
      ...(opts.lesson !== undefined && { lessonJson: JSON.stringify(opts.lesson) }),
    })
    .where(eq(sessions.id, id))
    .run();
}

export function markSessionClicked(id: string): void {
  updateSessionState(id, "ended_fell", { outcome: "fell_for_it", endedAt: new Date().toISOString() });
}

// ── Messages ──────────────────────────────────────────────────────────────────
export function saveMessage(sessionId: string, msg: SessionMessage): void {
  getDb().insert(messages).values({
    id: msg.id,
    sessionId,
    role: msg.role,
    redactedText: redact(msg.text),
    stageAtSend: msg.stageAtSend,
    redFlagsJson: JSON.stringify(msg.redFlags),
    sentAt: msg.sentAt,
  }).run();
}

export function getMessages(sessionId: string): SessionMessage[] {
  const rows = getDb()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.sentAt)
    .all();
  return rows.map((r) => ({
    id: r.id,
    role: r.role as "scammer" | "user",
    text: r.redactedText,
    redactedText: r.redactedText,
    stageAtSend: r.stageAtSend,
    redFlags: JSON.parse(r.redFlagsJson) as RedFlagSpan[],
    sentAt: r.sentAt,
  }));
}

// ── Skills stats ──────────────────────────────────────────────────────────────
export function getSkillsSummary(userId: string): SkillsSummary {
  const db = getDb();
  const rows = db.select().from(skillsStats).where(eq(skillsStats.userId, userId)).all();

  const userSessions = db.select().from(sessions).where(eq(sessions.userId, userId)).all();
  const total = userSessions.length;
  const caught = userSessions.filter((s) => s.outcome === "caught").length;
  const fell = userSessions.filter((s) => s.outcome === "fell_for_it").length;

  const categoryStats: CategoryStats[] = rows.map((r) => ({
    category: r.category as RedFlagCategory,
    timesEncountered: r.timesEncountered,
    timesCaught: r.timesCaught,
    score: r.timesEncountered === 0 ? 0 : r.timesCaught / r.timesEncountered,
  }));

  const weakest = categoryStats.sort((a, b) => a.score - b.score)[0]?.category;

  return {
    userId,
    totalSessions: total,
    caught,
    fellFor: fell,
    categoryStats,
    weakestCategory: weakest,
    updatedAt: new Date().toISOString(),
  };
}

export function upsertSkillStat(
  userId: string,
  category: RedFlagCategory,
  caught: boolean
): void {
  const db = getDb();
  const existing = db
    .select()
    .from(skillsStats)
    .where(and(eq(skillsStats.userId, userId), eq(skillsStats.category, category)))
    .get();

  const now = new Date().toISOString();
  if (existing) {
    db.update(skillsStats)
      .set({
        timesEncountered: existing.timesEncountered + 1,
        timesCaught: existing.timesCaught + (caught ? 1 : 0),
        updatedAt: now,
      })
      .where(eq(skillsStats.id, existing.id))
      .run();
  } else {
    db.insert(skillsStats).values({
      id: nanoid(),
      userId,
      category,
      timesEncountered: 1,
      timesCaught: caught ? 1 : 0,
      updatedAt: now,
    }).run();
  }
}

// ── TTL cleanup ───────────────────────────────────────────────────────────────
export function purgeExpiredSessions(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const expired = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(lt(sessions.expiresAt, now))
    .all();

  for (const s of expired) {
    db.delete(messages).where(eq(messages.sessionId, s.id)).run();
    db.delete(sessions).where(eq(sessions.id, s.id)).run();
  }
  return expired.length;
}

// ── Row mappers ───────────────────────────────────────────────────────────────
function rowToUser(r: typeof users.$inferSelect): User {
  return { id: r.id, phone: r.phone, name: r.name ?? undefined, createdAt: r.createdAt };
}

function rowToConsent(r: typeof consents.$inferSelect): Consent {
  return {
    id: r.id,
    userId: r.userId,
    phone: r.phone,
    channel: r.channel as ChannelType,
    interests: JSON.parse(r.interests) as InterestTag[],
    quietHours:
      r.quietHoursStart !== null && r.quietHoursEnd !== null
        ? { startHour: r.quietHoursStart, endHour: r.quietHoursEnd }
        : undefined,
    maxPerDay: r.maxPerDay,
    consentVersion: r.consentVersion,
    consentAt: r.consentAt,
    active: Boolean(r.active),
  };
}

function rowToSession(r: typeof sessions.$inferSelect): Session {
  const msgs = getMessages(r.id);
  return {
    id: r.id,
    userId: r.userId,
    scenarioId: r.scenarioId,
    channel: r.channel as ChannelType,
    state: r.state as SessionState,
    currentStageIndex: r.currentStageIndex,
    token: r.token,
    messages: msgs,
    startedAt: r.startedAt,
    endedAt: r.endedAt ?? undefined,
    outcome: (r.outcome ?? undefined) as Outcome | undefined,
    lesson: r.lessonJson ? (JSON.parse(r.lessonJson) as Lesson) : undefined,
  };
}

function sessionTimeoutMs(): number {
  const hours = Number(process.env["SESSION_TIMEOUT_HOURS"] ?? 4);
  return hours * 60 * 60 * 1000;
}

import { eq, and, desc, lt, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "./client.js";
import { users, consents, sessions, messages, skillsStats } from "./schema.js";
import { redact } from "../privacy/redact.js";
import type {
  User, Consent, Session, SessionMessage, SessionState,
  Outcome, Lesson, InterestTag, ChannelType, RedFlagSpan, SkillsSummary, CategoryStats, RedFlagCategory
} from "@safe-signal/shared";

// All functions are async: the database is Postgres (TigerData in the cloud,
// PGlite locally) and every query goes over a connection.

// ── Users ─────────────────────────────────────────────────────────────────────
export async function upsertUser(phone: string, name?: string): Promise<User> {
  const db = await getDb();
  const [existing] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  if (existing) return rowToUser(existing);

  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({ id, phone, name, createdAt: now });
  return { id, phone, name, createdAt: now };
}

export async function getUserById(id: string): Promise<User | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ? rowToUser(row) : undefined;
}

export async function getUserByPhone(phone: string): Promise<User | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  return row ? rowToUser(row) : undefined;
}

// ── Consents ──────────────────────────────────────────────────────────────────
export async function saveConsent(c: Omit<Consent, "id">): Promise<Consent> {
  const db = await getDb();
  // Deactivate old consents for this user
  await db.update(consents).set({ active: false }).where(eq(consents.userId, c.userId));

  const id = nanoid();
  await db.insert(consents).values({
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
  });
  return { ...c, id };
}

export async function deactivateConsents(userId: string): Promise<void> {
  const db = await getDb();
  await db.update(consents).set({ active: false }).where(eq(consents.userId, userId));
}

export async function getActiveConsent(userId: string): Promise<Consent | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.active, true)))
    .limit(1);
  return row ? rowToConsent(row) : undefined;
}

// ── Sessions ──────────────────────────────────────────────────────────────────
export async function createSession(s: Omit<Session, "messages" | "lesson">): Promise<Session> {
  const db = await getDb();
  await db.insert(sessions).values({
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
  });
  return { ...s, messages: [] };
}

export async function getSessionById(id: string): Promise<Session | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  if (!row) return undefined;
  return rowToSession(row);
}

export async function getSessionByToken(token: string): Promise<Session | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(sessions).where(eq(sessions.token, token)).limit(1);
  if (!row) return undefined;
  return rowToSession(row);
}

export async function getUserSessions(userId: string): Promise<Session[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.startedAt));
  return Promise.all(rows.map(rowToSession));
}

/** Most recent session for a user that is still in an active (non-terminal) state. */
export async function getActiveSessionForUser(userId: string, activeStates: string[]): Promise<Session | undefined> {
  const all = await getUserSessions(userId);
  // getUserSessions is newest-first
  return all.find((s) => activeStates.includes(s.state));
}

export async function updateSessionState(
  id: string,
  state: SessionState,
  opts: { currentStageIndex?: number; outcome?: Outcome; endedAt?: string; lesson?: Lesson } = {}
): Promise<void> {
  const db = await getDb();
  await db.update(sessions)
    .set({
      state,
      ...(opts.currentStageIndex !== undefined && { currentStageIndex: opts.currentStageIndex }),
      ...(opts.outcome !== undefined && { outcome: opts.outcome }),
      ...(opts.endedAt !== undefined && { endedAt: opts.endedAt }),
      ...(opts.lesson !== undefined && { lessonJson: JSON.stringify(opts.lesson) }),
    })
    .where(eq(sessions.id, id));
}

export async function markSessionClicked(id: string): Promise<void> {
  await updateSessionState(id, "ended_fell", { outcome: "fell_for_it", endedAt: new Date().toISOString() });
}

// ── Messages ──────────────────────────────────────────────────────────────────
export async function saveMessage(sessionId: string, msg: SessionMessage): Promise<void> {
  const db = await getDb();
  await db.insert(messages).values({
    id: msg.id,
    sessionId,
    role: msg.role,
    redactedText: redact(msg.text),
    stageAtSend: msg.stageAtSend,
    redFlagsJson: JSON.stringify(msg.redFlags),
    sentAt: msg.sentAt,
    ts: new Date(msg.sentAt),
  });
}

export async function getMessages(sessionId: string): Promise<SessionMessage[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.ts), asc(messages.sentAt));
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
export async function getSkillsSummary(userId: string): Promise<SkillsSummary> {
  const db = await getDb();
  const rows = await db.select().from(skillsStats).where(eq(skillsStats.userId, userId));

  const userSessions = await db.select().from(sessions).where(eq(sessions.userId, userId));
  const total = userSessions.length;
  const caught = userSessions.filter((s) => s.outcome === "caught").length;
  const fell = userSessions.filter((s) => s.outcome === "fell_for_it").length;

  const categoryStats: CategoryStats[] = rows.map((r) => ({
    category: r.category as RedFlagCategory,
    timesEncountered: r.timesEncountered,
    timesCaught: r.timesCaught,
    score: r.timesEncountered === 0 ? 0 : r.timesCaught / r.timesEncountered,
  }));

  const weakest = [...categoryStats].sort((a, b) => a.score - b.score)[0]?.category;

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

export async function upsertSkillStat(
  userId: string,
  category: RedFlagCategory,
  caught: boolean
): Promise<void> {
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(skillsStats)
    .where(and(eq(skillsStats.userId, userId), eq(skillsStats.category, category)))
    .limit(1);

  const now = new Date().toISOString();
  if (existing) {
    await db.update(skillsStats)
      .set({
        timesEncountered: existing.timesEncountered + 1,
        timesCaught: existing.timesCaught + (caught ? 1 : 0),
        updatedAt: now,
      })
      .where(eq(skillsStats.id, existing.id));
  } else {
    await db.insert(skillsStats).values({
      id: nanoid(),
      userId,
      category,
      timesEncountered: 1,
      timesCaught: caught ? 1 : 0,
      updatedAt: now,
    });
  }
}

// ── TTL cleanup ───────────────────────────────────────────────────────────────
export async function purgeExpiredSessions(): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  const expired = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(lt(sessions.expiresAt, now));

  for (const s of expired) {
    await db.delete(messages).where(eq(messages.sessionId, s.id));
    await db.delete(sessions).where(eq(sessions.id, s.id));
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

async function rowToSession(r: typeof sessions.$inferSelect): Promise<Session> {
  const msgs = await getMessages(r.id);
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

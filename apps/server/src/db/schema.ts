import { pgTable, text, integer, boolean, timestamp, primaryKey, index } from "drizzle-orm/pg-core";

/**
 * Postgres schema (TigerData / Timescale in the cloud, PGlite locally).
 *
 * Application timestamps stay ISO-8601 strings (startedAt, sentAt, ...) so the
 * rest of the codebase is unchanged. Each time-series table also carries a real
 * `ts` TIMESTAMPTZ column so TigerData can partition it as a hypertable and we
 * can run time-bucketed analytics (time_bucket, continuous aggregates).
 */

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  name: text("name"),
  createdAt: text("created_at").notNull(),
});

export const consents = pgTable("consents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  phone: text("phone").notNull(),
  channel: text("channel").notNull(),
  interests: text("interests").notNull(), // JSON array
  quietHoursStart: integer("quiet_hours_start"),
  quietHoursEnd: integer("quiet_hours_end"),
  maxPerDay: integer("max_per_day").notNull().default(1),
  consentVersion: text("consent_version").notNull().default("1.0"),
  consentAt: text("consent_at").notNull(),
  active: boolean("active").notNull().default(true),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    scenarioId: text("scenario_id").notNull(),
    channel: text("channel").notNull(),
    state: text("state").notNull().default("created"),
    currentStageIndex: integer("current_stage_index").notNull().default(0),
    token: text("token").notNull().unique(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    outcome: text("outcome"),
    lessonJson: text("lesson_json"),
    expiresAt: text("expires_at").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("idx_sessions_user").on(t.userId),
    expiresIdx: index("idx_sessions_expires").on(t.expiresAt),
  })
);

/**
 * `messages` is the TigerData hypertable. Timescale requires the partition
 * column to be part of every unique constraint, hence the composite key.
 */
export const messages = pgTable(
  "messages",
  {
    id: text("id").notNull(),
    sessionId: text("session_id").notNull().references(() => sessions.id),
    role: text("role").notNull(), // "scammer" | "user"
    redactedText: text("redacted_text").notNull(),
    stageAtSend: text("stage_at_send").notNull(),
    redFlagsJson: text("red_flags_json").notNull().default("[]"),
    sentAt: text("sent_at").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.ts] }),
    sessionIdx: index("idx_messages_session").on(t.sessionId, t.ts),
  })
);

export const skillsStats = pgTable(
  "skills_stats",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    category: text("category").notNull(),
    timesEncountered: integer("times_encountered").notNull().default(0),
    timesCaught: integer("times_caught").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    userIdx: index("idx_skills_user").on(t.userId),
  })
);

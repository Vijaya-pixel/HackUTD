import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  name: text("name"),
  createdAt: text("created_at").notNull(),
});

export const consents = sqliteTable("consents", {
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
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const sessions = sqliteTable("sessions", {
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
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  role: text("role").notNull(), // "scammer" | "user"
  redactedText: text("redacted_text").notNull(),
  stageAtSend: text("stage_at_send").notNull(),
  redFlagsJson: text("red_flags_json").notNull().default("[]"),
  sentAt: text("sent_at").notNull(),
});

export const skillsStats = sqliteTable("skills_stats", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  category: text("category").notNull(),
  timesEncountered: integer("times_encountered").notNull().default(0),
  timesCaught: integer("times_caught").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

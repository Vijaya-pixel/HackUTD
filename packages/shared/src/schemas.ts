import { z } from "zod";
import type { RedFlagCategory, ChannelType, InterestTag, ScenarioCategory } from "./types.js";

// ── Primitives ────────────────────────────────────────────────────────────────
export const RedFlagCategorySchema = z.enum([
  "urgency",
  "impersonation",
  "secrecy",
  "unusual_payment_or_code",
  "suspicious_link_or_sender",
  "too_good_to_be_true",
]) satisfies z.ZodType<RedFlagCategory>;

export const ChannelTypeSchema = z.enum([
  "imessage",
  "sms",
  "simulator",
  "voice",
]) satisfies z.ZodType<ChannelType>;

export const InterestTagSchema = z.enum([
  "shopping",
  "package_delivery",
  "driving",
  "travel",
  "career",
  "finance",
  "family",
  "mobile_account",
]) satisfies z.ZodType<InterestTag>;

export const ScenarioCategorySchema = z.enum([
  "package_delivery",
  "toll_fee",
  "job_offer",
  "family_emergency",
  "bank_alert",
  "tmobile_account",
]) satisfies z.ZodType<ScenarioCategory>;

// ── API request schemas ───────────────────────────────────────────────────────
export const OptInRequestSchema = z.object({
  phone: z.string().regex(/^\+1\d{10}$/, "Must be E.164 format, e.g. +12125550100"),
  channel: ChannelTypeSchema.exclude(["voice"]),
  interests: z.array(InterestTagSchema).min(1).max(8),
  quietHours: z
    .object({
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(0).max(23),
    })
    .optional(),
  maxPerDay: z.number().int().min(1).max(5).default(1),
  consentVersion: z.string().default("1.0"),
});

export const TriggerPracticeRequestSchema = z.object({
  userId: z.string().min(1),
  scenarioId: z.string().optional(),
});

export const DetectRequestSchema = z.object({
  text: z.string().min(1).max(5000),
  senderKnown: z.boolean().optional(),
  channel: ChannelTypeSchema.optional(),
});

export const SimulatorSendSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(2000),
});

// ── Scenario JSON schema ──────────────────────────────────────────────────────
export const ScenarioStageSchema = z.object({
  id: z.string(),
  name: z.enum(["hook", "engage", "escalate", "ask", "reveal"]),
  llmGuidance: z.string(),
  scriptedFallback: z.string(),
});

export const RedFlagDefSchema = z.object({
  category: RedFlagCategorySchema,
  explanation: z.string(),
});

export const ScenarioSchema = z.object({
  id: z.string(),
  category: ScenarioCategorySchema,
  interestTags: z.array(InterestTagSchema),
  brand: z.string(),
  difficulty: z.union([z.literal(1), z.literal(2)]),
  opener: z.string(),
  stages: z.array(ScenarioStageSchema).min(3),
  redFlagsByStage: z.record(z.array(RedFlagDefSchema)),
});

// ── Detection schema ──────────────────────────────────────────────────────────
export const DetectionResultSchema = z.object({
  label: z.enum(["scam", "suspicious", "likely_safe"]),
  confidence: z.number().min(0).max(1),
  redFlags: z.array(
    z.object({
      category: RedFlagCategorySchema,
      span: z.object({ start: z.number(), end: z.number() }),
      explanation: z.string(),
    })
  ),
  reasons: z.array(z.string()),
});

// ── Red flag categories ───────────────────────────────────────────────────────
export type RedFlagCategory =
  | "urgency"
  | "impersonation"
  | "secrecy"
  | "unusual_payment_or_code"
  | "suspicious_link_or_sender"
  | "too_good_to_be_true";

export interface RedFlagSpan {
  category: RedFlagCategory;
  startChar: number;
  endChar: number;
  explanation: string;
}

// ── Scenario types ────────────────────────────────────────────────────────────
export type ScenarioCategory =
  | "package_delivery"
  | "toll_fee"
  | "job_offer"
  | "family_emergency"
  | "bank_alert"
  | "tmobile_account";

export type InterestTag =
  | "shopping"
  | "package_delivery"
  | "driving"
  | "travel"
  | "career"
  | "finance"
  | "family"
  | "mobile_account";

export interface ScenarioStage {
  id: string;
  name: "hook" | "engage" | "escalate" | "ask" | "reveal";
  llmGuidance: string;
  scriptedFallback: string;
}

export interface RedFlagDef {
  category: RedFlagCategory;
  explanation: string;
}

export interface Scenario {
  id: string;
  category: ScenarioCategory;
  interestTags: InterestTag[];
  brand: string;
  difficulty: 1 | 2;
  opener: string;
  stages: ScenarioStage[];
  redFlagsByStage: Record<string, RedFlagDef[]>;
}

// ── Session types ─────────────────────────────────────────────────────────────
export type SessionState =
  | "created"
  | "hook_sent"
  | "engaging"
  | "escalating"
  | "link_sent"
  | "ended_caught"
  | "ended_fell"
  | "ended_timeout"
  | "opted_out";

export type Outcome =
  | "caught"
  | "fell_for_it"
  | "timeout"
  | "opted_out";

export type MessageRole = "scammer" | "user";

export interface SessionMessage {
  id: string;
  role: MessageRole;
  text: string;
  redactedText: string;
  stageAtSend: string;
  redFlags: RedFlagSpan[];
  sentAt: string; // ISO 8601
}

export interface Session {
  id: string;
  userId: string;
  scenarioId: string;
  channel: ChannelType;
  state: SessionState;
  currentStageIndex: number;
  token: string; // unguessable URL token
  messages: SessionMessage[];
  startedAt: string;
  endedAt?: string;
  outcome?: Outcome;
  lesson?: Lesson;
}

// ── Lesson types ──────────────────────────────────────────────────────────────
export interface AnnotatedMessage {
  id: string;
  role: MessageRole;
  text: string;
  redFlags: RedFlagSpan[];
}

export interface Lesson {
  sessionId: string;
  outcome: Outcome;
  replay: AnnotatedMessage[];
  mistakes: string[];
  strengths: string[];
  ruleToRemember: string;
  nextWeakCategory: RedFlagCategory;
  generatedAt: string;
}

// ── Consent / User types ──────────────────────────────────────────────────────
export type ChannelType = "imessage" | "sms" | "simulator" | "voice"; // voice: placeholder

export interface QuietHours {
  startHour: number; // 0-23
  endHour: number;   // 0-23
}

export interface Consent {
  id: string;
  userId: string;
  phone: string;
  channel: ChannelType;
  interests: InterestTag[];
  quietHours?: QuietHours;
  maxPerDay: number;
  consentVersion: string;
  consentAt: string;
  active: boolean;
}

export interface User {
  id: string;
  phone: string;
  name?: string;
  createdAt: string;
}

// ── Detection types ───────────────────────────────────────────────────────────
export interface DetectedFlag {
  category: RedFlagCategory;
  span: { start: number; end: number };
  explanation: string;
}

export type DetectionLabel = "scam" | "suspicious" | "likely_safe";

export interface DetectionResult {
  label: DetectionLabel;
  confidence: number; // 0..1
  redFlags: DetectedFlag[];
  reasons: string[];
}

export interface DetectionInput {
  text: string;
  senderKnown?: boolean;
  channel?: ChannelType;
}

// ── Skills summary ────────────────────────────────────────────────────────────
export interface CategoryStats {
  category: RedFlagCategory;
  timesEncountered: number;
  timesCaught: number;
  score: number; // 0..1
}

export interface SkillsSummary {
  userId: string;
  totalSessions: number;
  caught: number;
  fellFor: number;
  categoryStats: CategoryStats[];
  weakestCategory?: RedFlagCategory;
  updatedAt: string;
}

import { nanoid } from "nanoid";
import type { Session, SessionState, Outcome, Scenario, SessionMessage } from "@safe-signal/shared";
import {
  createSession,
  getSessionById,
  updateSessionState,
  saveMessage,
  markSessionClicked,
  upsertSkillStat,
} from "../db/repository.js";
import { validateScammerReply, userMessageTriggerReveal, detectRefusal, detectOptOut } from "./safetyFilter.js";
import { generateScammerReply } from "./scammerAgent.js";
import { buildLesson } from "./mistakeAnalyzer.js";
import { runRules } from "@safe-signal/shared/detection";
import type { MessagingChannel } from "../channels/MessagingChannel.js";

export interface StateMachineContext {
  channel: MessagingChannel;
  baseUrl: string;
}

export async function startSession(
  userId: string,
  scenario: Scenario,
  channelType: string,
  ctx: StateMachineContext
): Promise<Session> {
  const id = nanoid();
  const token = nanoid(32);
  const now = new Date().toISOString();

  const practiceLink = `${ctx.baseUrl}/p/${token}`;
  const opener = scenario.opener.replace("{{PRACTICE_LINK}}", practiceLink);

  const session = createSession({
    id,
    userId,
    scenarioId: scenario.id,
    channel: channelType as any,
    state: "hook_sent",
    currentStageIndex: 0,
    token,
    startedAt: now,
  });

  // Save opener as scammer message
  const openerMsg: SessionMessage = {
    id: nanoid(),
    role: "scammer",
    text: opener,
    redactedText: opener,
    stageAtSend: "hook",
    redFlags: (scenario.redFlagsByStage["hook"] ?? []).map((f, i) => ({
      category: f.category,
      startChar: 0,
      endChar: opener.length,
      explanation: f.explanation,
    })),
    sentAt: now,
  };
  saveMessage(id, openerMsg);

  // Send the opener
  await ctx.channel.send(userId, opener, id);

  return getSessionById(id)!;
}

export async function handleUserMessage(
  sessionId: string,
  userText: string,
  scenario: Scenario,
  ctx: StateMachineContext
): Promise<void> {
  const session = getSessionById(sessionId);
  if (!session) return;

  // Terminal states — ignore
  if (
    ["ended_caught", "ended_fell", "ended_timeout", "opted_out"].includes(session.state)
  ) return;

  const now = new Date().toISOString();

  // ── Opt-out check ──────────────────────────────────────────────────────────
  if (detectOptOut(userText)) {
    await endSession(session, scenario, "opted_out", ctx);
    await ctx.channel.send(session.userId,
      "✅ You've opted out of Safe Signal practice. Text START PRACTICE to resume anytime.",
      sessionId
    );
    return;
  }

  // ── PII guard ─────────────────────────────────────────────────────────────
  const { shouldReveal, piiCategories } = userMessageTriggerReveal(userText);
  if (shouldReveal) {
    // Save the user message (redacted)
    saveUserMessage(sessionId, userText, session.state, scenario);
    await revealSession(session, scenario, ctx, piiCategories);
    return;
  }

  // ── Save user message with detection ─────────────────────────────────────
  saveUserMessage(sessionId, userText, session.state, scenario);

  // ── Refusal / "nice catch" detection ─────────────────────────────────────
  if (detectRefusal(userText)) {
    await endSession(session, scenario, "caught", ctx);
    await sendNiceCatch(session, scenario, ctx);
    return;
  }

  // ── Advance stage ─────────────────────────────────────────────────────────
  const stageCount = scenario.stages.length - 1; // last stage is reveal
  const nextStageIndex = Math.min(session.currentStageIndex + 1, stageCount - 1);
  const stage = scenario.stages[nextStageIndex];
  if (!stage) return;

  const newState: SessionState = stageToState(stage.name);
  updateSessionState(sessionId, newState, { currentStageIndex: nextStageIndex });

  // ── Generate scammer reply ────────────────────────────────────────────────
  const practiceLink = `${ctx.baseUrl}/p/${session.token}`;
  const rawReply = await generateScammerReply({
    scenario,
    stage,
    conversationHistory: session.messages,
    practiceLink,
  });

  const { ok, reason } = validateScammerReply(rawReply);
  const replyText = ok ? rawReply : stage.scriptedFallback.replace("{{PRACTICE_LINK}}", practiceLink);

  if (!ok) {
    console.warn(`[safetyFilter] LLM reply rejected (${reason}), using scripted fallback`);
  }

  // Annotate red flags for this stage
  const stageRedFlags = scenario.redFlagsByStage[stage.id] ?? [];
  const scammerMsg: SessionMessage = {
    id: nanoid(),
    role: "scammer",
    text: replyText,
    redactedText: replyText,
    stageAtSend: stage.id,
    redFlags: stageRedFlags.map((f) => ({
      category: f.category,
      startChar: 0,
      endChar: replyText.length,
      explanation: f.explanation,
    })),
    sentAt: now,
  };
  saveMessage(sessionId, scammerMsg);
  await ctx.channel.send(session.userId, replyText, sessionId);
}

export async function handleLinkClick(
  token: string,
  ctx: StateMachineContext
): Promise<{ session: Session; lesson: any } | null> {
  const { getSessionByToken } = await import("../db/repository.js");
  const session = getSessionByToken(token);
  if (!session) return null;
  if (["ended_caught", "ended_fell", "ended_timeout", "opted_out"].includes(session.state)) {
    return { session, lesson: session.lesson ?? null };
  }

  // Load scenario
  const scenario = await loadScenario(session.scenarioId);
  if (!scenario) return null;

  markSessionClicked(session.id);

  // Build lesson
  const updatedSession = getSessionByToken(token)!;
  const lesson = await buildLesson(updatedSession, scenario);
  updateSessionState(session.id, "ended_fell", { lesson });

  // Send reveal in-thread
  const revealMsg = scenario.stages[scenario.stages.length - 1]?.scriptedFallback ??
    "🛑 PRACTICE SCAM — This was a Safe Signal exercise.";
  await ctx.channel.send(session.userId, revealMsg, session.id);

  // Update skills stats
  updateSkillStats(session.userId, scenario, false);

  return { session: getSessionByToken(token)!, lesson };
}

// ── Session timeout cleanup ───────────────────────────────────────────────────
export async function timeoutSession(sessionId: string, scenario: Scenario, ctx: StateMachineContext): Promise<void> {
  const session = getSessionById(sessionId);
  if (!session) return;
  if (["ended_caught", "ended_fell", "ended_timeout", "opted_out"].includes(session.state)) return;
  await endSession(session, scenario, "timeout", ctx);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function revealSession(
  session: Session,
  scenario: Scenario,
  ctx: StateMachineContext,
  piiCategories: string[]
): Promise<void> {
  const catList = piiCategories.join(", ");
  const revealText =
    `🛑 SAFE SIGNAL PRACTICE — This was a practice scam from T-Life.\n\n` +
    `You shared: ${catList}. Scammers use this to steal identities and access accounts.\n\n` +
    `See your full lesson in the T-Life app. 👇`;

  await ctx.channel.send(session.userId, revealText, session.id);
  const lesson = await buildLesson(session, scenario);
  updateSessionState(session.id, "ended_fell", {
    outcome: "fell_for_it",
    endedAt: new Date().toISOString(),
    lesson,
  });
  updateSkillStats(session.userId, scenario, false);
}

async function sendNiceCatch(
  session: Session,
  scenario: Scenario,
  ctx: StateMachineContext
): Promise<void> {
  const allFlags = Object.values(scenario.redFlagsByStage).flat();
  const unique = Array.from(new Map(allFlags.map((f) => [f.category, f])).values());
  const flagList = unique.map((f) => `• ${f.explanation}`).join("\n");

  const msg =
    `🎉 Nice catch! This was a Safe Signal practice scam.\n\nRed flags you spotted:\n${flagList}\n\n` +
    `See your full lesson → ${ctx.baseUrl}/p/${session.token}`;

  await ctx.channel.send(session.userId, msg, session.id);
}

async function endSession(
  session: Session,
  scenario: Scenario,
  outcome: Outcome,
  ctx: StateMachineContext
): Promise<void> {
  const stateMap: Record<Outcome, SessionState> = {
    caught: "ended_caught",
    fell_for_it: "ended_fell",
    timeout: "ended_timeout",
    opted_out: "opted_out",
  };

  const lesson = outcome !== "opted_out" ? await buildLesson(session, scenario) : undefined;
  updateSessionState(session.id, stateMap[outcome], {
    outcome,
    endedAt: new Date().toISOString(),
    lesson,
  });
  if (outcome !== "opted_out") {
    updateSkillStats(session.userId, scenario, outcome === "caught");
  }
}

function saveUserMessage(sessionId: string, text: string, state: string, scenario: Scenario): void {
  const detection = runRules({ text });
  const msg: SessionMessage = {
    id: nanoid(),
    role: "user",
    text,
    redactedText: text, // actual redaction happens in repository.saveMessage
    stageAtSend: state,
    redFlags: detection.flags.map((f) => ({
      category: f.category,
      startChar: f.span.start,
      endChar: f.span.end,
      explanation: f.explanation,
    })),
    sentAt: new Date().toISOString(),
  };
  saveMessage(sessionId, msg);
}

function stageToState(stageName: string): SessionState {
  const map: Record<string, SessionState> = {
    hook: "hook_sent",
    engage: "engaging",
    escalate: "escalating",
    ask: "link_sent",
    reveal: "ended_fell",
  };
  return map[stageName] ?? "engaging";
}

function updateSkillStats(userId: string, scenario: Scenario, caught: boolean): void {
  const categories = new Set(
    Object.values(scenario.redFlagsByStage)
      .flat()
      .map((f) => f.category)
  );
  for (const cat of categories) {
    upsertSkillStat(userId, cat, caught);
  }
}

export async function loadScenario(scenarioId: string): Promise<Scenario | null> {
  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const { fileURLToPath } = await import("url");
    const dir = fileURLToPath(new URL("../../../../packages/shared/scenarios", import.meta.url));
    const raw = readFileSync(join(dir, `${scenarioId}.json`), "utf-8");
    return JSON.parse(raw) as Scenario;
  } catch {
    return null;
  }
}

export function listScenarios(): Scenario[] {
  const { readdirSync, readFileSync } = _require("fs");
  const { join } = _require("path");
  const { fileURLToPath } = _require("url");
  const dir = fileURLToPath(new URL("../../../../packages/shared/scenarios", import.meta.url));
  return readdirSync(dir)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => JSON.parse(readFileSync(join(dir, f), "utf-8")));
}

import { createRequire } from "module";
const _require = createRequire(import.meta.url);

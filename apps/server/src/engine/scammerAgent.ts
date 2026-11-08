import type { Scenario, ScenarioStage, SessionMessage } from "@safe-signal/shared";
import { createLLMClient } from "../llm/LLMClient.js";

interface ScammerReplyInput {
  scenario: Scenario;
  stage: ScenarioStage;
  conversationHistory: SessionMessage[];
  practiceLink: string;
}

const SAFETY_CONSTRAINTS = `
SAFETY RULES (never violate):
1. Only link to the {{PRACTICE_LINK}} placeholder — no other URLs
2. Never ask for real passwords, real card numbers, or real SSNs
3. Never impersonate real government agencies (IRS, SSA, FBI)
4. Never impersonate real banks (Wells Fargo, Chase, etc.)
5. Keep messages under 300 characters
6. Do not break character or reference this being a training exercise
`.trim();

export async function generateScammerReply(input: ScammerReplyInput): Promise<string> {
  const { scenario, stage, conversationHistory, practiceLink } = input;

  const history = conversationHistory
    .map((m) => `${m.role === "scammer" ? "YOU" : "TARGET"}: ${m.redactedText}`)
    .join("\n");

  const prompt = `You are playing a scammer character for a safety training exercise.

SCENARIO: ${scenario.category} scam impersonating "${scenario.brand}"
CURRENT STAGE: ${stage.name}
STAGE GUIDANCE: ${stage.llmGuidance}
PRACTICE LINK (use as {{PRACTICE_LINK}}): ${practiceLink}

${SAFETY_CONSTRAINTS}

CONVERSATION SO FAR:
${history || "(no messages yet)"}

Write ONLY the next scammer message. No labels, no quotes. Just the message text.`;

  const llm = createLLMClient();
  const reply = await llm.complete(prompt);
  return reply.trim().replace("{{PRACTICE_LINK}}", practiceLink);
}

import type { DetectionInput, DetectionResult, DetectedFlag } from "../types.js";

export interface LLMClassifierDeps {
  callLLM: (prompt: string) => Promise<string>;
}

const SYSTEM_PROMPT = `You are a scam detection expert. Analyze the following message and respond with ONLY valid JSON in this exact shape:
{
  "label": "scam" | "suspicious" | "likely_safe",
  "confidence": <number 0.0 to 1.0>,
  "redFlags": [
    {
      "category": "urgency" | "impersonation" | "secrecy" | "unusual_payment_or_code" | "suspicious_link_or_sender" | "too_good_to_be_true",
      "span": { "start": <char index>, "end": <char index> },
      "explanation": "<one sentence>"
    }
  ],
  "reasons": ["<one sentence per reason>"]
}

Rules:
- "scam": high confidence this is fraudulent
- "suspicious": something feels off but could be legitimate
- "likely_safe": no meaningful red flags
- Be conservative — only mark "scam" with strong evidence
- When uncertain, use "suspicious" with honest reasons
- Identify exact character spans for red flags`;

export async function classifyWithLLM(
  input: DetectionInput,
  deps: LLMClassifierDeps
): Promise<DetectionResult | null> {
  const userMessage = `Message to analyze:\n"${input.text}"\n\nAdditional context:\n- Sender known: ${input.senderKnown ?? "unknown"}\n- Channel: ${input.channel ?? "unknown"}`;

  try {
    const raw = await deps.callLLM(`${SYSTEM_PROMPT}\n\n${userMessage}`);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as DetectionResult;

    // Validate required fields
    if (!["scam", "suspicious", "likely_safe"].includes(parsed.label)) return null;
    if (typeof parsed.confidence !== "number") return null;

    return {
      label: parsed.label,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      redFlags: (parsed.redFlags ?? []) as DetectedFlag[],
      reasons: parsed.reasons ?? [],
    };
  } catch {
    return null;
  }
}

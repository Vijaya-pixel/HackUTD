import { runRules } from "./rules.js";
import { classifyWithLLM, type LLMClassifierDeps } from "./llmClassifier.js";
import type { DetectionInput, DetectionResult, DetectionLabel } from "../types.js";

export type { LLMClassifierDeps };
export { runRules };

const RULE_WEIGHT = 0.45;
const LLM_WEIGHT = 0.55;

function labelFromScore(score: number): DetectionLabel {
  if (score >= 0.65) return "scam";
  if (score >= 0.35) return "suspicious";
  return "likely_safe";
}

export async function detect(
  input: DetectionInput,
  llmDeps?: LLMClassifierDeps
): Promise<DetectionResult> {
  const rulesResult = runRules(input);

  // If no LLM available, fall back to rules only
  if (!llmDeps) {
    return {
      label: labelFromScore(rulesResult.score),
      confidence: rulesResult.score,
      redFlags: rulesResult.flags,
      reasons: rulesResult.reasons,
    };
  }

  const llmResult = await classifyWithLLM(input, llmDeps);

  if (!llmResult) {
    // LLM failed — use rules only but lower confidence
    return {
      label: labelFromScore(rulesResult.score * 0.9),
      confidence: rulesResult.score * 0.9,
      redFlags: rulesResult.flags,
      reasons: [...rulesResult.reasons, "LLM classification unavailable; using rules only"],
    };
  }

  // Combine scores
  const llmScore =
    llmResult.label === "scam"
      ? llmResult.confidence
      : llmResult.label === "suspicious"
      ? llmResult.confidence * 0.5
      : (1 - llmResult.confidence) * 0.1;

  const combined = RULE_WEIGHT * rulesResult.score + LLM_WEIGHT * llmScore;

  // Merge red flags (deduplicate by start span)
  const seen = new Set<number>();
  const mergedFlags = [...rulesResult.flags, ...llmResult.redFlags].filter((f) => {
    if (seen.has(f.span.start)) return false;
    seen.add(f.span.start);
    return true;
  });

  // When layers strongly disagree → "suspicious" with explanation
  const layersDisagree =
    (rulesResult.score > 0.6 && llmResult.label === "likely_safe") ||
    (rulesResult.score < 0.2 && llmResult.label === "scam");

  const finalLabel = layersDisagree ? "suspicious" : labelFromScore(combined);
  const finalConfidence = layersDisagree ? 0.5 : Math.min(0.99, combined);

  const reasons = Array.from(
    new Set([...rulesResult.reasons, ...llmResult.reasons])
  );
  if (layersDisagree) {
    reasons.push("Rules and AI classifier disagree — marked suspicious. Review manually.");
  }

  return {
    label: finalLabel,
    confidence: finalConfidence,
    redFlags: mergedFlags,
    reasons,
  };
}

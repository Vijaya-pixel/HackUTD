import { containsSensitivePII, detectPIICategories } from "../privacy/redact.js";

const SAFE_DOMAIN = (process.env["BASE_URL"] ?? "http://localhost:3000").replace(/^https?:\/\//, "");

/** Reject generated scammer messages that violate safety rules */
export function validateScammerReply(text: string): { ok: boolean; reason?: string } {
  // Must not ask for real credentials/money
  if (/\b(password|passwd|credential|bank\s+account\s+number|routing\s+number)\b/i.test(text)) {
    return { ok: false, reason: "Requests real credentials" };
  }
  // Must not contain external links (only our own domain or the {{PRACTICE_LINK}} placeholder)
  const urlMatches = text.match(/https?:\/\/[^\s]+/gi) ?? [];
  for (const url of urlMatches) {
    if (!url.includes(SAFE_DOMAIN) && !url.includes("{{PRACTICE_LINK}}")) {
      return { ok: false, reason: `External URL detected: ${url}` };
    }
  }
  // Must not impersonate real government agencies by name
  if (/\b(internal\s+revenue\s+service|social\s+security\s+administration|medicare|federal\s+bureau|department\s+of\s+justice)\b/i.test(text)) {
    return { ok: false, reason: "Impersonates real government agency" };
  }
  // Must not impersonate real banks (beyond our fictional ones)
  if (/\b(wells\s+fargo|bank\s+of\s+america|chase\s+bank|citibank|jpmorgan)\b/i.test(text)) {
    return { ok: false, reason: "Impersonates real bank" };
  }
  return { ok: true };
}

/** Check if a user message contains PII that should trigger an immediate reveal */
export function userMessageTriggerReveal(text: string): {
  shouldReveal: boolean;
  piiCategories: string[];
} {
  const categories = detectPIICategories(text);
  return { shouldReveal: categories.length > 0, piiCategories: categories };
}

/** Detect refusal / report intent in a user message */
export function detectRefusal(text: string): boolean {
  return /\b(stop\s+practice|stopscam|stop\s+scam|this\s+is\s+a\s+scam|you'?re\s+a\s+scammer|block(ing)?(\s+you)?|report(ing)?(\s+to)?\s+7726|forwarding\s+to\s+7726|spam|scam)\b/i.test(
    text
  );
}

export function detectOptOut(text: string): boolean {
  return /\bstop\s+practice\b/i.test(text);
}

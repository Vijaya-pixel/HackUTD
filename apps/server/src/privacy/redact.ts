interface RedactionPattern {
  pattern: RegExp;
  replacement: string;
}

const PATTERNS: RedactionPattern[] = [
  // Card numbers (13-19 digits, with optional separators)
  { pattern: /\b(?:\d[ -]?){13,19}\b/g, replacement: "[CARD_NUMBER]" },
  // SSN
  { pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, replacement: "[SSN]" },
  // Phone numbers
  { pattern: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: "[PHONE]" },
  // Email addresses
  { pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g, replacement: "[EMAIL]" },
  // Street addresses (number + street name)
  { pattern: /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,4}(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl)\b\.?/gi, replacement: "[ADDRESS]" },
  // ZIP codes (5-digit, optionally with +4)
  { pattern: /\b\d{5}(?:-\d{4})?\b/g, replacement: "[ZIP]" },
  // 6-digit OTP / verification codes
  { pattern: /\b\d{6}\b/g, replacement: "[CODE]" },
  // Bank account numbers (8-17 digits standalone)
  { pattern: /\b\d{8,17}\b/g, replacement: "[ACCOUNT]" },
  // Routing numbers (9 digits)
  { pattern: /\b\d{9}\b/g, replacement: "[ROUTING]" },
];

export function redact(text: string): string {
  let result = text;
  for (const { pattern, replacement } of PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Returns the category label of what was detected, without exposing the value */
export function detectPIICategories(text: string): string[] {
  const found: string[] = [];
  const checks: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\b(?:\d[ -]?){13,19}\b/, label: "card number" },
    { pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/, label: "SSN" },
    { pattern: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/, label: "phone number" },
    { pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/, label: "email address" },
    { pattern: /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,4}(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl)\b/i, label: "street address" },
    { pattern: /\b\d{6}\b/, label: "verification code" },
  ];
  for (const { pattern, label } of checks) {
    if (pattern.test(text)) found.push(label);
  }
  return found;
}

export function containsSensitivePII(text: string): boolean {
  return detectPIICategories(text).length > 0;
}

import type { DetectedFlag, RedFlagCategory, DetectionInput } from "../types.js";

interface Rule {
  category: RedFlagCategory;
  pattern: RegExp;
  explanation: string;
  weight: number; // 0..1 contribution to scam score
}

const RULES: Rule[] = [
  // ── Urgency ───────────────────────────────────────────────────────────────
  {
    category: "urgency",
    pattern: /\b(within\s+\d+\s*(hour|hr|minute|min)|expires?\s+in|act\s+now|immediately|right\s+now|urgent|asap|time\s+is\s+running\s+out|limited\s+time|today\s+only|before\s+midnight|final\s+notice|last\s+chance)\b/gi,
    explanation: "Artificial time pressure designed to prevent careful thinking",
    weight: 0.35,
  },
  {
    category: "urgency",
    pattern: /\b(suspend|suspended|suspension|revoke|terminated|disabled|blocked|frozen|locked)\b/gi,
    explanation: "Threat of account action to trigger panic",
    weight: 0.4,
  },

  // ── Unusual payment / code ────────────────────────────────────────────────
  {
    category: "unusual_payment_or_code",
    pattern: /\b(zelle|cashapp|venmo|bitcoin|crypto|wire\s+transfer|gift\s+card|google\s+play|itunes|amazon\s+card|prepaid\s+card)\b/gi,
    explanation: "Untraceable payment method favored by scammers",
    weight: 0.65,
  },
  {
    category: "unusual_payment_or_code",
    pattern: /\b(one[- ]time\s+code|otp|verification\s+code|security\s+code|pin|passcode|read\s+(it\s+)?back|tell\s+me\s+the\s+code)\b/gi,
    explanation: "Requesting an OTP or PIN over chat is always fraudulent",
    weight: 0.75,
  },
  {
    category: "unusual_payment_or_code",
    pattern: /\b(\$\s*\d+(\.\d{1,2})?\s*(fee|deposit|charge|payment|processing|refundable))\b/gi,
    explanation: "Unexpected fee request is a scam hallmark",
    weight: 0.5,
  },

  // ── Suspicious link / sender ──────────────────────────────────────────────
  {
    category: "suspicious_link_or_sender",
    pattern: /https?:\/\/(?!(?:[\w-]+\.)*(t-mobile|parcelgo|tollpass|northlinebank|nextstep)\.(?:com|net|org)\b)[^\s]{6,}/gi,
    explanation: "Link does not match the official domain of the claimed sender",
    weight: 0.55,
  },
  {
    category: "suspicious_link_or_sender",
    pattern: /\b(bit\.ly|tinyurl|short\.link|rb\.gy|ow\.ly|t\.co(?!m)|cutt\.ly)\b/gi,
    explanation: "URL shortener hides the true destination",
    weight: 0.6,
  },
  {
    category: "suspicious_link_or_sender",
    pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b.*\b(new\s+number|lost\s+my\s+phone|borrowed|different\s+number)\b/gi,
    explanation: "New/unknown number claiming to be known contact",
    weight: 0.45,
  },

  // ── Impersonation ─────────────────────────────────────────────────────────
  {
    category: "impersonation",
    pattern: /\b(irs|social\s+security|medicare|dmv|fbi|dea|customs|immigration|federal)\b/gi,
    explanation: "Government agency impersonation is a major fraud category",
    weight: 0.7,
  },
  {
    category: "impersonation",
    pattern: /\b(fraud\s+(prevention|department|team)|security\s+(team|department)|account\s+specialist|case\s+#|ref\s+#|ticket\s+#)\b/gi,
    explanation: "Fake official reference numbers create false legitimacy",
    weight: 0.3,
  },

  // ── Secrecy ───────────────────────────────────────────────────────────────
  {
    category: "secrecy",
    pattern: /\b(don'?t\s+tell|keep\s+(this|it)\s+(between|private|secret|quiet)|don'?t\s+(share|mention|call|contact)|do\s+not\s+call|don'?t\s+use\s+(your\s+)?(old|regular)\s+(number|phone|email))\b/gi,
    explanation: "Instructions to keep the contact secret prevent you from verifying with trusted people",
    weight: 0.6,
  },

  // ── Too good to be true ───────────────────────────────────────────────────
  {
    category: "too_good_to_be_true",
    pattern: /\b(you'?ve?\s+(been\s+)?(selected|chosen|won|qualified|approved)|congratulations|you\s+(are|have\s+been)\s+(a\s+)?(winner|recipient)|random(ly)?\s+(selected|chosen))\b/gi,
    explanation: "Winning or being selected without entering a contest is a classic scam opener",
    weight: 0.45,
  },
  {
    category: "too_good_to_be_true",
    pattern: /\b(no\s+experience\s+(required|needed)|work\s+from\s+home|flexible\s+hours|\$\s*\d{3,}\s*\/\s*(week|day|hr|hour))\b/gi,
    explanation: "Unrealistic job or income offer",
    weight: 0.4,
  },
];

export interface RulesResult {
  score: number;
  flags: DetectedFlag[];
  reasons: string[];
}

export function runRules(input: DetectionInput): RulesResult {
  const { text } = input;
  const flags: DetectedFlag[] = [];
  const reasons: string[] = [];
  let totalWeight = 0;

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    let matched = false;
    while ((match = rule.pattern.exec(text)) !== null) {
      flags.push({
        category: rule.category,
        span: { start: match.index, end: match.index + match[0].length },
        explanation: rule.explanation,
      });
      if (!matched) {
        totalWeight += rule.weight;
        reasons.push(rule.explanation);
        matched = true;
      }
    }
  }

  // If sender is unknown, bump score
  const senderBonus = input.senderKnown === false ? 0.15 : 0;

  // Cap at 1.0
  const score = Math.min(1.0, totalWeight + senderBonus);

  return { score, flags, reasons };
}

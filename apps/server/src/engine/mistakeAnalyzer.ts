import type { Session, Scenario, Lesson, AnnotatedMessage, RedFlagCategory, RedFlagSpan } from "@safe-signal/shared";
import { createLLMClient } from "../llm/LLMClient.js";
import { runRules } from "@safe-signal/shared/detection";

const MISTAKE_RULES: Array<{
  test: (msgs: Session["messages"]) => boolean;
  label: string;
}> = [
  {
    test: (msgs) => msgs.some((m) => m.role === "user" && m.redFlags.some((f) => f.category === "suspicious_link_or_sender")),
    label: "Replied to a message from an unknown or suspicious sender",
  },
  {
    test: (msgs) => msgs.some((m) => m.role === "user" && m.redFlags.some((f) => f.category === "unusual_payment_or_code")),
    label: "Engaged with a request involving payment or a code",
  },
  {
    test: (msgs) => {
      const userCount = msgs.filter((m) => m.role === "user").length;
      const scammerFlags = msgs
        .filter((m) => m.role === "scammer")
        .flatMap((m) => m.redFlags);
      return userCount >= 3 && scammerFlags.length > 0;
    },
    label: "Continued the conversation after multiple red flags appeared",
  },
  {
    test: (msgs) => msgs.some((m) => m.role === "scammer" && m.stageAtSend === "ask") &&
      msgs.some((m) => m.role === "user" && msgs.indexOf(m) > msgs.findIndex((x) => x.stageAtSend === "ask")),
    label: "Responded after being asked for payment or personal information",
  },
];

export async function buildLesson(session: Session, scenario: Scenario): Promise<Lesson> {
  const msgs = session.messages;

  // ── Annotated replay ──────────────────────────────────────────────────────
  const replay: AnnotatedMessage[] = msgs.map((m) => ({
    id: m.id,
    role: m.role,
    text: m.role === "scammer" ? m.redactedText : describeUserMessage(m.redactedText),
    redFlags: m.redFlags,
  }));

  // ── Deterministic mistakes ────────────────────────────────────────────────
  const mistakes = MISTAKE_RULES
    .filter((r) => r.test(msgs))
    .map((r) => r.label);

  // ── Strengths ─────────────────────────────────────────────────────────────
  const strengths: string[] = [];
  const totalScammerMsgs = msgs.filter((m) => m.role === "scammer").length;
  const totalUserMsgs = msgs.filter((m) => m.role === "user").length;
  if (totalUserMsgs === 0) strengths.push("You didn't engage with the scam at all");
  if (totalUserMsgs < totalScammerMsgs) strengths.push("You kept your replies brief, limiting what the scammer could use");

  // ── Weakest red-flag category (for next session) ──────────────────────────
  const encountered = new Map<RedFlagCategory, number>();
  const caught = new Map<RedFlagCategory, number>();
  for (const m of msgs.filter((x) => x.role === "scammer")) {
    for (const f of m.redFlags) {
      encountered.set(f.category, (encountered.get(f.category) ?? 0) + 1);
    }
  }
  // Categories the user flagged themselves (via their own detection)
  for (const m of msgs.filter((x) => x.role === "user")) {
    for (const f of m.redFlags) {
      caught.set(f.category, (caught.get(f.category) ?? 0) + 1);
    }
  }

  let weakest: RedFlagCategory = "urgency";
  let lowestScore = Infinity;
  for (const [cat, enc] of encountered) {
    const c = caught.get(cat) ?? 0;
    const score = c / enc;
    if (score < lowestScore) {
      lowestScore = score;
      weakest = cat;
    }
  }

  // ── LLM-generated rule and wording improvement ───────────────────────────
  let ruleToRemember = defaultRule(scenario.category);
  try {
    const llm = createLLMClient();
    const allScammerFlags = msgs
      .filter((m) => m.role === "scammer")
      .flatMap((m) => m.redFlags)
      .map((f) => f.explanation);

    const prompt = `A user just completed a ${scenario.category} scam training exercise (outcome: ${session.outcome}).

Scam brand: ${scenario.brand}
Red flags in this scenario: ${[...new Set(allScammerFlags)].join("; ")}
Mistakes made: ${mistakes.join("; ") || "none"}

Write ONE clear, memorable rule under 25 words that this person should remember.
Focus on the most important lesson from this specific scenario.
Respond with just the rule, no preamble.`;

    const response = await llm.complete(prompt);
    if (response.trim().length < 150) {
      ruleToRemember = response.trim();
    }
  } catch {
    // Fall back to default rule
  }

  return {
    sessionId: session.id,
    outcome: session.outcome ?? "fell_for_it",
    replay,
    mistakes,
    strengths: strengths.length > 0 ? strengths : ["You completed this practice session"],
    ruleToRemember,
    nextWeakCategory: weakest,
    generatedAt: new Date().toISOString(),
  };
}

function describeUserMessage(redactedText: string): string {
  if (redactedText.includes("[CODE]")) return "You shared a verification code";
  if (redactedText.includes("[CARD_NUMBER]")) return "You shared a card number";
  if (redactedText.includes("[SSN]")) return "You shared a Social Security number";
  if (redactedText.includes("[PHONE]")) return "You shared a phone number";
  if (redactedText.includes("[EMAIL]")) return "You shared an email address";
  if (redactedText.includes("[ACCOUNT]")) return "You shared an account number";
  // Describe by length/engagement rather than quoting
  const wordCount = redactedText.trim().split(/\s+/).length;
  if (wordCount <= 3) return "You sent a short reply";
  if (wordCount <= 10) return "You engaged with the scammer's message";
  return "You sent a detailed reply to the scammer";
}

function defaultRule(category: string): string {
  const defaults: Record<string, string> = {
    package_delivery: "Real carriers never charge redelivery fees by SMS link.",
    toll_fee: "Official toll agencies send mail — never text payment links.",
    job_offer: "Legitimate employers never charge fees to get a job.",
    family_emergency: "Always call your family member's known number to verify emergencies.",
    bank_alert: "Your bank will never ask for your PIN or OTP over text.",
    tmobile_account: "T-Mobile will never ask for your account PIN or OTP via text.",
  };
  return defaults[category] ?? "When in doubt, hang up and call the official number on the company's website.";
}

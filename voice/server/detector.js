// Explainable scam detector for call transcripts.
//
// Each signal is a pattern group with a weight (roughly: "how likely is this a
// scam if we hear this, on its own"). Matched weights are combined with a
// noisy-OR, so several weak signals add up but the score never reaches 100%.
// Every point of the score can be traced to a phrase the caller said, which
// is what we show the user. Swap in an LLM later behind the same interface.

const SIGNALS = [
  {
    id: "payment",
    label: "Asked for gift cards, crypto, or a wire transfer",
    weight: 0.55,
    patterns: [/gift ?cards?/, /google play/, /apple (gift )?card/, /itunes/, /bitcoin/, /crypto/, /wire (the )?(money|transfer)/, /western union/, /zelle/, /cash ?app/, /\bvenmo\b/],
  },
  {
    id: "credentials",
    label: "Asked for codes, PINs, or your SSN",
    weight: 0.45,
    patterns: [/social security number/, /verification code/, /one[- ]time (pass)?code/, /\bpin\b/, /password/, /read (me )?(the|that) code/, /account number/, /code we (just )?sent/],
  },
  {
    id: "secrecy",
    label: "Told you to keep it secret or stay on the line",
    weight: 0.4,
    patterns: [/don'?t tell/, /do not tell/, /keep this between/, /don'?t hang up/, /do not hang up/, /stay on the line/, /confidential/],
  },
  {
    id: "remote",
    label: "Asked you to install an app or give remote access",
    weight: 0.4,
    patterns: [/anydesk/, /teamviewer/, /remote access/, /download (this|an|the) app/, /install/],
  },
  {
    id: "threat",
    label: "Threatened arrest, fines, or a frozen account",
    weight: 0.35,
    patterns: [/arrest/, /warrant/, /legal action/, /lawsuit/, /suspended/, /frozen/, /locked/, /deported/, /penalt(y|ies)/],
  },
  {
    id: "urgency",
    label: "Pressured you to act right now",
    weight: 0.25,
    patterns: [/immediately/, /right now/, /within the (next )?hour/, /today or/, /before (it'?s|its) too late/, /as soon as possible/, /urgent/],
  },
  {
    id: "authority_gov",
    label: "Claimed to be from a government agency or police",
    weight: 0.2,
    patterns: [/\birs\b/, /internal revenue/, /social security administration/, /sheriff/, /police/, /\bfbi\b/],
  },
  {
    id: "authority_company",
    label: "Claimed to be from your bank or a big company",
    weight: 0.2,
    patterns: [/fraud department/, /security (department|team)/, /\bchase\b/, /wells fargo/, /bank of america/, /microsoft/, /apple support/, /amazon/],
  },
  {
    id: "family",
    label: "Family emergency story (accident, jail, bail)",
    weight: 0.3,
    patterns: [/grand(ma|pa|mother|father)/, /\bbail\b/, /\bjail\b/, /accident/, /don'?t tell (mom|dad)/],
  },
  {
    id: "prize",
    label: "Prize, refund, or money you didn't expect",
    weight: 0.3,
    patterns: [/you'?ve won/, /\bprize\b/, /lottery/, /sweepstakes/, /refund/],
  },
];

// Checked in order; the first match wins.
const CATEGORIES = [
  {
    id: "family",
    name: "Family emergency scam",
    when: (s) => s.has("family"),
    say: "Let me call you right back on your own number.",
    do: "Hang up and call your family member directly. Don't send bail money or gift cards.",
  },
  {
    id: "tech",
    name: "Tech support scam",
    when: (s) => s.has("remote"),
    say: "I don't install software for people who call me.",
    do: "Hang up. Don't install anything or give anyone remote access.",
  },
  {
    id: "government",
    name: "Government impersonation",
    when: (s) => s.has("authority_gov"),
    say: "I don't handle government matters over the phone. Please mail me an official letter.",
    do: "Hang up. The IRS and SSA never call to demand gift cards or threaten arrest.",
  },
  {
    id: "bank",
    name: "Bank impersonation",
    when: (s) => s.has("authority_company") || s.has("credentials"),
    say: "I'll call my bank back using the number on the back of my card.",
    do: "Hang up. Never read out a code that was texted to you. Your bank will never ask for it.",
  },
  {
    id: "prize",
    name: "Prize or refund scam",
    when: (s) => s.has("prize"),
    say: "I'm not interested. Please remove my number.",
    do: "Hang up. Real prizes never require you to pay first.",
  },
];

const GENERIC = {
  id: "generic",
  name: "Suspicious call",
  say: "I'm not comfortable with this. I'll contact the company myself.",
  do: "Don't share personal info or send money. Hang up if they keep pushing.",
};

export function analyzeTranscript(transcript, { voiceMatch = null, aiVoice = null } = {}) {
  const text = String(transcript || "").toLowerCase().slice(0, 20000);

  const matched = [];
  for (const signal of SIGNALS) {
    for (const re of signal.patterns) {
      const m = text.match(re);
      if (m) {
        matched.push({ id: signal.id, label: signal.label, weight: signal.weight, evidence: m[0] });
        break;
      }
    }
  }

  // The caller passes voiceMatch only when the voice matched a reported scammer.
  // Strong evidence, but on its own it only reaches "suspicious" (0.6).
  if (voiceMatch && typeof voiceMatch.similarity === "number") {
    matched.push({
      id: "voiceprint",
      label: `Voice matches a reported scam caller (${Math.round(voiceMatch.similarity * 100)}% similar)`,
      weight: 0.6,
      evidence: null,
    });
  }

  // AI-generated voice: a real warning sign (voice-cloning scams), but the
  // detector can be fooled by bad phone lines, so it carries moderate weight.
  if (aiVoice?.status === "likely") {
    matched.push({
      id: "ai_voice",
      label: `Voice sounds AI-generated (${Math.round(aiVoice.probability * 100)}%)`,
      weight: 0.35,
      evidence: null,
    });
  }

  const score = 1 - matched.reduce((p, s) => p * (1 - s.weight), 1);
  const ids = new Set(matched.map((s) => s.id));
  const category = CATEGORIES.find((c) => c.when(ids)) || GENERIC;

  let level = "safe";
  if (score >= 0.65) level = "scam";
  else if (score >= 0.35) level = "suspicious";

  return {
    score: Math.round(score * 100) / 100,
    level,
    category: { id: category.id, name: category.name },
    signals: matched.sort((a, b) => b.weight - a.weight),
    advice: { say: category.say, do: category.do },
    summary: summarize(matched),
  };
}

// One calm sentence about who the caller claims to be and what they want.
const WHO = [
  [/irs|internal revenue/, "the IRS"], [/social security/, "Social Security"], [/sheriff|police/, "the police"],
  [/fbi/, "the FBI"], [/chase/, "Chase"], [/wells fargo/, "Wells Fargo"], [/bank of america/, "Bank of America"],
  [/fraud department|security/, "your bank's fraud team"], [/microsoft/, "Microsoft"], [/apple/, "Apple"], [/amazon/, "Amazon"],
  [/grand/, "a grandchild"],
];

function summarize(signals) {
  const get = (id) => signals.find((s) => s.id === id)?.evidence;
  const whoEv = get("authority_gov") || get("authority_company") || get("family");
  const who = whoEv ? (WHO.find(([re]) => re.test(whoEv))?.[1] || whoEv) : null;
  const wants = [];
  if (get("payment")) wants.push(`payment with ${get("payment")}`);
  if (get("credentials")) wants.push(`your ${get("credentials").replace(/^read (me )?(the|that) /, "")}`);
  if (get("remote")) wants.push("access to your device");
  const pressure = [];
  const THREAT = { arrest: "arrest", warrant: "arrest", "legal action": "legal action", lawsuit: "a lawsuit", suspended: "to suspend your account", frozen: "to freeze your account", locked: "to lock your account", deported: "deportation" };
  if (get("threat")) pressure.push(`threatening ${THREAT[get("threat")] || "penalties"}`);
  if (get("secrecy")) pressure.push("asking you to keep it quiet");
  if (get("urgency")) pressure.push("rushing you");
  if (get("prize")) pressure.push(`talking about a ${get("prize")}`);

  const parts = [];
  if (signals.some((s) => s.id === "ai_voice")) parts.push("Sounds like an AI voice");
  if (who) parts.push(`Says they're ${who === "a grandchild" ? "a grandchild" : `from ${who}`}`);
  if (wants.length) parts.push(`Wants ${wants.join(" and ")}`);
  if (pressure.length) parts.push(pressure.join(", ").replace(/^./, (c) => c.toUpperCase()));
  return parts.length ? `${parts.join(". ")}.` : "Nothing unusual so far.";
}

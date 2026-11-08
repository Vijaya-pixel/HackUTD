// Writes each scammer reply in the scam drill using Gemini, so the
// conversation responds to what the target actually says instead of
// playing back fixed lines. Needs GEMINI_API_KEY in .env.
// Docs: https://ai.google.dev/gemini-api/docs/text-generation
//
// The model is told the persona, the goal (get them to tap a link), and the
// red flags it should plant along the way. It must answer with strict JSON:
// { "reply": "...", "sendLink": true|false }. sendLink is only honored once
// the model has sent at least one earlier message (see drill.js), so the
// very first text is always a soft opener, never the hook.

const { GEMINI_API_KEY, DRILL_MODEL } = process.env;
export const brainConfigured = Boolean(GEMINI_API_KEY);
const MODEL = DRILL_MODEL || "gemini-3.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function systemPrompt(scenario, user) {
  return [
    `You are playing the role of a scammer in a SAFE, CONSENTED scam-awareness drill. The "target" (${user.name}) signed up to be tested and knows drills like this happen, just not when.`,
    `Persona: ${scenario.persona}`,
    `Goal: get the target to tap a link by sounding like a real, time-pressured, slightly-too-friendly scam text. Build a little rapport first, then create urgency, then ask them to tap the link.`,
    `Rules:`,
    `- Write like a real text message: short, casual, no markdown, no emoji spam (0-1 max).`,
    `- Never ask for or accept real passwords, card numbers, or SSNs in the chat itself — the "ask" always happens by sending the link, not by asking them to type sensitive info into the chat.`,
    `- Once you decide to send the link, set sendLink true and put exactly the placeholder "{LINK}" in your reply where the link should go. Only do this once per conversation.`,
    `- Keep replies under 300 characters.`,
    `- If the target seems suspicious or pushes back, you may try one reassurance, but do not become aggressive or abusive.`,
  ].join("\n");
}

// Forces the exact { reply, sendLink } shape via Gemini's structured output,
// instead of relying on the model to format raw JSON correctly in prose.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING", description: "The next text message to send, in character." },
    sendLink: { type: "BOOLEAN", description: "True only if `reply` contains the {LINK} placeholder." },
  },
  required: ["reply", "sendLink"],
};

// history: [{role: "assistant"|"user", text}], oldest first.
export async function nextScammerReply({ scenario, user, history }) {
  if (!brainConfigured) {
    return { reply: null, sendLink: false, reason: "GEMINI_API_KEY not set" };
  }
  // Gemini has no system role in `contents`; it goes in `systemInstruction`.
  // Its two content roles are "user" and "model" (not "assistant").
  const contents = history.length
    ? history.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.text }] }))
    : [{ role: "user", parts: [{ text: "(Start the conversation with your opening text.)" }] }];

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(scenario, user) }] },
      contents,
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 1024, // this model spends tokens "thinking" before answering; 200 was too tight
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { reply: raw.slice(0, 300), sendLink: false };
  }
  return { reply: String(parsed.reply || "").slice(0, 400), sendLink: Boolean(parsed.sendLink) };
}

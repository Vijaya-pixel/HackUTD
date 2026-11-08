// Scam drill: a believable, AI-written text conversation tailored to a
// participant's preferences. Logs whether they tapped the link, and always
// teaches the red flags afterwards.
//
// Why a conversation instead of one text: real scams build trust first and
// only send the link once the target engages. An LLM (drillbrain.js) plays
// the scammer persona live, over real-time two-way iMessage (spectrum.js),
// and decides for itself when to send the link.
//
// Safety rules baked in:
//  - only participants with consent = true are ever texted
//  - the link goes to OUR landing page (/d/:token), which collects nothing and
//    immediately explains that this was a drill
//  - a debrief text is always sent, even if they never reply or never click
//  - the model is instructed to never request real passwords/card/SSN in-chat

import * as db from "./drilldb.js";
import { dmFor, listen } from "./spectrum.js";
import { nextScammerReply, brainConfigured } from "./drillbrain.js";

const BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
const DEBRIEF_MINUTES = Number(process.env.DRILL_DEBRIEF_MINUTES) || 10;

const pick = (arr, fallback) => (Array.isArray(arr) && arr.length ? arr[Math.floor(Math.random() * arr.length)] : fallback);
const likes = (p, word) => Array.isArray(p.interests) && p.interests.some((i) => String(i).toLowerCase().includes(word));

// Each scenario gives the LLM a persona and a goal; it writes every line.
// `flags` is what the debrief teaches afterwards.
const SCENARIOS = [
  {
    id: "scholarship",
    applies: (p) => likes(p, "scholarship"),
    persona: (u) => `"Morgan" from ${u.preferences.school || "the National Student Aid Office"}, calling about a $2,500 scholarship the target supposedly qualifies for. There's a small "processing fee" and a same-day deadline.`,
    flags: ["A scholarship you never applied for", "Paying a fee to receive money (real scholarships never charge)", "Same-day deadline created mid-conversation", "Friendly chat before the link, to build trust", "Link that isn't your school's official site"],
  },
  {
    id: "internship",
    applies: (p) => likes(p, "intern") || likes(p, "job"),
    persona: (u) => `"Rachel" from Talent Acquisition at ${pick(u.preferences.companies, "Deloitte")}, offering a remote paid internship at $38/hr with no interview, that needs an "onboarding" / "equipment check" step.`,
    flags: ["Unsolicited offer by text with no interview", "Pay that's too good for an internship", "\"Equipment check\" is a classic fake-check scam", "Casual small talk before the pitch, to seem legitimate", "Recruiter asks you to use a link instead of the company's careers portal"],
  },
  {
    id: "interview",
    applies: (p) => likes(p, "interview"),
    persona: (u) => `The "${pick(u.preferences.companies, "Amazon")} recruiting team", confirming a virtual interview the target doesn't remember scheduling, and needing "identity verification" (a photo ID upload) before the slot is released.`,
    flags: ["Interview you don't remember scheduling", "Asks for your ID before you've even met anyone", "Threat of losing your slot to rush you", "Casual confirmation question before the real ask, to build trust", "Real recruiters email from the company domain, not random texts"],
  },
  {
    id: "bank",
    applies: (p) => Boolean(p.bank),
    persona: (u) => `"${u.preferences.bank} Fraud Prevention", claiming unusual card activity and a temporary lock that needs to be "verified" to undo.`,
    flags: ["Fear about money to rush you", "Real banks never ask you to verify through a text link", "A yes/no question first, to get you engaged before the ask", "Link instead of the number on your card"],
  },
  {
    id: "carrier",
    applies: (p) => Boolean(p.carrier),
    persona: (u) => `"${u.preferences.carrier} billing", claiming a failed autopay and offering to "resend the payment link" with a same-day service suspension threat.`,
    flags: ["Threat of losing service", "Pressure to act today", "Asked permission first, which feels polite and lowers your guard", "Payment demanded through a text link, not the official app"],
  },
  {
    id: "package",
    applies: (p) => Boolean(p.shops?.length),
    persona: (u) => `"${pick(u.preferences.shops)} delivery", claiming a failed delivery attempt today and offering to reschedule for a small "redelivery fee".`,
    flags: ["Unexpected delivery you never ordered", "Small fee to get your card details", "Urgent deadline (24h)", "Link that is not the company's real website"],
  },
  {
    id: "prize",
    applies: () => true,
    persona: (u) => `An exciting "you've been entered into a $500 gift card drawing" text${u.preferences.interests?.length ? ` themed around ${pick(u.preferences.interests)}` : ""}, with a very short claim window.`,
    flags: ["Prize for a contest you never entered", "Very short time limit", "Free money is the bait", "Asked an exciting yes/no question to hook you before the link"],
  },
];

function pickScenario(user) {
  const options = SCENARIOS.filter((s) => s.id !== "prize" && s.applies(user.preferences || {}));
  return pick(options, SCENARIOS.find((x) => x.id === "prize"));
}

const debriefText = (flags) =>
  "✅ That was a scam-awareness drill, not a real conversation. Nothing was charged and no info was collected.\n" +
  `Red flags along the way:\n${flags.map((f) => `• ${f}`).join("\n")}\n` +
  "When in doubt: don't tap links in texts, and contact the company using the number on your card or their official app.";

function scheduleDebrief(handle, token, flags) {
  setTimeout(async () => {
    const m = await db.getByToken(token).catch(() => null);
    if (m && !m.debriefed_at) {
      const dm = await dmFor(handle).catch(() => null);
      if (dm) await dm.send(debriefText(flags)).catch((e) => console.error("drill: debrief send failed", e));
      await db.markDebriefed(token).catch(() => { });
    }
  }, DEBRIEF_MINUTES * 60_000).unref();
}

// Sends the scammer's next line into a space, records it in the
// conversation's history, and — if the model asked to — sends the hook link
// instead and ends the conversation.
async function sendTurn(space, convo, scenario, user) {
  const { reply, sendLink, reason } = await nextScammerReply({ scenario, user, history: convo.history });
  if (!reply) {
    console.warn(`drill: no reply generated for conversation ${convo.id}${reason ? ` (${reason})` : ""}`);
    return;
  }

  if (sendLink && convo.history.some((h) => h.role === "assistant")) {
    const row = await db.recordMessage({ userId: convo.user_id, scenario: scenario.id, body: "pending", redFlags: scenario.flags, status: "sent" });
    const link = `${BASE_URL}/d/${row.token}`;
    const text = reply.replaceAll("{LINK}", link);
    await space.send(text);
    await db.markStatus(row.token, text, "sent");
    convo.history = [...convo.history, { role: "assistant", text }];
    await db.markLinkSent(convo.id, row.token);
    await db.finishConversation(convo.id);
    scheduleDebrief(convo.handle, row.token, scenario.flags);
    return;
  }

  // Not sending the link yet (or it's the very first message, which is
  // never the hook): strip any stray placeholder and send as a normal line.
  const text = reply.replaceAll("{LINK}", "").trim();
  await space.send(text);
  convo.history = [...convo.history, { role: "assistant", text }];
  await db.appendHistory(convo.id, convo.history);
}

// Starts an AI-written conversation for each consenting user (or one
// handle). dryRun only previews the persona and opening line, without
// creating a conversation row or sending anything.
export async function runDrill({ handle, dryRun = true } = {}) {
  const users = await db.consentedUsers(handle);
  const out = [];
  for (const user of users) {
    const scenario = pickScenario(user);
    if (dryRun) {
      const preview = brainConfigured
        ? (await nextScammerReply({ scenario, user, history: [] }).catch((e) => ({ reply: `(LLM error: ${e.message})` }))).reply
        : "(no OPENAI_API_KEY set — nothing will be generated)";
      out.push({ user: user.name, handle: user.handle, scenario: scenario.id, persona: scenario.persona(user), opener: preview, dryRun: true });
      continue;
    }
    if (!brainConfigured) {
      out.push({ user: user.name, handle: user.handle, scenario: scenario.id, status: "simulated", reason: "OPENAI_API_KEY not set" });
      continue;
    }
    const existing = await db.getConversation(user.id, scenario.id);
    if (existing) {
      out.push({ user: user.name, handle: user.handle, scenario: scenario.id, status: "skipped", reason: "already has an active conversation" });
      continue;
    }
    const convo = await db.startConversation({ userId: user.id, scenario: scenario.id, history: [] });
    convo.history = [];
    try {
      const space = await dmFor(user.handle);
      await sendTurn(space, convo, scenario, user);
      out.push({ user: user.name, handle: user.handle, scenario: scenario.id, status: "sent", text: convo.history[0]?.text });
    } catch (e) {
      console.error("drill: failed to start conversation", e);
      await db.finishConversation(convo.id).catch(() => { });
      out.push({ user: user.name, handle: user.handle, scenario: scenario.id, status: "error", reason: e.message });
    }
  }
  return out;
}

// Wire this once at startup: listens for real-time inbound replies and
// advances whichever drill conversation they belong to.
export function startListening() {
  if (!db.drillDbConfigured || !brainConfigured) return;
  void listen(async (space, message) => {
    const handle = message.sender?.address || message.sender?.id;
    if (!handle) return;
    const convo = await db.findActiveConversationByHandle(handle);
    if (!convo) return; // not someone we're mid-drill with; ignore (e.g. other Photon traffic)
    const scenario = SCENARIOS.find((s) => s.id === convo.scenario);
    if (!scenario) return db.finishConversation(convo.id);
    convo.history = [...convo.history, { role: "user", text: message.content.text }];
    await db.appendHistory(convo.id, convo.history);
    const user = { name: convo.name, preferences: convo.preferences || {} };
    await sendTurn(space, convo, scenario, user).catch((e) => console.error("drill: turn failed", e));
  });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Landing page for the link in the drill text. Collects nothing.
export async function landingPage(token) {
  const m = await db.markClicked(token);
  if (!m) return null;
  await db.markDebriefed(token).catch(() => { });
  const flags = (m.red_flags || []).map((f) => `<li>${esc(f)}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scam drill</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a}h1{font-size:1.5rem}.box{background:#fff4e5;border:2px solid #e8590c;border-radius:12px;padding:1rem}</style></head><body>
<main><h1>You tapped the link. This was a drill.</h1>
<p class="box">Nothing was charged and we collected nothing. A real scammer would have used this page to steal your card or login.</p>
<h2>Red flags you could have spotted</h2><ul>${flags}</ul>
<h2>Next time</h2><p>Don't tap links in unexpected texts. Contact the company with the number on your card or in their official app.</p></main></body></html>`;
}

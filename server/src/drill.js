// Scam drill (education suite). A consenting participant is texted by an AI-written fake scammer that fits
// what they care about. If they tap the link they land on our debrief page; either way they are told it was a
// drill and sent back to the app to learn the red flags. Nothing real is collected or charged.
//
// Safety rules enforced here, not just in the UI:
//   - consent: true is required to start, and the participant picks their own phone number
//   - a shared Photon line cannot text first, so a number that never texted the line is never reached
//   - texting STOP at any time ends the drill and sends the debrief
//   - every drill ends with a debrief text, even if the person never replies or never taps
//   - the AI persona is told never to ask for passwords, card numbers, SSNs or codes in the chat
//   - one live drill per phone, 3 drills per phone per day, 30 per day overall
import { randomBytes } from 'node:crypto';
import { q, one, e164, pretty } from './db.js';
import { nextScamText, brainEnabled } from './drillbrain.js';
import { sendToHandle, onInbound, photonEnabled } from './photon.js';

const base = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 8787}`).replace(/\/$/, '');
const MAX_TURNS = 4;                                                   // scammer texts before the link is forced
const LINK_WAIT_MIN = Number(process.env.DRILL_LINK_WAIT_MINUTES || 5);
const IDLE_MIN = Number(process.env.DRILL_IDLE_MINUTES || 15);
const PER_PHONE_DAILY = 3, TOTAL_DAILY = 30;
const first = n => String(n).trim().split(/\s+/)[0];
const pick = a => a[Math.floor(Math.random() * a.length)];

/* ---------- scenarios ---------- */
// match: words in a participant's interests that select the scenario. flags + lessons feed the debrief.
export const SCENARIOS = {
  scholarship: {
    id: 'scholarship', title: 'Scholarship offer', match: ['scholarship', 'financial aid', 'grant'],
    persona: () => `"Morgan" from a student financial aid office, saying {name} was selected for a $2,500 scholarship and must confirm eligibility and pay a small processing fee today.`,
    flags: ['A scholarship you never applied for', 'A fee to receive money (real scholarships never charge)', 'A same-day deadline appeared mid-conversation', 'Friendly small talk before the link, to build trust', "A link that isn't your school's official site"],
    fallback: n => [`Hi, is this ${n}?`, `Great news ${n}, you were selected for a $2,500 scholarship this cycle. Are you still a student?`, 'Perfect. There is a small processing fee and the award is reassigned at 5 PM today.', 'Confirm your eligibility here so it is not given to someone else: {LINK}'],
  },
  internship: {
    id: 'internship', title: 'Internship offer', match: ['internship', 'intern', 'job', 'career'],
    persona: () => `"Rachel" from Talent Acquisition at a big consulting firm, offering a remote paid internship at $38/hr with no interview, needing an "onboarding" step first.`,
    flags: ['An unsolicited offer by text, with no interview', 'Pay that is too good for an internship', 'Onboarding via a link instead of the real careers portal', 'Asking if you are free before pitching, to seem professional', 'Fake-check and "equipment" schemes usually come next'],
    fallback: n => [`Hi ${n}, this is Rachel from Talent Acquisition. Is now an okay time?`, 'Your resume was shortlisted for a remote paid internship, $38/hr, no interview needed. Still interested?', 'Great. We are filling the last spots today, so onboarding closes at 6 PM.', 'Complete onboarding here to lock in your offer: {LINK}'],
  },
  interview: {
    id: 'interview', title: 'Interview scheduling', match: ['interview', 'recruit'],
    persona: () => `The recruiting team at a well-known tech company, confirming a virtual interview the person does not remember scheduling and asking for "identity verification" (a photo ID upload) before the slot is released.`,
    flags: ["An interview you don't remember scheduling", 'Asking for a photo ID before anyone has met you', 'Threatening to release your slot to rush you', 'Real recruiters email from the company domain, not random texts', 'A link instead of the official careers site'],
    fallback: n => [`Hi ${n}, this is the recruiting team. Are you still available for your virtual interview tomorrow at 10 AM?`, 'Great, you are confirmed. Before we send the invite we need to verify your identity.', 'Your slot is released if verification is not done by 9 AM tomorrow.', 'Please upload your ID here: {LINK}'],
  },
  bank: {
    id: 'bank', title: 'Bank fraud alert', match: ['bank', 'banking', 'credit', 'card', 'money'],
    persona: () => `"Fraud Prevention" at the participant's bank, claiming an unusual charge and a temporary card lock that must be "verified" to undo.`,
    flags: ['Fear about your money, used to rush you', 'Real banks never ask you to verify through a text link', 'A yes/no question first, to get you engaged', 'A link instead of the number on the back of your card'],
    fallback: n => [`Fraud Prevention: ${n}, we noticed unusual activity on your card. Did you just try to make a purchase?`, 'Thanks for confirming. For your safety we have placed a temporary hold on the card.', 'To remove the hold, verify it was you in the next 15 minutes: {LINK}'],
  },
  carrier: {
    id: 'carrier', title: 'Phone bill problem', match: ['phone', 'carrier', 'bill', 'mobile'],
    persona: () => `"Billing" at the participant's mobile carrier, claiming a failed autopay and a service suspension today unless they pay through a link.`,
    flags: ['A threat of losing service', 'Pressure to act today', 'Asking permission first, which feels polite and lowers your guard', 'Payment through a text link instead of the official app'],
    fallback: n => [`Hi ${n}, your autopay failed this month. Want me to resend the payment link?`, 'Your service is scheduled to be suspended today and there is a $50 reconnection fee.', 'Pay the balance now to avoid it: {LINK}'],
  },
  package: {
    id: 'package', title: 'Missed package', match: ['shop', 'shopping', 'amazon', 'package', 'delivery', 'online'],
    persona: () => `"Delivery" support for a big online store, claiming a failed delivery attempt today and offering to reschedule for a small redelivery fee.`,
    flags: ['A delivery you never ordered', 'A small fee to capture your card details', 'A 24-hour deadline', "A link that is not the store's real website"],
    fallback: n => [`Hi ${n}, we tried to deliver your package today but no one was available. Want us to reschedule?`, 'Sure. There is a $1.99 redelivery fee and it is returned to sender after 24 hours.', 'Pay and pick a new time here: {LINK}'],
  },
  family: {
    id: 'family', title: 'Family emergency', match: ['family', 'grandparent', 'parent'],
    persona: () => `A relative texting from "a friend's phone" because theirs broke, saying they are in trouble (an accident or stuck abroad) and need money fast, and asking that no one else in the family be told.`,
    flags: ['A family member texting from an unknown number', 'An emergency that needs money right now', 'Asking you to keep it secret from the family', 'Payment by link, gift card or wire instead of a call you can verify'],
    fallback: n => [`Hey ${n}, it's me. My phone broke so I'm texting from a friend's. Can you talk?`, "I'm kind of in trouble, I was in a fender bender and I need help paying for the repair today. Please don't tell anyone yet.", 'Can you send it here? I will pay you back this week: {LINK}'],
  },
  prize: {
    id: 'prize', title: 'Prize drawing', match: [],
    persona: () => `An exciting "you were entered in a $500 gift card drawing" text with a very short claim window.`,
    flags: ['A prize for a contest you never entered', 'A very short time limit', 'Free money is the bait', 'An exciting yes/no question to hook you before the link'],
    fallback: n => [`Hi ${n}! You were just entered into a $500 gift card drawing. Want to see if you won?`, 'You did! The claim window is only one hour.', 'Claim your gift card here: {LINK}'],
  },
};
export const INTERESTS = ['Scholarships', 'Internships', 'Interviews', 'Banking', 'Online shopping', 'Phone bill', 'Family'];
export const DIFFICULTIES = ['beginner', 'intermediate', 'expert'];
const TURNS = { beginner: 3, intermediate: 4, expert: 5 };              // more back-and-forth before the hook on harder levels
export const CHALLENGES = ['internship', 'bank', 'family', 'package', 'scholarship', 'interview', 'carrier'].map(id => ({ id, title: SCENARIOS[id].title }));

/** ADAPT: the scam a call detected -> the Academy lesson that teaches it. */
export const LESSON_FOR_TACTIC = { otp_request: 'bank', impersonation: 'bank', remote_access: 'bank', gift_card: 'family', urgency_money: 'family', sales: 'package' };

export function chooseScenario(interests = [], requested) {
  if (requested && SCENARIOS[requested]) return SCENARIOS[requested];
  const text = interests.map(i => String(i).toLowerCase());
  const hits = Object.values(SCENARIOS).filter(s => s.match.some(m => text.some(t => t.includes(m))));
  return hits.length ? pick(hits) : SCENARIOS.prize;
}

/* ---------- storage helpers ---------- */
const linkFor = token => `${base()}/d/${token}`;
const resultsUrl = token => `${base()}/drill.html?t=${token}`;
const liveSession = handle => one(`SELECT * FROM drill_sessions WHERE handle = $1 AND status IN ('active','link_sent') ORDER BY created_at DESC LIMIT 1`, [handle]);
const bySession = token => one('SELECT * FROM drill_sessions WHERE token = $1', [token]);
const saveHistory = (id, history, extra = '') => q(`UPDATE drill_sessions SET history = $2, updated_at = now() ${extra} WHERE id = $1`, [id, JSON.stringify(history)]);
const pushMsg = (s, role, text) => { s.history = [...s.history, { role, text, at: new Date().toISOString() }]; };

/* ---------- debrief ---------- */
const debriefText = (s, reason) => {
  const sc = SCENARIOS[s.scenario];
  const lead = reason === 'stopped' ? 'Okay, stopping. ' : '';
  return `${lead}✅ That was a ScamShield drill, not a real message. Nothing was charged and nothing was collected.\n` +
    `Red flags in it:\n${sc.flags.slice(0, 4).map(f => `• ${f}`).join('\n')}\n` +
    `See how you did and what to do next: ${resultsUrl(s.token)}`;
};

async function endSession(s, reason, { debrief = true, via } = {}) {
  await q(`UPDATE drill_sessions SET status = 'ended', ended_reason = COALESCE(ended_reason, $2), updated_at = now() WHERE id = $1 AND status IN ('active','link_sent')`, [s.id, reason]);
  if (!debrief) return;
  const text = debriefText(s, reason);
  const r = via ? await via(text).then(() => ({ delivered: true })).catch(e => ({ delivered: false, reason: e.message })) : await sendToHandle(s.handle, text, { kind: 'drill-debrief' });
  if (r.delivered) await q('UPDATE drill_sessions SET debriefed_at = now() WHERE id = $1', [s.id]);
}

/* ---------- one scammer turn ---------- */
async function scammerTurn(s, send) {
  const turn = s.history.filter(h => h.role === 'assistant').length;
  const scenario = SCENARIOS[s.scenario];
  const difficulty = s.difficulty || 'intermediate';
  const out = await nextScamText({ scenario: { ...scenario, persona: scenario.persona().replace('{name}', first(s.name)) }, name: first(s.name), history: s.history, turn, maxTurns: TURNS[difficulty] || MAX_TURNS, difficulty });
  const text = out.reply.replaceAll('{LINK}', linkFor(s.token));
  await send(text);
  pushMsg(s, 'assistant', text);
  if (out.sendLink) await saveHistory(s.id, s.history, `, status = 'link_sent', link_sent_at = now()`);
  else await saveHistory(s.id, s.history);
  return { text, sendLink: out.sendLink, engine: out.engine };
}

/* ---------- public API ---------- */
export async function startDrill({ name, phone, interests = [], scenario, consent, difficulty = 'intermediate', gentle = false }) {
  if (!DIFFICULTIES.includes(difficulty)) difficulty = 'intermediate';
  if (gentle) difficulty = 'beginner';                                   // gentle mode always uses the easiest scammer
  if (consent !== true) return { ok: false, status: 400, error: 'Consent is required to run a drill.' };
  const handle = e164(phone);
  const cleanName = String(name || '').trim().slice(0, 40);
  if (!handle) return { ok: false, status: 400, error: 'Enter a valid 10-digit US phone number.' };
  if (!cleanName) return { ok: false, status: 400, error: 'Enter your first name.' };
  if (!photonEnabled()) return { ok: false, status: 503, error: 'Messaging is not connected right now.' };
  if (await liveSession(handle)) return { ok: false, status: 409, error: 'A drill is already running for this number. Text STOP to end it.' };
  const today = await one(`SELECT count(*) FILTER (WHERE handle = $1)::int AS mine, count(*)::int AS total FROM drill_sessions WHERE created_at > now() - interval '1 day'`, [handle]);
  if (today.mine >= PER_PHONE_DAILY) return { ok: false, status: 429, error: 'That number has reached its daily drill limit.' };
  if (today.total >= TOTAL_DAILY) return { ok: false, status: 429, error: 'The daily drill limit has been reached. Try again tomorrow.' };

  const sc = chooseScenario(interests, scenario);
  const token = randomBytes(9).toString('base64url');
  let s;
  try {
    s = await one(`INSERT INTO drill_sessions (token, handle, name, scenario, interests, difficulty, gentle) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [token, handle, cleanName, sc.id, JSON.stringify(interests.slice(0, 8)), difficulty, !!gentle]);
  } catch (e) {
    if (e.code === '23505') return { ok: false, status: 409, error: 'A drill is already running for this number. Text STOP to end it.' };   // double-tap race
    throw e;
  }
  s.history = [];
  try {
    await scammerTurn(s, async text => {
      const r = await sendToHandle(handle, text, { kind: 'drill' });
      if (!r.delivered) throw new Error(/texted|first|space|user/i.test(r.reason || '') ? `${pretty(handle)} has not texted the ScamShield line yet. Text it once from that phone, then try again.` : (r.reason || 'Could not deliver the message.'));
    });
  } catch (e) {
    await q(`UPDATE drill_sessions SET status = 'ended', ended_reason = 'undeliverable' WHERE id = $1`, [s.id]);
    return { ok: false, status: 422, error: e.message };
  }
  return { ok: true, token, scenario: { id: sc.id, title: sc.title }, phone: pretty(handle) };
}

export async function stopDrill(token) {
  const s = await bySession(token);
  if (!s || !['active', 'link_sent'].includes(s.status)) return false;
  await endSession(s, 'stopped');
  return true;
}

/** Called when the participant taps the link. Records it and returns the session. */
export async function markClicked(token) {
  return one(`UPDATE drill_sessions SET clicked_at = COALESCE(clicked_at, now()), debriefed_at = COALESCE(debriefed_at, now()),
                status = CASE WHEN status IN ('active','link_sent') THEN 'clicked' ELSE status END,
                ended_reason = COALESCE(ended_reason, 'clicked'), updated_at = now()
              WHERE token = $1 RETURNING *`, [token]);
}

/** Safe-to-share view for the results page. Flags and the transcript are shown once the drill is over. */
export async function publicState(token) {
  const s = await bySession(token);
  if (!s) return null;
  const sc = SCENARIOS[s.scenario];
  const over = s.status === 'clicked' || s.status === 'ended';
  const replies = s.history.filter(h => h.role === 'user').length;
  return {
    name: first(s.name), status: s.status, over,
    scenario: { id: sc.id, title: sc.title }, difficulty: s.difficulty || 'intermediate', gentle: !!s.gentle,
    outcome: s.clicked_at ? 'fell' : s.status === 'ended' ? 'resisted' : 'in_progress',
    reason: s.ended_reason, linkSent: !!s.link_sent_at, clicked: !!s.clicked_at,
    replies, texts: s.history.filter(h => h.role === 'assistant').length,
    flags: over ? sc.flags : [], conversation: over ? s.history.map(h => ({ from: h.role === 'assistant' ? 'scammer' : 'you', text: h.text })) : [],
  };
}

export async function allResults() {
  const r = await q(`SELECT name, scenario, status, ended_reason, link_sent_at, clicked_at, created_at, jsonb_array_length(history) AS messages FROM drill_sessions ORDER BY created_at DESC LIMIT 100`);
  return r.rows.map(x => ({ ...x, fell_for_it: !!x.clicked_at }));
}

/* ---------- inbound replies + sweeper ---------- */
export function startDrillListener() {
  onInbound(async ({ handle, text, reply }) => {
    const s = await liveSession(handle);
    if (!s) return false;                                              // not in a drill: let the normal bot answer
    const typed = new Promise(r => setTimeout(r, 1200 + Math.random() * 2200));   // humans take a moment to type
    if (/^\s*(stop|end|quit|cancel|exit)\s*[.!]?\s*$/i.test(text)) { await endSession(s, 'stopped', { via: reply }); return true; }
    s.history = Array.isArray(s.history) ? s.history : [];
    pushMsg(s, 'user', text.slice(0, 500));
    await saveHistory(s.id, s.history);
    if (s.status === 'link_sent') { await endSession(s, 'replied_after_link', { via: reply }); return true; }
    await typed;
    await scammerTurn(s, reply).catch(async e => { console.error('[drill] turn failed:', e.message); await endSession(s, 'error', { via: reply }); });
    return true;
  });
  const sweep = async () => {
    try {
      const stale = await q(`SELECT * FROM drill_sessions WHERE (status = 'link_sent' AND link_sent_at < now() - make_interval(mins => $1))
                                OR (status = 'active' AND updated_at < now() - make_interval(mins => $2))`, [LINK_WAIT_MIN, IDLE_MIN]);
      for (const s of stale.rows) await endSession(s, 'silent');
    } catch (e) { console.error('[drill] sweep failed:', e.message); }
  };
  setInterval(sweep, 30_000).unref();
  console.log(`[drill] ready (ai: ${brainEnabled() ? 'gemini' : 'canned lines'}, link wait ${LINK_WAIT_MIN} min)`);
}

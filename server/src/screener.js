// Call Screener interview: the questions ScamShield asks an unknown caller, and the Gemini summary that is
// shown to the subscriber while their phone rings. Rule-based fallback when Gemini is unavailable.
import { generateJson, SchemaType as T, ruleClassify } from './llm.js';
import { similarScripts } from './risk.js';

export const QUESTIONS = name => [
  `Hi, I'm screening calls for ${name}. May I ask who is calling?`,
  'Thanks. What is this call regarding?',
  `Got it. Which company or organization are you with, and is there a number ${name} can call you back on?`,
];
export const NUDGE = q => `Sorry, I didn't catch that. ${q}`;
export const CONNECTING = name => `Thanks. One moment while I connect you to ${name}.`;
export const NOT_AVAILABLE = name => `${name} isn't available right now. I'll let them know you called. Goodbye.`;
export const REFUSED = name => `${name} doesn't take calls like this. Goodbye.`;

const SCHEMA = {
  type: T.OBJECT,
  properties: {
    caller_name: { type: T.STRING, description: 'Name the caller gave, or "Not given"' },
    organization: { type: T.STRING, description: 'Company or organization the caller claimed, or "Not given"' },
    purpose: { type: T.STRING, description: 'Why they say they are calling, under 60 characters' },
    callback_offered: { type: T.BOOLEAN, description: 'true if the caller offered a callback number' },
    verdict: { type: T.STRING, enum: ['likely_legitimate', 'unclear', 'sales', 'likely_scam'] },
    risk: { type: T.INTEGER, description: '0 (safe) to 100 (certain scam)' },
    red_flags: { type: T.ARRAY, items: { type: T.STRING }, description: 'Up to 3 short red flags, e.g. "No callback number", "Pressure to decide today"' },
    summary: { type: T.STRING, description: 'One sentence for the subscriber, under 140 characters, e.g. "Says he is Mark from Chase about a card charge; vague on details, no callback number."' },
    recommendation: { type: T.STRING, enum: ['answer', 'caution', 'decline'] },
  },
  required: ['caller_name', 'organization', 'purpose', 'callback_offered', 'verdict', 'risk', 'red_flags', 'summary', 'recommendation'],
};

export const LABEL = { likely_scam: 'Scam Likely', sales: 'Potential Spam', unclear: 'Screened caller', likely_legitimate: 'Screened caller' };
export const CATEGORY = { likely_scam: 'Scam Likely', sales: 'Telemarketing', unclear: 'Unknown', likely_legitimate: 'Legitimate' };

function callerSpeech(transcript) {
  return transcript.split('\n').filter(l => l.startsWith('caller:')).map(l => l.replace(/^caller:\s*/, ''));
}

/** True only for outright fraud tactics in the caller's own words (passcodes, gift cards, remote access, "move your
    money now"). Those are refused when Scam Block is on; everything else is handed to the subscriber with the summary. */
export function hardFraud(transcript) {
  return ['otp_request', 'gift_card', 'remote_access', 'urgency_money'].includes(ruleClassify(callerSpeech(transcript).join(' ')).tactic);
}

function fallback(transcript) {
  const said = callerSpeech(transcript);
  const v = ruleClassify(said.join(' '));
  const nameM = said.join(' ').match(/(?:this is|my name is|it's|i am|i'm)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
  const fraud = ['otp_request', 'gift_card', 'urgency_money', 'impersonation', 'remote_access'].includes(v.tactic);
  const sales = v.tactic === 'sales';
  const callback = /call (me |you )?back|\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b/i.test(said.join(' '));
  const flags = [];
  if (!callback) flags.push('No callback number');
  if (/today|right now|immediately|expire/i.test(said.join(' '))) flags.push('Pressure to act now');
  if (fraud) flags.push(v.one_line_warning);
  return {
    caller_name: nameM ? nameM[1] : 'Not given',
    organization: said[2]?.slice(0, 40) || 'Not given',
    purpose: (said[1] || said[0] || 'Not stated').slice(0, 60),
    callback_offered: callback,
    verdict: fraud ? 'likely_scam' : sales ? 'sales' : said.length >= 3 ? 'unclear' : 'unclear',
    risk: fraud ? 90 : sales ? 60 : 35,
    red_flags: flags.slice(0, 3),
    summary: fraud ? `Caller used a known fraud tactic: ${v.one_line_warning}` : sales ? `Unsolicited sales call: ${(said[0] || '').slice(0, 80)}` : `Caller answered the screener but could not be verified.`,
    recommendation: fraud ? 'decline' : sales ? 'caution' : 'caution',
    engine: 'rules',
  };
}

/** Summarize a finished screening interview for the subscriber. Always resolves. */
export async function summarizeScreening(transcript) {
  let ctx = [];
  try { ctx = await similarScripts(transcript); } catch {}
  const prompt = `You are ScamShield, a carrier call screener. You just asked an unknown caller who they are, what the call is about,
and which company they are with / whether there is a callback number. Summarize the interview for the subscriber, who is deciding
whether to pick up right now. Be concrete and brief. Known scam scripts that resemble this call (reference only):
${ctx.map((c, i) => `${i + 1}. [${c.label}] ${c.text}`).join('\n') || '(none)'}

Interview transcript:
"""${transcript.slice(-2500)}"""

Rules: evasive or vague answers, refusal to give a company or callback number, urgency, or requests for codes, payments or
remote access raise the risk. A caller who gives a plausible name, company, reason and callback number is likely_legitimate.
A sales pitch is "sales". recommendation: answer (likely_legitimate), caution (unclear or sales), decline (likely_scam).`;
  let s = await generateJson(prompt, SCHEMA, { timeoutMs: 6000 });
  if (!s) s = fallback(transcript); else s.engine = 'gemini';
  s.risk = Math.max(0, Math.min(100, Math.round(Number(s.risk) || 0)));
  s.red_flags = (s.red_flags || []).slice(0, 3);
  s.label = LABEL[s.verdict] || 'Screened caller';
  s.category = CATEGORY[s.verdict] || 'Unknown';
  s.similar = ctx.map(c => c.label);
  return s;
}

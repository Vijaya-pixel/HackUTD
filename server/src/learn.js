// Safe Signal practice engine (Learn tab). Ported from the Education_feature branch onto this server:
// scenarios -> staged scammer conversation (Gemini, scripted fallback) -> reveal -> lesson.
// Channels: 'simulator' (in-app chat over SSE) and 'imessage' (Photon shared line).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { q, one, tx } from './db.js';
import { generateText, generateJson, SchemaType, llmEnabled } from './llm.js';
import { publish } from './sse.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scenarios');
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:8787').replace(/\/$/, '');
const SAFE_DOMAIN = PUBLIC_URL.replace(/^https?:\/\//, '');
const TERMINAL = ['ended_caught', 'ended_fell', 'ended_timeout', 'opted_out'];

/* ---------- scenarios ---------- */
export const SCENARIOS = readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(path.join(DIR, f), 'utf8')));
const scenario = id => SCENARIOS.find(s => s.id === id) || null;
const CATEGORY_LABEL = { package_delivery: 'Package delivery', toll_fee: 'Toll notice', job_offer: 'Job offer', family_emergency: 'Family emergency', bank_alert: 'Bank alert', tmobile_account: 'Mobile account' };
const FLAG_LABEL = { urgency: 'Urgency', impersonation: 'Impersonation', secrecy: 'Secrecy', unusual_payment_or_code: 'Payment or code request', suspicious_link_or_sender: 'Suspicious link or sender', too_good_to_be_true: 'Too good to be true' };

/* ---------- detection rules (verbatim weights from the branch) ---------- */
const RULES = [
  ['urgency', /\b(within\s+\d+\s*(hour|hr|minute|min)s?|expires?\s+in|act\s+now|immediately|right\s+now|urgent|asap|time\s+is\s+running\s+out|limited\s+time|today\s+only|before\s+midnight|final\s+notice|last\s+chance)\b/gi, 'Artificial time pressure designed to prevent careful thinking', 0.35],
  ['urgency', /\b(suspend|suspended|suspension|revoke|terminated|disabled|blocked|frozen|locked)\b/gi, 'Threat of account action to trigger panic', 0.4],
  ['unusual_payment_or_code', /\b(zelle|cashapp|venmo|bitcoin|crypto|wire\s+transfer|gift\s+card|google\s+play|itunes|amazon\s+card|prepaid\s+card)\b/gi, 'Untraceable payment method favored by scammers', 0.65],
  ['unusual_payment_or_code', /\b(one[- ]time\s+code|otp|verification\s+code|security\s+code|pin|passcode|read\s+(it\s+)?back|tell\s+me\s+the\s+code)\b/gi, 'Requesting an OTP or PIN over chat is always fraudulent', 0.75],
  ['unusual_payment_or_code', /\b(\$\s*\d+(\.\d{1,2})?\s*(\w+\s+)?(fee|deposit|charge|payment|processing|refundable))\b/gi, 'Unexpected fee request is a scam hallmark', 0.5],
  ['suspicious_link_or_sender', /https?:\/\/(?!(?:[\w-]+\.)*(t-mobile|parcelgo|tollpass|northlinebank|nextstep)\.(?:com|net|org)\b)[^\s]{6,}/gi, 'Link does not match the official domain of the claimed sender', 0.55],
  ['suspicious_link_or_sender', /\b(bit\.ly|tinyurl|short\.link|rb\.gy|ow\.ly|t\.co(?!m)|cutt\.ly)\b/gi, 'URL shortener hides the true destination', 0.6],
  ['impersonation', /\b(irs|social\s+security|medicare|dmv|fbi|dea|customs|immigration|federal)\b/gi, 'Government agency impersonation is a major fraud category', 0.7],
  ['impersonation', /\b(fraud\s+(prevention|department|team)|security\s+(team|department)|account\s+specialist|case\s+#|ref\s+#|ticket\s+#)\b/gi, 'Fake official reference numbers create false legitimacy', 0.3],
  ['secrecy', /\b(don'?t\s+tell|keep\s+(this|it)\s+(between|private|secret|quiet)|don'?t\s+(share|mention|call|contact)|do\s+not\s+call)\b/gi, 'Instructions to keep the contact secret prevent you from verifying with trusted people', 0.6],
  ['too_good_to_be_true', /\b(you'?ve?\s+(been\s+)?(selected|chosen|won|qualified|approved)|congratulations|you\s+(are|have\s+been)\s+(a\s+)?(winner|recipient)|random(ly)?\s+(selected|chosen))\b/gi, 'Winning or being selected without entering a contest is a classic scam opener', 0.45],
  ['too_good_to_be_true', /\b(no\s+experience\s+(required|needed)|work\s+from\s+home|flexible\s+hours|\$\s*\d{3,}\s*\/\s*(week|day|hr|hour))\b/gi, 'Unrealistic job or income offer', 0.4],
];
export function runRules(text, senderKnown) {
  const flags = [], reasons = []; let total = 0;
  for (const [category, re, explanation, weight] of RULES) {
    re.lastIndex = 0; let m, matched = false;
    while ((m = re.exec(text)) !== null) { flags.push({ category, startChar: m.index, endChar: m.index + m[0].length, explanation }); if (!matched) { total += weight; reasons.push(explanation); matched = true; } }
  }
  return { score: Math.min(1, total + (senderKnown === false ? 0.15 : 0)), flags, reasons };
}
const labelFromScore = s => s >= 0.65 ? 'scam' : s >= 0.35 ? 'suspicious' : 'likely_safe';

/** Rules + Gemini classifier for POST /api/learn/detect (and the lesson's own-message annotation). */
export async function detect(text, senderKnown) {
  const rules = runRules(text, senderKnown);
  const llm = llmEnabled() ? await generateJson(
    `Classify this text message a phone user received. Is it a scam?\n"""${text.slice(0, 1500)}"""\nReturn label scam | suspicious | likely_safe, a confidence 0..1 for that label, and up to 3 short reasons.`,
    { type: SchemaType.OBJECT, properties: { label: { type: SchemaType.STRING, enum: ['scam', 'suspicious', 'likely_safe'] }, confidence: { type: SchemaType.NUMBER }, reasons: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } } }, required: ['label', 'confidence', 'reasons'] }) : null;
  if (!llm) return { label: labelFromScore(rules.score * (llmEnabled() ? 0.9 : 1)), confidence: rules.score, redFlags: rules.flags, reasons: rules.reasons, engine: 'rules' };
  const llmScore = llm.label === 'scam' ? llm.confidence : llm.label === 'suspicious' ? llm.confidence * 0.5 : (1 - llm.confidence) * 0.1;
  const combined = 0.45 * rules.score + 0.55 * llmScore;
  const disagree = (rules.score > 0.6 && llm.label === 'likely_safe') || (rules.score < 0.2 && llm.label === 'scam');
  const reasons = [...new Set([...rules.reasons, ...(llm.reasons || [])])];
  if (disagree) reasons.push('Rules and AI classifier disagree; marked suspicious.');
  return { label: disagree ? 'suspicious' : labelFromScore(combined), confidence: disagree ? 0.5 : Math.min(0.99, combined), redFlags: rules.flags, reasons, engine: 'rules+gemini' };
}

/* ---------- privacy & safety (from the branch) ---------- */
const REDACT = [[/\b(?:\d[ -]?){13,19}\b/g, '[CARD_NUMBER]'], [/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, '[SSN]'], [/\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE]'], [/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g, '[EMAIL]'], [/\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,4}(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl)\b\.?/gi, '[ADDRESS]'], [/\b\d{6}\b/g, '[CODE]'], [/\b\d{8,17}\b/g, '[ACCOUNT]']];
export const redact = t => REDACT.reduce((s, [re, r]) => s.replace(re, r), t);
function piiCategories(t) {
  const checks = [[/\b(?:\d[ -]?){13,19}\b/, 'card number'], [/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/, 'SSN'], [/\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/, 'phone number'], [/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/, 'email address'], [/\b\d{6}\b/, 'verification code']];
  return checks.filter(([re]) => re.test(t)).map(([, l]) => l);
}
function validateScammerReply(text) {
  if (!text || text.length < 8 || text.length > 320) return { ok: false, reason: 'length' };
  if (/\b(password|passwd|credential|bank\s+account\s+number|routing\s+number)\b/i.test(text)) return { ok: false, reason: 'requests real credentials' };
  for (const url of text.match(/https?:\/\/[^\s]+/gi) || []) if (!url.includes(SAFE_DOMAIN) && !url.includes('{{PRACTICE_LINK}}')) return { ok: false, reason: 'external URL ' + url };
  if (/\b(internal\s+revenue\s+service|social\s+security\s+administration|medicare|federal\s+bureau|department\s+of\s+justice)\b/i.test(text)) return { ok: false, reason: 'real agency' };
  if (/\b(wells\s+fargo|bank\s+of\s+america|chase\s+bank|citibank|jpmorgan)\b/i.test(text)) return { ok: false, reason: 'real bank' };
  return { ok: true };
}
const detectRefusal = t => /\b(stop\s+practice|stopscam|stop\s+scam|this\s+is\s+a\s+scam|you'?re\s+a\s+scammer|block(ing)?(\s+you)?|report(ing)?(\s+to)?\s+7726|forwarding\s+to\s+7726|spam|scam|not\s+falling\s+for)\b/i.test(t);
const detectOptOut = t => /\bstop\s+practice\b/i.test(t);

/* ---------- persistence ---------- */
const rowSession = r => r && ({ id: r.id, lineId: r.line_id, scenarioId: r.scenario_id, channel: r.channel, state: r.state, stageIndex: r.stage_index, token: r.token, startedAt: r.started_at, endedAt: r.ended_at, clickedAt: r.clicked_at, outcome: r.outcome, lesson: r.lesson,
  scenario: (() => { const s = scenario(r.scenario_id); return s ? { id: s.id, brand: s.brand, category: s.category, categoryLabel: CATEGORY_LABEL[s.category] || s.category, difficulty: s.difficulty } : null; })() });
export async function getSession(id) {
  const s = rowSession(await one('SELECT * FROM learn_sessions WHERE id = $1', [id])); if (!s) return null;
  const m = await q('SELECT id, role, redacted_text, stage, red_flags, time FROM learn_messages WHERE session_id = $1 ORDER BY time', [id]);
  s.messages = m.rows.map(x => ({ id: x.id, role: x.role, text: x.redacted_text, stage: x.stage, redFlags: x.red_flags, sentAt: x.time }));
  s.practiceLink = `${PUBLIC_URL}/p/${s.token}`;
  return s;
}
const bySessionToken = async token => { const r = await one('SELECT id FROM learn_sessions WHERE token = $1', [token]); return r ? getSession(r.id) : null; };
async function saveMessage(sessionId, role, text, stage, redFlags = []) {
  const id = randomUUID();
  await q('INSERT INTO learn_messages (id, session_id, role, redacted_text, stage, red_flags) VALUES ($1,$2,$3,$4,$5,$6)', [id, sessionId, role, redact(text), stage, JSON.stringify(redFlags)]);
  const msg = { id, role, text: redact(text), stage, redFlags, sentAt: new Date().toISOString() };
  publish('learn', { sessionId, message: msg });
  return msg;
}
async function setState(id, state, extra = {}) {
  await q(`UPDATE learn_sessions SET state = $2, stage_index = COALESCE($3, stage_index), outcome = COALESCE($4, outcome), ended_at = COALESCE($5, ended_at), lesson = COALESCE($6, lesson), clicked_at = COALESCE($7, clicked_at) WHERE id = $1`,
    [id, state, extra.stageIndex ?? null, extra.outcome ?? null, extra.endedAt ?? null, extra.lesson ? JSON.stringify(extra.lesson) : null, extra.clickedAt ?? null]);
  publish('learn', { sessionId: id, state, outcome: extra.outcome || null });
}
async function bumpSkills(lineId, sc, caught) {
  const cats = new Set(Object.values(sc.redFlagsByStage).flat().map(f => f.category));
  for (const c of cats) await q(`INSERT INTO learn_skills (line_id, category, encountered, caught) VALUES ($1,$2,1,$3) ON CONFLICT (line_id, category) DO UPDATE SET encountered = learn_skills.encountered + 1, caught = learn_skills.caught + $3`, [lineId, c, caught ? 1 : 0]);
}

/* ---------- channel ---------- */
let sendPhoton = async () => ({ delivered: false, reason: 'photon not wired' });
export const setPhotonSender = fn => { sendPhoton = fn; };
async function deliver(session, text) {
  if (session.channel === 'imessage') return sendPhoton(session.lineId, text, { kind: 'practice' });
  return { delivered: true, simulator: true };
}

/* ---------- engine ---------- */
export async function startSession(lineId, sc, channel) {
  const id = randomUUID(), token = randomBytes(16).toString('hex');
  const link = `${PUBLIC_URL}/p/${token}`;
  const opener = sc.opener.replace('{{PRACTICE_LINK}}', link);
  await q('INSERT INTO learn_sessions (id, line_id, scenario_id, channel, state, stage_index, token) VALUES ($1,$2,$3,$4,$5,0,$6)', [id, lineId, sc.id, channel, 'hook_sent', token]);
  await saveMessage(id, 'scammer', opener, 'hook', (sc.redFlagsByStage.hook || []).map(f => ({ ...f, startChar: 0, endChar: opener.length })));
  const sent = await deliver({ lineId, channel }, opener);
  return { ...(await getSession(id)), sent };
}

async function scammerReply(sc, stage, history, link) {
  const hist = history.map(m => `${m.role === 'scammer' ? 'YOU' : 'TARGET'}: ${m.text}`).join('\n');
  const prompt = `You are playing a scammer character for a safety training exercise run by a phone carrier.
SCENARIO: ${sc.category} scam impersonating "${sc.brand}"
CURRENT STAGE: ${stage.name}
STAGE GUIDANCE: ${stage.llmGuidance}
PRACTICE LINK: ${link}

SAFETY RULES (never violate):
1. Only link to the practice link above, no other URLs
2. Never ask for real passwords, real card numbers, or real SSNs
3. Never impersonate real government agencies (IRS, SSA, FBI) or real banks
4. Keep the message under 300 characters
5. Do not break character or mention training

CONVERSATION SO FAR:
${hist || '(no messages yet)'}

Write ONLY the next scammer text message. No labels, no quotes.`;
  return generateText(prompt, { timeoutMs: 6000, maxChars: 320 });
}

export async function handleUserMessage(sessionId, userText) {
  const s = await getSession(sessionId); if (!s || TERMINAL.includes(s.state)) return s;
  const sc = scenario(s.scenarioId); if (!sc) return s;
  const link = s.practiceLink;
  if (detectOptOut(userText)) { await endSession(s, sc, 'opted_out'); await deliver(s, 'You have opted out of Safe Signal practice. Text START PRACTICE to resume anytime.'); return getSession(sessionId); }
  const pii = piiCategories(userText);
  const det = runRules(userText);
  await saveMessage(sessionId, 'user', userText, s.state, det.flags);
  if (pii.length) {
    await deliver(s, `🛑 SAFE SIGNAL PRACTICE. This was a practice scam from T-Life.\n\nYou shared: ${pii.join(', ')}. Scammers use this to steal identities and access accounts.\n\nSee your full lesson in T-Life: ${link}`);
    await endSession(s, sc, 'fell_for_it');
    return getSession(sessionId);
  }
  if (detectRefusal(userText)) {
    const flags = [...new Map(Object.values(sc.redFlagsByStage).flat().map(f => [f.category, f])).values()];
    await endSession(s, sc, 'caught');
    await deliver(s, `🎉 Nice catch! This was a Safe Signal practice scam.\n\nRed flags you spotted:\n${flags.map(f => '• ' + f.explanation).join('\n')}\n\nSee your full lesson: ${link}`);
    await saveMessage(sessionId, 'system', 'Nice catch! This was a Safe Signal practice scam.', 'reveal');
    return getSession(sessionId);
  }
  const lastIdx = sc.stages.length - 2; // last stage is reveal
  const nextIdx = Math.min(s.stageIndex + 1, lastIdx);
  const stage = sc.stages[nextIdx];
  const stateOf = { hook: 'hook_sent', engage: 'engaging', escalate: 'escalating', ask: 'link_sent' };
  await setState(sessionId, stateOf[stage.name] || 'engaging', { stageIndex: nextIdx });
  let reply = await scammerReply(sc, stage, s.messages, link);
  const v = validateScammerReply(reply || '');
  if (!v.ok) { if (reply) console.warn('[learn] scammer reply rejected:', v.reason); reply = stage.scriptedFallback.replace('{{PRACTICE_LINK}}', link); }
  await saveMessage(sessionId, 'scammer', reply, stage.id, (sc.redFlagsByStage[stage.id] || []).map(f => ({ ...f, startChar: 0, endChar: reply.length })));
  await deliver(s, reply);
  return getSession(sessionId);
}

export async function handleLinkClick(token) {
  const s = await bySessionToken(token); if (!s) return null;
  if (TERMINAL.includes(s.state)) return s;
  const sc = scenario(s.scenarioId);
  await setState(s.id, s.state, { clickedAt: new Date().toISOString() });
  await saveMessage(s.id, 'user', 'Tapped the link', s.state, [{ category: 'suspicious_link_or_sender', startChar: 0, endChar: 15, explanation: 'Tapping a link from an unexpected text is how most credential theft starts' }]);
  await endSession(await getSession(s.id), sc, 'fell_for_it');
  const reveal = sc.stages[sc.stages.length - 1]?.scriptedFallback || '🛑 PRACTICE SCAM. This was a Safe Signal exercise.';
  await deliver(s, reveal);
  await saveMessage(s.id, 'system', reveal, 'reveal');
  return getSession(s.id);
}

async function endSession(s, sc, outcome) {
  const stateMap = { caught: 'ended_caught', fell_for_it: 'ended_fell', timeout: 'ended_timeout', opted_out: 'opted_out' };
  const full = await getSession(s.id);
  const lesson = outcome === 'opted_out' ? null : await buildLesson(full, sc, outcome);
  await setState(s.id, stateMap[outcome], { outcome, endedAt: new Date().toISOString(), lesson });
  if (outcome !== 'opted_out') await bumpSkills(s.lineId, sc, outcome === 'caught');
}

const MISTAKES = [
  [m => m.some(x => x.role === 'user' && x.redFlags.some(f => f.category === 'suspicious_link_or_sender')), 'Replied to, or tapped a link from, an unknown sender'],
  [m => m.some(x => x.role === 'user' && x.redFlags.some(f => f.category === 'unusual_payment_or_code')), 'Engaged with a request involving payment or a code'],
  [m => m.filter(x => x.role === 'user').length >= 3 && m.some(x => x.role === 'scammer' && x.redFlags.length), 'Continued the conversation after multiple red flags appeared'],
  [m => { const i = m.findIndex(x => x.role === 'scammer' && x.stage === 'ask'); return i >= 0 && m.slice(i + 1).some(x => x.role === 'user'); }, 'Responded after being asked for payment or personal information'],
];
const DEFAULT_RULE = { package_delivery: 'Real carriers never charge redelivery fees by SMS link.', toll_fee: 'Official toll agencies send mail, never text payment links.', job_offer: 'Legitimate employers never charge fees to get a job.', family_emergency: "Always call your family member's known number to verify emergencies.", bank_alert: 'Your bank will never ask for your PIN or OTP over text.', tmobile_account: 'T-Mobile will never ask for your account PIN or OTP via text.' };
function describeUser(t) {
  for (const [tag, d] of [['[CODE]', 'You shared a verification code'], ['[CARD_NUMBER]', 'You shared a card number'], ['[SSN]', 'You shared a Social Security number'], ['[PHONE]', 'You shared a phone number'], ['[EMAIL]', 'You shared an email address'], ['[ACCOUNT]', 'You shared an account number']]) if (t.includes(tag)) return d;
  if (t === 'Tapped the link') return 'You tapped the link';
  const w = t.trim().split(/\s+/).length; return w <= 3 ? 'You sent a short reply' : w <= 10 ? "You engaged with the scammer's message" : 'You sent a detailed reply to the scammer';
}
async function buildLesson(s, sc, outcome) {
  const msgs = s.messages.filter(m => m.role !== 'system');
  const replay = msgs.map(m => ({ id: m.id, role: m.role, text: m.role === 'scammer' ? m.text : describeUser(m.text), raw: m.role === 'user' ? m.text : undefined, redFlags: m.redFlags }));
  const mistakes = MISTAKES.filter(([t]) => t(msgs)).map(([, l]) => l);
  const users = msgs.filter(m => m.role === 'user').length, scams = msgs.filter(m => m.role === 'scammer').length;
  const strengths = [];
  if (outcome === 'caught') strengths.push('You called it out instead of playing along');
  if (users === 0) strengths.push("You didn't engage with the scam at all");
  if (users < scams) strengths.push('You kept your replies brief, limiting what the scammer could use');
  if (!msgs.some(m => m.role === 'user' && /\[(CODE|CARD_NUMBER|SSN|ACCOUNT)\]/.test(m.text))) strengths.push('You never shared a code, card or account number');
  const enc = new Map(), got = new Map();
  for (const m of msgs) for (const f of m.redFlags) (m.role === 'scammer' ? enc : got).set(f.category, ((m.role === 'scammer' ? enc : got).get(f.category) || 0) + 1);
  let weakest = 'urgency', low = Infinity; for (const [c, n] of enc) { const sc2 = (got.get(c) || 0) / n; if (sc2 < low) { low = sc2; weakest = c; } }
  const flags = [...new Set(msgs.filter(m => m.role === 'scammer').flatMap(m => m.redFlags.map(f => f.explanation)))];
  let rule = DEFAULT_RULE[sc.category] || 'When in doubt, hang up and call the official number on the company website.';
  const gen = await generateText(`A phone user just completed a ${sc.category} scam training exercise (outcome: ${outcome}). Scam brand: ${sc.brand}. Red flags in this scenario: ${flags.join('; ')}. Mistakes made: ${mistakes.join('; ') || 'none'}.\nWrite ONE clear, memorable rule under 25 words that this person should remember. Respond with just the rule.`, { timeoutMs: 5000, maxChars: 200 });
  if (gen && gen.length < 160) rule = gen.replace(/^"|"$/g, '');
  return { sessionId: s.id, outcome, replay, mistakes, strengths: strengths.length ? strengths : ['You completed this practice session'], ruleToRemember: rule, nextWeakCategory: weakest, nextWeakLabel: FLAG_LABEL[weakest], generatedAt: new Date().toISOString(), scenario: { brand: sc.brand, category: sc.category, categoryLabel: CATEGORY_LABEL[sc.category] } };
}

/* ---------- queries for the UI ---------- */
export async function overview(lineId) {
  const consent = await one('SELECT * FROM learn_consents WHERE line_id = $1', [lineId]);
  const sessions = (await q('SELECT * FROM learn_sessions WHERE line_id = $1 ORDER BY started_at DESC LIMIT 20', [lineId])).rows.map(rowSession);
  const skills = (await q('SELECT category, encountered, caught FROM learn_skills WHERE line_id = $1', [lineId])).rows.map(r => ({ category: r.category, label: FLAG_LABEL[r.category] || r.category, encountered: r.encountered, caught: r.caught, score: r.encountered ? r.caught / r.encountered : 0 }));
  const weakest = [...skills].sort((a, b) => a.score - b.score)[0]?.category || null;
  const active = sessions.find(s => !TERMINAL.includes(s.state)) || null;
  return { consent: consent ? { ...consent, interests: consent.interests } : null, active, sessions, skills,
    stats: { total: sessions.length, caught: sessions.filter(s => s.outcome === 'caught').length, fell: sessions.filter(s => s.outcome === 'fell_for_it').length, weakest, weakestLabel: FLAG_LABEL[weakest] || null },
    categories: Object.entries(CATEGORY_LABEL).map(([id, label]) => ({ id, label, scenarios: SCENARIOS.filter(s => s.category === id).length })) };
}
function pickScenario(interests, exclude = []) {
  const match = SCENARIOS.filter(s => s.interestTags.some(t => (interests || []).includes(t)) && !exclude.includes(s.id));
  const pool = match.length ? match : SCENARIOS.filter(s => !exclude.includes(s.id));
  return pool[Math.floor(Math.random() * pool.length)] || SCENARIOS[0];
}

/* ---------- routes ---------- */
export function registerLearn(app) {
  app.get('/api/learn/scenarios', c => c.json(SCENARIOS.map(s => ({ id: s.id, brand: s.brand, category: s.category, categoryLabel: CATEGORY_LABEL[s.category], difficulty: s.difficulty, interestTags: s.interestTags, opener: s.opener.replace('{{PRACTICE_LINK}}', '[link]') }))));
  app.get('/api/learn/:lineId', async c => c.json(await overview(c.req.param('lineId'))));
  app.post('/api/learn/:lineId/optin', async c => {
    const b = await c.req.json();
    await q(`INSERT INTO learn_consents (line_id, channel, interests, max_per_day, consent_at, active) VALUES ($1,$2,$3,$4,now(),true)
             ON CONFLICT (line_id) DO UPDATE SET channel = EXCLUDED.channel, interests = EXCLUDED.interests, max_per_day = EXCLUDED.max_per_day, consent_at = now(), active = true`,
      [c.req.param('lineId'), b.channel === 'imessage' ? 'imessage' : 'simulator', JSON.stringify(b.interests || []), Number(b.maxPerDay) || 3]);
    return c.json(await overview(c.req.param('lineId')));
  });
  app.delete('/api/learn/:lineId/optin', async c => { await q('UPDATE learn_consents SET active = false WHERE line_id = $1', [c.req.param('lineId')]); return c.json({ ok: true }); });
  app.post('/api/learn/:lineId/practice', async c => {
    const lineId = c.req.param('lineId'); const b = await c.req.json().catch(() => ({}));
    const consent = await one('SELECT * FROM learn_consents WHERE line_id = $1 AND active', [lineId]);
    if (!consent) return c.json({ error: 'Turn on practice first' }, 403);
    const open = await one(`SELECT id FROM learn_sessions WHERE line_id = $1 AND state NOT IN ('ended_caught','ended_fell','ended_timeout','opted_out')`, [lineId]);
    if (open) return c.json({ error: 'A practice session is already in progress', sessionId: open.id }, 409);
    const recent = (await q(`SELECT scenario_id FROM learn_sessions WHERE line_id = $1 ORDER BY started_at DESC LIMIT 3`, [lineId])).rows.map(r => r.scenario_id);
    const sc = scenario(b.scenarioId) || pickScenario(consent.interests, recent);
    const channel = b.channel || consent.channel || 'simulator';
    return c.json(await startSession(lineId, sc, channel));
  });
  app.get('/api/learn/session/:id', async c => { const s = await getSession(c.req.param('id')); return s ? c.json(s) : c.json({ error: 'not found' }, 404); });
  app.post('/api/learn/session/:id/reply', async c => { const { text } = await c.req.json(); if (!text) return c.json({ error: 'text required' }, 400); return c.json(await handleUserMessage(c.req.param('id'), String(text).slice(0, 500))); });
  app.post('/api/learn/session/:id/click', async c => { const s = await getSession(c.req.param('id')); if (!s) return c.json({ error: 'not found' }, 404); return c.json(await handleLinkClick(s.token)); });
  app.post('/api/learn/detect', async c => { const { text, senderKnown } = await c.req.json(); if (!text) return c.json({ error: 'text required' }, 400); return c.json(await detect(String(text), senderKnown)); });

  // Practice link: records the tap, reveals in-thread, and sends the phone to the lesson in the T-Life UI.
  app.get('/p/:token', async c => {
    const s = await handleLinkClick(c.req.param('token'));
    if (!s) return c.html(page('Link not found', '<p>This practice link has already been used or has expired.</p>'), 404);
    const rule = s.lesson?.ruleToRemember ? `<div class="rule"><h3>Rule to remember</h3><p>${esc(s.lesson.ruleToRemember)}</p></div>` : '';
    return c.html(page('Practice complete', `<div class="big">🛑</div><h1>This was a practice scam</h1><p>Safe Signal, part of ScamShield in T-Life, sent this text so you could practice safely. Nothing was shared with anyone.</p>${rule}<a class="btn" href="/?lesson=${s.id}#learn">See your lesson in T-Life</a>`));
  });
  app.get('/learn/:id', async c => { const s = await getSession(c.req.param('id')); if (!s?.lesson) return c.html(page('Not found', '<p>No lesson yet.</p>'), 404); const L = s.lesson;
    return c.html(page('Your lesson', `<h1>${L.outcome === 'caught' ? '🎉 You caught it' : '🛑 You fell for this one'}</h1><h2>Key mistakes</h2><ul>${L.mistakes.map(m => `<li>${esc(m)}</li>`).join('') || '<li>No major mistakes</li>'}</ul><h2>What you did well</h2><ul>${L.strengths.map(m => `<li>${esc(m)}</li>`).join('')}</ul><div class="rule"><h3>Rule to remember</h3><p>${esc(L.ruleToRemember)}</p></div><a class="btn" href="/?lesson=${s.id}#learn">Open in T-Life</a>`)); });
}
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ScamShield</title><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#F5F5F7;color:#1A1A1A;margin:0;padding:24px;display:flex;justify-content:center}.card{background:#fff;border-radius:16px;padding:28px 22px;max-width:420px;width:100%;border:1px solid #E6E6E6}.big{font-size:44px}h1{font-size:24px;margin:8px 0}h2{font-size:14px;text-transform:uppercase;color:#E20074;margin:18px 0 6px}p,li{color:#444;line-height:1.5}.rule{background:#FCE4F1;border-left:4px solid #E20074;border-radius:10px;padding:12px 14px;margin:16px 0}.rule h3{margin:0 0 4px;font-size:12px;text-transform:uppercase;color:#E20074}.rule p{margin:0;color:#1A1A1A;font-weight:600}.btn{display:block;text-align:center;background:#E20074;color:#fff;text-decoration:none;border-radius:999px;padding:14px;font-weight:700;margin-top:16px}</style></head><body><div class="card">${body}</div></body></html>`;

/** Photon inbound hook: returns true when the text belongs to an active iMessage practice session. */
export async function learnInbound(lineId, text) {
  if (!lineId) return false;
  const open = await one(`SELECT id FROM learn_sessions WHERE line_id = $1 AND channel = 'imessage' AND state NOT IN ('ended_caught','ended_fell','ended_timeout','opted_out') ORDER BY started_at DESC LIMIT 1`, [lineId]);
  if (!open) {
    if (/\bstart\s+practice\b/i.test(text)) { const consent = await one('SELECT * FROM learn_consents WHERE line_id = $1 AND active', [lineId]); if (consent) { await startSession(lineId, pickScenario(consent.interests), 'imessage'); return true; } }
    return false;
  }
  await handleUserMessage(open.id, text);
  return true;
}

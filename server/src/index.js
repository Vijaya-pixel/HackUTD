import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { q, one, e164, pretty, pool } from './db.js';
import { getLine, preRing, reputation, syntheticReputation, judgeTranscript } from './risk.js';
import { subscribe, publish, clientCount } from './sse.js';
import { startPhoton, sendToLine, getOutbox, photonEnabled, photonStatus } from './photon.js';
import { llmEnabled } from './llm.js';
import { registerTwilio, attachMediaServer, hangupTwilio, sayAndHangup, forwardTarget, twilioEnabled } from './twilio.js';
import { QUESTIONS, CONNECTING, REFUSED, NOT_AVAILABLE, summarizeScreening, hardFraud } from './screener.js';
import { registerLearn, setPhotonSender } from './learn.js';

const app = new Hono();
app.use('/api/*', cors());

const webRoot = path.relative(process.cwd(), path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')) || '.';

/* ---------- helpers ---------- */
const bad = (c, msg, code = 400) => c.json({ error: msg }, code);
const lineOr404 = async (c, id) => { const l = await getLine(id); if (!l) throw Object.assign(new Error('line not found'), { status: 404 }); return l; };

function rowToActivity(r) {
  return { id: r.id, line: r.line_id, num: pretty(r.e164), e164: r.e164, name: r.display_name || null, type: r.outcome,
           cat: r.category, loc: r.location, risk: r.risk, reports: r.reports_30d ?? 0, note: r.note, time: r.time,
           ago: Math.max(0, Math.round((Date.now() - new Date(r.time).getTime()) / 60000)), times: Number(r.times || 1), source: r.source };
}

/* ---------- health ---------- */
app.get('/api/health', async c => {
  const db = await one('SELECT now() AS now, current_setting(\'server_version\') AS pg');
  return c.json({ ok: true, db, llm: llmEnabled(), photon: photonEnabled(), twilio: twilioEnabled(), sseClients: clientCount() });
});

/* ---------- lines ---------- */
app.get('/api/lines', async c => {
  const r = await q(`SELECT l.*, a.premium, a.plan FROM lines l JOIN accounts a ON a.id = l.account_id ORDER BY is_primary DESC, id`);
  return c.json(r.rows.map(l => ({ ...l, num: pretty(l.msisdn) })));
});
app.patch('/api/lines/:id', async c => {
  const line = await lineOr404(c, c.req.param('id'));
  const body = await c.req.json();
  const toggles = { ...line.toggles, ...(body.toggles || {}) };
  const r = await q('UPDATE lines SET toggles = $2, notify_guardian = COALESCE($3, notify_guardian) WHERE id = $1 RETURNING *', [line.id, toggles, body.notify_guardian ?? null]);
  publish('line', r.rows[0]);
  return c.json(r.rows[0]);
});

app.get('/api/lines/:id/stats', async c => {
  const line = await lineOr404(c, c.req.param('id'));
  const r = await q(`SELECT outcome, sum(n)::int AS n FROM line_daily WHERE line_id = $1 AND day >= now() - interval '30 days' GROUP BY outcome`, [line.id]);
  const by = Object.fromEntries(r.rows.map(x => [x.outcome, x.n]));
  const sum = (...k) => k.reduce((a, x) => a + (by[x] || 0), 0);
  return c.json({ blocked: sum('blocked', 'fraud'), flagged: sum('scam', 'ai', 'spam', 'screened'), identified: sum('identified'), by });
});

app.get('/api/lines/:id/activity', async c => {
  const line = await lineOr404(c, c.req.param('id'));
  const { filter = 'all', q: query = '', limit = '50' } = c.req.query();
  const outcomes = { all: null, blocked: ['blocked', 'fraud'], scam: ['scam', 'ai'], spam: ['spam'], identified: ['identified'], screened: ['screened'] }[filter] ?? null;
  const r = await q(`
    SELECT DISTINCT ON (e.e164, e.outcome) e.time, e.id, e.line_id, e.e164, e.outcome, e.category, e.risk, e.note, e.source,
           n.display_name, n.location, n.reports_30d,
           (SELECT count(*) FROM call_events x WHERE x.line_id = e.line_id AND x.e164 = e.e164 AND x.time > now() - interval '30 days') AS times
    FROM call_events e LEFT JOIN numbers n ON n.e164 = e.e164
    WHERE e.line_id = $1 AND e.outcome NOT IN ('ringing','connected','allowed')
      AND ($2::text[] IS NULL OR e.outcome = ANY($2))
      AND ($3 = '' OR n.display_name ILIKE '%' || $3 || '%' OR e.e164 LIKE '%' || regexp_replace($3, '\\D', '', 'g') || '%' OR e.category ILIKE '%' || $3 || '%')
    ORDER BY e.e164, e.outcome, e.time DESC`, [line.id, outcomes, query.trim()]);
  const rows = r.rows.map(rowToActivity).sort((a, b) => a.ago - b.ago).slice(0, Number(limit));
  return c.json(rows);
});

/* ---------- numbers ---------- */
app.get('/api/numbers/:num', async c => {
  const n = e164(c.req.param('num'));
  if (!n) return bad(c, 'Enter a 10-digit phone number');
  const rep = (await reputation(n)) || syntheticReputation(n);
  const lineId = c.req.query('line');
  if (lineId) await q('INSERT INTO lookups (line_id, e164) VALUES ($1,$2)', [lineId, n]);
  const lists = lineId ? (await q('SELECT kind FROM list_entries WHERE line_id = $1 AND e164 = $2', [lineId, n])).rows.map(r => r.kind) : [];
  return c.json({ ...rep, num: pretty(n), blocked: lists.includes('block'), allowed: lists.includes('allow') });
});
app.get('/api/lines/:id/lookups', async c => {
  const r = await q('SELECT DISTINCT ON (e164) e164, created_at FROM lookups WHERE line_id = $1 ORDER BY e164, created_at DESC', [c.req.param('id')]);
  return c.json(r.rows.sort((a, b) => b.created_at - a.created_at).slice(0, 6).map(x => pretty(x.e164)));
});

/* ---------- lists & categories ---------- */
app.get('/api/lines/:id/lists', async c => {
  const r = await q('SELECT kind, e164, label, created_at FROM list_entries WHERE line_id = $1 ORDER BY created_at DESC', [c.req.param('id')]);
  return c.json(r.rows.map(x => ({ ...x, num: pretty(x.e164) })));
});
app.post('/api/lines/:id/lists', async c => {
  const line = await lineOr404(c, c.req.param('id'));
  const { kind, num, label } = await c.req.json();
  const n = e164(num);
  if (!n || !['block', 'allow'].includes(kind)) return bad(c, 'Enter a 10-digit phone number');
  await q('DELETE FROM list_entries WHERE line_id = $1 AND e164 = $2 AND kind <> $3', [line.id, n, kind]); // allow and block are exclusive
  await q('INSERT INTO list_entries (line_id, e164, kind, label) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [line.id, n, kind, label || null]);
  publish('lists', { line: line.id });
  return c.json({ ok: true, num: pretty(n), kind });
});
app.delete('/api/lines/:id/lists/:kind/:num', async c => {
  const n = e164(c.req.param('num'));
  await q('DELETE FROM list_entries WHERE line_id = $1 AND e164 = $2 AND kind = $3', [c.req.param('id'), n, c.req.param('kind')]);
  publish('lists', { line: c.req.param('id') });
  return c.json({ ok: true });
});
app.get('/api/lines/:id/categories', async c => {
  const r = await q('SELECT category, enabled FROM category_prefs WHERE line_id = $1', [c.req.param('id')]);
  return c.json(Object.fromEntries(r.rows.map(x => [x.category, x.enabled])));
});
app.put('/api/lines/:id/categories', async c => {
  const line = await lineOr404(c, c.req.param('id'));
  const body = await c.req.json();
  for (const [cat, enabled] of Object.entries(body)) {
    await q('INSERT INTO category_prefs (line_id, category, enabled) VALUES ($1,$2,$3) ON CONFLICT (line_id, category) DO UPDATE SET enabled = EXCLUDED.enabled', [line.id, cat, !!enabled]);
  }
  return c.json({ ok: true });
});

/* ---------- reports & premium ---------- */
app.post('/api/reports', async c => {
  const { lineId, num, reason, text, source = 'app' } = await c.req.json();
  const n = e164(num);
  if (!n) return bad(c, 'Enter a 10-digit phone number');
  if (!reason) return bad(c, 'Choose a reason');
  const r = await q('INSERT INTO reports (line_id, e164, reason, text, source) VALUES ($1,$2,$3,$4,$5) RETURNING *', [lineId || null, n, reason, text || null, source]);
  const wronglyFlagged = /not spam/i.test(reason);
  await q(`INSERT INTO numbers (e164, risk, reports_30d, category) VALUES ($1, $2, 1, $3)
           ON CONFLICT (e164) DO UPDATE SET reports_30d = numbers.reports_30d + 1,
             risk = CASE WHEN $4 THEN GREATEST(0, numbers.risk - 15) ELSE LEAST(100, numbers.risk + 5) END, updated_at = now()`,
    [n, wronglyFlagged ? 10 : 60, wronglyFlagged ? 'No reports' : 'Scam Likely', wronglyFlagged]);
  publish('report', r.rows[0]);
  return c.json(r.rows[0]);
});
app.post('/api/accounts/:id/premium', async c => {
  const { premium } = await c.req.json();
  await q('UPDATE accounts SET premium = $2 WHERE id = $1', [c.req.param('id'), !!premium]);
  if (!premium) await q(`UPDATE lines SET toggles = toggles || '{"aiVoice":false,"inCall":false,"screener":false,"vmText":false}' WHERE account_id = $1`, [c.req.param('id')]);
  return c.json({ ok: true, premium: !!premium });
});

/* ---------- calls ---------- */
const SCENARIOS = {
  scam:     { e164: '+13125550107', script: [] },
  // ring: true models a number the network has not seen yet, so pre-ring cannot stop it and in-call detection has to.
  fraud:    { e164: '+17025550119', ring: true, script: [[2, 'Hi, this is the fraud department at your bank. We detected suspicious activity and need to move your money now. Please read me the code we just texted you.']] },
  // one scripted answer per screener question
  screener: { e164: '+14045550151', script: [[2.5, "Uh... yeah, this is about your car's extended warranty. It's about to expire."], [2.5, "I'm with, uh, Vehicle Protection Services. We're the warranty department."], [2.5, "No, there's no callback number. This offer is only good today, so they need to decide now."]] },
};
const live = new Map(); // callId -> { lineId, e164, transcript, phase, timers }

async function logEvent(lineId, e164v, outcome, extra = {}) {
  const r = await q(`INSERT INTO call_events (line_id, e164, outcome, category, risk, note, transcript, verdict, duration_s, source)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [lineId, e164v, outcome, extra.category || null, extra.risk ?? null, extra.note || null, extra.transcript || null, extra.verdict ? JSON.stringify(extra.verdict) : null, extra.duration_s ?? null, extra.source || 'sim']);
  const rep = await reputation(e164v);
  const act = rowToActivity({ ...r.rows[0], display_name: rep?.display_name, location: rep?.location, reports_30d: rep?.reports_30d });
  publish('activity', act);
  return act;
}

/** Start an incoming call (simulated or from Twilio). Applies the pre-ring decision and emits SSE. */
export async function incomingCall({ lineId, e164: num, scenario = 'custom', source = 'sim', script = [], ring = false }) {
  const line = await getLine(lineId);
  if (!line) throw Object.assign(new Error('line not found'), { status: 404 });
  let decision = await preRing(line, num);
  if (ring && ['blocked', 'spam'].includes(decision.outcome) && decision.reason !== 'block list') {
    decision = { ...decision, outcome: 'unknown', label: 'Potential Spam', risk: Math.min(decision.risk, 60), category: 'Potential Spam', reason: 'new number, no network reputation yet' };
  }
  const rep = decision.rep || (await reputation(num)) || syntheticReputation(num);
  if (['blocked', 'spam'].includes(decision.outcome)) {
    const act = await logEvent(lineId, num, decision.outcome, { category: decision.category, risk: decision.risk, note: decision.outcome === 'blocked' ? `Blocked automatically (${decision.reason})` : `Sent to voicemail (${decision.reason})`, source });
    publish('call', { phase: 'blocked', lineId, num: pretty(num), label: decision.label, outcome: decision.outcome, reason: decision.reason, activity: act });
    await maybeGuardianAlert(line, num, decision, null);
    return { outcome: decision.outcome, decision, activity: act };
  }
  const id = crypto.randomUUID();
  const call = { id, lineId, e164: num, scenario, source, phase: 'ringing', transcript: '', decision, started: Date.now(), timers: [], alerts: [], rep, callerId: !!line.toggles?.callerId };
  const screen = (line.toggles?.screener && decision.outcome === 'unknown') || scenario === 'screener';
  if (screen) call.phase = 'screening';
  live.set(id, call);
  publish('call', { phase: call.phase, id, lineId, num: pretty(num), e164: num, label: decision.label, loc: rep.location, risk: decision.risk, callerId: !!line.toggles?.callerId, scenario });
  // scripted caller lines (the simulation's stand-in for Twilio audio). For a screened call the caller
  // talks to the screener right away; otherwise the script starts when the call is answered.
  call.script = script;
  if (screen) { call.questions = QUESTIONS(line.name); call.answers = []; call.lineName = line.name; askQuestion(call, 0); }
  return { outcome: 'ringing', id, decision };
}

async function maybeGuardianAlert(line, num, decision, verdict) {
  if (!line.notify_guardian) return;
  const high = decision?.risk >= 80 || (verdict && verdict.confidence >= 0.8);
  if (!high) return;
  const TACTIC = { otp_request: 'a passcode-phishing scam call', gift_card: 'a gift-card scam call', urgency_money: 'an urgent-money scam call', impersonation: 'an impersonation scam call', remote_access: 'a remote-access scam call', sales: 'a sales call' };
  const what = verdict ? (TACTIC[verdict.tactic] || 'a scam call') : `a ${decision.label} call`;
  await sendToLine(line.notify_guardian, `ScamShield stopped ${what} on ${line.name}'s phone from ${pretty(num)}. Nothing was shared.`, { kind: 'guardian' });
}

async function addTranscript(id, text, who = 'caller') {
  const call = live.get(id); if (!call) return;
  call.transcript += (call.transcript ? '\n' : '') + `${who}: ${text}`;
  publish('call', { phase: 'transcript', id, who, text });
  if (who !== 'caller' || call.phase === 'ended') return;
  const line = await getLine(call.lineId);
  const premium = (await one('SELECT premium FROM accounts WHERE id = $1', [line.account_id]))?.premium;
  const t = line.toggles || {};
  if (call.phase === 'screening') {
    // The screener runs a short interview: one answer per question, then a summary and a hand-off to the subscriber.
    if (call.screenDecided) return;
    if (!call.awaiting) { if (call.answers.length) call.answers[call.answers.length - 1] += ' ' + text; return; } // caller kept talking
    call.awaiting = false; call.answers.push(text);
    const next = call.qIndex + 1;
    if (next < call.questions.length) { call.timers.push(setTimeout(() => askQuestion(call, next), 900)); return; }
    await decideScreening(call, line);
    return;
  }
  if (call.phase !== 'connected') return;
  if (!(premium && (t.inCall || t.aiVoice))) return;
  const verdict = await judgeTranscript(call.transcript);
  call.verdict = verdict;
  if (t.aiVoice && verdict.synthetic_voice_hint && !call.alerts.includes('ai')) {
    call.alerts.push('ai'); publishAlert(call, { kind: 'ai', title: 'AI voice detected', text: 'The caller appears to be using a synthetic or cloned voice. Proceed with caution.', verdict });
  }
  if (t.inCall && verdict.confidence >= 0.8 && !call.alerts.includes('fraud')) {
    call.alerts.push('fraud'); publishAlert(call, { kind: 'fraud', title: 'Fraud call detected', text: verdict.one_line_warning, verdict });
    await maybeGuardianAlert(line, call.e164, call.decision, verdict);
  }
}

function publishAlert(call, a) {
  (call.alertDetails ||= []).push({ kind: a.kind, title: a.title, text: a.text });
  publish('call', { phase: 'alert', id: call.id, ...a });
}

/** Snapshot of a call for a client that (re)connects mid-call, e.g. Safari suspended during a phone call. */
function callSnapshot(call) {
  const transcript = (call.transcript || '').split('\n').filter(Boolean).map(l => { const m = l.match(/^([^:]+):\s*(.*)$/); return m ? { who: m[1], text: m[2] } : { who: 'caller', text: l }; });
  return {
    id: call.id, lineId: call.lineId, phase: call.phase, num: pretty(call.e164), e164: call.e164, label: call.decision.label,
    loc: call.rep?.location, risk: call.decision.risk, callerId: !!call.callerId, scenario: call.scenario, remote: !!call.remote,
    transcript, alerts: call.alertDetails || [], endedBy: call.endedBy, outcome: call.outcome, summary: call.summary || null, forwarded: !!call.forwarded,
    label: call.summary?.label || call.decision.label, risk: call.summary?.risk ?? call.decision.risk,
    t: call.phase === 'connected' ? Math.round((Date.now() - call.started) / 1000) : 0, endedAt: call.endedAt || null,
  };
}

function scheduleScript(call) {
  for (const [sec, text] of call.script || []) call.timers.push(setTimeout(() => addTranscript(call.id, text, 'caller').catch(console.error), sec * 1000));
  call.script = [];
}
/** Ask screener question `idx`. On Twilio the voice webhook's wait loop speaks `pendingSay`; in the simulation the
    scripted caller answers from the scenario's script. */
function askQuestion(call, idx) {
  const q = call.questions[idx];
  call.qIndex = idx; call.awaiting = true; call.askedAt = Date.now(); call.nudges = 0;
  if (call.twilioSid || call.source === 'twilio') { call.pendingSay = q; return; }
  call.timers.push(setTimeout(() => addTranscript(call.id, q, 'ScamShield'), 400));
  const reply = (call.script || []).shift();
  if (reply) call.timers.push(setTimeout(() => addTranscript(call.id, reply[1], 'caller').catch(console.error), 400 + reply[0] * 1000));
}

/** Interview over: summarize with Gemini, then either refuse a clear scam (Scam Block on) or ring the subscriber
    with the summary on screen. */
async function decideScreening(call, line) {
  if (call.screenDecided) return;
  call.screenDecided = true;
  const name = line.name;
  const s = await summarizeScreening(call.transcript);
  call.summary = s;
  call.verdict = { tactic: s.verdict === 'likely_scam' ? 'impersonation' : s.verdict === 'sales' ? 'sales' : 'none', confidence: s.risk / 100, synthetic_voice_hint: false, one_line_warning: s.summary, category: s.category, engine: s.engine };
  // Policy: the subscriber decides. Only an outright fraud tactic (passcode, gift card, remote access, "move your money
  // now") with Scam Block on is refused outright; sales pitches and vague callers ring through with the summary on screen.
  const refuse = hardFraud(call.transcript) && line.toggles?.scamBlock;
  if (call.phase === 'ended') return;
  if (refuse) {
    publish('call', { phase: 'screening', id: call.id, lineId: call.lineId, num: pretty(call.e164), e164: call.e164, label: s.label, loc: call.rep?.location, risk: s.risk, callerId: call.callerId, scenario: call.scenario, remote: !!call.twilioSid, summary: s });
    const bye = REFUSED(name);
    if (call.twilioSid) { call.pendingTwiml = { kind: 'hangup', say: bye, end: ['ScamShield', 'scam', { category: s.category, note: s.summary }] }; return; }
    call.timers.push(setTimeout(() => addTranscript(call.id, bye, 'ScamShield'), 800));
    call.timers.push(setTimeout(() => endCall(call.id, 'ScamShield', 'scam', { category: s.category, note: s.summary }), 3000));
    return;
  }
  const to = call.twilioSid ? forwardTarget() : null;
  const msg = call.twilioSid && !to ? `Thanks. ${name} will call you back. Goodbye.` : CONNECTING(name);
  call.phase = 'ringing'; call.forwarded = true;
  publish('call', { phase: 'ringing', id: call.id, lineId: call.lineId, num: pretty(call.e164), e164: call.e164, label: s.label, loc: call.rep?.location, risk: s.risk, callerId: call.callerId, scenario: call.scenario, remote: !!call.twilioSid, forwarded: true, summary: s });
  if (call.twilioSid) {
    call.pendingTwiml = to
      ? { kind: 'dial', say: msg, to, unavailable: NOT_AVAILABLE(name) }
      : { kind: 'hangup', say: msg, end: ['ScamShield', 'missed', { category: s.category, note: s.summary }] };
    return;
  }
  call.timers.push(setTimeout(() => addTranscript(call.id, msg, 'ScamShield'), 600));
}

async function endCall(id, by, outcomeHint, extra = {}) {
  const call = live.get(id); if (!call || call.phase === 'ended') return null;
  call.timers.forEach(clearTimeout);
  if (call.stt) { try { call.stt.close(); } catch {} }
  if (call.twilioSid && !extra.fromTwilio && !call.saidGoodbye) hangupTwilio(call.twilioSid);
  const duration = Math.round((Date.now() - call.started) / 1000);
  let outcome = outcomeHint;
  if (!outcome) {
    if (call.alerts.includes('fraud')) outcome = 'fraud';
    else if (call.alerts.includes('ai')) outcome = 'ai';
    else if (call.decision.outcome === 'scam') outcome = 'scam';
    else if (call.summary) outcome = call.phase === 'connected' ? 'forwarded' : 'missed';
    else if (call.decision.outcome === 'identified') outcome = 'identified';
    else outcome = call.phase === 'screening' ? 'screened' : 'allowed';
  }
  call.phase = 'ended'; call.endedBy = by; call.outcome = outcome; call.endedAt = Date.now();
  const act = outcome === 'allowed' ? null : await logEvent(call.lineId, call.e164, outcome, {
    category: extra.category || (outcome === 'fraud' ? 'Fraud detected' : outcome === 'ai' ? 'AI voice detected' : call.summary?.category || call.decision.category),
    risk: call.summary?.risk ?? call.decision.risk, note: extra.note || call.summary?.summary || call.verdict?.one_line_warning || null, transcript: call.transcript || null, verdict: call.verdict || null, duration_s: duration, source: call.source });
  publish('call', { phase: 'ended', id, endedBy: by, outcome, duration, activity: act });
  setTimeout(() => live.delete(id), 5 * 60_000);
  return { outcome, activity: act };
}

/** The call a reconnecting client should be showing: the active call on the line, else one that ended in the last few minutes. */
app.get('/api/calls/current', c => {
  const lineId = c.req.query('lineId');
  const calls = [...live.values()].filter(x => !lineId || x.lineId === lineId);
  const active = calls.filter(x => x.phase !== 'ended').sort((a, b) => b.started - a.started)[0];
  const recent = calls.filter(x => x.phase === 'ended' && Date.now() - x.endedAt < 3 * 60_000).sort((a, b) => b.endedAt - a.endedAt)[0];
  const call = active || recent;
  return c.json(call ? callSnapshot(call) : null);
});

app.post('/api/calls/simulate', async c => {
  const { lineId, scenario = 'scam', num } = await c.req.json();
  const s = SCENARIOS[scenario];
  const target = e164(num) || s?.e164;
  if (!target) return bad(c, 'unknown scenario');
  return c.json(await incomingCall({ lineId, e164: target, scenario, script: s?.script || [], ring: !!s?.ring }));
});
app.post('/api/calls/:id/answer', async c => {
  const call = live.get(c.req.param('id')); if (!call) return bad(c, 'no such call', 404);
  call.phase = 'connected'; call.started = Date.now();
  publish('call', { phase: 'connected', id: call.id });
  scheduleScript(call);
  return c.json({ ok: true });
});
app.post('/api/calls/:id/decline', async c => c.json(await endCall(c.req.param('id'), 'you', null)));
app.post('/api/calls/:id/end', async c => c.json(await endCall(c.req.param('id'), c.req.query('by') || 'you', null)));
app.post('/api/calls/:id/takeover', async c => {
  const call = live.get(c.req.param('id')); if (!call) return bad(c, 'no such call', 404);
  call.timers.forEach(clearTimeout); call.phase = 'connected'; call.started = Date.now();
  publish('call', { phase: 'connected', id: call.id, takeover: true });
  // anything the caller already said to the screener gets judged now that the user is on the line
  const said = call.transcript.split('\n').filter(l => l.startsWith('caller:')).pop();
  if (said) addTranscript(call.id, said.replace(/^caller:\s*/, ''), 'caller').catch(console.error);
  return c.json({ ok: true });
});
app.post('/api/calls/:id/transcript', async c => {
  const { text, who = 'caller' } = await c.req.json();
  if (!live.has(c.req.param('id'))) return bad(c, 'no such call', 404);
  await addTranscript(c.req.param('id'), text, who);
  return c.json({ ok: true, verdict: live.get(c.req.param('id'))?.verdict || null });
});

/* ---------- events (SSE) ---------- */
app.get('/api/events', c => streamSSE(c, async stream => {
  const unsubscribe = subscribe({ write: s => stream.write(s) });
  await stream.write(`event: hello\ndata: ${JSON.stringify({ llm: llmEnabled(), photon: photonEnabled() })}\n\n`);
  const ping = setInterval(() => stream.write(': ping\n\n').catch(() => {}), 25_000);
  await new Promise(resolve => { stream.onAbort(() => { clearInterval(ping); unsubscribe(); resolve(); }); });
}));

/* ---------- Photon ---------- */
app.get('/api/photon/status', c => c.json(photonStatus()));
app.get('/api/photon/outbox', c => c.json(getOutbox()));
app.post('/api/photon/send', async c => { const { lineId = 'line_0', text } = await c.req.json(); if (!text) return bad(c, 'text required'); return c.json(await sendToLine(lineId, text, { kind: 'manual' })); });
app.post('/webhooks/photon', c => c.json({ ok: true, note: 'inbound messages are consumed over the spectrum-ts stream; webhook not used' }));
startPhoton();

/* ---------- Learn tab (Safe Signal practice) ---------- */
registerLearn(app);
setPhotonSender(sendToLine);

/* ---------- Twilio (real calls) ---------- */
const callDeps = { incomingCall, addTranscript, endCall, live, getLine, publish };
registerTwilio(app, callDeps);

/* ---------- static UI ---------- */
// The UI is demoed from phones over ngrok: make Safari revalidate scripts instead of keeping a stale copy.
app.use('/*', async (c, next) => { await next(); if (!c.req.path.startsWith('/api')) c.header('Cache-Control', 'no-cache'); });
app.use('/*', serveStatic({ root: webRoot }));

app.onError((err, c) => { console.error(err); return c.json({ error: err.message }, err.status || 500); });

const port = Number(process.env.PORT || 8787);
const httpServer = serve({ fetch: app.fetch, port }, () => console.log(`ScamShield API on http://localhost:${port}  (web root: ${webRoot}, llm: ${llmEnabled()}, photon: ${photonEnabled()}, twilio: ${twilioEnabled()})`));
attachMediaServer(httpServer, callDeps);
process.on('SIGINT', async () => { await pool.end(); process.exit(0); });

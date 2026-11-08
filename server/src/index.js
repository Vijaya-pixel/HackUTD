import 'dotenv/config';
import path from 'node:path';
import { readFileSync } from 'node:fs';
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
import { INTERESTS, CHALLENGES, DIFFICULTIES, LESSON_FOR_TACTIC, SCENARIOS as DRILLS, startDrill, stopDrill, markClicked, publicState, allResults, startDrillListener } from './drill.js';
import { brainEnabled } from './drillbrain.js';
import { searchVoiceprint, logVoiceMatch, enrollVoiceprints, listProfiles, getProfile, deleteProfile, voiceprintCount, learnVoiceprint, disputeProfile, resetLearned } from './voicedb.js';

const app = new Hono();
app.use('/api/*', cors());

const webRoot = path.relative(process.cwd(), path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')) || '.';

/* ---------- helpers ---------- */
const bad = (c, msg, code = 400) => c.json({ error: msg }, code);
const lineOr404 = async (c, id) => { const l = await getLine(id); if (!l) throw Object.assign(new Error('line not found'), { status: 404 }); return l; };

function rowToActivity(r) {
  return {
    id: r.id, line: r.line_id, num: pretty(r.e164), e164: r.e164, name: r.display_name || null, type: r.outcome,
    cat: r.category, loc: r.location, risk: r.risk, reports: r.reports_30d ?? 0, note: r.note, time: r.time,
    ago: Math.max(0, Math.round((Date.now() - new Date(r.time).getTime()) / 60000)), times: Number(r.times || 1), source: r.source
  };
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
// `voice` names an enrolled scammer voice (server/seed/voiceprints.json). Simulated calls carry no audio, so
// the sim replays a stored sample of that voice (never one of its enrolled ones) through the real database search.
const SCENARIOS = {
  scam: { e164: '+13125550107', script: [] },
  // ring: true models a number the network has not seen yet, so pre-ring cannot stop it and in-call detection has to.
  fraud: { e164: '+17025550119', ring: true, voice: 'bank_fraud', script: [[2, 'Hi, this is the fraud department at your bank. We detected suspicious activity and need to move your money now. Please read me the code we just texted you.']] },
  voice: { e164: '+13235550188', ring: true, voice: 'grandparent', script: [[2, "Grandma, it's me. I was in a car accident and I'm in jail. I need bail money right now, please don't tell mom."]] },
  screener: { e164: '+14045550151', script: [[2, "Uh... yeah, this is about your car's extended warranty. It's about to expire."]] },
  // The headline story: one scammer voice the database has never heard, calling two customers from two numbers.
  // Call 1 is an unknown voice (the system learns it); call 2 is the SAME voice on a NEW number and gets flagged.
  // Screened call whose caller speech arrives as live audio (Twilio, or scripts/fake-scam-call.mjs). No canned lines.
  screen_live: { e164: '+14045550151', ring: true, script: [] },
  story1: { e164: '+12145550198', ring: true, voice: 'story:callA', script: [[2, 'Hello, this is the security department at your bank. To cancel the suspicious transfer, please confirm the six digit verification code we just sent to your phone.']] },
  story2: { e164: '+14695550231', ring: true, voice: 'story:callB', script: [[2, 'Good afternoon, I am calling from the fraud prevention team about your debit card. Please read back the passcode that was just texted to you, or the account will be locked.']] },
};
const seedDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed');
const seedCache = {};
const seedFile = name => { try { return seedCache[name] ??= JSON.parse(readFileSync(path.join(seedDir, name), 'utf8')); } catch { return null; } };
function voiceProbe(key) {
  if (key.startsWith('story:')) return seedFile('story.json')?.[key.slice(6)]?.embedding || null;
  return seedFile('voiceprints.json')?.profiles.find(p => p.key === key)?.probe || null;
}
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
  const call = { id, lineId, e164: num, scenario, source, phase: 'ringing', transcript: '', decision, started: Date.now(), timers: [], alerts: [], rep };
  const screen = (line.toggles?.screener && decision.outcome === 'unknown') || scenario === 'screener' || scenario === 'screen_live';
  if (screen) call.phase = 'screening';
  live.set(id, call);
  publish('call', { phase: call.phase, id, lineId, num: pretty(num), e164: num, label: decision.label, loc: rep.location, risk: decision.risk, callerId: !!line.toggles?.callerId, scenario });
  // scripted caller lines (the simulation's stand-in for Twilio audio). For a screened call the caller
  // talks to the screener right away; otherwise the script starts when the call is answered.
  call.script = script;
  if (screen) { runScreener(call, line); scheduleScript(call); }
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
    // screener decides from the caller's answer
    const verdict = await judgeTranscript(call.transcript);
    call.verdict = verdict;
    if (call.screenDecided) return; // one decision per screened call
    call.screenDecided = true;
    if (verdict.confidence >= 0.6 || verdict.category === 'Telemarketing') {
      const bye = `${line.name} is not available for sales calls. Goodbye.`;
      call.timers.push(setTimeout(() => addTranscript(id, bye, 'ScamShield'), 1200));
      if (call.twilioSid) { call.saidGoodbye = true; sayAndHangup(call.twilioSid, bye); }
      // With live audio, give the voice check a few more seconds so a scam voice can still be learned or flagged.
      const finish = () => endCall(id, 'ScamShield', 'screened', { category: verdict.category, note: `Caller said: "${text}"`, fromTwilio: !!call.twilioSid });
      const waitVoice = (left) => (!call.audio || call.embedding || left <= 0) ? finish() : call.timers.push(setTimeout(() => waitVoice(left - 500), 500));
      call.timers.push(setTimeout(() => waitVoice(6000), 3200));
    } else {
      const fwd = forwardTarget();
      const msg = call.twilioSid && !fwd ? `Thanks. ${line.name} will call you back. Goodbye.` : `One moment, connecting you to ${line.name}.`;
      call.timers.push(setTimeout(() => addTranscript(id, msg, 'ScamShield'), 1200));
      if (call.twilioSid) {
        call.saidGoodbye = true; sayAndHangup(call.twilioSid, msg, fwd ? { dial: fwd } : {});
        if (!fwd) call.timers.push(setTimeout(() => endCall(id, 'ScamShield', 'screened', { category: 'Identified caller', note: `Caller said: "${text}"`, fromTwilio: true }), 4000));
      } else {
        call.timers.push(setTimeout(() => { call.phase = 'ringing'; publish('call', { phase: 'ringing', id, lineId: call.lineId, num: pretty(call.e164), label: 'Screened caller', loc: call.rep?.location, risk: call.decision.risk, scenario: call.scenario }); }, 2600));
      }
    }
    return;
  }
  if (call.phase !== 'connected') return;
  if (!(premium && (t.inCall || t.aiVoice))) return;
  const verdict = await judgeTranscript(call.transcript);
  call.verdict = verdict;
  if (t.aiVoice && verdict.synthetic_voice_hint && !call.alerts.includes('ai')) {
    call.alerts.push('ai'); publish('call', { phase: 'alert', id, kind: 'ai', title: 'AI voice detected', text: 'The caller appears to be using a synthetic or cloned voice. Proceed with caution.', verdict });
  }
  if (t.inCall && verdict.confidence >= 0.8 && !call.alerts.includes('fraud')) {
    call.alerts.push('fraud'); publish('call', { phase: 'alert', id, kind: 'fraud', title: 'Fraud call detected', text: verdict.one_line_warning, verdict });
    await maybeGuardianAlert(line, call.e164, call.decision, verdict);
  }
}

function scheduleScript(call) {
  for (const [sec, text] of call.script || []) call.timers.push(setTimeout(() => addTranscript(call.id, text, 'caller').catch(console.error), sec * 1000));
  call.script = [];
}
function runScreener(call, line) {
  call.timers.push(setTimeout(() => addTranscript(call.id, `Hi, I'm screening calls for ${line.name}. May I ask who is calling?`, 'ScamShield'), 400));
}

/**
 * Risk fusion: no single signal decides. Each one adds independent evidence and the total is
 * 1 - product(1 - p). Voice alone is deliberately capped, and nothing here ever blocks a call.
 */
function fuseRisk(call, match, profile, otherNumbers) {
  const signals = [];
  const sim = Math.max(0, Math.min(1, (match.similarity - 0.7) / 0.3));
  const corroborated = profile.reports >= 2 && profile.status === 'confirmed';
  const pVoice = Math.min(0.55, 0.2 + sim * 0.35) * (corroborated ? 1 : 0.7) * (profile.disputes ? 0.7 : 1);
  signals.push({ label: 'Voice similarity', detail: `${Math.round(match.similarity * 100)}% match · ${profile.reports} report${profile.reports === 1 ? '' : 's'}${corroborated ? '' : ' (not yet corroborated)'}`, p: pVoice });
  if (otherNumbers.length) signals.push({ label: 'Number changed', detail: `Same voice used ${otherNumbers.length} other number${otherNumbers.length === 1 ? '' : 's'}`, p: 0.2 });
  const risk = call.decision?.risk ?? 0;
  if (risk >= 45) signals.push({ label: 'Number reputation', detail: `Risk ${risk}/100 · ${call.decision.category}`, p: Math.min(0.5, risk / 200) });
  const v = call.verdict;
  if (v && v.confidence >= 0.5) signals.push({ label: 'Conversation', detail: v.one_line_warning, p: Math.min(0.8, v.confidence * 0.8) });
  const score = 1 - signals.reduce((a, s) => a * (1 - s.p), 1);
  return { score: Math.round(score * 100), level: score >= 0.8 ? 'High' : score >= 0.5 ? 'Elevated' : 'Low', signals: signals.map(({ label, detail }) => ({ label, detail })) };
}

/**
 * Compare the caller's voiceprint with the scammer voice database and warn the user on a match.
 * Same gate as the other in-call protections (Premium + AI voice / in-call toggle). One alert per profile per call.
 * `replayed` marks simulated calls, where a stored sample stands in for live audio.
 */
async function checkVoice(call, embedding, { replayed = false } = {}) {
  if (!embedding || !['connected', 'screening'].includes(call.phase)) return null;
  const line = await getLine(call.lineId);
  const premium = (await one('SELECT premium FROM accounts WHERE id = $1', [line.account_id]))?.premium;
  const t = line.toggles || {};
  if (!(premium && (t.aiVoice || t.inCall))) return { skipped: 'premium protection is off for this line' };
  call.embedding = embedding;                         // kept in memory only, so a confirmed scam can be learned when the call ends
  const r = await searchVoiceprint(embedding);
  if (!r.matched) return r;
  const p = r.profile;
  if (call.alerts.includes('voiceprint:' + p.id)) return r;
  call.alerts.push('voiceprint:' + p.id, 'voiceprint');
  call.voiceMatch = { id: p.id, name: p.name, similarity: r.similarity };
  const others = p.numbers.filter(n => n.e164 !== call.e164).map(n => n.num);
  const pct = Math.round(r.similarity * 100);
  await logVoiceMatch(p.id, call.e164, call.id, r.similarity).catch(console.error);
  const fusion = fuseRisk(call, r, p, others);
  publish('call', {
    phase: 'alert', id: call.id, kind: 'voiceprint',
    title: p.status === 'pending' ? 'Possible repeat caller' : 'Possible repeat scam caller',
    text: `Voice similarity to previously reported scam audio (${p.reports} report${p.reports === 1 ? '' : 's'}).` + (others.length ? ` The same voice called from ${others.join(' and ')}.` : ''),
    similarity: r.similarity, pct, replayed, fusion,
    profile: { id: p.id, name: p.name, scamType: p.scamType, aiVoice: p.aiVoice, reports: p.reports, status: p.status, numbers: others },
  });
  if (p.aiVoice && !call.alerts.includes('ai')) {
    call.alerts.push('ai');
    publish('call', { phase: 'alert', id: call.id, kind: 'ai', title: 'AI voice detected', text: 'This voice is on file as AI-generated. Scammers use voice cloning to sound like people you know.' });
  }
  await maybeGuardianAlert(line, call.e164, call.decision, { confidence: 0.9, tactic: 'impersonation' });
  return r;
}

async function endCall(id, by, outcomeHint, extra = {}) {
  const call = live.get(id); if (!call || call.phase === 'ended') return null;
  call.timers.forEach(clearTimeout);
  if (call.stt) { try { call.stt.close(); } catch { } }
  if (call.twilioSid && !extra.fromTwilio && !call.saidGoodbye) hangupTwilio(call.twilioSid);
  const duration = Math.round((Date.now() - call.started) / 1000);
  let outcome = outcomeHint;
  if (!outcome) {
    if (call.alerts.includes('fraud')) outcome = 'fraud';
    else if (call.alerts.includes('ai')) outcome = 'ai';
    else if (call.voiceMatch) outcome = 'scam';
    else if (call.decision.outcome === 'scam') outcome = 'scam';
    else if (call.decision.outcome === 'identified') outcome = 'identified';
    else outcome = call.phase === 'screening' ? 'screened' : 'allowed';
  }
  call.phase = 'ended';
  // ADAPT: a call judged a scam teaches the voice database. New voices start as pending (one report is a hint);
  // a repeat of a known voice adds a corroborating report. Only the voiceprint and number are kept, never audio.
  // A screened call never reaches the in-call fraud alert, so a confident scam verdict from the screener counts too.
  const judgedScam = call.alerts.includes('fraud') || (call.verdict && call.verdict.confidence >= 0.8 && !['sales', 'none'].includes(call.verdict.tactic));
  if (call.embedding && judgedScam && !call.learned) {
    call.learned = true;
    const cat = call.verdict?.category && !['Unknown', 'Legitimate'].includes(call.verdict.category) ? call.verdict.category : 'Suspicious call';
    learnVoiceprint({ embedding: call.embedding, e164: call.e164, scamType: cat, matchedProfileId: call.voiceMatch?.id || null })
      .then(p => p && console.log(`[voice] learned ${p.name} (${p.status}, ${p.reports} report${p.reports === 1 ? '' : 's'}) from ${call.e164}`))
      .catch(e => console.warn('[voice] learn failed:', e.message));
  }
  const act = outcome === 'allowed' ? null : await logEvent(call.lineId, call.e164, outcome, {
    category: extra.category || (outcome === 'fraud' ? 'Fraud detected' : outcome === 'ai' ? 'AI voice detected' : call.voiceMatch ? 'Known scam voice' : call.decision.category),
    risk: call.decision.risk, note: extra.note || (call.voiceMatch && `Voice matched "${call.voiceMatch.name}" (${Math.round(call.voiceMatch.similarity * 100)}% similar)`) || call.verdict?.one_line_warning || null, transcript: call.transcript || null, verdict: call.verdict || null, duration_s: duration, source: call.source
  });
  // ADAPT: point the customer at the Academy lesson for the scam this call used.
  const lessonId = ['fraud', 'ai', 'scam', 'screened'].includes(outcome) ? (LESSON_FOR_TACTIC[call.verdict?.tactic] || (call.voiceMatch ? 'bank' : null)) : null;
  const lesson = lessonId ? { id: lessonId, title: DRILLS[lessonId].title } : null;
  publish('call', { phase: 'ended', id, endedBy: by, outcome, duration, activity: act, lesson });
  setTimeout(() => live.delete(id), 60_000);
  return { outcome, activity: act };
}

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
  // Simulated calls have no audio: replay a stored sample of the scenario's scammer voice through the real search.
  const simVoice = call.source === 'sim' && SCENARIOS[call.scenario]?.voice;
  if (simVoice) call.timers.push(setTimeout(() => checkVoice(call, voiceProbe(simVoice), { replayed: true }).catch(console.error), 5500));
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

/* ---------- scammer voice database ---------- */
app.get('/api/voices', async c => c.json(await listProfiles()));
app.get('/api/voices/status', async c => c.json({ profiles: (await listProfiles()).length, voiceprints: await voiceprintCount() }));
app.post('/api/voices/enroll', async c => {
  const b = await c.req.json();
  if (!Array.isArray(b.embeddings) || !b.embeddings.length) return bad(c, 'embeddings required (256 numbers each)');
  if (!b.profileId && !b.name) return bad(c, 'name required for a new profile');
  const r = await enrollVoiceprints({ profileId: b.profileId, name: String(b.name || '').slice(0, 80), scamType: String(b.scamType || 'Unknown').slice(0, 60), notes: b.notes ? String(b.notes).slice(0, 300) : null, aiVoice: !!b.aiVoice, numbers: (b.numbers || []).map(e164).filter(Boolean), embeddings: b.embeddings.slice(0, 50), source: 'enroll' });
  if (!r.added) return bad(c, 'no valid embeddings (each must be 256 finite numbers)');
  return c.json(r);
});
app.delete('/api/voices/:id', async c => { await deleteProfile(c.req.param('id')); return c.json({ ok: true }); });
// "Not a scam?": customers can dispute a voice match. Two disputes retire an unconfirmed profile.
app.post('/api/voices/:id/dispute', async c => c.json(await disputeProfile(c.req.param('id')) || { ok: true }));
// Demo setup: forget voices learned from calls, and make sure every line has the protections the story needs.
app.post('/api/demo/story/reset', async c => {
  const forgotten = await resetLearned();
  await q(`UPDATE accounts SET premium = true`);
  await q(`UPDATE lines SET toggles = toggles || '{"aiVoice":true,"inCall":true}'`);
  const rows = (await q('SELECT * FROM lines')).rows;
  for (const l of rows) publish('line', l);
  return c.json({ ok: true, forgotten, voices: await voiceprintCount() });
});
// A live voiceprint for a call in progress (from the audio pipeline). Returns the match result.
app.post('/api/calls/:id/voice', async c => {
  const call = live.get(c.req.param('id')); if (!call) return bad(c, 'no such call', 404);
  const { embedding } = await c.req.json();
  return c.json(await checkVoice(call, embedding) || { matched: false });
});

/* ---------- ADAPT: collective threat intelligence ---------- */
// Turns what Protect saw (voices reused across numbers, tactics in judged calls) into a recommended Academy lesson.
async function threatInsights() {
  const voices = (await q(`
    SELECT p.id, p.name, p.scam_type, p.status, p.reports, count(DISTINCT n.e164)::int AS numbers,
           (SELECT count(*)::int FROM voice_matches m WHERE m.profile_id = p.id AND m.matched_at > now() - interval '7 days') AS matches_7d
    FROM scammer_profiles p LEFT JOIN scammer_numbers n ON n.profile_id = p.id
    GROUP BY p.id ORDER BY matches_7d DESC, numbers DESC LIMIT 5`)).rows;
  const tactics = (await q(`
    SELECT verdict->>'tactic' AS tactic, count(*)::int AS n FROM call_events
    WHERE time > now() - interval '7 days' AND verdict IS NOT NULL AND verdict->>'tactic' NOT IN ('none', '')
    GROUP BY 1 ORDER BY n DESC LIMIT 5`)).rows;
  const top = tactics.find(t => LESSON_FOR_TACTIC[t.tactic]);
  const lesson = top ? LESSON_FOR_TACTIC[top.tactic] : 'bank';
  const LABEL = { otp_request: 'Passcode requests', impersonation: 'Impersonation', gift_card: 'Gift-card demands', urgency_money: 'Urgent money requests', remote_access: 'Remote-access requests', sales: 'Sales calls' };
  return {
    repeatVoices: voices.filter(v => v.numbers > 1).length,
    voices: voices.map(v => ({ id: v.id, name: v.name, scamType: v.scam_type, status: v.status, reports: v.reports, numbers: v.numbers, matches7d: v.matches_7d })),
    tactics: tactics.map(t => ({ tactic: t.tactic, label: LABEL[t.tactic] || t.tactic, calls: t.n })),
    recommended: { id: lesson, title: DRILLS[lesson].title, because: top ? `${LABEL[top.tactic] || top.tactic} showed up in ${top.n} call${top.n === 1 ? '' : 's'} this week` : 'The most common scam type for T-Mobile customers' },
  };
}
app.get('/api/insights', async c => c.json(await threatInsights()));

/* ---------- scam drill (education suite) ---------- */
app.get('/api/drill/options', async c => c.json({ interests: INTERESTS, challenges: CHALLENGES, difficulties: DIFFICULTIES, ai: brainEnabled(), messaging: photonEnabled(), recommended: (await threatInsights().catch(() => null))?.recommended || null }));
app.post('/api/drill/start', async c => {
  const b = await c.req.json().catch(() => ({}));
  const { status = 200, ...body } = await startDrill({ name: b.name, phone: b.phone, interests: Array.isArray(b.interests) ? b.interests.map(String).slice(0, 8) : [], scenario: b.scenario, consent: b.consent, difficulty: b.difficulty, gentle: b.gentle === true });
  return c.json(body, status);
});
app.get('/api/drill/session/:token', async c => {
  const s = await publicState(c.req.param('token'));
  return s ? c.json(s) : bad(c, 'not found', 404);
});
app.post('/api/drill/session/:token/stop', async c => c.json({ ok: await stopDrill(c.req.param('token')) }));
// The link inside the drill text: record the tap, then send the person to their results page in the app.
app.get('/d/:token', async c => {
  const token = c.req.param('token');
  const s = await markClicked(token);
  return s ? c.redirect(`/drill.html?t=${encodeURIComponent(token)}`, 302) : c.text('Not found', 404);
});
// Presenter view of everyone's results. Off unless DRILL_ADMIN_KEY is set (names and outcomes are private).
app.get('/api/drill/results', async c => {
  const key = process.env.DRILL_ADMIN_KEY;
  if (!key) return bad(c, 'Set DRILL_ADMIN_KEY in server/.env to enable this', 503);
  if (c.req.header('x-admin-key') !== key) return bad(c, 'unauthorized', 401);
  return c.json(await allResults());
});

/* ---------- events (SSE) ---------- */
app.get('/api/events', c => streamSSE(c, async stream => {
  const unsubscribe = subscribe({ write: s => stream.write(s) });
  await stream.write(`event: hello\ndata: ${JSON.stringify({ llm: llmEnabled(), photon: photonEnabled() })}\n\n`);
  const ping = setInterval(() => stream.write(': ping\n\n').catch(() => { }), 25_000);
  await new Promise(resolve => { stream.onAbort(() => { clearInterval(ping); unsubscribe(); resolve(); }); });
}));

/* ---------- Photon ---------- */
app.get('/api/photon/status', c => c.json(photonStatus()));
app.get('/api/photon/outbox', c => c.json(getOutbox()));
app.post('/api/photon/send', async c => { const { lineId = 'line_0', text } = await c.req.json(); if (!text) return bad(c, 'text required'); return c.json(await sendToLine(lineId, text, { kind: 'manual' })); });
app.post('/webhooks/photon', c => c.json({ ok: true, note: 'inbound messages are consumed over the spectrum-ts stream; webhook not used' }));
startPhoton();
startDrillListener();

/* ---------- Twilio (real calls) ---------- */
const callDeps = { incomingCall, addTranscript, endCall, live, getLine, publish, checkVoice };
registerTwilio(app, callDeps);

/* ---------- static UI ---------- */
app.use('/*', serveStatic({ root: webRoot }));

app.onError((err, c) => { console.error(err); return c.json({ error: err.message }, err.status || 500); });

const port = Number(process.env.PORT || 8787);
const httpServer = serve({ fetch: app.fetch, port }, () => console.log(`ScamShield API on http://localhost:${port}  (web root: ${webRoot}, llm: ${llmEnabled()}, photon: ${photonEnabled()}, twilio: ${twilioEnabled()})`));
attachMediaServer(httpServer, callDeps);
process.on('SIGINT', async () => { await pool.end(); process.exit(0); });

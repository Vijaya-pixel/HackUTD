// Photon Spectrum (stable) integration via the spectrum-ts SDK.
// Spectrum has no HTTP send endpoint: the SDK holds a live connection, streams inbound messages
// (app.messages) and sends replies. Credentials: PHOTON_PROJECT_ID + PHOTON_PROJECT_SECRET.
import 'dotenv/config';
import { q, one, e164, pretty } from './db.js';
import { reputation, syntheticReputation } from './risk.js';
import { draftReply } from './llm.js';

const PROJECT_ID = process.env.PHOTON_PROJECT_ID || '';
const SECRET = process.env.PHOTON_PROJECT_SECRET || process.env.PHOTON_API_KEY || '';
const DEMO_PHONE = e164(process.env.DEMO_PHONE || '') || null;   // the real phone that stands in for Anne's line in demos
const DEMO_LINE = process.env.DEMO_LINE_ID || 'line_0';

let app = null, im = null, textFn = null, status = { state: 'off', detail: 'PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET not set' };
const outbox = []; // last 50 outbound messages with delivery result (GET /api/photon/outbox)
const seen = new Set();

export const photonEnabled = () => !!app;
export const photonStatus = () => ({ ...status, projectId: PROJECT_ID ? PROJECT_ID.slice(0, 8) + '…' : null, demoPhone: DEMO_PHONE ? pretty(DEMO_PHONE) : null, outbox: outbox.length });
export const getOutbox = () => outbox;

/**
 * Other features (the scam drill) can claim inbound texts before the default ScamShield bot answers.
 * An interceptor gets { handle, text, space, message, reply(text) } and returns true when it handled the message.
 */
const interceptors = [];
export const onInbound = fn => { interceptors.push(fn); };

/** Send a text to any phone over iMessage (a shared line can only reach people who already texted it). */
export async function sendToHandle(handle, text, meta = {}) {
  const to = e164(handle);
  const entry = { at: new Date().toISOString(), lineId: null, to: to ? pretty(to) : null, text, kind: meta.kind || 'message', delivered: false };
  outbox.unshift(entry); outbox.length = Math.min(outbox.length, 50);
  if (!app) { entry.reason = 'photon not connected'; return entry; }
  if (!to) { entry.reason = 'invalid phone number'; return entry; }
  try {
    const space = await im.space.create(await im.user(to));
    await space.send(textFn(text));
    entry.delivered = true;
  } catch (e) { entry.reason = e.message; console.warn('[photon] send failed:', e.message); }
  return entry;
}

/** Connect to Photon and start consuming inbound messages. Safe to call when credentials are missing. */
export async function startPhoton() {
  if (!PROJECT_ID || !SECRET) return;
  try {
    const core = await import('spectrum-ts');
    const { imessage } = await import('spectrum-ts/providers/imessage');
    textFn = core.text;
    app = await core.Spectrum({ projectId: PROJECT_ID, projectSecret: SECRET, providers: [imessage.config()], logLevel: 'warn' });
    im = imessage(app);
    const cfg = app.config || {};
    status = { state: 'connected', detail: 'spectrum-ts stream open', projectKeys: Object.keys(cfg) };
    console.log('[photon] connected; project config keys:', Object.keys(cfg).join(', '));
    const summary = JSON.stringify(cfg, (k, v) => /secret|token|key/i.test(k) ? undefined : v).slice(0, 600);
    console.log('[photon] project:', summary);
    pump().catch(e => { console.error('[photon] message stream ended:', e.message); status = { state: 'error', detail: e.message }; });
  } catch (e) {
    status = { state: 'error', detail: e.message };
    console.error('[photon] failed to start:', e.message);
    app = null;
  }
}

async function pump() {
  for await (const [space, message] of app.messages) {
    try { await handleInbound(space, message); } catch (e) { console.error('[photon] inbound handler error:', e.message); }
  }
}

async function lineForHandle(handle) {
  const ph = e164(handle);
  if (!ph) return null;
  if (DEMO_PHONE && ph === DEMO_PHONE) return one('SELECT * FROM lines WHERE id = $1', [DEMO_LINE]);
  return one('SELECT * FROM lines WHERE msisdn = $1', [ph]);
}
function phoneForLine(line) { return (DEMO_PHONE && line.id === DEMO_LINE) ? DEMO_PHONE : line.msisdn; }

/** Send a text to a line's phone over iMessage. Shared Photon lines can only message people who texted first. */
export async function sendToLine(lineId, text, meta = {}) {
  const line = await one('SELECT * FROM lines WHERE id = $1', [lineId]);
  const to = line ? phoneForLine(line) : null;
  const entry = { at: new Date().toISOString(), lineId, to: to ? pretty(to) : null, text, kind: meta.kind || 'message', delivered: false };
  outbox.unshift(entry); outbox.length = Math.min(outbox.length, 50);
  if (!app) { entry.reason = 'photon not connected'; return entry; }
  if (!to) { entry.reason = 'line not found'; return entry; }
  try {
    const user = await im.user(to);
    const space = await im.space.create(user);
    await space.send(textFn(text));
    entry.delivered = true; entry.spaceId = space.id;
    if (line && space.id) q('UPDATE lines SET photon_space_id = $2 WHERE id = $1', [line.id, space.id]).catch(() => { });
  } catch (e) { entry.reason = e.message; console.warn('[photon] send failed:', e.message); }
  return entry;
}

/** Inbound text: a phone number => check it (and report it if the text says so); anything else => help. */
export async function handleInbound(space, message) {
  if (!message || message.content?.type !== 'text') return;
  if (seen.has(message.id)) return; seen.add(message.id);
  const text = message.content.text || '';
  const fromHandle = message.sender?.id || '';
  for (const fn of interceptors) {
    try {
      const reply = async t => { await message.reply(textFn(t)); };
      if (await fn({ handle: e164(fromHandle) || fromHandle, text, space, message, reply })) return;
    } catch (e) { console.error('[photon] interceptor error:', e.message); }
  }
  const line = await lineForHandle(fromHandle);
  if (line && space?.id) q('UPDATE lines SET photon_space_id = $2 WHERE id = $1', [line.id, space.id]).catch(() => { });
  console.log('[photon] inbound from', pretty(e164(fromHandle) || fromHandle), '->', line?.id || 'unknown line', ':', text.slice(0, 80));

  const num = e164(text.match(/\+?1?\D*(\d{3})\D*(\d{3})\D*(\d{4})/)?.[0]);
  let reply;
  if (num) {
    const rep = (await reputation(num)) || syntheticReputation(num);
    const isReport = /report|scam|spam|fraud/i.test(text);
    if (isReport) {
      await q(`INSERT INTO reports (line_id, e164, reason, text, source) VALUES ($1,$2,$3,$4,'photon')`, [line?.id || null, num, 'Reported by text', text]);
      await q(`INSERT INTO numbers (e164, risk, reports_30d, category) VALUES ($1, 60, 1, 'Scam Likely')
               ON CONFLICT (e164) DO UPDATE SET reports_30d = numbers.reports_30d + 1, risk = LEAST(100, numbers.risk + 5), updated_at = now()`, [num]);
      rep.reports_30d = (rep.reports_30d || 0) + 1;
    }
    reply = await draftReply(pretty(num), rep);
    if (isReport) reply = 'Thanks, report received. ' + reply;
  } else {
    reply = 'ScamShield: text me any phone number to check it, or "report 312-555-0107" to report a scam call.';
  }
  const entry = { at: new Date().toISOString(), lineId: line?.id || null, to: pretty(e164(fromHandle) || fromHandle), text: reply, kind: 'reply', delivered: false };
  outbox.unshift(entry); outbox.length = Math.min(outbox.length, 50);
  try { await message.reply(textFn(reply)); entry.delivered = true; }
  catch (e) { entry.reason = e.message; console.warn('[photon] reply failed:', e.message); }
  return entry;
}

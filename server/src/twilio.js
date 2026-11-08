// Twilio Programmable Voice: inbound Call Screener, outbound "scammer" demo calls, Media Streams audio.
// All real-call behaviour funnels into the same call pipeline the simulation uses (incomingCall/addTranscript/endCall).
import 'dotenv/config';
import twilio from 'twilio';
import { WebSocketServer } from 'ws';
import { openStt, sttEnabled } from './stt.js';
import { e164, pretty } from './db.js';

const SID = process.env.TWILIO_ACCOUNT_SID || '', TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const FROM = e164(process.env.TWILIO_NUMBER || '') || process.env.TWILIO_NUMBER || '';   // Twilio wants +1XXXXXXXXXX
// Trial accounts may only call verified phones from the "assigned trial number" (the sandbox line), while an
// owned number is what receives inbound calls. Set TWILIO_OUTBOUND_FROM to the sandbox line on a trial.
const OUT_FROM = e164(process.env.TWILIO_OUTBOUND_FROM || '') || FROM;
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:8787').replace(/\/$/, '');
const LINE_ID = process.env.TWILIO_LINE_ID || 'line_0';
const FORWARD_TO = process.env.TWILIO_FORWARD_TO || '';
const VOICE = process.env.TWILIO_VOICE || 'Polly.Matthew';
const MAX_CALL_SECONDS = Number(process.env.TWILIO_MAX_CALL_SECONDS || 180);
const client = SID && TOKEN ? twilio(SID, TOKEN) : null;
const { VoiceResponse } = twilio.twiml;

export const twilioEnabled = () => !!(client && FROM);
const wsUrl = () => PUBLIC_URL.replace(/^http/, 'ws') + '/twilio/media';
const abs = (path) => PUBLIC_URL + path;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Scripted lines the "scammer" says on an outbound demo call; each one is also fed to the classifier. */
export const OUTBOUND_SCRIPTS = {
  fraud: [
    'Hello, this is the fraud department at your bank. We detected suspicious activity on your account and need to move your money to a safe account right now.',
    'To verify your identity, please read me the six digit code we just texted you. Do not hang up, or the transfer will go through.',
    'If it is easier, you can also secure the account today by purchasing gift cards and reading me the numbers on the back.',
  ],
  grandparent: [
    'Grandma? It is me. I was in a car accident and I am at the police station. Please do not tell mom and dad.',
    'They say I can leave tonight if someone pays the bail. Can you send it by wire or a cash app right now? I will pay you back.',
  ],
  warranty: [
    'We are reaching out about your vehicle extended warranty, which is about to expire. Press one to speak with a specialist before coverage lapses.',
  ],
};
const SCREENER_PROMPT = name => `Hi, I'm screening calls for ${name}. May I ask who is calling and what it's about?`;

let warnedUnsigned = false;
function validate(c, params) {
  if (!TOKEN || /localhost|127\.0\.0\.1/.test(PUBLIC_URL)) return true; // local curl tests
  const sig = c.req.header('x-twilio-signature') || '';
  if (sig) {
    const url = PUBLIC_URL + new URL(c.req.url).pathname + (new URL(c.req.url).search || '');
    return twilio.validateRequest(TOKEN, sig, url, params);
  }
  // Trial sandbox numbers send no signature. Accept only when the body names our own account.
  const ok = !!params.AccountSid && params.AccountSid === SID;
  if (ok && !warnedUnsigned) { warnedUnsigned = true; console.warn('[twilio] unsigned webhook accepted by AccountSid match (trial mode)'); }
  return ok;
}
const xml = (c, vr) => c.body(vr.toString(), 200, { 'Content-Type': 'text/xml' });

function startStream(vr, callId, mode) {
  const start = vr.start();
  const stream = start.stream({ url: wsUrl(), track: 'inbound_track' });
  stream.parameter({ name: 'callId', value: callId });
  stream.parameter({ name: 'mode', value: mode });
}

/** Registers webhooks + API routes. deps come from index.js to avoid a circular import. */
export function registerTwilio(app, deps) {
  const { incomingCall, addTranscript, endCall, live, getLine } = deps;

  app.post('/webhooks/twilio/voice', async c => {
    const p = await c.req.parseBody();
    if (!validate(c, p)) return c.text('bad signature', 403);
    const q = c.req.query();
    const vr = new VoiceResponse();

    // ---- outbound demo call: scripted scammer, step by step ----
    if (q.mode === 'outbound' && q.callId) {
      const call = live.get(q.callId);
      if (!call) { vr.say('This demo call has expired. Goodbye.'); vr.hangup(); return xml(c, vr); }
      const step = Number(q.step || 0);
      const lines = OUTBOUND_SCRIPTS[call.scenario] || OUTBOUND_SCRIPTS.fraud;
      if (step === 0) {
        call.twilioSid = call.twilioSid || p.CallSid;
        call.phase = 'connected'; call.started = Date.now();
        deps.publish('call', { phase: 'connected', id: call.id, remote: true });
        startStream(vr, call.id, 'outbound');
      }
      const line = lines[step];
      if (!line) {
        vr.say({ voice: VOICE }, 'Thank you. Goodbye.'); vr.hangup();
        // Trial accounts deliver no status callback: close the record once the goodbye has played.
        call.saidGoodbye = true;
        setTimeout(() => { if (call.phase !== 'ended') endCall(call.id, 'ScamShield', null, { fromTwilio: true }); }, 3500);
        return xml(c, vr);
      }
      // the scammer's words are classified exactly like a real caller's transcript
      setTimeout(() => addTranscript(call.id, line, 'caller').catch(console.error), 300);
      vr.say({ voice: VOICE }, line);
      vr.pause({ length: step === 0 ? 5 : 7 });
      vr.redirect({ method: 'POST' }, abs(`/webhooks/twilio/voice?mode=outbound&callId=${call.id}&step=${step + 1}`));
      return xml(c, vr);
    }

    // ---- inbound call to the ScamShield number: Call Screener ----
    const from = e164(p.From) || p.From || '+10000000000';
    const line = await getLine(LINE_ID);
    if (!q.callId) {
      // ring: true lets unknown numbers through to the screener; explicit block-list entries are still rejected.
      const r = await incomingCall({ lineId: LINE_ID, e164: from, scenario: 'screener', source: 'twilio', ring: true });
      if (!r.id) { vr.say({ voice: VOICE }, 'This number is not accepting calls from your number. Goodbye.'); vr.hangup(); return xml(c, vr); }
      const call = live.get(r.id); call.twilioSid = p.CallSid; call.remote = true;
      startStream(vr, r.id, 'inbound');
      vr.say({ voice: VOICE }, SCREENER_PROMPT(line?.name || 'the subscriber'));
      vr.pause({ length: 10 });
      vr.redirect({ method: 'POST' }, abs(`/webhooks/twilio/voice?callId=${r.id}&step=1`));
      return xml(c, vr);
    }
    const call = live.get(q.callId);
    const step = Number(q.step || 1);
    if (!call || call.phase === 'ended') { vr.hangup(); return xml(c, vr); }
    if (step === 1) { vr.say({ voice: VOICE }, "Sorry, I didn't catch that. Who is calling, please?"); vr.pause({ length: 10 }); vr.redirect({ method: 'POST' }, abs(`/webhooks/twilio/voice?callId=${call.id}&step=2`)); }
    else { vr.say({ voice: VOICE }, 'No one is available right now. Goodbye.'); vr.hangup(); setTimeout(() => endCall(call.id, 'ScamShield', 'screened', { note: 'Caller did not identify themselves', fromTwilio: true }), 500); }
    return xml(c, vr);
  });

  app.post('/webhooks/twilio/status', async c => {
    const p = await c.req.parseBody();
    if (!validate(c, p)) return c.text('bad signature', 403);
    const call = [...live.values()].find(x => x.twilioSid === p.CallSid);
    if (call && ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(p.CallStatus) && call.phase !== 'ended') {
      await endCall(call.id, p.CallStatus === 'completed' ? 'remote' : 'network', null, { fromTwilio: true, note: `Twilio: ${p.CallStatus}` });
    }
    return c.text('ok');
  });

  // Place a real call from the ScamShield number to a (trial: verified) phone. The judge's phone rings;
  // the UI shows it as an incoming call from the scam number on the chosen line.
  app.post('/api/calls/outbound', async c => {
    if (!twilioEnabled()) return c.json({ error: 'Twilio is not configured' }, 400);
    const { to, lineId = LINE_ID, scenario = 'fraud' } = await c.req.json();
    const dest = e164(to);
    if (!dest) return c.json({ error: 'Enter a 10-digit phone number to call' }, 400);
    const displayNum = { fraud: '+17025550119', grandparent: '+18665550176', warranty: '+19175550162' }[scenario] || '+17025550119';
    const r = await incomingCall({ lineId, e164: displayNum, scenario, source: 'twilio', ring: true, script: [] });
    if (!r.id) return c.json({ error: 'pre-ring blocked the demo number; turn Scam Block off or allow it', decision: r.decision }, 409);
    const call = live.get(r.id); call.remote = true;
    deps.publish('call', { phase: 'ringing', id: r.id, lineId, num: pretty(displayNum), e164: displayNum, label: r.decision.label, loc: 'Twilio · calling ' + pretty(dest), risk: r.decision.risk, callerId: true, scenario, remote: true });
    try {
      const url = abs(`/webhooks/twilio/voice?mode=outbound&callId=${r.id}&step=0`);
      const full = { to: dest, from: OUT_FROM, url, method: 'POST', timeLimit: MAX_CALL_SECONDS,
        statusCallback: abs('/webhooks/twilio/status'), statusCallbackMethod: 'POST', statusCallbackEvent: ['answered', 'completed'] };
      let tc, trial = false;
      const place = async (from, minimal) => client.calls.create(minimal ? { to: dest, from, url } : { ...full, from });
      try { tc = await place(OUT_FROM, false); }
      catch (e) {
        // Trial accounts accept only to/from/url. The scripted TwiML hangs up on its own and the media
        // stream's stop event closes the call record, so nothing is lost besides the time limit.
        if (/trial accounts have limited parameter access/i.test(e.message)) { trial = true; tc = await place(OUT_FROM, true).catch(async e2 => { if (e2.code === 573003 && FROM !== OUT_FROM) return place(FROM, true); throw e2; }); }
        else if (e.code === 573003 && FROM !== OUT_FROM) { trial = true; tc = await place(FROM, true); }
        else throw e;
      }
      call.twilioSid = tc.sid;
      return c.json({ ok: true, callId: r.id, twilioSid: tc.sid, to: pretty(dest), trial });
    } catch (e) {
      await endCall(r.id, 'network', 'scam', { note: 'Twilio error: ' + e.message, fromTwilio: true });
      return c.json({ error: e.message, code: e.code }, 502);
    }
  });

  app.get('/api/twilio/status', async c => {
    if (!client) return c.json({ enabled: false });
    try {
      const [nums, ver, bal] = await Promise.all([client.incomingPhoneNumbers.list({ limit: 5 }), client.outgoingCallerIds.list({ limit: 20 }), client.balance.fetch().catch(() => null)]);
      return c.json({ enabled: twilioEnabled(), number: FROM, ownsNumber: nums.some(n => n.phoneNumber === FROM), numbers: nums.map(n => n.phoneNumber), verified: ver.map(v => v.phoneNumber), balance: bal?.balance, publicUrl: PUBLIC_URL, stt: sttEnabled() });
    } catch (e) { return c.json({ enabled: false, error: e.message }); }
  });
}

/** Hang up a live Twilio call (used when the UI or the risk engine ends a call). */
export async function hangupTwilio(sid) {
  if (!client || !sid) return;
  try { await client.calls(sid).update({ status: 'completed' }); } catch (e) { console.warn('hangup failed', e.message); }
}

/** Replace what a live call is doing (speak a line, then hang up or forward). */
export async function sayAndHangup(sid, text, { dial } = {}) {
  if (!client || !sid) return;
  const vr = new VoiceResponse();
  vr.say({ voice: VOICE }, text);
  if (dial) vr.dial({ timeLimit: MAX_CALL_SECONDS }, dial); else vr.hangup();
  try { await client.calls(sid).update({ twiml: vr.toString() }); } catch (e) { console.warn('update failed', e.message); }
}
export const forwardTarget = () => FORWARD_TO;

/** Media Streams WebSocket: Twilio -> Deepgram -> transcript events. */
export function attachMediaServer(httpServer, deps) {
  const wss = new WebSocketServer({ server: httpServer, path: '/twilio/media' });
  wss.on('connection', ws => {
    let stt = null, callId = null, mode = 'inbound', frames = 0;
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.event === 'start') {
        callId = m.start?.customParameters?.callId; mode = m.start?.customParameters?.mode || 'inbound';
        console.log('[media] start', callId, mode, 'tracks:', m.start?.tracks, 'format:', JSON.stringify(m.start?.mediaFormat));
        if (!callId || !deps.live.has(callId)) { ws.close(); return; }
        if (!sttEnabled()) { console.warn('media stream without DEEPGRAM_API_KEY; audio ignored'); return; }
        stt = openStt({ tag: ':' + callId.slice(0, 8), onUtterance: text => {
          const who = mode === 'outbound' ? 'you' : 'caller';
          deps.addTranscript(callId, text, who).catch(console.error);
        } });
        deps.live.get(callId).stt = stt;
      } else if (m.event === 'media' && stt) {
        frames++; stt.send(Buffer.from(m.media.payload, 'base64'));
      } else if (m.event === 'stop') {
        if (stt) { console.log('[media] stop', callId, stt.stats()); stt.close(); }
        ws.close();
        // On trial accounts there may be no status callback, so the end of audio is the end of the call.
        const call = callId && deps.live.get(callId);
        if (call && call.phase !== 'ended') setTimeout(() => { if (call.phase !== 'ended') deps.endCall(callId, 'remote', null, { fromTwilio: true }); }, 1500);
      }
    });
    ws.on('close', () => { if (stt) stt.close(); });
    ws.on('error', e => console.warn('[media] ws error', e.message));
  });
  console.log('Twilio media stream endpoint ready at', wsUrl());
}

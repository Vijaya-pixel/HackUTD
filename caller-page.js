/* Browser call: you play the caller. Your mic is turned into phone-quality audio (8 kHz mu-law, 20 ms frames)
   and streamed to /twilio/media with the exact messages Twilio Media Streams sends, so it runs the same code as a
   real call: speech-to-text, the AI Call Screener, voiceprints and the scam voice database. The screener's lines
   are spoken back to you with the browser's voice. Nothing is recorded; only the voiceprint numbers are used. */
const content = document.getElementById('content'), callview = document.getElementById('callview');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ico = n => I[n] || '';
const rand4 = () => String(Math.floor(Math.random() * 9000) + 1000);
const C = { lines: [], lineId: 'line_0', from: `(214) 555-${rand4()}`, error: '', call: null };
let es = null, ws = null, mic = null;

/* ---------- audio: mic -> 8 kHz mu-law frames ---------- */
const WORKLET = `class Tap extends AudioWorkletProcessor { process(i) { const c = i[0] && i[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; } } registerProcessor('tap', Tap);`;
function muLaw(sample) {                                  // Float32 [-1,1] -> G.711 mu-law byte
  let s = Math.max(-1, Math.min(1, sample)) * 32767 | 0;
  const sign = s < 0 ? 0x80 : 0; if (s < 0) s = -s; s = Math.min(s + 0x84, 0x7fff);
  let exp = 7; for (let m = 0x4000; (s & m) === 0 && exp > 0; exp--, m >>= 1);
  return ~(sign | (exp << 4) | ((s >> (exp + 3)) & 0x0f)) & 0xff;
}
async function startMic(onFrame) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
  const src = ctx.createMediaStreamSource(stream), tap = new AudioWorkletNode(ctx, 'tap');
  const ratio = ctx.sampleRate / 8000;                    // e.g. 48000 / 8000 = 6
  let acc = 0, n = 0, pos = 0, frame = new Uint8Array(160), fi = 0, level = 0;
  tap.port.onmessage = e => {
    const x = e.data;
    for (let i = 0; i < x.length; i++) {
      acc += x[i]; n++; pos += 1;
      if (pos >= ratio) {                                  // average = simple low-pass before decimating
        const v = acc / n; acc = 0; n = 0; pos -= ratio;
        level = Math.max(level * 0.995, Math.abs(v));
        frame[fi++] = muLaw(v);
        if (fi === 160) { onFrame(frame, level); frame = new Uint8Array(160); fi = 0; }
      }
    }
  };
  src.connect(tap);                                        // not connected to the speakers: no echo of yourself
  return { stop() { tap.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); ctx.close(); } };
}
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };

/* ---------- the screener talks back ---------- */
let speaking = 0;
function say(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text); u.rate = 1.02;
  let done = false;
  const finish = () => { if (!done) { done = true; speaking = Math.max(0, speaking - 1); } };
  speaking++; u.onend = u.onerror = finish;
  setTimeout(finish, 1500 + text.length * 75);           // some browsers never fire onend; never leave the mic paused
  speechSynthesis.speak(u);
}

/* ---------- views ---------- */
function setupView() {
  const lineOpts = C.lines.map(l => `<button class="chip ${C.lineId === l.id ? 'on' : ''}" data-act="line" data-val="${esc(l.id)}" aria-pressed="${C.lineId === l.id}">${esc(l.name)} · ${esc(l.num)}</button>`).join('');
  return `<div class="header sub"><div class="left"><a class="icon-btn back" href="/" aria-label="Back to ScamShield">${ico('chevL')}</a><div class="h1">Browser call</div></div><div class="icons"><span class="badge amber">Prototype</span></div></div>
  <div class="card dark"><div class="eyebrow">You are the caller</div><div class="big">Call a ScamShield line</div>
    <p class="desc">Your mic audio is converted to phone quality and goes through the same pipeline as a real call: the AI screener answers, transcribes you, and checks your voice against the scam voice database.</p></div>
  <h2 class="section">Who are you calling?</h2>
  <div class="chips" style="flex-wrap:wrap;margin:0;padding:0;overflow:visible">${lineOpts || '<span class="note">Loading lines…</span>'}</div>
  <h2 class="section">Your caller ID</h2>
  <div class="field">${ico('phone')}<input type="tel" data-bind="from" value="${esc(C.from)}" aria-label="Caller ID number"><button class="btn sm black" data-act="newnum">New number</button></div>
  <p class="note">Use a different number on your second call to test "same voice, new number".</p>
  <div class="card"><div class="eyebrow">Try saying</div>
    <div class="feat">${ico('message')}<span>"Hi, this is the fraud department at your bank. Please read me the six-digit code we just texted you."</span></div>
    <div class="feat">${ico('message')}<span>"Your Social Security number has been suspended. You need to pay with gift cards today."</span></div>
    <p class="note">Speak for at least 5 seconds. Headphones help, so the screener's voice doesn't reach your mic.</p></div>
  <p class="note">Open the ScamShield app on another screen to watch the call arrive: <b>${esc(location.origin)}/</b></p>
  ${C.error ? `<div class="banner" style="background:var(--red-tint);color:var(--red)" role="alert">${ico('alert')}<div>${esc(C.error)}</div></div>` : ''}
  <div class="btn-row"><button class="btn primary" data-act="dial">${ico('phone')} Call</button></div>`;
}

const RESULT = {
  screened: 'The screener ended the call.', fraud: 'Flagged as fraud.', scam: 'Logged as a likely scam.', ai: 'Flagged as an AI voice.', allowed: 'The call ended normally.',
};
function callHtml() {
  const c = C.call;
  const bubbles = c.lines.map(l => `<div class="bubble ${l.who === 'caller' ? 'us' : 'them'}"><span class="by">${l.who === 'caller' ? 'You (heard by ScamShield)' : 'ScamShield'}</span>${esc(l.text)}</div>`).join('');
  const alerts = c.alerts.map(a => {
    if (a.kind === 'voiceprint') return `<div class="alert voice"><div class="ah"><div class="i magenta">${ico('waveform')}</div>${esc(a.title)}</div><p>${esc(a.text)}</p><div class="vmeta"><span>${a.pct}% similar</span><span>${a.profile?.reports || 1} report${(a.profile?.reports || 1) === 1 ? '' : 's'}</span></div><div class="brand">${ico('shieldCheck')} What the customer sees</div></div>`;
    return `<div class="alert ${a.kind === 'fraud' ? 'danger' : ''}"><div class="ah"><div class="i ${a.kind === 'fraud' ? 'red' : 'amber'}">${ico(a.kind === 'fraud' ? 'shieldAlert' : 'sparkles')}</div>${esc(a.title)}</div><p>${esc(a.text)}</p></div>`;
  }).join('');
  const voice = c.voiceSeen
    ? '' : `<div class="vnote" style="color:rgba(255,255,255,.6);font-size:13px;text-align:center">Keep talking. A voiceprint needs about 3 seconds of your speech.</div>`;
  const meter = `<div class="score-bar" aria-hidden="true" style="margin:14px 0 0"><span style="width:${Math.min(100, Math.round(c.level * 400))}%"></span></div>`;
  let state, controls;
  if (c.phase === 'dialing') { state = 'Calling…'; controls = ctl('red', 'phoneOff', 'Cancel', 'hangup'); }
  else if (c.phase === 'ended') {
    state = RESULT[c.outcome] || 'Call ended';
    controls = `<div style="width:100%;display:flex;flex-direction:column;gap:10px"><button class="btn primary" data-act="again">${ico('phone')} Call again from a new number</button><a class="btn outline-light" href="/">Open ScamShield</a></div>`;
  } else { state = `<span class="timer">${fmt(c.t)}</span> · ${c.phase === 'screening' ? 'ScamShield is screening you' : 'Connected'}`; controls = ctl('red', 'phoneOff', 'Hang up', 'hangup'); }
  return `<div class="call"><div class="top"><div class="label gray">${ico('mic')} You are the caller</div><div class="who">${esc(c.lineName)}</div><div class="where">from ${esc(c.from)}</div><div class="state">${state}</div>${c.phase !== 'ended' ? meter : ''}</div>
    <div class="body"><div class="transcript">${bubbles}</div>${c.phase !== 'ended' && c.phase !== 'dialing' ? voice : ''}${alerts}</div><div class="controls">${controls}</div></div>`;
}
const ctl = (cls, icon, label, act) => `<button class="ctl" data-act="${act}"><div class="c ${cls}">${ico(icon)}</div>${label}</button>`;
const fmt = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

function render() {
  if (!C.call) { callview.innerHTML = ''; const a = document.activeElement, b = a?.dataset?.bind, p = a?.selectionStart; content.innerHTML = setupView(); if (b) { const el = content.querySelector(`[data-bind="${b}"]`); el?.focus(); try { el.setSelectionRange(p, p); } catch { } } }
  else callview.innerHTML = callHtml();
  document.querySelector('.statusbar').classList.toggle('light', !!C.call);
}
let raf = 0;
const soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

/* ---------- call flow ---------- */
async function dial() {
  C.error = '';
  const digits = C.from.replace(/\D/g, '');
  if (digits.length < 10) { C.error = 'Enter a 10-digit caller ID number.'; return render(); }
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) { C.error = 'This browser cannot use the microphone here. Open the page over https or on localhost.'; return render(); }
  const line = C.lines.find(l => l.id === C.lineId) || { name: 'ScamShield', id: C.lineId };
  C.call = { id: null, phase: 'dialing', lineName: line.name, from: C.from, lines: [], alerts: [], t: 0, level: 0, voiceSeen: false, outcome: null };
  render();
  try {
    mic = await startMic((frame, level) => {
      C.call && (C.call.level = level);
      if (ws && ws.readyState === 1 && C.call?.id && !speaking) ws.send(JSON.stringify({ event: 'media', media: { payload: b64(frame) } }));
    });
  } catch (e) { C.call = null; C.error = 'Microphone permission was denied. Allow the mic and try again.'; return render(); }
  try {
    const r = await api.post('/calls/simulate', { lineId: C.lineId, scenario: 'screen_live', num: digits });
    if (!r.id) throw new Error(r.decision?.reason ? `The line rejected the call (${r.decision.reason}).` : 'The call did not connect.');
    C.call.id = r.id; C.call.phase = 'screening';
  } catch (e) { hangup(true); C.call = null; C.error = e.message; return render(); }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/twilio/media`);
  ws.onopen = () => ws.send(JSON.stringify({ event: 'start', start: { streamSid: 'MZbrowser', callSid: 'CA_browser', tracks: ['inbound'], customParameters: { callId: C.call.id, mode: 'inbound' } } }));
  ws.onclose = () => { ws = null; };
  C.timer = setInterval(() => { if (C.call && C.call.phase !== 'ended') { C.call.t++; soon(); } }, 1000);
  C.meter = setInterval(soon, 120);
  render();
}
function hangup(silent) {
  if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify({ event: 'stop' })); } catch { } setTimeout(() => ws?.close(), 300); }
  mic?.stop(); mic = null; clearInterval(C.timer); clearInterval(C.meter); speechSynthesis?.cancel?.();
  if (!silent && C.call && C.call.phase !== 'ended') { C.call.phase = 'ended'; C.call.outcome = C.call.outcome || 'allowed'; render(); }
}
function onCall(ev) {
  const c = C.call; if (!c || !c.id || ev.id !== c.id) return;
  if (ev.phase === 'transcript') {
    c.lines.push({ who: ev.who === 'caller' ? 'caller' : 'ScamShield', text: ev.text });
    if (ev.who === 'ScamShield') say(ev.text);
  } else if (ev.phase === 'alert') { c.alerts.push(ev); if (ev.kind === 'voiceprint') c.voiceSeen = true; }
  else if (ev.phase === 'ringing') c.phase = 'connected';         // screener let the call through to the customer
  else if (ev.phase === 'connected') c.phase = 'connected';
  else if (ev.phase === 'ended') { c.outcome = ev.outcome; c.phase = 'ended'; setTimeout(() => hangup(true), 2500); }
  render();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  if (a === 'line') { C.lineId = el.dataset.val; render(); }
  else if (a === 'newnum') { C.from = `(${['214', '469', '972', '817'][Math.floor(Math.random() * 4)]}) 555-${rand4()}`; render(); }
  else if (a === 'dial') dial();
  else if (a === 'hangup') hangup(false);
  else if (a === 'again') { hangup(true); C.call = null; C.from = `(469) 555-${rand4()}`; render(); }
});
document.addEventListener('input', e => { const b = e.target.dataset?.bind; if (b) C[b] = e.target.value; });
window.addEventListener('pagehide', () => hangup(true));

(async function boot() {
  try { C.lines = (await api.get('/lines')).map(l => ({ id: l.id, name: l.name, num: l.num })); } catch (e) { C.error = 'Cannot reach the server. ' + e.message; }
  if (C.lines.length && !C.lines.some(l => l.id === C.lineId)) C.lineId = C.lines[0].id;
  es = api.events({ call: onCall });
  render();
})();

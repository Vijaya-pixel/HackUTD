// Drives caller.html in a real (headless) Edge whose microphone is a WAV file, via the DevTools protocol.
// Make a WAV first:  node voice/scripts/make-wav.mjs out.wav 6 "Hello, this is your bank's fraud team..."
//   node scripts/browser-call-test.mjs <wav> <callerDigits> <lineId> [debugPort]
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const [, , wav, from, lineId, port = '9333'] = process.argv;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TEMP}\\bcall\\prof${port}`,
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`,
  '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(500); target = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()).then(l => l.find(t => t.type === 'page')).catch(() => null); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.on('open', r));
let id = 0; const pending = new Map();
ws.on('message', m => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
await send('Page.navigate', { url: 'http://localhost:8787/caller.html' });
await sleep(3000);
await ev(`C.lineId = ${JSON.stringify(lineId)}; C.from = ${JSON.stringify(from)}; render(); true`);
await ev(`document.querySelector('[data-act=dial]').click(); true`);
let state;
for (let i = 0; i < 60; i++) {                            // up to 30 s
  await sleep(500);
  state = await ev(`JSON.stringify(C.call && { phase: C.call.phase, outcome: C.call.outcome, id: C.call.id, heard: C.call.lines.filter(l => l.who === 'caller').map(l => l.text), alerts: C.call.alerts.map(a => a.kind + ':' + a.title + (a.pct ? ' ' + a.pct + '%' : '')), error: C.error })`);
  if (state && JSON.parse(state).phase === 'ended') break;
}
console.log(state || JSON.stringify({ error: await ev('C.error') }));
ws.close(); edge.kill();
process.exit(0);

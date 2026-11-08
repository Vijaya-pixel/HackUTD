// Pretends to be a scammer calling the ScamShield number, over the SAME path a real Twilio call uses:
// creates an inbound screened call, then streams synthetic scammer speech as Twilio Media Streams frames
// (8 kHz mu-law, 20 ms each) into /twilio/media. No phone call is placed.
//
//   node scripts/fake-scam-call.mjs <fromNumber> <voice: st6|michael|adam|heart> [lineId]
// Example (the story): node scripts/fake-scam-call.mjs 2145550198 st6 line_0
//                      node scripts/fake-scam-call.mjs 4695550231 st6 line_1
import 'dotenv/config';
import WebSocket from 'ws';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const [, , from = '2145550198', voiceName = 'st6', lineId = 'line_0', script = '0'] = process.argv;
const PORT = process.env.PORT || 8787, BASE = `http://localhost:${PORT}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const { clip, AI_VOICES } = await import(pathToFileURL(path.resolve(here, '..', '..', 'voice', 'server', 'tts.js')).href);
AI_VOICES.st6 = 6;

// Different words on each call, so a match means "same voice", not "same recording".
const SCRIPTS = [
  'Hello, this is the security department at your bank. To cancel the suspicious transfer, please read me the six digit verification code we just sent to your phone. Do not hang up.',
  'Good afternoon, I am calling from the fraud prevention team about unusual charges on your debit card. Please read back the passcode that was just texted to you, or the account will be locked today.',
];
const LINE = SCRIPTS[Number(script)] || SCRIPTS[0];

function toMulaw8k(pcm16) {                       // 16 kHz Int16 PCM -> 8 kHz G.711 mu-law
  const out = Buffer.alloc(Math.floor(pcm16.length / 4));
  for (let i = 0; i < out.length; i++) {
    let s = (pcm16.readInt16LE(4 * i) + pcm16.readInt16LE(4 * i + 2)) >> 1;
    const sign = s < 0 ? 0x80 : 0; if (s < 0) s = -s; s = Math.min(s + 0x84, 0x7fff);
    let exp = 7; for (let m = 0x4000; (s & m) === 0 && exp > 0; exp--, m >>= 1);
    out[i] = ~(sign | (exp << 4) | ((s >> (exp + 3)) & 0x0f)) & 0xff;
  }
  return out;
}

// 1. the call reaches the ScamShield number (same entry point the Twilio voice webhook uses)
const sim = await fetch(`${BASE}/api/calls/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lineId, scenario: 'screen_live', num: from }) }).then(r => r.json());
if (!sim.id) { console.error('call did not ring:', JSON.stringify(sim)); process.exit(1); }
console.log(`screened call ${sim.id} from ${from} on ${lineId}`);

// 2. stream the scammer's voice like Twilio Media Streams
const audio = toMulaw8k(await clip(LINE, voiceName));
const ws = new WebSocket(`ws://localhost:${PORT}/twilio/media`);
ws.on('open', async () => {
  ws.send(JSON.stringify({ event: 'start', start: { streamSid: 'MZfake', callSid: 'CA_fake', tracks: ['inbound'], customParameters: { callId: sim.id, mode: 'inbound' } } }));
  for (let o = 0; o < audio.length; o += 160) {
    ws.send(JSON.stringify({ event: 'media', media: { payload: audio.subarray(o, o + 160).toString('base64') } }));
    await new Promise(r => setTimeout(r, 20));
  }
  await new Promise(r => setTimeout(r, 2500));       // let the last voiceprint and verdict land
  ws.send(JSON.stringify({ event: 'stop' }));
  setTimeout(() => { console.log(`streamed ${(audio.length / 8000).toFixed(1)}s of caller audio`); ws.close(); process.exit(0); }, 1500);
});
ws.on('error', e => { console.error('ws error', e.message); process.exit(1); });

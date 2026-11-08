// Live call audio -> voiceprint. Twilio streams the CALLER's voice as 8 kHz mu-law; we decode it, upsample to
// the 16 kHz the speaker model expects, keep only the voiced parts, and produce a 256-number voiceprint every
// few seconds of speech. The model is the WeSpeaker ResNet34 from the voice/ project (runs locally; audio never
// leaves this machine and is never stored, only the resulting numbers are used).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const voiceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'voice');
export const voiceAudioAvailable = () =>
  existsSync(path.join(voiceDir, 'models', 'wespeaker_en_voxceleb_resnet34_LM.onnx')) && existsSync(path.join(voiceDir, 'node_modules', 'sherpa-onnx-node'));

let engine = null;
async function loadEngine() {
  engine ??= import(pathToFileURL(path.join(voiceDir, 'server', 'speech.js')).href);
  return engine;
}

// G.711 mu-law -> 16-bit linear PCM
const MULAW = (() => {
  const t = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff, sign = u & 0x80, exp = (u >> 4) & 7, man = u & 15;
    const v = ((man << 3) + 0x84 << exp) - 0x84;
    t[i] = sign ? -v : v;
  }
  return t;
})();

/** mu-law bytes at 8 kHz -> Float32 at 16 kHz (linear-interpolated upsample). */
export function mulawTo16k(buf) {
  const n = buf.length, out = new Float32Array(n * 2);
  let prev = MULAW[buf[0]] / 32768;
  for (let i = 0; i < n; i++) {
    const cur = MULAW[buf[i]] / 32768;
    out[2 * i] = (prev + cur) / 2;
    out[2 * i + 1] = cur;
    prev = cur;
  }
  return out;
}

const FRAME = 320;            // 20 ms at 16 kHz
const VOICED_RMS = 0.012;     // frames quieter than this are treated as silence

/**
 * Collects voiced speech from one call and emits a voiceprint each time `seconds` of speech has built up.
 * At most `max` voiceprints per call, so a long call cannot run up CPU.
 */
export class CallVoiceSampler {
  constructor({ onEmbedding, seconds = 4, max = 3 }) {
    this.onEmbedding = onEmbedding; this.need = seconds * 16000; this.max = max;
    this.chunks = []; this.have = 0; this.emitted = 0; this.busy = false;
  }
  push(mulawBuf) {
    if (this.emitted >= this.max || this.busy) return;
    const pcm = mulawTo16k(mulawBuf);
    for (let o = 0; o + FRAME <= pcm.length; o += FRAME) {
      let e = 0;
      for (let i = o; i < o + FRAME; i++) e += pcm[i] * pcm[i];
      if (Math.sqrt(e / FRAME) >= VOICED_RMS) { this.chunks.push(pcm.subarray(o, o + FRAME)); this.have += FRAME; }
    }
    if (this.have >= this.need) this.pending = this.flush();   // fire and forget on calls; tests await `pending`
  }
  async flush() {
    this.busy = true;
    const speech = new Float32Array(this.have);
    let o = 0;
    for (const c of this.chunks) { speech.set(c, o); o += c.length; }
    this.chunks = []; this.have = 0;
    try {
      const { embed } = await loadEngine();
      const embedding = embed(speech);
      if (embedding) { this.emitted++; await this.onEmbedding(embedding, speech.length / 16000); }
    } catch (e) { console.warn('[voice] embedding failed:', e.message); }
    finally { this.busy = false; }
  }
}

export async function embedFloat16k(samples) { const { embed } = await loadEngine(); return embed(samples); }

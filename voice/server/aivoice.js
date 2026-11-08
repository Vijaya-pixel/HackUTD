// AI-generated voice detection with Spectra-AASIST3 (wav2vec2 XLS-R + AASIST),
// INT8 ONNX: https://huggingface.co/Limitless-8/spectra-aasist3-int8-audio-deepfake
//
// The model scores ~4 s windows. One window isn't enough: noisy or heavily
// compressed real speech can score high. We only say "sounds like AI" after
// several windows agree, and we always show the score.
//
// Local tests: Windows TTS and Kokoro neural voices scored 0.84-1.00.
// 4 of 5 real recordings scored 0.00, but a 1960s broadcast recording
// (JFK) scored 0.99, and 1 of 3 real voices scored 0.96 after a simulated
// phone-line filter. So: a hint, never proof.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startWorker } from "./workers.js";

const MODEL = join(fileURLToPath(new URL("../models/", import.meta.url)), "aasist3-int8.onnx");
const WINDOW = 64600; // samples at 16 kHz, fixed by the model
const MAX_WINDOWS = 6; // ~24 s of caller speech is plenty
export const AI_THRESHOLD = Number(process.env.AI_VOICE_THRESHOLD) || 0.85;
export const aiModelReady = existsSync(MODEL);

const worker = aiModelReady ? startWorker("./workers/aidetect-worker.cjs", "AI voice") : null;

export function warmUpAi() {
  worker?.request({ type: "warmup" }).catch((e) => console.error("AI voice model failed to load:", e.message));
}

// Per-call tracker. Feed it the caller's spoken sentences; it calls onUpdate.
export class AiVoiceTracker {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.buf = [];
    this.len = 0;
    this.scores = [];
    this.running = false;
  }

  // Only voiced audio is scored. Silence (pauses, a muted mic) makes the
  // model lean "real", which would hide an AI voice.
  addSpeech(samples) {
    if (!worker || this.scores.length >= MAX_WINDOWS) return;
    const FRAME = 320; // 20 ms
    const rms = [];
    let peak = 0;
    for (let i = 0; i + FRAME <= samples.length; i += FRAME) {
      let s = 0;
      for (let j = i; j < i + FRAME; j++) s += samples[j] * samples[j];
      const r = Math.sqrt(s / FRAME);
      rms.push(r);
      if (r > peak) peak = r;
    }
    const floor = Math.max(0.004, peak * 0.08);
    const voiced = [];
    rms.forEach((r, k) => { if (r >= floor) voiced.push(samples.subarray(k * FRAME, (k + 1) * FRAME)); });
    if (voiced.length < 25) return; // under 0.5 s of speech
    const out = new Float32Array(voiced.length * FRAME);
    voiced.forEach((f, k) => out.set(f, k * FRAME));
    this.buf.push(out);
    this.len += out.length;
    this.pump();
  }

  async pump() {
    if (this.running || this.len < WINDOW || this.scores.length >= MAX_WINDOWS) return;
    this.running = true;
    const all = new Float32Array(this.len);
    let o = 0;
    for (const b of this.buf) {
      all.set(b, o);
      o += b.length;
    }
    const rest = all.slice(WINDOW);
    this.buf = rest.length ? [rest] : [];
    this.len = rest.length;
    try {
      const r = await worker.request({ type: "score", samples: all.slice(0, WINDOW) });
      this.scores.push(r.probability);
      this.onUpdate(this.result());
    } catch (e) {
      console.error("AI voice scoring failed:", e.message);
    }
    this.running = false;
    this.pump();
  }

  // Median of window scores, so one odd window doesn't decide it either way.
  result() {
    const n = this.scores.length;
    const sorted = [...this.scores].sort((a, b) => a - b);
    const median = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : 0;
    const agree = this.scores.filter((s) => s >= AI_THRESHOLD).length / (n || 1);
    let status = "human";
    if (n >= 2 && median >= AI_THRESHOLD && agree >= 0.6) status = "likely";
    else if (median >= AI_THRESHOLD) status = "checking"; // only one window so far
    return { probability: Math.round(median * 100) / 100, windows: n, seconds: Math.round((n * WINDOW) / 16000), status };
  }
}

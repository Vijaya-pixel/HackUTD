// AI voice clips for the scammer phone's "AI voice" mode (Kokoro TTS).
// Clips are generated once and cached in data/tts as raw 16 kHz Int16 PCM.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startWorker } from "./workers.js";

const MODEL_DIR = fileURLToPath(new URL("../models/kokoro-int8-multi-lang-v1_0/", import.meta.url));
const CACHE = fileURLToPath(new URL("../data/tts/", import.meta.url));
mkdirSync(CACHE, { recursive: true });

export const ttsReady = existsSync(join(MODEL_DIR, "model.int8.onnx")) && existsSync(join(MODEL_DIR, "lexicon-us-en.txt"));

// Kokoro v1.0 speaker IDs.
export const AI_VOICES = { michael: 16, adam: 11, heart: 3 };

const worker = ttsReady ? startWorker("./workers/tts-worker.cjs", "TTS") : null;
const inflight = new Map();

// The lexicon has no "IRS"; spell it out.
const clean = (t) => t.replace(/\bIRS\b/g, "I R S");

export async function clip(text, voice = "michael") {
  if (!worker) throw new Error("AI voice model missing. Run: npm run models");
  const sid = AI_VOICES[voice] ?? AI_VOICES.michael;
  const key = createHash("sha1").update(`${sid}|${text}`).digest("hex").slice(0, 16);
  const file = join(CACHE, `${key}.pcm`);
  if (existsSync(file)) return readFileSync(file);
  if (!inflight.has(key)) {
    inflight.set(key, worker.request({ text: clean(text), sid }).then((r) => {
      const buf = Buffer.from(r.pcm.buffer, r.pcm.byteOffset, r.pcm.byteLength);
      writeFileSync(file, buf);
      inflight.delete(key);
      return buf;
    }, (e) => {
      inflight.delete(key);
      throw e;
    }));
  }
  return inflight.get(key);
}

// Generate the script lines in the background so the demo is instant.
export async function pregenerate(lines, voice = "michael") {
  for (const text of lines) {
    try {
      await clip(text, voice);
    } catch (e) {
      console.error("TTS pregenerate failed:", e.message);
      return;
    }
  }
}

// Local speech engine (sherpa-onnx). Runs on this machine; audio never leaves it.
//  - Streaming speech-to-text: Zipformer (Kroko English)
//  - Speaker embeddings: WeSpeaker ResNet34 (256 numbers per voice)

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export const SAMPLE_RATE = 16000;
const MODELS = fileURLToPath(new URL("../models/", import.meta.url));
const ASR_DIR = join(MODELS, "sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06");
const SPK_MODEL = join(MODELS, "wespeaker_en_voxceleb_resnet34_LM.onnx");

export const modelsReady = existsSync(join(ASR_DIR, "encoder.onnx")) && existsSync(SPK_MODEL);

let sherpa, recognizer, extractor;

function load() {
  if (recognizer) return;
  if (!modelsReady) throw new Error("Models missing. Run: npm run models");
  sherpa = require("sherpa-onnx-node");
  recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(ASR_DIR, "encoder.onnx"),
        decoder: join(ASR_DIR, "decoder.onnx"),
        joiner: join(ASR_DIR, "joiner.onnx"),
      },
      tokens: join(ASR_DIR, "tokens.txt"),
      numThreads: 2,
      provider: "cpu",
      debug: 0,
    },
    decodingMethod: "greedy_search",
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4, // silence with no speech
    rule2MinTrailingSilence: 0.9, // pause after speech ends a sentence
    rule3MinUtteranceLength: 15, // force a cut on very long speech
  });
  extractor = new sherpa.SpeakerEmbeddingExtractor({ model: SPK_MODEL, numThreads: 1, debug: 0 });
}

export function warmUp() {
  load();
}

function concat(chunks, total) {
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// Speaker embedding for a chunk of 16 kHz mono audio, L2-normalized.
export function embed(samples) {
  load();
  const s = extractor.createStream();
  s.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
  s.inputFinished();
  if (!extractor.isReady(s)) return null;
  const v = extractor.compute(s);
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}

// One live call. Feed audio with accept(); get partial text, finished
// sentences (with their audio, for voice ID), and early audio for a quick
// first voice check before the caller finishes a sentence.
export class CallSession {
  constructor({ onPartial, onFinal, onEarlyAudio }) {
    load();
    this.stream = recognizer.createStream();
    this.onPartial = onPartial;
    this.onFinal = onFinal;
    this.onEarlyAudio = onEarlyAudio;
    this.chunks = [];
    this.len = 0;
    this.lastText = "";
    this.earlyMarks = [3, 6].map((s) => s * SAMPLE_RATE);
    this.totalSamples = 0;
  }

  accept(samples) {
    this.stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
    this.chunks.push(samples);
    this.len += samples.length;
    this.totalSamples += samples.length;
    while (recognizer.isReady(this.stream)) recognizer.decode(this.stream);

    const text = recognizer.getResult(this.stream).text.trim();
    if (text !== this.lastText) {
      this.lastText = text;
      if (text) this.onPartial(text);
    }

    if (recognizer.isEndpoint(this.stream)) {
      this.flushSegment(text);
    } else if (text && this.earlyMarks.length && this.len >= this.earlyMarks[0]) {
      this.earlyMarks.shift();
      this.onEarlyAudio(concat(this.chunks, this.len));
    }
  }

  flushSegment(text) {
    const audio = concat(this.chunks, this.len);
    recognizer.reset(this.stream);
    this.chunks = [];
    this.len = 0;
    this.lastText = "";
    if (text) this.onFinal(text, audio);
  }

  // Call end: pad with silence so the last words are decoded, then flush.
  finish() {
    this.stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: new Float32Array(SAMPLE_RATE * 0.6) });
    while (recognizer.isReady(this.stream)) recognizer.decode(this.stream);
    this.flushSegment(recognizer.getResult(this.stream).text.trim());
  }
}

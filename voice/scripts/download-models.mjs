// Downloads the local speech models (run once): npm run models
//  - Streaming English speech-to-text (sherpa-onnx Zipformer, ~55 MB)
//  - Speaker embedding model (WeSpeaker ResNet34, ~25 MB)
// Everything runs on this machine. No audio is sent to a third party.

import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../models/", import.meta.url));
mkdirSync(dir, { recursive: true });

const BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download";
const ASR = "sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06";
const SPK = "wespeaker_en_voxceleb_resnet34_LM.onnx";

async function download(url, dest) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

if (!existsSync(join(dir, ASR))) {
  const archive = join(dir, `${ASR}.tar.bz2`);
  await download(`${BASE}/asr-models/${ASR}.tar.bz2`, archive);
  console.log("Extracting…");
  execFileSync("tar", ["-xjf", archive, "-C", dir], { stdio: "inherit" });
} else console.log("Speech-to-text model already present.");

if (!existsSync(join(dir, SPK))) {
  await download(`${BASE}/speaker-recongition-models/${SPK}`, join(dir, SPK));
} else console.log("Speaker model already present.");

// AI-generated voice detector (Spectra-AASIST3, INT8 ONNX, ~350 MB)
const AI = "aasist3-int8.onnx";
if (!existsSync(join(dir, AI))) {
  await download("https://huggingface.co/Limitless-8/spectra-aasist3-int8-audio-deepfake/resolve/main/spectra-aasist3-int8-dynamic.onnx", join(dir, AI));
} else console.log("AI voice detector already present.");

// Kokoro neural TTS for the scammer phone's "AI voice" mode (~130 MB)
const TTS = "kokoro-int8-multi-lang-v1_0";
if (!existsSync(join(dir, TTS))) {
  const archive = join(dir, `${TTS}.tar.bz2`);
  await download(`${BASE}/tts-models/${TTS}.tar.bz2`, archive);
  console.log("Extracting…");
  execFileSync("tar", ["-xjf", archive, "-C", dir], { stdio: "inherit" });
} else console.log("AI voice (TTS) model already present.");

console.log("Models ready in ./models");

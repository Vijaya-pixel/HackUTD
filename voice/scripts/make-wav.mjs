// Writes a 16 kHz mono WAV of a synthetic voice saying a line. Used as a fake microphone for browser tests.
//   node scripts/make-wav.mjs <out.wav> <speakerId> "<text>"
import { writeFileSync } from "node:fs";
import { clip, AI_VOICES } from "../server/tts.js";
const [, , out, sid = "6", text = "Hello"] = process.argv;
AI_VOICES[`s${sid}`] = Number(sid);
const pcm = await clip(text, `s${sid}`);
const h = Buffer.alloc(44);
h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
writeFileSync(out, Buffer.concat([h, pcm]));
console.log(`wrote ${out} (${(pcm.length / 32000).toFixed(1)}s)`);
process.exit(0);

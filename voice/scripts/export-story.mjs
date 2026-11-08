// Builds the "same voice, different number" story: one scammer voice the database has never heard,
// saying two DIFFERENT scripts (call A, call B). Picks the Kokoro speaker that is least similar to every
// enrolled voice, so call A reliably reads as a brand-new voice and call B matches call A.
// Run from voice/:  node scripts/export-story.mjs     (needs server/seed/voiceprints.json first)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { warmUp, embed } from "../server/speech.js";
import { clip, AI_VOICES } from "../server/tts.js";

warmUp();
const seedPath = fileURLToPath(new URL("../../server/seed/voiceprints.json", import.meta.url));
const enrolled = JSON.parse(readFileSync(seedPath, "utf8")).profiles;
const toFloat = (b) => { const i = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); return Float32Array.from(i, (x) => x / 32768); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const bestVsEnrolled = (e) => Math.max(...enrolled.flatMap((p) => p.embeddings.map((v) => dot(e, v))));
const round = (v) => Array.from(v, (x) => Math.round(x * 1e6) / 1e6);

const CALL_A = "Hello, this is the security department at your bank. To cancel the suspicious transfer, please confirm the six digit verification code we just sent to your phone.";
const CALL_B = "Good afternoon, I am calling from the fraud prevention team about your debit card. Please read back the passcode that was just texted to you, or the account will be locked.";

const embedText = async (voice, text) => embed(toFloat(await clip(text, voice)));
// Candidates, best first (from earlier measurements). Take the first that is clearly a new voice AND consistent with itself.
const rows = [];
let pick = null;
console.log("speaker  worst-sim-to-enrolled  A-vs-B(same voice)");
for (const sid of [6, 21, 22, 4, 23, 7]) {
  const name = `st${sid}`;
  AI_VOICES[name] = sid;
  const a = await embedText(name, CALL_A), b = await embedText(name, CALL_B);
  const r = { sid, name, a, b, worst: Math.max(bestVsEnrolled(a), bestVsEnrolled(b)), self: dot(a, b) };
  rows.push(r);
  console.log(`${String(sid).padStart(5)}  ${r.worst.toFixed(2).padStart(20)}  ${r.self.toFixed(2).padStart(18)}`);
  if (r.worst < 0.65 && r.self >= 0.85) { pick = r; break; }
}
if (!pick) { rows.sort((x, y) => x.worst - y.worst); pick = rows[0]; console.log("no candidate met both limits; using the least similar one"); }
console.log(`chosen speaker ${pick.sid}: strangers-to-enrolled ${pick.worst.toFixed(2)}, call A vs call B ${pick.self.toFixed(2)}`);
const out = { generated: new Date().toISOString(), speaker: pick.sid, callA: { text: CALL_A, embedding: round(pick.a) }, callB: { text: CALL_B, embedding: round(pick.b) }, worstVsEnrolled: pick.worst, aVsB: pick.self };
writeFileSync(fileURLToPath(new URL("../../server/seed/story.json", import.meta.url)), JSON.stringify(out));
console.log("wrote server/seed/story.json");
process.exit(0);

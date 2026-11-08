// Builds real speaker voiceprints (256 numbers each) from the synthetic scam voices and
// writes them to ../server/seed/voiceprints.json for the ScamShield database.
//
// Each profile gets several enrolled lines. One more line per voice is kept aside as a
// "probe": the same voice saying something it was never enrolled with. Matching a probe
// against the database is a fair test, because the sentence differs from the enrolled ones.
//
// Run from voice/:  node scripts/export-voiceprints.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { warmUp, embed, modelsReady } from "../server/speech.js";
import { clip, AI_VOICES, ttsReady } from "../server/tts.js";

if (!modelsReady || !ttsReady) {
  console.error("Models missing. Run: npm run models");
  process.exit(1);
}
warmUp();

const toFloat = (buf) => {
  const i16 = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
  return f;
};

const PROFILES = [
  {
    key: "bank_fraud", voice: "michael", name: "Bank fraud-department caller", scamType: "Bank impersonation", aiVoice: true,
    notes: "Claims to be a bank fraud team and asks for the one-time code.",
    numbers: ["+17025550119", "+12145550199"],
    enroll: [
      "Hi, this is the fraud department at your bank. We detected suspicious activity on your account.",
      "Please read me the six digit code we just texted you so we can block the charge.",
      "Your account will be frozen today unless you verify your identity right now.",
      "Do not hang up, or the transfer will go through and your money will be gone.",
    ],
    probe: "To secure the account today, move your money to a safe account that I will give you.",
  },
  {
    key: "irs_giftcard", voice: "adam", name: "IRS gift-card caller", scamType: "Government impersonation", aiVoice: false,
    notes: "Threatens arrest over back taxes and demands gift card payment.",
    numbers: ["+14695550142"],
    enroll: [
      "Hello, this is Officer Miller from the IRS. Our records show you owe back taxes.",
      "There is a warrant for your arrest in your county unless you pay immediately.",
      "Go to the store and buy Google Play gift cards, then read me the code on the back.",
      "Do not tell anyone at the store what the cards are for.",
    ],
    probe: "You must stay on the line with me and pay two thousand dollars today to avoid arrest.",
  },
  {
    key: "grandparent", voice: "heart", name: "Grandparent emergency caller", scamType: "Family emergency", aiVoice: true,
    notes: "Pretends to be a grandchild in jail and asks for bail by wire or gift card.",
    numbers: ["+18665550176", "+19725550177"],
    enroll: [
      "Grandma, it's me. I'm in big trouble and I need your help right now.",
      "I was in a car accident and the police put me in jail. Please don't tell mom and dad.",
      "I need two thousand dollars for bail. My lawyer says you can send it by Zelle.",
      "I will pay you back, I promise. Just please hurry before they move me.",
    ],
    probe: "They said I can leave tonight if someone pays the bail, can you buy gift cards for me?",
  },
];

const embedLine = async (voice, text) => {
  const pcm = await clip(text, voice);
  return Array.from(embed(toFloat(pcm)), (x) => Math.round(x * 1e6) / 1e6);
};

const out = { generated: new Date().toISOString(), dim: 256, profiles: [] };
for (const p of PROFILES) {
  const embeddings = [];
  for (const line of p.enroll) embeddings.push(await embedLine(p.voice, line));
  const probe = await embedLine(p.voice, p.probe);
  out.profiles.push({ key: p.key, name: p.name, scamType: p.scamType, aiVoice: p.aiVoice, notes: p.notes, numbers: p.numbers, embeddings, probe });
  console.log(`${p.key}: ${embeddings.length} voiceprints + 1 probe (${AI_VOICES[p.voice] !== undefined ? p.voice : "?"})`);
}

const dir = fileURLToPath(new URL("../../server/seed/", import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(dir + "voiceprints.json", JSON.stringify(out));
console.log("wrote", dir + "voiceprints.json");
process.exit(0);

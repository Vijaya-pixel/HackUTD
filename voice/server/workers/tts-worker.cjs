// Child process: Kokoro neural text-to-speech for the "AI voice scammer" test.
// Generation takes several seconds per sentence, so it runs outside the
// main server where it would otherwise pause live call audio.
const sherpa = require("sherpa-onnx-node");
const path = require("node:path");

const DIR = path.join(__dirname, "../../models/kokoro-int8-multi-lang-v1_0/");
let tts = null;

function load() {
  if (!tts) {
    tts = new sherpa.OfflineTts({
      model: {
        kokoro: { model: DIR + "model.int8.onnx", voices: DIR + "voices.bin", tokens: DIR + "tokens.txt", lexicon: DIR + "lexicon-us-en.txt" },
        numThreads: 2,
        debug: false,
      },
      maxNumSentences: 1,
    });
  }
  return tts;
}

// 24 kHz float -> 16 kHz Int16 (linear interpolation).
function toPcm16k(x, from) {
  const r = from / 16000;
  const n = Math.floor(x.length / r);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * r;
    const j = Math.floor(p);
    const f = p - j;
    const v = (x[j] || 0) * (1 - f) + (x[j + 1] || 0) * f;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return out;
}

process.on("message", (msg) => {
  try {
    const a = load().generate({ text: msg.text, sid: msg.sid, speed: 1.0 });
    process.send({ id: msg.id, pcm: toPcm16k(a.samples, a.sampleRate) });
  } catch (e) {
    process.send({ id: msg.id, error: e.message });
  }
});

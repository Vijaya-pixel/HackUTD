// Child process: scores 4 s windows of 16 kHz audio for AI-generated speech.
// Separate process because onnxruntime-node and sherpa-onnx ship different
// onnxruntime DLLs that can't load into the same process on Windows.
const ort = require("onnxruntime-node");
const path = require("node:path");

const MODEL = path.join(__dirname, "../../models/aasist3-int8.onnx");
const WINDOW = 64600;
let session = null;

async function load() {
  if (!session) session = await ort.InferenceSession.create(MODEL, { intraOpNumThreads: 2 });
  return session;
}

process.on("message", async (msg) => {
  try {
    if (msg.type === "warmup") {
      await load();
      return process.send({ id: msg.id, ok: true });
    }
    const s = await load();
    const samples = msg.samples;
    const x = new Float32Array(WINDOW);
    x[0] = samples[0];
    for (let i = 1; i < WINDOW; i++) x[i] = samples[i] - 0.97 * samples[i - 1]; // pre-emphasis
    const out = await s.run({ wav: new ort.Tensor("float32", x, [1, WINDOW]) });
    const [spoof, bonafide] = out.logits.data;
    process.send({ id: msg.id, probability: 1 / (1 + Math.exp(bonafide - spoof)) });
  } catch (e) {
    process.send({ id: msg.id, error: e.message });
  }
});

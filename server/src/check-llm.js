// Verifies the Gemini setup: key present, model answers with schema-valid JSON, embeddings are 1024-dim.
// Run: npm run check-llm
import 'dotenv/config';
import { llmEnabled, classifyTranscript, embed, ruleClassify } from './llm.js';

const sample = 'Hi, this is the fraud department at your bank. We need to move your money now. Please read me the code we just texted you.';

async function main() {
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  if (!llmEnabled()) {
    console.log('GEMINI_API_KEY is empty in server/.env');
    console.log('1. Get a key at https://aistudio.google.com/apikey');
    console.log('2. Put it in server/.env as  GEMINI_API_KEY=AIza...  (no quotes)');
    console.log('3. Run  npm run check-llm  again, then  npm run seed  to embed the scam scripts.');
    console.log('\nRule fallback verdict for the sample call:', ruleClassify(sample).tactic);
    process.exit(2);
  }
  console.log(`Key found. Model: ${model}`);
  const t0 = Date.now();
  const v = await classifyTranscript(sample, []);
  const ms = Date.now() - t0;
  if (v.engine === 'rules') {
    console.log(`FAIL: model call fell back to rules after ${ms} ms. Reason: ${v.fallback_reason}`);
    console.log('Common causes: wrong key, model name not available to this key (try GEMINI_MODEL=gemini-2.5-flash or gemini-2.0-flash), or no network.');
    process.exit(1);
  }
  console.log(`Classifier OK in ${ms} ms:`, { tactic: v.tactic, confidence: v.confidence, category: v.category, synthetic_voice_hint: v.synthetic_voice_hint });
  console.log('Warning text:', v.one_line_warning);
  const t1 = Date.now();
  const vec = await embed('test sentence for embedding dimensions');
  console.log(`Embedding OK in ${Date.now() - t1} ms: ${vec.length} dims ${vec.length === 1024 ? '(matches vector(1024) column)' : '(MISMATCH: scam_scripts.embedding is vector(1024))'}`);
  if (vec.length !== 1024) process.exit(1);
  console.log('\nAll good. Next: npm run seed   (stores embeddings for the scam scripts; safe to rerun)');
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

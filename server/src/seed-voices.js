// Loads server/seed/voiceprints.json (real speaker embeddings from synthetic scam voices) into Postgres.
// Safe to run repeatedly: profiles are keyed by seed_key and their seeded voiceprints are replaced.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { enrollVoiceprints, voiceprintCount } from './voicedb.js';

const file = fileURLToPath(new URL('../seed/voiceprints.json', import.meta.url));
const data = JSON.parse(readFileSync(file, 'utf8'));
for (const p of data.profiles) {
  const r = await enrollVoiceprints({ seedKey: p.key, name: p.name, scamType: p.scamType, notes: p.notes, aiVoice: p.aiVoice, numbers: p.numbers, embeddings: p.embeddings, source: 'seed' });
  console.log(`${r.name}: ${r.samples} voiceprints, ${r.numbers.length} numbers`);
}
console.log('total voiceprints:', await voiceprintCount());
await pool.end();

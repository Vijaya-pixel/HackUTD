// Scammer voice identity database (Postgres + pgvector).
//
//   scammer_profiles  one row per known scammer voice
//   voiceprints       speaker embeddings (256 numbers) for a profile; never audio
//   scammer_numbers   numbers that voice has called from
//   voice_matches     every time the voice was recognized on a call
//
// Embeddings are L2-normalized (WeSpeaker ResNet34 from the voice/ project), so pgvector's
// cosine distance equals 1 - dot product. A profile's score is its best-matching sample.

import { q, one, pretty } from './db.js';

export const DIM = 256;
// Same threshold the voice/ project calibrated: same voice on a new line scored 0.87-0.95,
// a different voice scored 0.44-0.66.
export const VOICE_THRESHOLD = Number(process.env.VOICE_MATCH_THRESHOLD ?? 0.7);

const vec = arr => '[' + Array.from(arr, x => Number(x).toFixed(6)).join(',') + ']';
const valid = e => Array.isArray(e) && e.length === DIM && e.every(Number.isFinite);

async function withNumbers(p) {
  if (!p) return null;
  const nums = await q('SELECT e164, times, last_seen FROM scammer_numbers WHERE profile_id = $1 ORDER BY first_seen', [p.id]);
  return {
    id: p.id, name: p.name, scamType: p.scam_type, notes: p.notes, aiVoice: p.ai_voice, reports: p.reports,
    status: p.status, origin: p.origin, disputes: p.disputes,
    samples: p.sample_count ?? undefined, lastSeen: p.last_seen ?? p.updated_at,
    numbers: nums.rows.map(n => ({ e164: n.e164, num: pretty(n.e164), times: n.times })),
  };
}

/** Best matching profile for one embedding. Always resolves; { matched:false } if nothing is close enough. */
export async function searchVoiceprint(embedding) {
  if (!valid(embedding)) return { matched: false, similarity: 0, reason: 'bad embedding' };
  const r = await one(`
    SELECT p.*, max(1 - (v.embedding <=> $1::vector)) AS similarity, count(*)::int AS sample_count
    FROM voiceprints v JOIN scammer_profiles p ON p.id = v.profile_id
    GROUP BY p.id ORDER BY similarity DESC LIMIT 1`, [vec(embedding)]);
  if (!r) return { matched: false, similarity: 0, reason: 'no voices enrolled' };
  const similarity = Math.round(Number(r.similarity) * 100) / 100;
  if (similarity < VOICE_THRESHOLD) return { matched: false, similarity };
  return { matched: true, similarity, profile: await withNumbers(r) };
}

/** Record that a live call matched a profile, and remember the number it came from. */
export async function logVoiceMatch(profileId, e164, callId, similarity) {
  await q('INSERT INTO voice_matches (profile_id, e164, call_id, similarity) VALUES ($1,$2,$3,$4)', [profileId, e164, callId ? String(callId) : null, similarity]);
  await q(`INSERT INTO scammer_numbers (profile_id, e164) VALUES ($1,$2)
           ON CONFLICT (profile_id, e164) DO UPDATE SET last_seen = now(), times = scammer_numbers.times + 1`, [profileId, e164]);
  await q('UPDATE scammer_profiles SET updated_at = now() WHERE id = $1', [profileId]);
}

/** Add voiceprints to a profile (creating it from `name` when profileId is omitted). */
export async function enrollVoiceprints({ profileId, seedKey, name, scamType = 'Unknown', notes = null, aiVoice = false, numbers = [], embeddings = [], source = 'enroll' }) {
  let id = profileId;
  if (!id && seedKey) id = (await one('SELECT id FROM scammer_profiles WHERE seed_key = $1', [seedKey]))?.id;
  if (!id) {
    id = (await one(`INSERT INTO scammer_profiles (name, scam_type, notes, ai_voice, seed_key) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name || 'Unknown scammer', scamType, notes, aiVoice, seedKey || null])).id;
  } else {
    await q(`UPDATE scammer_profiles SET name = COALESCE($2, name), scam_type = COALESCE($3, scam_type), notes = COALESCE($4, notes),
             ai_voice = COALESCE($5, ai_voice), updated_at = now() WHERE id = $1`, [id, name || null, scamType || null, notes, aiVoice ?? null]);
  }
  if (seedKey) await q('DELETE FROM voiceprints WHERE profile_id = $1 AND source = $2', [id, source]); // re-seeding replaces, never duplicates
  let added = 0;
  for (const e of embeddings) {
    if (!valid(e)) continue;
    await q('INSERT INTO voiceprints (profile_id, embedding, source) VALUES ($1,$2,$3)', [id, vec(e), source]);
    added++;
  }
  for (const n of numbers) {
    await q('INSERT INTO scammer_numbers (profile_id, e164) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, n]);
  }
  return { ...(await getProfile(id)), added };
}

/**
 * Learn from a call that was judged a scam. A voice we already know gains a corroborating report (and a
 * second report confirms a pending profile); a new voice becomes a PENDING profile. Stores only the numeric
 * voiceprint and the number, never audio.
 */
export async function learnVoiceprint({ embedding, e164, scamType = 'Suspicious call', matchedProfileId = null }) {
  if (!valid(embedding)) return null;
  let id = matchedProfileId;
  if (id) {
    await q(`UPDATE scammer_profiles SET reports = reports + 1, status = CASE WHEN reports + 1 >= 2 THEN 'confirmed' ELSE status END, updated_at = now() WHERE id = $1`, [id]);
  } else {
    const n = (await one(`SELECT count(*)::int AS n FROM scammer_profiles WHERE origin = 'learned'`)).n;
    id = (await one(`INSERT INTO scammer_profiles (name, scam_type, origin, status, reports) VALUES ($1,$2,'learned','pending',1) RETURNING id`,
      [`Reported caller #${n + 1}`, scamType])).id;
  }
  await q('INSERT INTO voiceprints (profile_id, embedding, source) VALUES ($1,$2,$3)', [id, vec(embedding), 'learned']);
  if (e164) await q('INSERT INTO scammer_numbers (profile_id, e164) VALUES ($1,$2) ON CONFLICT (profile_id, e164) DO UPDATE SET last_seen = now(), times = scammer_numbers.times + 1', [id, e164]);
  return getProfile(id);
}

/** "This isn't a scam": a dispute counts against the profile; two disputes retire a pending one. */
export async function disputeProfile(id) {
  await q(`UPDATE scammer_profiles SET disputes = disputes + 1, updated_at = now() WHERE id = $1`, [id]);
  await q(`DELETE FROM scammer_profiles WHERE id = $1 AND origin = 'learned' AND status = 'pending' AND disputes >= 2`, [id]);
  return getProfile(id);
}

/** Demo helper: forget everything learned from calls, keep the seeded voices. */
export async function resetLearned() {
  const r = await q(`DELETE FROM scammer_profiles WHERE origin = 'learned'`);
  return r.rowCount;
}

export async function getProfile(id) {
  const p = await one(`SELECT p.*, count(v.id)::int AS sample_count FROM scammer_profiles p
                       LEFT JOIN voiceprints v ON v.profile_id = p.id WHERE p.id = $1 GROUP BY p.id`, [id]);
  return withNumbers(p);
}

export async function listProfiles() {
  const r = await q(`SELECT p.id FROM scammer_profiles p ORDER BY p.updated_at DESC`);
  const out = [];
  for (const row of r.rows) {
    const p = await getProfile(row.id);
    const m = await one('SELECT count(*)::int AS n, max(matched_at) AS last FROM voice_matches WHERE profile_id = $1', [row.id]);
    out.push({ ...p, matches: m.n, lastMatch: m.last });
  }
  return out;
}

/** Which known voice has this number been linked to? Used for caller-ID style hints before any audio. */
export async function profileForNumber(e164) {
  const r = await one('SELECT profile_id FROM scammer_numbers WHERE e164 = $1 ORDER BY last_seen DESC LIMIT 1', [e164]);
  return r ? getProfile(r.profile_id) : null;
}

export async function deleteProfile(id) { await q('DELETE FROM scammer_profiles WHERE id = $1', [id]); }
export async function voiceprintCount() { return (await one('SELECT count(*)::int AS n FROM voiceprints')).n; }

// Risk engine: reputation + lists + rules, then LLM verdicts on transcript chunks.
import { q, one, pretty } from './db.js';
import { classifyTranscript, embed, llmEnabled } from './llm.js';

export async function getLine(lineId) {
  return one('SELECT * FROM lines WHERE id = $1', [lineId]);
}

export async function reputation(e164) {
  return one('SELECT * FROM numbers WHERE e164 = $1', [e164]);
}

/** Deterministic pseudo-reputation for numbers we have never seen, so lookups always answer. */
export function syntheticReputation(e164) {
  const d = e164.replace(/\D/g, '');
  const h = [...d].reduce((a, c) => (a * 31 + +c) % 1000, 7) % 100;
  return {
    e164, display_name: null, carrier: h > 60 ? 'VoIP (Onvoy)' : 'Verizon Wireless', line_type: h > 60 ? 'VoIP' : 'Mobile',
    location: 'United States', risk: h, reports_30d: Math.round(h * 9),
    category: h >= 80 ? 'Scam Likely' : h >= 45 ? 'Potential Spam' : 'No reports',
    note: h >= 45 ? 'Call behavior matches known spam patterns.' : 'No negative reports from T-Mobile customers in the last 30 days.',
    synthetic: true,
  };
}

/**
 * Pre-ring decision for an incoming call.
 * Returns { outcome, label, risk, category, reason } where outcome is one of
 * allowed | blocked | spam | scam (rings with label) | identified | unknown (rings, screener may take it)
 */
export async function preRing(line, e164) {
  const t = line.toggles || {};
  const lists = await q('SELECT kind, label FROM list_entries WHERE line_id = $1 AND e164 = $2', [line.id, e164]);
  const allow = lists.rows.find(r => r.kind === 'allow');
  if (allow) return { outcome: 'allowed', label: allow.label || 'Allowed', risk: 0, category: 'Allowed', reason: 'allow list' };
  if (lists.rows.find(r => r.kind === 'block')) return { outcome: 'blocked', label: 'Blocked', risk: 100, category: 'Blocked number', reason: 'block list' };

  const rep = (await reputation(e164)) || syntheticReputation(e164);
  let risk = rep.risk;
  const reasons = [];

  // neighbor spoofing: same area code and prefix as the line, no real reputation
  if (rep.synthetic && e164.slice(0, 8) === line.msisdn.slice(0, 8)) { risk = Math.min(100, risk + 25); reasons.push('neighbor spoofing'); }

  // premium category routing
  const prefs = await q('SELECT category FROM category_prefs WHERE line_id = $1 AND enabled', [line.id]);
  const enabled = new Set(prefs.rows.map(r => r.category));
  const catKey = (rep.category || '').toLowerCase();
  const catMap = { telemarketing: 'telemarketing', survey: 'survey', political: 'political', nuisance: 'nuisance', 'potential spam': 'nuisance' };
  const mapped = catMap[catKey];
  if (mapped && enabled.has(mapped)) return { outcome: 'spam', label: rep.category, risk, category: rep.category, reason: `category ${mapped} enabled`, rep };

  if (risk >= 80) {
    if (t.scamBlock) return { outcome: 'blocked', label: 'Scam Likely', risk, category: 'Scam Likely', reason: 'Scam Block', rep, reasons };
    return { outcome: 'scam', label: t.scamLikely ? 'Scam Likely' : 'Unknown caller', risk, category: 'Scam Likely', reason: 'rings with label', rep, reasons };
  }
  if (risk >= 45) {
    if (enabled.has('nuisance')) return { outcome: 'spam', label: 'Potential Spam', risk, category: rep.category || 'Potential Spam', reason: 'nuisance category', rep };
    return { outcome: 'unknown', label: 'Potential Spam', risk, category: rep.category || 'Potential Spam', reason: 'rings with label', rep, reasons };
  }
  if (rep.display_name) return { outcome: 'identified', label: rep.display_name, risk, category: rep.category || 'Business', reason: 'caller id', rep };
  if (t.unknownVm && !rep.display_name) return { outcome: 'spam', label: 'Unknown caller', risk, category: 'Unknown caller', reason: 'unknown callers to voicemail', rep };
  return { outcome: 'unknown', label: 'Unknown caller', risk, category: 'Unknown caller', reason: 'no reputation', rep, reasons };
}

/** Hybrid search over known scam scripts: vector (if embeddings exist) plus keyword fallback. */
export async function similarScripts(text, k = 3) {
  try {
    if (llmEnabled()) {
      const vec = await embed(text);
      const r = await q(`SELECT label, text, 1 - (embedding <=> $1::vector) AS score FROM scam_scripts
                         WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT $2`, [JSON.stringify(vec), k]);
      if (r.rows.length) return r.rows;
    }
  } catch { /* fall through to keyword */ }
  const words = text.toLowerCase().match(/[a-z]{4,}/g) || [];
  if (!words.length) return [];
  const r = await q(`SELECT label, text, (SELECT count(*) FROM unnest($1::text[]) w WHERE position(w IN lower(text)) > 0) AS score
                     FROM scam_scripts ORDER BY score DESC LIMIT $2`, [words.slice(0, 40), k]);
  return r.rows.filter(x => Number(x.score) > 0);
}

/** Classify the rolling transcript of a call. Returns the verdict with the matched scripts attached. */
export async function judgeTranscript(transcript) {
  const ctx = await similarScripts(transcript);
  const verdict = await classifyTranscript(transcript, ctx);
  verdict.similar = ctx.map(c => c.label);
  return verdict;
}

export function describe(e164, rep) {
  return rep?.display_name || pretty(e164);
}

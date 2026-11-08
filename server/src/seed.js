// Seeds TigerData from the prototype's data.js so the UI fixtures become real rows.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { pool, e164, tx } from './db.js';
import { embed } from './llm.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SCAM_SCRIPTS = [
  ['bank_impersonation', 'This is the fraud department at your bank. We detected suspicious activity on your account and need to move your money to a safe account right now. Please read me the verification code we just texted you.'],
  ['otp_request', 'To confirm your identity, tell me the six digit code that was sent to your phone. Do not hang up or the transaction will go through.'],
  ['gift_card', 'There is a warrant for your arrest for unpaid taxes. You can clear it today by purchasing gift cards and reading me the numbers on the back.'],
  ['grandparent', 'Grandma, it is me. I was in an accident and I am in jail. I need bail money tonight, please do not tell mom and dad, send it by wire or cash app.'],
  ['tech_support', 'We are calling from Microsoft. Your computer is sending us virus alerts. Go to your computer and install this remote access program so we can fix it.'],
  ['warranty', 'We are reaching out about your vehicle extended warranty which is about to expire. Press one to speak with a specialist before coverage lapses.'],
  ['prize', 'Congratulations, you have won a free vacation cruise. To claim it we just need a small processing fee and your card number.'],
  ['delivery', 'This is the postal service, your package is held at customs. Pay the redelivery fee at the link we are sending to release it.'],
  ['utility', 'Your electric service will be disconnected in thirty minutes for non-payment unless you make an immediate payment over the phone.'],
  ['romance_money', 'I love you and I want to visit but my account is frozen. Can you send me money for the plane ticket and I will pay you back.'],
];

async function loadPrototypeData() {
  const src = await readFile(path.join(root, 'data.js'), 'utf8');
  return vm.runInNewContext(src + ';({ LINES, ACTIVITY, CATEGORIES, LOOKUP_DB })', {});
}

async function main() {
  const { LINES, ACTIVITY, CATEGORIES, LOOKUP_DB } = await loadPrototypeData();
  await tx(async c => {
    await c.query(`INSERT INTO accounts (id, name, plan, premium) VALUES ('acct_anne','Anne Rivera','Experience More',false)
                   ON CONFLICT (id) DO NOTHING`);
    for (const l of LINES) {
      await c.query(`INSERT INTO lines (id, account_id, name, device, msisdn, initials, is_primary, notify_guardian)
                     VALUES ($1,'acct_anne',$2,$3,$4,$5,$6,$7)
                     ON CONFLICT (id) DO UPDATE SET device = EXCLUDED.device, msisdn = EXCLUDED.msisdn`,
        ['line_' + l.id, l.name, l.device, e164(l.num), l.initials, !!l.primary, l.id === 2 ? 'line_0' : null]);
    }
    for (const l of LINES) for (const cat of CATEGORIES) {
      await c.query(`INSERT INTO category_prefs (line_id, category, enabled) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        ['line_' + l.id, cat.id, cat.id === 'fraud']);
    }
    // reputation rows: lookup db first, then anything seen in activity
    for (const [digits, r] of Object.entries(LOOKUP_DB)) {
      await c.query(`INSERT INTO numbers (e164, display_name, carrier, line_type, location, category, risk, reports_30d, note)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                     ON CONFLICT (e164) DO UPDATE SET risk = EXCLUDED.risk, reports_30d = EXCLUDED.reports_30d, category = EXCLUDED.category`,
        ['+1' + digits, r.name === 'Unknown' ? null : r.name, r.carrier, r.type, r.loc, r.cat, r.risk, r.reports, r.note]);
    }
    for (const a of ACTIVITY) {
      await c.query(`INSERT INTO numbers (e164, display_name, carrier, line_type, location, category, risk, reports_30d, note)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (e164) DO NOTHING`,
        [e164(a.num), a.name, a.name ? 'Lumen' : 'VoIP', a.name ? 'Business' : 'VoIP', a.loc, a.cat, a.risk, a.reports, a.note || null]);
    }
    // historical call events (ago is minutes)
    const existing = await c.query(`SELECT count(*)::int AS n FROM call_events WHERE source = 'seed'`);
    if (existing.rows[0].n === 0) {
      for (const a of ACTIVITY) {
        const times = a.times || 1;
        for (let i = 0; i < times; i++) {
          const minutesAgo = a.ago + i * 1440 * 3; // repeat calls spaced three days apart
          await c.query(`INSERT INTO call_events (time, line_id, e164, outcome, category, risk, note, source)
                         VALUES (now() - ($1 || ' minutes')::interval, $2, $3, $4, $5, $6, $7, 'seed')`,
            [String(minutesAgo), 'line_' + a.line, e164(a.num), a.type, a.cat, a.risk, a.note || null]);
        }
      }
      // pad history so the monthly counters look like a month of protection
      const pad = [[0, 'blocked', 36], [0, 'spam', 8], [0, 'identified', 27], [1, 'blocked', 15], [1, 'identified', 10], [2, 'blocked', 20], [2, 'spam', 5], [2, 'identified', 6]];
      for (const [line, outcome, n] of pad) {
        for (let i = 0; i < n; i++) {
          const d = 2 + Math.floor(Math.random() * 26);
          await c.query(`INSERT INTO call_events (time, line_id, e164, outcome, category, risk, source)
                         VALUES (now() - ($1 || ' days')::interval - (random()*86400 || ' seconds')::interval, $2, $3, $4, $5, $6, 'seed')`,
            [String(d), 'line_' + line, '+1' + String(200 + Math.floor(Math.random() * 700)) + '555' + String(1000 + Math.floor(Math.random() * 9000)),
             outcome, outcome === 'identified' ? 'Business' : outcome === 'spam' ? 'Telemarketing' : 'Scam Likely', outcome === 'identified' ? 5 : outcome === 'spam' ? 55 : 92]);
        }
      }
    }
    // lists
    const lists = [['line_0', '+12065550199', 'block', null], ['line_0', '+14255550142', 'block', null], ['line_0', '+12065550123', 'allow', 'Mom'], ['line_0', '+14255550170', 'allow', 'Dr. Patel Dental']];
    for (const [l, n, k, label] of lists) await c.query(`INSERT INTO list_entries (line_id, e164, kind, label) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [l, n, k, label]);
  });

  // scam scripts with embeddings (null embedding when no Gemini key; BM25/keywords still work)
  for (const [label, text] of SCAM_SCRIPTS) {
    const exists = await pool.query('SELECT id, embedding IS NOT NULL AS has FROM scam_scripts WHERE label = $1', [label]);
    if (exists.rows[0]?.has) continue;
    let vec = null;
    try { vec = await embed(text); } catch (e) { console.warn('embed skipped:', e.message); }
    if (exists.rows[0]) await pool.query('UPDATE scam_scripts SET embedding = $2 WHERE id = $1', [exists.rows[0].id, vec ? JSON.stringify(vec) : null]);
    else await pool.query('INSERT INTO scam_scripts (label, text, embedding) VALUES ($1,$2,$3)', [label, text, vec ? JSON.stringify(vec) : null]);
  }

  const counts = await pool.query(`SELECT (SELECT count(*) FROM lines) lines, (SELECT count(*) FROM numbers) numbers,
    (SELECT count(*) FROM call_events) events, (SELECT count(*) FROM scam_scripts WHERE embedding IS NOT NULL) embedded_scripts`);
  console.log('seeded', counts.rows[0]);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

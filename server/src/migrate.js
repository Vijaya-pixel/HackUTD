import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function main() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) { console.log('skip ', f); continue; }
    const sql = await readFile(path.join(dir, f), 'utf8');
    console.log('apply', f);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
  }
  const v = await pool.query("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'");
  const ext = await pool.query("SELECT extname FROM pg_extension ORDER BY 1");
  console.log('timescaledb', v.rows[0]?.extversion, '| extensions:', ext.rows.map(r => r.extname).join(', '));
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

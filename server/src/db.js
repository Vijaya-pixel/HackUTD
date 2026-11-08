import 'dotenv/config';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (server/.env)');

// Tiger Cloud's download config uses sslmode=require; recent pg versions treat that as verify-full and
// reject the chain. Strip the parameter and configure TLS explicitly (encrypted, no CA pinning for the hackathon).
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');

export const pool = new pg.Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
});

export const q = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Normalize anything that looks like a US number to E.164 (+1XXXXXXXXXX). Returns null if not 10/11 digits. */
export function e164(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 ? '+1' + d : null;
}

/** Pretty US format for the UI: (312) 555-0107 */
export function pretty(e) {
  const d = String(e || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e;
}

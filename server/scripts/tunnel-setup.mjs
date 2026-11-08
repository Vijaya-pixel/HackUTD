// After `ngrok http 8788` is running: reads the public https URL from ngrok's local API, writes it to
// server/.env as PUBLIC_URL, and points the Twilio number's voice + status webhooks at it.
// Run: npm run tunnel-setup
import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import twilio from 'twilio';

const envPath = new URL('../.env', import.meta.url);
const tunnels = await fetch('http://127.0.0.1:4040/api/tunnels').then(r => r.json()).catch(() => null);
const pub = tunnels?.tunnels?.find(t => t.public_url.startsWith('https'))?.public_url;
if (!pub) { console.error('No ngrok tunnel found. Start one first:  ngrok http 8788'); process.exit(1); }

let env = await readFile(envPath, 'utf8');
env = /^PUBLIC_URL=/m.test(env) ? env.replace(/^PUBLIC_URL=.*$/m, `PUBLIC_URL=${pub}`) : env + `\nPUBLIC_URL=${pub}\n`;
await writeFile(envPath, env);
console.log('PUBLIC_URL =', pub);

const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
let from = (process.env.TWILIO_NUMBER || '').replace(/\D/g, ''); if (from.length === 10) from = '1' + from; from = '+' + from;
if (!sid || !token) { console.log('Twilio credentials missing; webhook not configured.'); process.exit(0); }
const client = twilio(sid, token);
const nums = await client.incomingPhoneNumbers.list({ limit: 20 });
const mine = nums.find(n => n.phoneNumber === from) || nums[0];
if (!mine) { console.log(`No phone number on the Twilio account yet. Claim the trial number in the console, set TWILIO_NUMBER, rerun.`); process.exit(0); }
await client.incomingPhoneNumbers(mine.sid).update({
  voiceUrl: `${pub}/webhooks/twilio/voice`, voiceMethod: 'POST',
  statusCallback: `${pub}/webhooks/twilio/status`, statusCallbackMethod: 'POST',
});
console.log(`Twilio ${mine.phoneNumber}: voice webhook -> ${pub}/webhooks/twilio/voice`);
if (mine.phoneNumber !== from) console.log(`NOTE: TWILIO_NUMBER in .env (${from}) differs from the account's number (${mine.phoneNumber}); set TWILIO_NUMBER=${mine.phoneNumber}`);
const ver = await client.outgoingCallerIds.list({ limit: 20 });
console.log('Verified caller IDs (outbound targets on trial):', ver.map(v => v.phoneNumber).join(', ') || 'none yet');
console.log('\nRestart the API so it picks up PUBLIC_URL:  npm start   (or PORT=8788 npm start)');

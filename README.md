# HackUTD: ScamShield for T-Life

A T-Life feature extension that brings Hiya Spam Blocker's capabilities (caller ID,
pre-ring spam blocking, AI voice detection, in-call fraud alerts, call screening,
reverse lookup, reporting) into T-Mobile's existing ScamShield, using the current
T-Life app format: Home / Shop / Benefits / Services / Account tabs, bold left-aligned
titles, white rounded cards on light gray, outline icon tiles, pill chips, magenta
(#E20074) accents and dark stat blocks.

## Run

Any static server works. For example:

    python -m http.server 5173

then open http://localhost:5173. The UI now reads and writes through the backend in `server/`, so start
that first (see Backend below); the static server is only needed when you want the UI on a different port.

## Where ScamShield lives

- Home: ScamShield summary card and Quick actions tile
- Services: "Your services" list
- Account: each line and the ScamShield Premium row

## Feature map (Hiya -> T-Life ScamShield)

| Hiya feature                     | In this app                                   | Tier    |
|----------------------------------|-----------------------------------------------|---------|
| Caller ID                        | Protection > Caller ID toggle                 | Free    |
| Block spam before it rings       | Protection > Scam Block toggle                | Free    |
| Report spam numbers              | Report tile, activity detail, post-call       | Free    |
| Basic call blocking              | Block list / Allow list                       | Free    |
| AI voice & deepfake detection    | Protection toggle + in-call alert card        | Premium |
| In-call fraud detection          | Protection toggle + in-call alert card        | Premium |
| Call Screener                    | Protection toggle + screening transcript      | Premium |
| Premium phone number lookups     | Look up a number (name/carrier/type unlocked) | Premium |
| Advanced blocking                | Block spam categories                         | Premium |
| Visual voicemail                 | Settings > Voicemail-to-text                  | Premium |
| Family setup                     | Family protection + per-line chips            | Free    |

ScamShield Premium is priced at $4/mo per line, matching T-Mobile's current offer.

## Demo

On the ScamShield screen, "See ScamShield in action" simulates three calls:

1. Scam Likely call: blocked silently when Scam Block is on; rings with a label when off.
2. AI voice scam: answer it to see the AI voice and Fraud call detected alerts mid-call.
3. Screen a call: Call Screener asks the caller who they are and hangs up on a sales pitch.

State (toggles, lists, reports, Premium) persists in localStorage. Use
ScamShield settings > Reset demo data to start over.

## Files

- index.html  phone frame and status bar
- styles.css  T-Life design tokens and components
- icons.js    outline icon set
- data.js     lines, activity, categories, lookup records
- app.js      state, screens, sheets, call simulation, rendering

## Backend (server/)

Node 24, Hono, `pg`, Gemini (`@google/genai`), TigerData (TimescaleDB) as the database.

    cd server
    npm install
    npm run migrate      # creates tables, hypertable, continuous aggregate, retention policy
    npm run seed         # loads lines, reputation and 30 days of call events from ../data.js
    npm start            # http://localhost:8787 serves the API and the UI from the repo root

Config lives in `server/.env` (ignored by git): `DATABASE_URL` from the Tiger Cloud config file,
`GEMINI_API_KEY` (optional; the classifier falls back to rules without it), `PHOTON_*` and `TWILIO_*`
(optional; sends are logged to `GET /api/photon/outbox` until configured).

Key routes: `/api/health`, `/api/lines`, `/api/lines/:id/stats|activity|lists|categories|lookups`,
`/api/numbers/:num`, `/api/reports`, `/api/calls/simulate`, `/api/calls/:id/answer|decline|end|takeover|transcript`,
`/api/events` (SSE), `/webhooks/photon`.

## Real calls (Twilio + Deepgram)

1. Twilio console: claim the trial number (Phone Numbers > Buy a number, voice-capable), and add your own
   phone under Verified Caller IDs. Put the number in `server/.env` as `TWILIO_NUMBER=+1...`.
2. Start the API (`PORT=8788 npm start` in `server/`) and a tunnel in another terminal: `ngrok http 8788`.
3. `npm run tunnel-setup` writes the tunnel URL into `.env` and points the Twilio number's webhooks at it.
   Restart the API afterwards.
4. Call the Twilio number from any phone to hit the Call Screener, or place a demo scam call to a verified phone:

       curl -X POST localhost:8788/api/calls/outbound -H Content-Type:application/json -d '{"to":"+1XXXXXXXXXX","lineId":"line_2","scenario":"fraud"}'

Cost guards: outbound calls are capped at 180 s, Deepgram opens only while audio streams and is force-closed
after 240 s, and only the far side's audio track is transcribed. `GET /api/twilio/status` shows number,
verified IDs, balance and tunnel URL.

Trial-account notes (verified 2026-11-08): the sandbox trial number works for outbound calls with `to`,
`from` and `url` only (no inline TwiML, time limit or status callbacks), its webhooks arrive unsigned (the
server accepts them when the body's AccountSid matches), and it does not open Media Streams, so the far
side is not transcribed until the account is upgraded. The scripted scammer lines still drive the alerts.

Two numbers on a trial: `TWILIO_NUMBER` is the owned number that receives inbound calls (Call Screener);
`TWILIO_OUTBOUND_FROM` is the sandbox "assigned trial number", the only sender a trial may use to call a
verified phone (Twilio error 573003 otherwise). The server falls back between them automatically.

Verified 2026-11-08 on the owned trial number: inbound Call Screener end to end (signed webhooks, status
callbacks, Media Stream -> Deepgram transcript -> Gemini verdict -> spoken goodbye and hang-up, logged as
"screened"). Media Streams do not open on the sandbox outbound sender, so only inbound calls are transcribed on a trial.

## Photon (messaging)

Photon's stable product (Spectrum) is used through the `spectrum-ts` SDK. Credentials are
`PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET` (the dashboard's Project Secret; there is no separate API key).
The server keeps a live SDK connection: inbound texts arrive on the stream (no webhook), and replies and
guardian alerts are sent on it. Shared lines can only message a phone that has texted them first, so each demo
phone must text the project's iMessage number once. `DEMO_PHONE` maps your real phone to Anne's line
(`DEMO_LINE_ID`). Endpoints: `GET /api/photon/status`, `GET /api/photon/outbox`, `POST /api/photon/send`.
Verified 2026-11-08: inbound "Hi" bound the phone and got the help reply; a fraud call on Rosa's line
delivered a real guardian alert to the bound phone.

# ScamShield for T-Life: Hackathon Implementation Plan

Goal: turn the clickable prototype in this folder into a working system in roughly 24 to 36 hours, using
TigerData for the database and Photon for messaging, with the T-Life UI you already have as the front end.

Platform notes:

- TigerData free plan: two free services per account, shared CPU/memory, region `us-east-1` only, goes
  read-only at the storage cap. Hypertables, continuous aggregates, retention policies, pgvector,
  pgvectorscale, pg_textsearch (BM25) and copy-on-write forks are all available. The in-database
  `ai.*` embedding and LLM functions were removed on June 30, 2026, so embeddings must be generated in app code.
- Photon: the current platform is the Beta API at `https://api.photon.codes/v1`, SDK `@photon-ai/api`,
  bearer auth with a `pho_sk_...` project key. Channels: iMessage, SMS, WhatsApp Business, email, voice.
  Free plan includes 25 shared iMessage and 25 shared WhatsApp assignments; SMS is pay-per-part at $0.01 (US/CA),
  iMessage and WhatsApp sends are free. Stable rate limit is 5 requests per second per project.
  A shared line cannot send the first message: the human must text the assigned number first.
  Delivery is at-least-once, so dedupe inbound messages on their id.
- Gemini: Node SDK `@google/genai`, generation model from `GEMINI_MODEL` (default `gemini-3.5-flash-lite`),
  embeddings from `gemini-embedding-001` with `outputDimensionality: 1024`. The classifier uses
  `responseMimeType: "application/json"` plus a `responseSchema` so the verdict is schema-valid JSON.
  Without a key the server falls back to a keyword rule classifier so the demo still runs.
- Twilio Programmable Voice (Node SDK `twilio`): a local US number is about $1.15/month, voice is roughly
  $0.014/min inbound and outbound, Media Streams (raw call audio over WebSocket) has no extra charge. A trial
  account can only call verified numbers and plays a preamble, so load $20 and upgrade before the event.

## 1. What is real vs. simulated

There is no carrier call path in a hackathon, so calls are simulated end to end, but every other layer is real:

| Layer | Hackathon reality |
|---|---|
| Incoming calls to the user's own T-Mobile number | Cannot be intercepted; that happens in the carrier network. Simulated by the call generator for the Home/activity demo |
| Real phone calls | Real, through a Twilio number: the ScamShield line takes inbound calls (Call Screener) and places outbound "scammer" calls to a judge's phone, with live audio streamed to the backend (section 6b) |
| Call risk scoring | Real: reputation table in TigerData plus rules plus Claude classification of the live transcript |
| AI voice detection | Scripted flag by default. Stretch: an open-source synthetic-speech detector on five-second windows of the Twilio audio |
| Caller ID, block/allow lists, categories, activity, stats | Real, stored in TigerData, served by the API |
| Alerts to the user and family | Real, sent through Photon over iMessage (free) or SMS |
| Report a number by text | Real: user texts a number to the ScamShield line, backend looks it up and replies with a verdict |
| Voicemail-to-text, weekly summary | Real Photon messages, content generated from stored events |

## 2. Architecture

```
T-Life UI (this folder)  --fetch/SSE-->  API server (Node 24, Hono)  --pg-->  TigerData (Postgres)
                                              |  \--> Gemini API (classify transcript, embeddings, draft replies)
                                              |  \--> Photon API (outbound alerts and replies)
                                              |  \--> Twilio REST (place outbound calls, hang up)
                                              <-- Photon webhook (inbound texts) / WebSocket
                                              <-- Twilio voice webhook (TwiML) + Media Streams WebSocket (audio)
                                              --> Speech-to-text (Deepgram streaming) --> transcript chunks --> risk engine
Call generator (script) --POST /calls/simulate--> API server   (fallback when no real call is available)
```

Repository layout to add next to the prototype:

```
server/
  src/index.ts          Hono app, routes, SSE hub
  src/db.ts             pg Pool, migrations runner
  src/risk.ts           scoring: reputation + rules + Claude verdict
  src/photon.ts         send message, inbound webhook handler, dedupe
  src/twilio.ts         TwiML handlers, Media Streams WebSocket, outbound call placement
  src/stt.ts            Deepgram streaming client: mulaw 8 kHz audio in, transcript chunks out
  src/llm.ts            Gemini: classifyTranscript(), embed(), draftReply(); rule fallback without a key
  migrations/001_init.sql
  migrations/002_aggregates.sql
  seed/numbers.csv      reputation seed (the numbers used in data.js)
sim/
  generate.ts           posts scripted and random calls to /calls/simulate
web/                    move index.html, app.js, styles.css, icons.js here; replace localStorage with api.js
```

Hosting: run the server on a laptop with a tunnel (ngrok or cloudflared) so the Photon and Twilio webhooks
can reach it. Twilio needs the public URL for both the voice webhook and the Media Streams WebSocket (`wss://`),
so the tunnel is mandatory once Twilio is in. Use a reserved ngrok domain so the URL does not change between restarts.

## 3. TigerData schema

Create the service once:

```
curl -fsSL https://cli.tigerdata.com | sh          # or: irm https://cli.tigerdata.com/install.ps1 | iex
tiger auth login
tiger service create --name scamshield --region us-east-1 --cpu shared --memory shared
tiger db uri scamshield --with-password              # -> DATABASE_URL
```

`001_init.sql` (the columns mirror data.js so the prototype's fixtures become the seed):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_textsearch;

CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, plan TEXT, premium BOOLEAN DEFAULT false);
CREATE TABLE lines (
  id TEXT PRIMARY KEY, account_id TEXT REFERENCES accounts(id),
  name TEXT, device TEXT, msisdn TEXT UNIQUE, photon_handle TEXT,   -- the user's own number, for alerts
  scam_block BOOLEAN DEFAULT true, caller_id BOOLEAN DEFAULT true, scam_likely BOOLEAN DEFAULT true,
  ai_voice BOOLEAN DEFAULT false, in_call BOOLEAN DEFAULT false, screener BOOLEAN DEFAULT false,
  vm_text BOOLEAN DEFAULT false, unknown_vm BOOLEAN DEFAULT false, notify_guardian TEXT  -- line id to alert
);

-- reputation: one row per phone number, updated by reports and call outcomes
CREATE TABLE numbers (
  e164 TEXT PRIMARY KEY, display_name TEXT, carrier TEXT, line_type TEXT, location TEXT,
  category TEXT, risk SMALLINT DEFAULT 0, reports_30d INT DEFAULT 0, note TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- every call event is time-series data: hypertable, partitioned by time, segmented by line
CREATE TABLE call_events (
  time TIMESTAMPTZ NOT NULL, id UUID DEFAULT gen_random_uuid(), line_id TEXT NOT NULL,
  e164 TEXT NOT NULL, outcome TEXT NOT NULL,      -- blocked | scam | spam | identified | screened | ai | fraud | allowed
  category TEXT, risk SMALLINT, duration_s INT, transcript TEXT, verdict JSONB
) WITH (tsdb.hypertable, tsdb.segmentby = 'line_id', tsdb.orderby = 'time DESC');

CREATE TABLE list_entries (line_id TEXT, e164 TEXT, kind TEXT CHECK (kind IN ('block','allow')),
  label TEXT, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (line_id, e164, kind));
CREATE TABLE category_prefs (line_id TEXT, category TEXT, enabled BOOLEAN, PRIMARY KEY (line_id, category));
CREATE TABLE reports (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, line_id TEXT, e164 TEXT,
  reason TEXT, text TEXT, source TEXT, created_at TIMESTAMPTZ DEFAULT now());

-- known scam scripts for similarity matching (embeddings generated in app code)
CREATE TABLE scam_scripts (id SERIAL PRIMARY KEY, label TEXT, text TEXT, embedding vector(1024));
CREATE INDEX ON scam_scripts USING hnsw (embedding vector_cosine_ops);
CREATE INDEX scam_scripts_bm25 ON scam_scripts USING bm25(text) WITH (text_config='english');
```

`002_aggregates.sql` powers the "this month" counters and the weekly summary without scanning raw rows:

```sql
CREATE MATERIALIZED VIEW line_daily WITH (timescaledb.continuous) AS
SELECT line_id, time_bucket(INTERVAL '1 day', time) AS day, outcome, count(*) AS n
FROM call_events GROUP BY line_id, day, outcome;
SELECT add_continuous_aggregate_policy('line_daily',
  start_offset => INTERVAL '60 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '15 minutes');
SELECT add_retention_policy('call_events', INTERVAL '90 days');
```

Demo trick worth 30 seconds on stage: `tiger service fork scamshield --name judge-demo` gives a copy-on-write
clone in under 90 seconds, so you can wreck the demo data and reset it instantly by pointing `DATABASE_URL` back.

## 4. API surface (replaces localStorage in app.js)

| Method and path | Backs this UI action |
|---|---|
| `GET /lines`, `PATCH /lines/:id` | line chips, Protection toggles, Settings toggles |
| `GET /lines/:id/stats` | status card counters (reads `line_daily`) |
| `GET /lines/:id/activity?filter=&q=` | Recent activity, See all, search |
| `GET /numbers/:e164` | Look up a number, detail sheet |
| `POST /lines/:id/lists`, `DELETE /lines/:id/lists/:kind/:e164` | Block and Allow lists |
| `PUT /lines/:id/categories` | Block spam categories |
| `POST /reports` | Report sheet |
| `POST /accounts/:id/premium` | Add or remove Premium |
| `POST /calls/simulate` | the three demo buttons and the call generator |
| `POST /calls/:id/answer`, `/end`, `/takeover` | incoming-call overlay controls (for Twilio calls, `/end` hangs up via the REST API) |
| `POST /calls/outbound` | places a real "scammer" call from the Twilio number to a verified phone |
| `GET /events` (SSE) | pushes ring, alert, blocked and ended events to the open UI |
| `POST /webhooks/photon` | inbound texts from Photon |
| `POST /webhooks/twilio/voice` | Twilio voice webhook; returns TwiML that starts a Media Stream |
| `POST /webhooks/twilio/status` | call status callbacks (ringing, in-progress, completed) |
| `WS /twilio/media` | Media Streams audio in, optional audio out for the screener voice |

Front-end change is mechanical: `S` stays the render state, but each mutation calls the API and the SSE
stream replaces the `setInterval` call timer. Keep localStorage only for the selected line and tab.

## 5. Risk engine (server/src/risk.ts)

Runs when a simulated call arrives and again whenever a transcript chunk is posted during a call.

1. Allow list or contact match: score 0, ring through, never analyzed further (the privacy promise).
2. Block list match: outcome `blocked`, straight to voicemail.
3. Reputation: `numbers.risk` and `reports_30d`; neighbor-spoof rule adds +25 when the caller shares the
   line's area code and prefix but has no reputation row.
4. Category preference: if `numbers.category` is enabled in `category_prefs`, outcome `spam` to voicemail.
5. Scam Block: risk >= 80 and `scam_block` on, outcome `blocked`; else label "Scam Likely" and ring.
6. In-call (Premium): on each transcript chunk, call Gemini with a JSON response schema
   `{ tactic: "otp_request" | "gift_card" | "urgency_money" | "impersonation" | "none", confidence: number, synthetic_voice_hint: boolean, one_line_warning: string }`.
   Also run a hybrid search against `scam_scripts` (pgvector cosine plus BM25, reciprocal rank fusion) and
   pass the top three matches into the prompt as context. Confidence >= 0.8 emits the "Fraud call detected" alert.
7. Write the row to `call_events` with the verdict JSON; the continuous aggregate picks it up.

Model choice: a Flash-class Gemini model for the per-chunk classifier, since latency matters more than depth
here; set `thinkingConfig: { thinkingBudget: 0 }` if the chosen model thinks by default. Cap each call with a
timeout of about four seconds and fall back to the rule classifier on timeout or error so a slow model never
stalls a call. Embeddings for `scam_scripts` and transcripts come from `gemini-embedding-001` at 1024 dims,
stored with the `pg` driver as `'[...]'::vector`.

## 6. Photon integration (server/src/photon.ts)

Setup (dashboard): create a project, assign a shared iMessage number, copy the `pho_sk_` key.
Because a shared line cannot message first, onboarding is "Text SHIELD to <number>". That inbound message
supplies the `spaceId`, `senderId` and the message id you must reuse for every reply. Store them on `lines.photon_handle`.

Flows:

- Guardian alert: when a high-risk call hits Rosa's line and `notify_guardian` is set, send Harsh
  "ScamShield stopped a likely grandparent scam on Rosa's phone (866) 555-0176. She did not share any info."
- Report by text: inbound "report 312-555-0107" or just a pasted number: look it up, insert a `reports` row with
  `source = 'photon'`, bump `numbers.reports_30d`, reply with risk, category and report count.
- Smishing check: inbound message with a URL: reply with a verdict from the same classifier (it is cheap).
- Voicemail-to-text (Premium): after a `spam` or `blocked` outcome with a scripted voicemail, send the transcript.
- Weekly summary: a cron (node-cron) that reads `line_daily` for the last 7 days and sends one message per line.

Rules of the road: dedupe inbound on message id, honor 429 with backoff, send with an idempotency key per
event id, and prefer iMessage for the demo because it is free on the Free plan (SMS costs $0.01 per part and the
Free plan includes none).

## 6b. Twilio real-call path (server/src/twilio.ts, server/src/stt.ts)

What it buys you: real phone calls, real audio, and a live transcript feeding the same risk engine the
simulation uses. The user's own T-Mobile number stays out of the loop; the Twilio number is the ScamShield line.

Setup (30 minutes, do it before the event):
1. Create the account, upgrade it (trial accounts only call verified numbers and play a preamble), buy one
   local US voice number. Note `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`.
2. In the number's Voice configuration, set "A call comes in" to `POST https://<PUBLIC_URL>/webhooks/twilio/voice`
   and the status callback to `/webhooks/twilio/status`.
3. Verify every phone that will be called during the demo (judges' phones can be added on the day; it takes a code).
4. Sign up for Deepgram (free credit is enough) for streaming speech-to-text. Any streaming STT works; Deepgram
   accepts Twilio's mulaw 8 kHz directly, which avoids transcoding.

Two call shapes, both using Media Streams:

A. Call Screener (inbound). A judge calls the Twilio number.
   - `/webhooks/twilio/voice` returns TwiML: `<Connect><Stream url="wss://<PUBLIC_URL>/twilio/media"/></Connect>`.
     Twilio opens the WebSocket and sends `start`, then `media` frames (base64 mulaw, 20 ms each).
   - The server plays the screener prompt back on the same socket (TTS the line "Hi, I'm screening calls for Harsh.
     May I ask who is calling?" to mulaw 8 kHz once at startup and cache the bytes).
   - Caller audio goes to Deepgram; each final transcript chunk is posted into the risk engine as a transcript
     event for the active call. The engine's verdict decides: sales pitch or scam tactic, play the goodbye line and
     end the call through the REST API; a named person, bridge or let through (for the demo, bridging means
     `<Dial>` to a teammate's verified phone from a second TwiML step).
   - Every step emits an SSE event so the T-Life overlay shows the same transcript bubbles it shows today, now
     from real speech.

B. Scam call to a real phone (outbound). The judge's own phone rings.
   - `POST /calls/outbound { to, scenario }` calls `client.calls.create({ to, from: TWILIO_NUMBER, url: .../voice?scenario=fraud })`.
   - The voice webhook returns TwiML that connects a Media Stream; the server plays the scripted scammer lines
     ("this is the fraud department at your bank ... read me the code we just texted you") as mulaw audio and
     listens to the judge's replies.
   - The scammer lines themselves go through the classifier exactly as they would in a real call, so the
     "AI voice detected" and "Fraud call detected" cards fire from the transcript, not from a scenario flag.
   - "End call" in the UI calls `client.calls(sid).update({ status: 'completed' })`.

Stream handling details that bite people at 3 a.m.:
- Twilio sends audio as 8 kHz mulaw, 160 bytes per 20 ms frame. Forward frames to Deepgram as they arrive;
  do not buffer into files.
- Keep one in-memory call record per `streamSid` holding the DB call id, the line, and the rolling transcript.
  Map Twilio `CallSid` to it from the `start` message's `customParameters` (pass the DB call id in the TwiML `<Parameter>`).
- The classifier runs on transcript chunks of roughly one sentence, debounced to at most one request every
  two seconds per call, with the last 30 seconds of transcript as context. Expect one to three seconds from
  speech to card.
- Validate Twilio webhook signatures (`twilio.validateRequest`) and the Photon HMAC; both are documented and cheap.
- Record nothing. Transcripts are kept in `call_events.transcript` for the demo and dropped by the 90-day retention policy.

Cost for the weekend: one number (about $1), maybe 60 minutes of calls (under $2), Deepgram inside the free
credit. The $20 account top-up is mostly to get off the trial restrictions.

Optional add-on, Android only: a `CallScreeningService` app on a teammate's phone that calls `/numbers/:e164`
before the phone rings and blocks or labels the call. This is the only way to show a real incoming call being
stopped on a real handset. It has no access to call audio, so it pairs with the Twilio path rather than replacing it.

## 7. Build order (two people, parallel tracks)

Before the event (one evening)
- Twilio account upgraded, number bought, team phones verified, Deepgram key, reserved ngrok domain.

Hour 0 to 2: both
- Create the Tiger service, run migrations, seed `numbers` from data.js, confirm `pg` connects with SSL.
- Create the Photon project, assign a number, text it once, confirm one reply round trip from a script.
- Point the Twilio number at the tunnel and confirm a call reaches the webhook and opens the Media Stream.

Hours 2 to 10: backend owner
- Lines, stats, activity, lists, categories, reports endpoints against the DB.
- `/calls/simulate` with the three scripted scenarios and the SSE hub.
- Risk engine steps 1 to 5 (no LLM yet).

Hours 2 to 10: front-end owner
- Move the prototype to `web/`, add `api.js`, swap each `S` mutation to a fetch, subscribe to SSE for calls.
- Keep the demo buttons; they now POST to `/calls/simulate`.

Hours 10 to 18
- Gemini classifier plus hybrid search; wire the in-call alerts to real verdicts.
- Twilio: Media Streams to Deepgram to transcript events; outbound scam call (shape B) end to end.
- Photon guardian alert and report-by-text.

Hours 18 to 26
- Twilio Call Screener (shape A) with the cached TTS prompt and REST hang-up.
- Continuous aggregate for stats; weekly summary cron.
- Call generator that fires a realistic mix every 20 to 40 seconds for a live dashboard during judging.

Hours 26 to 30
- Fork the service for a clean demo copy; rehearse the demo twice on real phones; write the 3-minute script.

Stretch, only if ahead
- Deepfake-audio classifier on a 5-second clip for the "AI voice detected" card.
- Per-line Premium billing row in `accounts`; Scam Block toggles that differ per line (the schema already allows it).

## 8. Demo script (3 minutes)

1. Home tab: ScamShield card shows live counters from `line_daily`.
2. Tap "Scam Likely call" with Scam Block on: no ring, toast, new row, counter ticks. Show the row in TigerData.
3. Switch to Rosa, then `POST /calls/outbound` to a judge's phone. Their phone actually rings from the ScamShield
   number; they answer and hear the bank-fraud script. On the big screen the transcript streams in, the Gemini
   verdict lands, the Fraud card appears, you end the call from the UI, and Harsh's phone gets the Photon guardian alert.
4. A second judge calls the ScamShield number and pretends to sell a warranty. The Call Screener asks who is
   calling, transcribes the answer, says goodbye and hangs up. The screened row appears in activity.
5. Text an unknown number to the ScamShield line from a phone; the reply shows the verdict and the report count
   rises in the app within a second via SSE.
6. Close on the Family screen and the "calls with people they know are never analyzed" line.

If the venue has bad cell coverage, steps 3 and 4 fall back to the simulated buttons, which produce the same screens.

## 9. Environment variables

```
DATABASE_URL=postgresql://tsdbadmin:...@...tsdb.cloud.timescale.com:5432/tsdb?sslmode=require
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash-lite
PHOTON_API_KEY=pho_sk_...
PHOTON_PROJECT_ID=pho_prj_...
PHOTON_WEBHOOK_SECRET=...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_NUMBER=+1...
DEEPGRAM_API_KEY=...
PUBLIC_URL=https://<reserved-name>.ngrok.app
```

## 10. Risks and fallbacks

- Photon shared line cannot cold-text: every demo phone must text the line first. Do this before judging starts.
- Free Tiger service is beta and us-east-1 only; keep the dataset small and run the generator at a low rate.
- If the webhook tunnel fails, switch Photon delivery to WebSocket, which only needs outbound connectivity.
- If the Gemini quota or network fails mid-demo, the risk engine degrades to steps 1 to 5 and the in-call
  alerts fall back to the scripted verdicts, so the demo still runs.
- Twilio: a trial account cannot call unverified judges, so upgrade beforehand and keep the verification
  flow handy. Outbound calls from a new number may show as "Spam Risk" on some carriers, which is a joke worth
  making on stage rather than a problem. If the tunnel drops, Twilio returns an error tone; restart the tunnel
  on the reserved domain and no Twilio settings need to change.
- Venue cell coverage: rehearse on Wi-Fi calling, and keep the simulated buttons as the fallback for every real-call step.

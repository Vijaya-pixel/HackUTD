# Safe Signal — HackUTD 2026

HackUTD 2026 · T-Mobile "Safe Signal" challenge · Photon track

A T-Life feature extension that protects customers from scams through two complementary systems:
- **Education branch** — interactive SMS practice sessions that teach users to spot scams by experiencing them safely
- **ScamShield branch** — Hiya Spam Blocker capabilities (caller ID, AI voice detection, in-call fraud alerts, repeat-scam-caller voice detection, Scam Academy) integrated into T-Life's existing ScamShield

---

## Education Backend (Safe Signal)

Protect customers from scams through interactive practice sessions delivered over iMessage/SMS.

### Quick start

```bash
# Prerequisites: Node 20+, pnpm 9+
pnpm install

# Configure environment
cp .env.example .env
# Fill in: ANTHROPIC_API_KEY (or OPENAI_API_KEY), BASE_URL, PHOTON_* keys

# Seed demo data (stop the dev server first when using local PGlite)
pnpm seed

# Start server (port 3000)
pnpm dev:server

# Start mobile app (Expo Go)
pnpm dev:mobile

# Run detection evaluation
pnpm eval
```

### Architecture

```
apps/
  server/        Hono + Node.js — conversation engine, webhooks, link tracking, API
  mobile/        React Native + Expo Router — T-Life shell with Learn tab
packages/
  shared/        Types, Zod schemas, detection module, 12 scenario JSONs, eval harness
```

### Server API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/optin` | User opt-in with consent |
| GET | `/api/optin/:userId` | Get consent status |
| DELETE | `/api/optin/:userId` | Opt out |
| POST | `/api/practice/trigger` | Trigger a practice session |
| GET | `/api/sessions/:userId` | List sessions |
| GET | `/api/sessions/:userId/skills` | Skills summary |
| GET | `/api/session/:sessionId` | Session detail |
| GET | `/api/lesson/:sessionId` | Get lesson |
| POST | `/api/detect` | Classify a suspicious message |
| POST | `/api/simulator/send` | Send a message in simulator |
| GET | `/api/simulator/:sessionId/messages` | Get simulator messages |
| GET | `/api/simulator/:sessionId/stream` | SSE stream for real-time messages |
| GET | `/p/:token` | Practice link — records click, reveals, deep-links |
| GET | `/learn/:sessionId` | Web fallback lesson page |
| POST | `/webhooks/photon` | Photon inbound webhook (Standard Webhooks) |
| GET | `/health` | Health check |

### Database

Postgres everywhere, via Drizzle ORM:

| Mode | When | Notes |
|------|------|-------|
| **TigerData** (Timescale Cloud) | `DATABASE_URL` is set | Production/demo DB. `messages` is created as a **hypertable** partitioned on `ts`. |
| **PGlite** (embedded Postgres) | `DATABASE_URL` is empty | Zero-setup local fallback, persisted under `DATABASE_PATH` (default `./data/pglite`). |

### Environment variables

See `.env.example` for the full list. Key variables:

- `LLM_PROVIDER` — `anthropic` (default) or `openai`
- `DEMO_MODE=true` — short timeouts, no Photon required
- `PHOTON_PROJECT_ID/SECRET/WEBHOOK_SECRET` — Spectrum credentials
- `DATABASE_URL` — TigerData / Postgres connection string (empty = embedded PGlite)
- `SESSION_TTL_DAYS` — auto-delete sessions after N days (default 30)

See [DEMO.md](./DEMO.md) for the 3-minute demo script and [PRIVACY.md](./PRIVACY.md) for data storage details.

---

## ScamShield UI + Voice (Photon SMS Feature)

A T-Life feature extension that brings Hiya Spam Blocker's capabilities into T-Mobile's existing ScamShield.

### Run

Any static server works:

    python -m http.server 5173

then open http://localhost:5173. Start the backend in `server/` first (see Backend below).

### Feature map (Hiya → T-Life ScamShield)

| Hiya feature | In this app | Tier |
|---|---|---|
| Caller ID | Protection > Caller ID toggle | Free |
| Block spam before it rings | Protection > Scam Block toggle | Free |
| Report spam numbers | Report tile, activity detail, post-call | Free |
| AI voice & deepfake detection | Protection toggle + in-call alert card | Premium |
| In-call fraud detection | Protection toggle + in-call alert card | Premium |
| Call Screener | Protection toggle + screening transcript | Premium |
| Family setup | Family protection + per-line chips | Free |

ScamShield Premium is priced at $4/mo per line.

### Backend (server/)

Node 24, Hono, `pg`, Gemini (`@google/genai`), TigerData (TimescaleDB).

```bash
cd server
npm install
npm run migrate      # creates tables, hypertable, continuous aggregate, retention policy
npm run seed         # loads lines, reputation and 30 days of call events
npm start            # http://localhost:8787
```

Config lives in `server/.env`: `DATABASE_URL`, `GEMINI_API_KEY`, `PHOTON_*`, `TWILIO_*`.

### Protect / Train / Adapt

- **Protect**: caller ID, Scam Block, Call Screener, in-call fraud alerts, repeat-caller voice alerts
- **Train (Scam Academy, `drill.html`)**: opt-in AI-written practice scams over iMessage with difficulty levels, Scam Survival Score
- **Adapt**: what Protect sees feeds `/api/insights`, recommending Academy lessons and showing a "Threats we're seeing" card

### Photon (messaging)

Uses Spectrum SDK (`spectrum-ts`). Credentials: `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET`. Inbound texts arrive on the stream (no webhook). `DEMO_PHONE` maps your real phone to Anne's line (`DEMO_LINE_ID`).

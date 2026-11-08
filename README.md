# Safe Signal — Education Branch

HackUTD 2026 · T-Mobile "Safe Signal" challenge · Photon track

Protect customers from scams through interactive practice sessions delivered over iMessage/SMS.

## Quick start

```bash
# Prerequisites: Node 20+, pnpm 9+
pnpm install

# Configure environment
cp .env.example .env
# Fill in: ANTHROPIC_API_KEY (or OPENAI_API_KEY), BASE_URL, PHOTON_* keys

# Seed demo data
pnpm seed

# Start server (port 3000)
pnpm dev:server

# Start mobile app (Expo Go)
pnpm dev:mobile

# Run detection evaluation
pnpm eval
```

## Architecture

```
apps/
  server/        Hono + Node.js — conversation engine, webhooks, link tracking, API
  mobile/        React Native + Expo Router — T-Life shell with Learn tab
packages/
  shared/        Types, Zod schemas, detection module, 12 scenario JSONs, eval harness
```

## Server API

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

## Environment variables

See `.env.example` for the full list. Key variables:

- `LLM_PROVIDER` — `anthropic` (default) or `openai`
- `DEMO_MODE=true` — short timeouts, no Photon required
- `PHOTON_PROJECT_ID/SECRET/WEBHOOK_SECRET` — Spectrum credentials
- `SESSION_TTL_DAYS` — auto-delete sessions after N days (default 30)

## Demo

See [DEMO.md](./DEMO.md) for the 3-minute demo script.

## Privacy

See [PRIVACY.md](./PRIVACY.md) for data storage, redaction, and retention details.

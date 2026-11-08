# Privacy Policy — Safe Signal (Education Branch)

## What we store

| Data | Purpose | Retention |
|------|---------|-----------|
| Phone number (hashed in prod) | Route practice messages | Until opt-out |
| Consent record (channel, interests, timestamp, version) | Proof of consent; enforce opt-out | Until opt-out |
| Scenario ID, session state, outcome | Power the Learn screen | 30 days (TTL) |
| **Scammer** message text | Replay in Learn screen | 30 days (TTL) |
| **User** message text | **Redacted before storage** — only red-flag categories and engagement patterns are kept, never the raw text | 30 days (TTL) |
| Skill stats per red-flag category | Skills summary on Learn home | Until opt-out |

## What we do NOT store

- Real credentials (passwords, card numbers, SSNs, OTPs) — these trigger an immediate reveal and are redacted before any write
- Raw user message text — only a category description (e.g. "you sent a short reply") is recorded
- Location, device identifiers, or browsing history
- Any real T-Mobile account data

## Redaction

All user message text passes through `redact()` before being written to the database or logs. The function replaces:

- Card numbers → `[CARD_NUMBER]`
- SSNs → `[SSN]`
- Phone numbers → `[PHONE]`
- Email addresses → `[EMAIL]`
- Street addresses → `[ADDRESS]`
- ZIP codes → `[ZIP]`
- Verification codes (6 digits) → `[CODE]`
- Bank account numbers → `[ACCOUNT]`

## Automatic deletion

A TTL cleanup job runs every hour and permanently deletes session records (messages + session row) older than `SESSION_TTL_DAYS` (default: 30). Skill stats aggregates are kept until opt-out but contain no PII — only category scores.

## Opt-out

Sending `STOP PRACTICE` immediately:
1. Deactivates the user's consent record
2. Ends any active session
3. Sends a confirmation message
4. No further practice messages are sent

## Webhook security

Photon webhooks are verified using the **Standard Webhooks** signature scheme (`HMAC-SHA256` over `webhook-id.webhook-timestamp.rawBody`) before any payload is processed.

## Secrets

All secrets (API keys, webhook signing secrets) are read from environment variables and never committed to source control. See `.env.example` for the full list.

## Synthetic data only

No real customer data is used anywhere in this system. Practice conversations use fictional brands (ParcelGo, TollPass, Northline Bank, NextStep Careers) and synthetic seed data.

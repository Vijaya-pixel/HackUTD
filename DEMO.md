# Safe Signal — 3-Minute Demo Script

## Prerequisites

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env and fill in your keys
cp .env.example .env
# Set: ANTHROPIC_API_KEY, BASE_URL (ngrok URL for Photon), PHOTON_PROJECT_ID/SECRET/WEBHOOK_SECRET

# 3. Seed demo data
pnpm seed

# 4. Start the server
pnpm dev:server

# 5. Start the mobile app (Expo Go)
pnpm dev:mobile
```

---

## 0:00 — Opt in (30 sec)

1. Open the T-Life app in Expo Go
2. Tap the **Learn** tab → "Get Protected" → **Start Scam Practice**
3. Show the consent screen — plain language, opt-out instructions
4. Select interests: **Package Delivery**, **Mobile Account**
5. Choose channel: **iMessage**
6. Tap **Enable Practice**

> **Talking point:** "Consent is timestamped and versioned. The user controls everything — quiet hours, frequency, opt-out at any time."

---

## 0:30 — Practice scam arrives (45 sec)

1. Tap **Send me a practice now** (demo button on Learn home)
2. Show the iMessage thread on the demo phone — the ParcelGo opener arrives:
   > *"PARCELGO: Your package could not be delivered. Pay $3.50 redelivery fee: [link]"*
3. Reply: **"Ok how do I pay?"**
4. The scammer agent escalates — show the reply

> **Talking point:** "The AI stays in character, escalates through scripted stages, and every message is validated by our safety filter before it sends."

---

## 1:15 — User taps the link (30 sec)

1. Tap the practice link in iMessage
2. The reveal page loads: "🛑 This was a Safe Signal practice scam"
3. The app deep-links open — T-Life goes to the **Lesson screen**

> **Talking point:** "The link is a unique token on our own domain. Clicking it records `clicked_at`, sends a reveal in-thread, and deep-links back to the app."

---

## 1:45 — Lesson screen walkthrough (45 sec)

Walk through each section:

1. **Header** — outcome + non-shaming message ("It happens to everyone — here's what to watch for")
2. **Replay** — conversation bubbles, red flags highlighted in pink. Tap a highlight → one-line explanation.
   - Show: "24-hour deadline creates artificial pressure"
   - Show: "Link doesn't match official parcelgo.com domain"
3. **Your key mistakes** — "Replied to an unknown sender", "Engaged with a payment request"
4. **What you did well** — "You kept your replies brief"
5. **Rule to remember** — LLM-generated, specific to this scenario
6. **Protect yourself now** — tap "Turn on Scam Block" → dials `#662#`

> **Talking point:** "The lesson is generated from the actual conversation. We only describe user messages by category — never quote them verbatim."

---

## 2:30 — Detection metrics (30 sec)

Switch to terminal:

```bash
pnpm eval
```

Show the output table:

```
 Method      Precision  Recall  F1      FPR
─────────────────────────────────────────────
 Rules only  XX.X%      XX.X%   XX.X%   X.X%
```

> **Talking point:** "Our detection pipeline uses fast regex rules plus an LLM classifier. We evaluate on 220 labeled messages including hard negatives — real OTPs you requested, real delivery confirmations — to track false positive rate."

---

## Key judge talking points

| Criterion | What to highlight |
|-----------|------------------|
| **Creativity** | Practice mode — learn by doing, not reading |
| **Impact** | Targets older adults; large tap targets, plain language, non-shaming |
| **Usability** | One tap from iMessage to full lesson; no app switch required until reveal |
| **Security & Privacy** | Redaction pipeline, Standard Webhooks signature verification, TTL cleanup, no real data |
| **Detection quality** | Precision/recall table; honest "suspicious" label when layers disagree |
| **Photon integration** | iMessage delivery, webhook verification, SimulatorChannel for offline demo |

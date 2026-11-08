# Detonate — implementation plan

Tap-time protection for links. When a customer taps a link from a text (or forwards one),
the page is opened first in a disposable cloud browser, rendered the way a phone would see it,
analyzed in 2–3 seconds, and the customer gets a **Verdict Card** before their phone ever loads
the page. Afterwards the system knows who else tapped the same thing and can reach them.

This document is the build plan. Nothing here is implemented yet. It assumes only the code that
exists on `Education_feature` (Hono server, Drizzle on TigerData/PGlite, shared detection module,
test UI). It does **not** assume any other feature from earlier brainstorming (no shared
"Checkpoint" engine, no passphrase scheme, no guardian flow, no call features). Where an optional
hook to the existing practice feature exists it is marked *optional*.

---

## 1. Scope

**In (demo-able in one build day):**

1. `GET /d/:token` resolver — rewrite-and-redirect endpoint. Every link we hand out (and any
   link a user forwards) is wrapped as `${BASE_URL}/d/<token>`. Tapping it runs the pipeline and
   shows the Verdict Card page; "Continue anyway" proceeds to the real destination.
2. `POST /api/detonate` — analyze an arbitrary URL (from the share-sheet / forward path / test UI).
3. **Sandbox render** — headless Chromium (Playwright) with a mobile UA + viewport, screenshot,
   DOM extraction, redirect chain, final URL, TLS/cert facts.
4. **Analysis signals** → the four engine dials (identity, origin trust, campaign match, intent).
5. **Verdict Card** — HTML page (and JSON) with: what it is, two evidence lines, confidence in
   words + number, next steps (1–3 buttons), and a "Wrong?" appeal.
6. **Census** — hypertable of taps; "N people tapped this today, M reached the card form".
7. **Exposure response** — if the user proceeds past a card/credential form (or reports after
   the fact), one tap fires the matching response checklist and queues outreach to other tappers.
8. **Evaluation harness** — 60 synthetic phish pages + 40 legitimate pages, precision / recall /
   abstain / time-to-verdict, reported on an architecture page.
9. **Test UI tab** — build-a-phish templates, tap, see the card, see the census.

**Out (say so in the pitch):** real SMS link rewriting at a carrier (simulated: our links are
already ours), iMessage/WhatsApp interception (share-sheet / forward path instead), encrypted-DNS and
in-app-browser bypass. The sandbox egresses from wherever the server runs.

---

## 2. Where it lives

```
apps/server/src/
  detonate/
    pipeline.ts          runDetonate(input) → DetonateResult   (orchestrates everything below)
    sandbox.ts           render(url, opts) → RenderResult      (Playwright; pool of warm pages)
    signals/
      domain.ts          domain age/registrar/TLD, punycode, lookalike distance to brand registry
      redirects.ts       redirect chain, shorteners, cross-origin hops, final-vs-claimed host
      tls.ts             cert issuer, age, SAN mismatch, HTTP-only
      brand.ts           brand match (title/logo text/colors/DOM fingerprints) vs brand registry
      forms.ts           credential / card / OTP / SSN field detection, action target host
      kits.ts            known phishing-kit fingerprints (DOM/JS/text hashes), cloaking signal
      content.ts         page text → shared detection rules + LLM classifier (reuse)
    scoring.ts           signals → four dials + label + abstain + reasons
    card.ts              buildVerdictCard(result, user) → VerdictCard (JSON) + renderCardHtml()
    census.ts            recordTap / summarizeLink / findOtherTappers
    exposure.ts          buildExposureResponse(result) → steps[]; queueOutreach()
    brands.json          brand registry (name, official domains, colors, logo text, aliases)
  routes/
    detonate.ts          GET /d/:token, POST /api/detonate, POST /api/detonate/:id/decision,
                         POST /api/detonate/:id/appeal, GET /api/detonate/:id, GET /api/census/:linkHash
packages/shared/src/
  detonate/types.ts      DetonateInput/Result, Signals, Dials, VerdictCard, Decision, Appeal
  detonate/schemas.ts    Zod schemas for the routes
  eval/detonate/         pages/ (synthetic phish + legit HTML), dataset.jsonl, evaluate.ts
apps/server/public/
  test-ui.html           new "Detonate" tab
  kits/                  phishing-kit templates served locally for the demo (brand × pretext)
docs/
  detonate-plan.md       (this file)
  detonate-architecture.md  one-page diagram + numbers for judges (written at the end)
```

Reuse, do not rewrite: `runRules` and `classifyWithLLM` (`packages/shared/src/detection`) for page
text; `redact()` for anything stored; `createLLMClient()`; the `/p/:token` pattern in
`routes/redirect.ts` as the template for `/d/:token`; the `users` table only to attach a tap to a
known user when one is logged in (anonymous use must work).

---

## 3. Data model (Postgres / TigerData)

Add to `apps/server/src/db/schema.ts` and `client.ts` MIGRATIONS. `link_taps` is the second
hypertable (the census is a time series by construction).

```sql
-- One row per distinct destination we have analyzed. link_hash = sha256(normalized final URL).
CREATE TABLE IF NOT EXISTS links (
  link_hash        TEXT PRIMARY KEY,
  first_seen_at    TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL,
  claimed_brand    TEXT,                 -- what the page pretends to be (nullable)
  final_host       TEXT NOT NULL,
  label            TEXT NOT NULL,        -- 'phish' | 'suspicious' | 'likely_safe' | 'abstain'
  confidence       REAL NOT NULL,
  dials_json       TEXT NOT NULL,        -- {identity, originTrust, campaignMatch, intentRisk}
  reasons_json     TEXT NOT NULL,
  campaign_id      TEXT,                 -- cluster id (kits.ts / content similarity)
  screenshot_path  TEXT,                 -- local file or object key; never the HTML itself
  analysis_version TEXT NOT NULL         -- bump when scoring changes → re-analyze on next tap
);

-- Wrapped tokens handed to users (practice links, forwards, demo kits).
CREATE TABLE IF NOT EXISTS detonate_tokens (
  token        TEXT PRIMARY KEY,
  target_url   TEXT NOT NULL,
  link_hash    TEXT,                     -- filled after first analysis
  created_for  TEXT REFERENCES users(id), -- nullable (anonymous forward)
  source       TEXT NOT NULL,            -- 'practice' | 'forward' | 'share' | 'demo_kit'
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

-- Hypertable. One row per tap/analysis event.
CREATE TABLE IF NOT EXISTS link_taps (
  id            TEXT NOT NULL,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  link_hash     TEXT NOT NULL,
  user_id       TEXT,                    -- NULL when anonymous; see privacy rules
  token         TEXT,
  verdict       TEXT NOT NULL,           -- label at tap time
  confidence    REAL NOT NULL,
  latency_ms    INTEGER NOT NULL,
  decision      TEXT,                    -- 'blocked' | 'continued' | 'reported' | NULL (undecided)
  reached_form  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id, ts)
);
SELECT create_hypertable('link_taps', 'ts', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_link_taps_link ON link_taps(link_hash, ts DESC);
CREATE INDEX IF NOT EXISTS idx_link_taps_user ON link_taps(user_id, ts DESC);

-- Appeals ("Wrong?") and exposure responses.
CREATE TABLE IF NOT EXISTS appeals (
  id TEXT PRIMARY KEY, link_hash TEXT NOT NULL, user_id TEXT, note TEXT,
  status TEXT NOT NULL DEFAULT 'open',   -- open | upheld | overturned
  created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS exposure_events (
  id TEXT PRIMARY KEY, tap_id TEXT NOT NULL, user_id TEXT NOT NULL,
  exposure_types_json TEXT NOT NULL,     -- ["card","password","otp"]
  steps_json TEXT NOT NULL,              -- checklist with done flags
  outreach_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

Census queries (TigerData):

```sql
SELECT count(*) taps, count(*) FILTER (WHERE reached_form) reached_form,
       count(DISTINCT user_id) people
FROM link_taps WHERE link_hash = $1 AND ts > now() - interval '24 hours';

SELECT time_bucket('15 minutes', ts) b, count(*) FROM link_taps
WHERE link_hash = $1 AND ts > now() - interval '24 hours' GROUP BY b ORDER BY b;
```

Privacy rules baked into the schema (see §8): `link_taps.user_id` is written only when the
verdict is `phish`/`suspicious` **or** the user continued past a card; `likely_safe` taps are stored
with `user_id = NULL`. Raw HTML is never stored; a screenshot is kept only for non-safe verdicts.

---

## 4. Pipeline (`detonate/pipeline.ts`)

```ts
export async function runDetonate(input: {
  url: string; userId?: string; token?: string; source: TapSource;
}): Promise<DetonateResult>
```

Stages, with time budget (target ≤ 3.0 s p50, hard cap 6 s then **abstain**):

| # | Stage | Budget | Notes |
|---|-------|--------|-------|
| 0 | Normalize + cache | 5 ms | Resolve `token → target_url`. Compute pre-redirect hash. If `links` has a row with the same `analysis_version` seen < 1 h ago, reuse (skip render). |
| 1 | Static signals (parallel) | 300 ms | `domain.ts` (registrable domain, age via RDAP lookup with 1.5 s timeout → unknown, punycode, digit/hyphen entropy, brand-lookalike edit distance), `redirects.ts` HEAD/GET chain without JS (max 8 hops), `tls.ts` (issuer, notBefore age, SAN vs host, plain HTTP). |
| 2 | Sandbox render | 1500 ms | Playwright, warm browser pool (2 contexts), iPhone UA + 390×844 viewport, JS on, `waitUntil: 'domcontentloaded'` + 600 ms settle. Capture: final URL, full-page screenshot (JPEG q60), `document.title`, visible text (`innerText`, capped 20 KB), forms (fields, types, autocomplete, action host), external script hosts, favicon hash. Block downloads, popups, geolocation, media. |
| 3 | Content signals (parallel) | 800 ms | `brand.ts` (title/text/favicon/color palette vs `brands.json`), `forms.ts` (password / card / OTP / SSN / DOB fields; action host ≠ page host), `kits.ts` (DOM-shape hash + distinctive strings → campaign id; cloaking = render text ≪ static fetch text or blank body), `content.ts` → `runRules` + `classifyWithLLM` on page text (LLM has a 1.2 s timeout; absence is fine). |
| 4 | Score | 5 ms | `scoring.ts` → dials, label, confidence, reasons, abstain. |
| 5 | Persist + census | 20 ms | Upsert `links`, insert `link_taps`, compute census summary. |
| 6 | Card | 5 ms | `card.ts` → VerdictCard JSON (+ HTML for `/d/:token`). |

Failure policy: any stage error → that signal is `unknown`, never a crash. Render timeout or
blocked destination → label `abstain`, card says "we could not check this page in time" with
"Open in safe view" (screenshot only) and "Continue anyway". Abstains are counted and reported.

---

## 5. Signals → four dials (`scoring.ts`)

Detonate's own scoring, self-contained. Four sub-scores ("dials"), each 0..1 (1 = bad) with its
own evidence list, so the card can explain *why*. **Never collapse them silently.**

| Dial | Inputs | Key rule |
|------|--------|----------|
| **Identity confidence** (inverted: 1 = cannot establish who this is) | brand match score, domain ∈ brand's official domains?, lookalike distance, punycode, cert SAN mismatch | **Brand match alone is never a verdict.** `phish` requires `brandMatch ≥ 0.6 AND domain ∉ brandDomains`. A page that looks like NorthlineBank on northlinebank.com scores identity ≈ 0. |
| **Origin trust** | domain age (< 30 d high risk; unknown = 0.4), free/abused TLDs, shortener in chain, > 2 cross-origin hops, plain HTTP, cert issued < 7 d, bulletproof/abused hosting ASN list (small static list) | Purely infrastructural; works even when content is cloaked. |
| **Campaign match** | `kits.ts` cluster hit (DOM-shape hash, kit strings), census volume in last 24 h, same final host seen under ≥ 3 different first-hop domains | This is the "seen 3,200 times today" line. Cold start: 0 with reason "no prior sightings". |
| **Intent risk** | forms (card/password/OTP/SSN) weighted, action host ≠ page host, urgency/payment rules from `runRules` on page text, LLM classifier label, download/APK prompt | "What is this page trying to make you do". |

Label:

```
score = 0.35*identity + 0.20*originTrust + 0.20*campaignMatch + 0.25*intentRisk
phish        if score ≥ 0.65 AND identity-rule above satisfied (or intentRisk ≥ 0.8 with originTrust ≥ 0.5)
likely_safe  if score ≤ 0.25 AND no credential form on an off-brand domain
abstain      if render failed/timed out, OR dials disagree hard (e.g. identity ≥ 0.7 but originTrust ≤ 0.1
             AND campaignMatch = 0 AND brand is a *verified* domain) → route to "safe view"
suspicious   otherwise
```

Confidence shown to the user = calibrated score (fit a simple isotonic/binned mapping on the eval
set; store the bins in `scoring.ts`), and in words: "almost certain / likely / unsure".

---

## 6. Verdict Card (`card.ts`)

JSON (also what the mobile app will render):

```ts
interface VerdictCard {
  id: string;                      // tap id
  label: 'phish' | 'suspicious' | 'likely_safe' | 'abstain';
  headline: string;                // "This page is pretending to be NorthlineBank"
  evidence: [string, string];      // exactly two plain-English lines
  confidence: { value: number; words: 'almost certain' | 'likely' | 'unsure' };
  dials: { identity: number; originTrust: number; campaignMatch: number; intentRisk: number };
  census: { taps24h: number; reachedForm24h: number; people24h: number } | null;
  tell: string;                    // one plain-English sentence: what gave it away
  nextSteps: Array<{ id: 'block'|'continue'|'safe_view'|'report'|'verify_brand'; label: string; href?: string }>;
  screenshotUrl: string | null;
  appealUrl: string;
}
```

HTML for `/d/:token` reuses the dark T-Life styling in `routes/redirect.ts`: screenshot with the
detected form outlined in magenta (we have element bounding boxes from the render), headline, two
evidence lines, confidence pill, buttons. Buttons POST to `/api/detonate/:id/decision`
(`continue` returns a 302 to the real URL; `block` records and shows the tell; `report` files 7726
text + appeal; `safe_view` shows the screenshot only).

`likely_safe` card is one line and auto-continues after 1.5 s ("Checked. Looks like the real
ntta.org.") — protection should be invisible when nothing is wrong.

---

## 7. Census + exposure response

`census.ts`
- `recordTap(result, {userId, token, latencyMs})` → `link_taps` insert (respecting the user_id rule).
- `summarizeLink(linkHash)` → the two SQL queries in §3.
- `findOtherTappers(linkHash, since)` → distinct user_ids with `decision='continued' OR reached_form`.

`exposure.ts`
- `POST /api/detonate/:id/decision {decision:'continued'}` marks the tap; when the page had a
  card/credential/OTP form, create an `exposure_events` row with steps derived from the form types:
  `card` → lock card / call issuer script; `password` → reset at the *real* brand domain (link from
  `brands.json`); `otp` → "do not share codes, change password now"; `ssn` → credit freeze walkthrough;
  always → "forward the text to 7726" and "tell someone".
- `queueOutreach(linkHash)` → for every other tapper who continued, send via the existing
  `MessagingChannel` (SimulatorChannel in demo; Photon when configured):
  "Safe Signal: a link you tapped at 9:14 today was a fake NTTA toll page that collects card
  numbers. 300 people tapped it. If you typed anything, here is what to do: <deep link>".
  Message is templated, never model-generated, and links back to the in-app card so the user can
  verify it came from us.

---

## 8. Privacy by design (write this into `PRIVACY.md` when implementing)

- Store `sha256(normalized final URL)` plus the final host; never the full raw URL of a *safe* tap.
- `likely_safe` taps: no `user_id`, no screenshot, no page text. 24-hour aggregate counts only.
- Non-safe taps: `user_id` kept 30 days (reuse `SESSION_TTL_DAYS` purge job → extend
  `purgeExpiredSessions` to `link_taps`, `appeals`, screenshots).
- Page text passes through `redact()` before the LLM sees it (phish pages echo victims' data).
- Screenshots live under `data/screenshots/<link_hash>.jpg` (gitignored), served only through
  `/api/detonate/:id/screenshot` to the user who tapped.
- "What we kept" endpoint: `GET /api/privacy/:userId` returns every Detonate row about the user
  with the rule that produced it; `DELETE` works.
- Verdict Cards are served only at `/d/` or in-app, never pushed as message content, so a text
  claiming to be a Safe Signal verdict is by definition not one.

---

## 9. Optional: integration with the existing practice (education) feature

Detonate works standalone. If the team wants the two features to share one link path:

- `startSession` currently builds `${BASE_URL}/p/${token}`. Change practice links to
  `${BASE_URL}/d/${token}` with a `detonate_tokens` row (`source='practice'`, `target_url` =
  the old `/p/:token` reveal URL). The practice phish page is itself a synthetic kit page, so the
  user sees a **real Verdict Card** on a practice scam before the reveal: education and protection
  are the same screen. The reveal page then adds the lesson.
- `Lesson.tell` ← `VerdictCard.tell`; `skills_stats` gets a `suspicious_link_or_sender` increment
  when the user hits **Block** on a card (caught) or **Continue** (fell).
- The practice scenarios' `brand` values (ParcelGo, NorthlineBank, TollPass, NextStep, T-Mobile)
  are the first entries of `brands.json`, with the fictional official domains already assumed by
  `rules.ts` (`parcelgo.com`, `northlinebank.com`, ...).

---

## 10. Evaluation harness (`packages/shared/src/eval/detonate/`)

- `pages/phish/*.html` — 60 synthetic kit pages generated from 6 brands × 5 pretexts × 2 variants
  (card form, password form, OTP relay, "download app", lookalike domain served from our own
  host under paths that mimic domains: the harness maps `pages/phish/ntta-tollpay-01.html` to a
  fake host via Playwright `page.route()` so domain signals exercise properly).
- `pages/legit/*.html` — 40 pages: real-looking login pages on the brands' *official* fictional
  domains, newsletters, package-tracking pages, two with urgency language but no forms (false-positive traps).
- `dataset.jsonl` — `{id, path, host, label, expected: {hasCredentialForm, brand}}`.
- `evaluate.ts` — runs `runDetonate` over all 100, prints precision, recall, F1 per label,
  abstain rate, p50/p95 latency, confusion matrix, and writes `docs/detonate-eval.json`.
- Red-team pass (`mutate.ts`): paraphrase text, swap brand colors, move the form into an iframe,
  add a cloaking check (`navigator.userAgent` not mobile → blank body), use a shortener hop.
  Report recall before/after. This is the "detection quality" slide.

Targets to beat before demo: precision ≥ 0.9 on `phish`, recall ≥ 0.85, false-positive rate on
legit ≤ 5 %, abstain ≤ 10 %, p50 latency ≤ 3 s.

---

## 11. Dependencies and environment

`apps/server/package.json`:
- `playwright` (Chromium only: `npx playwright install chromium`, ~150 MB; add to README setup and
  to a `postinstall` guarded by `DETONATE_ENABLED`). Fallback if install is blocked on a machine:
  `puppeteer-core` + system Chrome via `CHROME_PATH`.
- `tldts` (registrable domain / TLD parsing), `sharp` (screenshot resize/annotate) — optional,
  Playwright can clip and we can draw the outline client-side with CSS from bounding boxes instead.
- RDAP for domain age: plain `fetch('https://rdap.org/domain/<domain>')` with 1.5 s timeout; no
  key needed. Unknown → neutral.

`.env.example` additions:
```
DETONATE_ENABLED=true
DETONATE_RENDER_TIMEOUT_MS=1500
DETONATE_TOTAL_TIMEOUT_MS=6000
DETONATE_SCREENSHOT_DIR=./data/screenshots
DETONATE_ALLOW_PRIVATE_HOSTS=false   # true only for the eval harness / local kit pages
DETONATE_EGRESS_LABEL=lab            # shown on the architecture page: 'carrier' in production
```

Safety of the sandbox itself: block navigation to private IP ranges and `localhost` unless
`DETONATE_ALLOW_PRIVATE_HOSTS=true`; disable downloads; one context per analysis, closed in
`finally`; 2 concurrent renders max (queue beyond that, abstain if queue wait > 2 s).

---

## 12. Build order (one day, two people on Detonate, two on the rest)

| Step | Owner | Hours | Done when |
|------|-------|-------|-----------|
| 1 | A | 0.5 | Types + Zod schemas in `packages/shared/src/detonate`; tables + migrations; `brands.json` with the 5 fictional brands + 5 real ones (USPS, FedEx, NTTA, Chase, T-Mobile) |
| 2 | A | 1.5 | `sandbox.ts` renders a local kit page: screenshot, text, forms, redirect chain, final URL. Warm pool. Timeouts enforced. |
| 3 | B | 1.5 | `signals/domain.ts`, `redirects.ts`, `tls.ts`, `forms.ts`, `brand.ts` as pure functions with unit tests on fixtures (no browser needed). |
| 4 | A+B | 1.0 | `scoring.ts` + `pipeline.ts`; `POST /api/detonate` returns a result for a kit page and for a legit page. |
| 5 | B | 1.0 | `card.ts` + `GET /d/:token` HTML; decision endpoint; `continue` redirects. |
| 6 | A | 1.0 | `census.ts` on the `link_taps` hypertable; card shows census; `exposure.ts` steps + outreach through `MessagingChannel`. |
| 7 | B | 1.0 | Test UI "Detonate" tab: kit template picker (brand × pretext), "send to demo phone", tap → card, census panel, appeal. |
| 8 | A | 1.5 | Eval harness + dataset + red-team mutations; numbers into `docs/detonate-architecture.md`. |
| 9 | B | 0.5 | *Optional:* practice links routed through `/d/` (§9); `skills_stats` wiring. Skip if the practice feature is not being shipped. |
| 10 | both | 0.5 | Privacy endpoint + PRIVACY.md section; README setup for Playwright. |

Cut order if behind: red-team mutations → RDAP domain age (use static heuristics) → outreach
automation (make it a button) → screenshot annotation (show plain screenshot) → `kits.ts`
clustering (campaign dial from census volume only).

Never cut: the sandbox render, the identity rule (brand match + domain ownership), the card, the
eval numbers.

---

## 13. Demo script (90 s, no live telephony)

1. Judge picks a brand and pretext in the test UI, gets a phishing page hosted by us, and
   sends the wrapped link to the demo phone (Simulator in demo mode; Photon iMessage when configured).
2. Tap → 2–3 s → Verdict Card: screenshot with the card form outlined, "This page is pretending to
   be NTTA and wants your card number. Real NTTA is ntta.org." Confidence 0.92, "almost certain".
3. Judge taps **Continue anyway**, types a fake card into the kit page → exposure response card:
   lock card, reset at the real domain, forward to 7726, tell someone.
4. Census panel: "1,200 taps, 300 reached the form today" (synthetic tappers seeded into
   `link_taps`); **Notify them** → outreach text lands on the second demo phone.
5. Architecture page: pipeline, four dials, confusion matrix, abstain rate, red-team before/after.

Lines to say: "we judge what the page *does*, not whether its domain is on a list, so zero-hour
pages are caught", "the model never scores, it explains", "we tell the other 300 people before
they know".

---

## 14. Open questions to settle before coding

- Playwright install size on hackathon Wi-Fi — pre-download `chromium` the night before.
- Anonymous forwards (no `userId`): full card, no census attribution, no exposure follow-up unless
  the user opts in on the card. Current plan: yes, anonymous works end to end.
- Census seed data: generate ~1,500 synthetic taps across 6 links over the last 24 h in `seed.ts`
  so the time_bucket chart is not empty on first run.
- Whether to keep screenshots at all for `suspicious` (currently yes, 30 days) — privacy reviewer's call.

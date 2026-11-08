# ScamShield for T-Life

A scam-protection feature for the T-Mobile T-Life app. It does four things:

- **Spots scam calls.** Caller ID, Scam Block, a reverse number lookup, and alerts during a call.
- **Screens unknown callers.** It asks who is calling, then rings you with a summary.
- **Teaches people to spot scams.** The Learn tab is a game with a pet called Buddy.
- **Sends practice scam texts.** Users opt in, and the texts arrive over iMessage.

## What you need

- Node.js 22 or newer
- A free TigerData (Postgres) database
- Optional: a Gemini API key, for smarter scam detection
- Optional: Twilio and Deepgram accounts, for real phone calls
- Optional: a Photon project, for real text messages

The app works without the optional services. It falls back to built-in rules and simulated calls.

## Run it

```bash
cd server
npm install
cp .env.example .env
```

Open `server/.env` and paste your database link into `DATABASE_URL`. Add any optional keys you have.

```bash
npm run migrate
npm run seed
npm start
```

Open http://localhost:8787. The server runs the backend and serves the app.

## Try it

- **Home:** your bill, ScamShield stats and quick actions.
- **Services > ScamShield:** turn protections on or off. Simulate a scam call, an AI voice call or a screened call.
- **Learn:** tap a cloud and Buddy flies there. Each cloud is a short scam minigame. Wins give Buddy energy and earn weekly T-Mobile points.

## Real calls (optional)

1. Add your Twilio and Deepgram keys to `server/.env`.
2. Start a tunnel in a second terminal: `ngrok http 8787`.
3. Run `npm run tunnel-setup`, then restart the server.
4. Call your Twilio number. ScamShield answers, interviews the caller and forwards the call to you.

## Real text messages (optional)

1. Add `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET` to `server/.env`.
2. Set `DEMO_PHONE` to your phone number.
3. Text the project's iMessage number once from that phone.
4. Turn on scam practice in the Learn tab and pick "Text my phone".

## Project layout

| Path | What it is |
|---|---|
| `index.html`, `styles.css` | The app shell and styles |
| `app.js` | Screens, navigation and call handling |
| `game.js`, `buddy.js`, `buddy3d.js` | The Learn game, Buddy and the 3D mascot |
| `server/src/` | The API, scam detection, calls, texts and the practice engine |
| `server/migrations/` | Database tables |
| `server/scenarios/` | Practice scam scripts |

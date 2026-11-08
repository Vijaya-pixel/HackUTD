# Safe Signal (HackUTD · T-Mobile challenge)

Real-time scam call protection that runs on a real iPhone.

- **Before the call:** the phone says "This call may be recorded or monitored for fraud protection."
- **During the call:** the mic streams audio to our server. It transcribes speech live and pops an alert as soon as scam tactics show up: what to say (black), what to do (red), and a "Let T-Mobile handle it" button.
- **Voice ID:** each sentence becomes a voiceprint (256 numbers). If it matches a reported scammer, the alert names them and lists the other numbers they've called from.
- **After the call:** handoff saves the voice and number to the database and sends an iMessage alert through Photon.

Speech-to-text and voice ID run locally with [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). No audio is stored or sent to third parties.

## Setup (once)

Requires Node 24+ and [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

```powershell
npm install
npm run models      # downloads ~80 MB of speech models into ./models
```

## Run

Terminal 1:

```powershell
npm start
```

Terminal 2:

```powershell
npm run tunnel
```

Open the `https://….trycloudflare.com` link it prints on the iPhone in Safari. The iPhone needs HTTPS to use the mic. Optional: Share → Add to Home Screen.

Pages:

- `/` is the phone app.
- `/voices.html` is the scam voice database. You can record new voices there.
- `/caller.html` is the scam call player. Open it on a laptop so it plays a scammer out loud.

## Demo script

1. iPhone: caller ID `469-555-0142`, then **Simulate incoming call**, then **Accept**.
2. Laptop: open `/caller.html` and play **IRS gift card scam** near the iPhone. Or have a teammate act it out.
3. When the alert pops, tap **Let T-Mobile handle it**.
4. iPhone: caller ID `214-555-0199`, accept, and have the **same voice** say a different script. It shows "Known scam caller voice" right away.
5. Show `/voices.html`: one scammer, two numbers, one recognition.

## Photon iMessage alerts

Set `PHOTON_PROJECT_ID` (`pho_prj_…`), `PHOTON_API_KEY`, and `PHOTON_ALERT_RECIPIENT` in `.env`. Text the assigned Photon line once from the recipient phone, then restart.

## AI voice detection

The caller's speech (silence removed) is scored in ~4 s windows by [Spectra-AASIST3](https://huggingface.co/Limitless-8/spectra-aasist3-int8-audio-deepfake). After 2+ windows agree (median ≥ `AI_VOICE_THRESHOLD`, default 0.85), the customer sees "This voice sounds AI-generated" and can tap **Flag as AI caller**. That saves the voice with a 🤖 AI voice tag, and future calls show "Uses an AI voice" at ring time.

To test, the scammer phone has **🤖 AI voice** mode. It says the script lines into the call with Kokoro neural TTS (clips are cached in `data/tts`).

Local results: Windows TTS and Kokoro voices scored 0.84–1.00. 4 of 5 real recordings scored 0.00, but an old broadcast recording scored 0.99. Treat it as a hint, which is how the app words it.

## Tuning

`VOICE_MATCH_THRESHOLD` (default `0.7`). In tests with synthetic voices, the same voice on a new number scored 0.87–0.95 and a different voice scored up to 0.66. Real voices through a speakerphone may need about 0.6. Check the percentages shown in the app.

## Code map

| File | What it does |
| - | - |
| `server/speech.js` | Streaming speech-to-text + speaker embeddings (sherpa-onnx) |
| `server/voicedb.js` | SQLite: profiles, voiceprints, numbers used, later matches |
| `server/detector.js` | Explainable scam signals → score, category, advice |
| `server/photon.js` | iMessage alert via `@photon-ai/api` |
| `server/index.js` | Express API + WebSocket audio stream |
| `public/mic.js`, `pcm-worklet.js` | Mic capture at 16 kHz, streamed to the server |
| `public/app.js` | Phone UI |

## Limits

- iOS doesn't let apps hear phone calls. In this demo the iPhone listens through its mic, with the call on speaker or someone talking. A real product would run this on T-Mobile's network.
- The mic hears both people on the call. Voiceprints come from sentences with scam signals, which are almost always the scammer.
- The tunnel URL is public but random. Stop the tunnel when you're done.

import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { analyzeTranscript } from "./detector.js";
import { CallSession, embed, modelsReady, warmUp, SAMPLE_RATE } from "./speech.js";
import * as voices from "./voicedb.js";
import { sendAlert, photonConfigured } from "./photon.js";
import { AiVoiceTracker, aiModelReady, warmUpAi } from "./aivoice.js";
import { clip, pregenerate, ttsReady, AI_VOICES } from "./tts.js";
import { SCENARIOS } from "../public/scenarios.js";
import * as drillDb from "./drilldb.js";
import { drillDbConfigured } from "./drilldb.js";
import { runDrill, landingPage, startListening } from "./drill.js";

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static(fileURLToPath(new URL("../public/", import.meta.url))));

const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const MAX_CALL_SECONDS = 20 * 60;
const MIN_SEGMENT_SECONDS = 1.5;
const RING_TIMEOUT_MS = 45_000;

// Analyzed calls (live and recently ended). Holds text and voiceprints, never audio.
const calls = new Map();

const sendJson = (ws, msg) => ws && ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

// ---------- Analysis pipeline (shared by phone calls, mic tests, enrollment) ----------
function createAnalyzedCall({ number, mode, notify }) {
  const call = {
    id: randomUUID(),
    mode,
    number: voices.normalizeNumber(number),
    notify,
    finals: [],
    partial: "",
    segments: [],
    voiceMatch: null,
    voiceChecks: 0,
    analysis: null,
    lastKey: "",
    samples: 0,
    result: null,
    endedAt: null,
    aiVoice: null,
    flaggedProfileId: null,
  };
  call.ai = mode === "call"
    ? new AiVoiceTracker((r) => {
      call.aiVoice = r;
      call.notify({ type: "aivoice", ...r });
      analyze(call);
    })
    : null;
  call.session = new CallSession({
    onPartial: (text) => {
      call.partial = text;
      call.notify({ type: "partial", text });
      analyze(call);
    },
    onFinal: (text, audio) => {
      call.partial = "";
      call.finals.push(text);
      call.notify({ type: "final", text, flagged: analyzeTranscript(text).signals.length > 0 });
      call.ai?.addSpeech(audio);
      const seconds = audio.length / SAMPLE_RATE;
      if (seconds >= MIN_SEGMENT_SECONDS) {
        const embedding = embed(audio);
        if (embedding) {
          call.segments.push({ embedding, seconds, text });
          checkVoice(call, embedding);
        }
      }
      analyze(call);
    },
    onEarlyAudio: (audio) => checkVoice(call, embed(audio)),
  });
  calls.set(call.id, call);
  return call;
}

function analyze(call) {
  if (call.mode !== "call") return;
  const text = [...call.finals, call.partial].join(" ");
  const a = analyzeTranscript(text, { voiceMatch: call.voiceMatch?.matched ? call.voiceMatch : null, aiVoice: call.aiVoice });
  call.analysis = a;
  const key = `${a.score}|${a.level}|${a.category.id}|${a.summary}`;
  if (key !== call.lastKey) {
    call.lastKey = key;
    call.notify({ type: "analysis", ...a });
  }
}

function checkVoice(call, embedding) {
  if (!embedding) return;
  const r = voices.search(embedding);
  call.voiceChecks++;
  if (r.matched) {
    if (call.voiceMatch && r.similarity <= call.voiceMatch.similarity) return;
    const newProfile = call.voiceMatch?.profile?.id !== r.profile.id;
    if (newProfile && call.mode === "call") voices.logMatch(r.profile.id, call.number, r.similarity);
    call.voiceMatch = { ...r, profile: voices.getProfile(r.profile.id) };
    call.notify({ type: "voice", status: "match", similarity: r.similarity, profile: call.voiceMatch.profile });
    analyze(call);
  } else if (!call.voiceMatch) {
    call.notify({ type: "voice", status: "nomatch", similarity: r.similarity, checks: call.voiceChecks });
  }
}

// Audio arrives as 16 kHz mono Int16 PCM.
function toFloat32(data) {
  const i16 = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
  return f32;
}

function feed(call, data) {
  if (!call?.session || data.byteLength % 2 !== 0) return;
  if (call.samples > MAX_CALL_SECONDS * SAMPLE_RATE) return finishAnalysis(call);
  const samples = toFloat32(data);
  call.samples += samples.length;
  call.session.accept(samples);
}

function finishAnalysis(call) {
  if (!call?.session) return;
  try {
    call.session.finish();
  } catch (e) {
    console.error("finish failed", e);
  }
  call.session = null;
  call.endedAt = Date.now();
}

// ---------- Switchboard for phone-to-phone calls ----------
// One customer line (the iPhone running the Safe Signal app). Scammer phones dial it.
let customer = null;
const callers = new Set();
const phoneCalls = new Map(); // ws -> phone call (both participants map to the same object)

function broadcastLineStatus() {
  for (const c of callers) sendJson(c, { type: "line", online: Boolean(customer), busy: Boolean(customer && phoneCalls.has(customer)) });
}

function dial(ws, number) {
  if (phoneCalls.has(ws)) return;
  if (!customer) return sendJson(ws, { type: "dial-failed", reason: "The customer phone is offline. Open the customer link and tap Go online." });
  if (phoneCalls.has(customer)) return sendJson(ws, { type: "dial-failed", reason: "The customer is on another call." });
  const pc = { id: randomUUID(), caller: ws, customer, number: voices.normalizeNumber(number), display: str(number, 32), state: "ringing", call: null };
  phoneCalls.set(ws, pc);
  phoneCalls.set(customer, pc);
  pc.timer = setTimeout(() => endPhone(pc, "no-answer"), RING_TIMEOUT_MS);
  sendJson(customer, { type: "incoming", number: pc.display, lookup: voices.lookupNumber(pc.number) });
  sendJson(ws, { type: "ringing" });
  broadcastLineStatus();
}

function answer(ws) {
  const pc = phoneCalls.get(ws);
  if (!pc || pc.customer !== ws || pc.state !== "ringing") return;
  clearTimeout(pc.timer);
  pc.state = "active";
  pc.call = createAnalyzedCall({ number: pc.number, mode: "call", notify: (m) => sendJson(pc.customer, m) });
  sendJson(pc.customer, { type: "connected", callId: pc.call.id });
  sendJson(pc.caller, { type: "connected" });
}

function endPhone(pc, reason) {
  if (pc.state === "ended") return;
  pc.state = "ended";
  clearTimeout(pc.timer);
  finishAnalysis(pc.call); // flush the last sentence before telling the customer
  phoneCalls.delete(pc.caller);
  phoneCalls.delete(pc.customer);
  sendJson(pc.customer, { type: "ended", reason, callId: pc.call?.id || null });
  sendJson(pc.caller, { type: "ended", reason });
  broadcastLineStatus();
}

function relay(ws, data) {
  const pc = phoneCalls.get(ws);
  if (!pc || pc.state !== "active") return false;
  const peer = ws === pc.caller ? pc.customer : pc.caller;
  if (peer.readyState === peer.OPEN && peer.bufferedAmount < 512 * 1024) peer.send(data, { binary: true });
  if (ws === pc.caller) feed(pc.call, data); // only the caller's voice is analyzed
  return true;
}

// ---------- WebSocket ----------
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1 << 20 });

wss.on("connection", (ws) => {
  let local = null; // single-device mic test or voice enrollment

  function stopLocal() {
    if (!local) return;
    finishAnalysis(local);
    sendJson(ws, { type: "stopped", callId: local.id, segments: local.segments.length, seconds: Math.round(local.segments.reduce((s, x) => s + x.seconds, 0)) });
    local = null;
  }

  ws.on("message", (data, isBinary) => {
    try {
      if (isBinary) {
        if (!relay(ws, data) && local) feed(local, data);
        return;
      }
      const msg = JSON.parse(data.toString());
      switch (msg.type) {
        case "register": // customer iPhone goes online
          if (customer && customer !== ws) sendJson(customer, { type: "replaced" });
          customer = ws;
          sendJson(ws, { type: "registered" });
          broadcastLineStatus();
          break;
        case "hello-caller":
          callers.add(ws);
          broadcastLineStatus();
          break;
        case "dial":
          dial(ws, str(msg.number, 32));
          break;
        case "answer":
          answer(ws);
          break;
        case "decline":
        case "hangup": {
          const pc = phoneCalls.get(ws);
          if (pc) endPhone(pc, msg.type === "decline" ? "declined" : ws === pc.caller ? "caller-hung-up" : "customer-hung-up");
          break;
        }
        case "handoff": {
          const pc = phoneCalls.get(ws);
          if (pc && ws === pc.customer) endPhone(pc, "transferred");
          break;
        }
        case "start": // single-device: listen through this phone's mic
          stopLocal();
          local = createAnalyzedCall({ number: str(msg.number, 32), mode: msg.mode === "enroll" ? "enroll" : "call", notify: (m) => sendJson(ws, m) });
          sendJson(ws, { type: "started", callId: local.id });
          break;
        case "stop":
          stopLocal();
          break;
      }
    } catch (e) {
      console.error("ws message error", e);
      sendJson(ws, { type: "error", message: "Server could not process that" });
    }
  });

  ws.on("close", () => {
    stopLocal();
    const pc = phoneCalls.get(ws);
    if (pc) endPhone(pc, "disconnected");
    callers.delete(ws);
    if (customer === ws) customer = null;
    broadcastLineStatus();
  });
});

// ---------- REST ----------
app.get("/api/status", (_req, res) => {
  res.json({ photon: photonConfigured ? "configured" : "simulated", models: modelsReady, aiDetector: aiModelReady, aiVoices: ttsReady, threshold: voices.MATCH_THRESHOLD, customerOnline: Boolean(customer) });
});

// Voiceprints to store for a reported call: prefer sentences that contained
// scam signals (those are certainly the scammer talking).
function pickSamples(call) {
  const scammy = call.segments.filter((s) => analyzeTranscript(s.text).signals.length > 0);
  return (scammy.length ? scammy : call.segments).map((s) => ({ embedding: s.embedding, seconds: s.seconds }));
}

// "Let T-Mobile handle it" and "Report this caller".
app.post("/api/handoff", async (req, res) => {
  const call = calls.get(str(req.body.callId, 64));
  if (!call || call.mode !== "call") return res.status(404).json({ error: "Call not found" });
  if (call.result) return res.json(call.result);
  finishAnalysis(call);

  const a = call.analysis || analyzeTranscript(call.finals.join(" "));
  const saved = voices.report({
    profileId: call.voiceMatch?.profile?.id || call.flaggedProfileId,
    items: pickSamples(call),
    number: call.number,
    scamType: call.voiceMatch?.profile?.scamType || a.category.name,
  });

  if (saved) call.flaggedProfileId = saved.profile.id; // a later "flag as AI" updates the same caller
  const last4 = call.number.replace(/\D/g, "").slice(-4) || "????";
  const lines = [
    "🛡️ T-Mobile Safe Signal",
    `We stopped a likely scam call (${a.category.name}, ${Math.round(a.score * 100)}% confidence) from a number ending in ${last4}.`,
    a.summary && a.summary !== "Nothing unusual so far." ? `The caller: ${a.summary}` : "",
    call.voiceMatch ? `This voice was already reported as ${call.voiceMatch.profile.label}, calling from other numbers.` : "",
    call.aiVoice?.status === "likely" ? `The voice sounded AI-generated (${Math.round(call.aiVoice.probability * 100)}%). Scammers use voice cloning to sound like real people.` : "",
    "Don't call this number back. If you shared any info, call your bank using the number on your card and change any passwords you gave out.",
  ].filter(Boolean);
  const photon = await sendAlert(lines.join("\n"));

  call.result = { voiceprint: saved, photon, analysis: a };
  res.json(call.result);
});

// "Flag as AI caller": the customer chooses to save this voice as an AI-voice
// caller. Works mid-call; the call keeps going.
app.post("/api/flag-ai", (req, res) => {
  const call = calls.get(str(req.body.callId, 64));
  if (!call || call.mode !== "call") return res.status(404).json({ error: "Call not found" });
  const items = pickSamples(call);
  if (!items.length) return res.status(400).json({ error: "Not enough speech yet to save this voice." });
  const saved = voices.report({
    profileId: call.voiceMatch?.profile?.id || call.flaggedProfileId,
    items,
    number: call.number,
    scamType: call.analysis?.level !== "safe" && call.analysis?.category.name ? call.analysis.category.name : "AI voice caller",
    aiVoice: true,
  });
  call.flaggedProfileId = saved.profile.id;
  res.json(saved);
});

// AI voice clips for the scammer phone. Only the built-in script lines can be
// spoken, so this can't be used as a general text-to-speech service.
const AI_SCRIPTS = SCENARIOS.filter((s) => s.id !== "safe").map((s) => ({
  id: s.id,
  title: s.title,
  lines: s.lines.filter((l) => l.who === "caller").map((l) => l.text),
}));

app.get("/api/ai-scripts", (_req, res) => res.json({ ready: ttsReady, voices: Object.keys(AI_VOICES), scripts: AI_SCRIPTS }));

app.get("/api/tts/:script/:line", async (req, res) => {
  const s = AI_SCRIPTS.find((x) => x.id === req.params.script);
  const text = s?.lines[Number(req.params.line)];
  if (!text) return res.status(404).json({ error: "Unknown line" });
  try {
    const pcm = await clip(text, str(req.query.voice, 20) || "michael");
    res.type("application/octet-stream").send(pcm);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/api/voices", (_req, res) => res.json(voices.listProfiles()));

// Enroll a voice recorded on the database page.
app.post("/api/voices/enroll", (req, res) => {
  const call = calls.get(str(req.body.callId, 64));
  if (!call || call.mode !== "enroll") return res.status(404).json({ error: "Recording not found" });
  if (call.session) return res.status(409).json({ error: "Stop the recording first" });
  const items = call.segments.map((s) => ({ embedding: s.embedding, seconds: s.seconds }));
  if (!items.length) return res.status(400).json({ error: "Not enough speech. Record at least 3 seconds of talking." });
  const saved = voices.report({
    profileId: str(req.body.profileId, 40) || undefined,
    items,
    number: str(req.body.number, 32),
    scamType: str(req.body.scamType, 80) || "Suspicious call",
    label: str(req.body.label, 60) || undefined,
    source: "enroll",
  });
  calls.delete(call.id);
  res.json(saved);
});

app.patch("/api/voices/:id", (req, res) => {
  const p = voices.updateProfile(str(req.params.id, 40), {
    label: str(req.body.label, 60),
    scamType: str(req.body.scamType, 80),
    aiVoice: typeof req.body.aiVoice === "boolean" ? req.body.aiVoice : undefined,
  });
  return p ? res.json(p) : res.status(404).json({ error: "Not found" });
});

app.delete("/api/voices/:id", (req, res) => {
  voices.deleteProfile(str(req.params.id, 40));
  res.json({ ok: true });
});

app.post("/api/voices/reset", (_req, res) => {
  voices.resetAll();
  res.json({ ok: true });
});

// ---------- Scam drill (educational phishing simulation) ----------
// Admin endpoints need the x-admin-key header to match DRILL_ADMIN_KEY.
// Without that env var they stay off, because the public tunnel would expose them.
const adminOnly = (req, res, next) => {
  const key = process.env.DRILL_ADMIN_KEY;
  if (!key) return res.status(503).json({ error: "Set DRILL_ADMIN_KEY in .env to enable the drill API" });
  if (req.get("x-admin-key") !== key) return res.status(401).json({ error: "Unauthorized" });
  if (!drillDbConfigured) return res.status(503).json({ error: "Set DATABASE_URL in .env" });
  next();
};
const drillError = (res, e) => { console.error("drill error", e); res.status(500).json({ error: "Drill request failed" }); };

// Add or update a participant. consent must be true for them to ever get a text.
app.post("/api/drill/users", adminOnly, async (req, res) => {
  const handle = str(req.body.handle, 80);
  const name = str(req.body.name, 80);
  if (!handle || !name) return res.status(400).json({ error: "handle and name are required" });
  const prefs = req.body.preferences && typeof req.body.preferences === "object" ? req.body.preferences : {};
  try {
    res.json(await drillDb.upsertUser({ handle, name, preferences: prefs, consent: req.body.consent === true }));
  } catch (e) { drillError(res, e); }
});

// Preview by default. Pass { "dryRun": false } to actually send.
app.post("/api/drill/send", adminOnly, async (req, res) => {
  try {
    res.json(await runDrill({ handle: str(req.body.handle, 80) || undefined, dryRun: req.body.dryRun !== false }));
  } catch (e) { drillError(res, e); }
});

app.get("/api/drill/results", adminOnly, async (_req, res) => {
  try { res.json(await drillDb.results()); } catch (e) { drillError(res, e); }
});

// Public: the link inside the drill text. Collects nothing, teaches the red flags.
app.get("/d/:token", async (req, res) => {
  try {
    const html = drillDbConfigured ? await landingPage(str(req.params.token, 40)) : null;
    html ? res.type("html").send(html) : res.status(404).send("Not found");
  } catch (e) { console.error("landing error", e); res.status(500).send("Error"); }
});

// Forget ended calls after 30 minutes.
setInterval(() => {
  for (const [id, c] of calls) if (c.endedAt && Date.now() - c.endedAt > 30 * 60e3) calls.delete(id);
}, 60e3).unref();

const port = Number(process.env.PORT) || 3000;
if (modelsReady) warmUp();
warmUpAi();
if (ttsReady) pregenerate(AI_SCRIPTS.flatMap((s) => s.lines)); // background, cached on disk
startListening(); // real-time scam-drill replies via Spectrum
server.listen(port, () => {
  console.log(`AI voice detector: ${aiModelReady ? "ready" : "missing"} · AI voice clips: ${ttsReady ? "ready" : "missing"}`);
  console.log(`Safe Signal running at http://localhost:${port}`);
  console.log(`Speech models: ${modelsReady ? "loaded" : "MISSING, run: npm run models"}`);
  console.log(`Photon alerts: ${photonConfigured ? "configured" : "simulated (set PHOTON_* in .env)"}`);
  console.log("Customer phone: /   Scammer phone: /scammer.html   (use the https tunnel URL)");
});

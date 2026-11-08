// Customer phone. Receives calls from the scammer phone through the server,
// or (test mode) listens through this phone's own mic.
import { createAudioContext, Mic, Player, Sounds, wsUrl } from "./mic.js";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === "class" ? (n.className = v) : n.setAttribute(k, v);
  for (const c of kids) if (c !== null && c !== undefined && c !== "") n.append(c instanceof Node ? c : String(c));
  return n;
}
async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const WORDING = {
  calm: { scam: "This sounds like a scam", suspicious: "Something seems off", voice: "Same voice as" },
  casual: { scam: "Bruh, this might be a scammer 🚩", suspicious: "Hmm, kinda fishy 🐟", voice: "We've heard this voice before:" },
};
const RANK = { safe: 0, suspicious: 1, scam: 2 };

const S = {
  tone: localStorage.getItem("tone") || "calm",
  ctx: null, mic: null, player: null, sounds: null, ws: null,
  online: false,
  call: null,
};

// ---------- Lock screen ----------
function tick() {
  const d = new Date();
  $("lock-time").textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M/i, "");
  $("lock-date").textContent = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}
tick();
setInterval(tick, 10_000);

function show(v) {
  document.querySelectorAll(".view").forEach((x) => x.classList.toggle("active", x.id === `v-${v}`));
}

$("scammer-url").textContent = `${location.origin}/scammer.html`;
$("btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(`${location.origin}/scammer.html`);
    $("btn-copy").textContent = "Copied";
  } catch {
    $("btn-copy").textContent = "Select it";
  }
  setTimeout(() => ($("btn-copy").textContent = "Copy"), 1500);
});

function setTone(t) {
  S.tone = t;
  localStorage.setItem("tone", t);
  document.querySelectorAll("#tone button").forEach((b) => b.classList.toggle("on", b.dataset.tone === t));
}
setTone(S.tone);
$("tone").addEventListener("click", (e) => {
  const t = e.target.closest("button")?.dataset.tone;
  if (t) setTone(t);
});

function setLine(text, on) {
  $("w-status").classList.toggle("on", on);
  $("w-status-text").textContent = text;
}

// ---------- Going online: unlock audio, open mic, connect to the switchboard ----------
async function ensureAudio() {
  if (S.ctx) {
    if (S.ctx.state !== "running") await S.ctx.resume().catch(() => { });
    return;
  }
  S.ctx = createAudioContext(); // inside the tap (iOS)
  S.sounds = new Sounds(S.ctx);
  S.player = new Player(S.ctx);
  S.mic = new Mic(S.ctx, { voiceCall: true });
  await S.mic.start();
  S.mic.onChunk = (pcm) => {
    const c = S.call;
    if (!c || !c.streaming || S.ws?.readyState !== WebSocket.OPEN) return;
    S.ws.send(pcm.buffer);
  };
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl());
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "register" }));
      resolve();
    };
    ws.onerror = () => reject(new Error("Can't reach the Safe Signal server"));
    ws.onclose = () => {
      if (S.ws !== ws) return;
      S.online = false;
      setLine("Reconnecting…", false);
      if (S.call && !S.call.ended) endLocally("Call Failed");
      setTimeout(() => connect().catch(() => setLine("Offline. Tap Go online.", false)), 2000);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") {
        if (S.call?.kind === "phone" && S.call.connected) S.player.play(e.data);
        return;
      }
      try { onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); }
    };
    S.ws = ws;
  });
}

$("btn-online").addEventListener("click", async () => {
  const btn = $("btn-online");
  btn.disabled = true;
  btn.textContent = "Connecting…";
  try {
    await ensureAudio();
    await connect();
    try { S.wake = await navigator.wakeLock?.request("screen"); } catch { /* optional */ }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Go online";
    $("w-help").textContent = e.message;
  }
});

function send(msg) {
  if (S.ws?.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg));
}

// ---------- Server messages ----------
function onMessage(m) {
  const c = S.call;
  switch (m.type) {
    case "registered":
      S.online = true;
      setLine("Online · protecting your calls", true);
      $("btn-online").textContent = "Online";
      $("w-help").textContent = "Keep this screen open. Calls from the scammer phone ring here.";
      break;
    case "replaced":
      setLine("Another phone took over this line", false);
      S.ws?.close();
      break;
    case "incoming":
      if (S.call && !S.call.ended) return;
      ring({ kind: "phone", number: m.number, lookup: m.lookup });
      break;
    case "connected":
      if (c?.kind === "phone") onConnected(m.callId);
      break;
    case "started": // test mode
      if (c?.kind === "local") c.callId = m.callId;
      break;
    case "ended":
      if (c?.kind === "phone" && !c.ended) onPhoneEnded(m);
      break;
    case "stopped":
      break;
    case "partial":
    case "final":
      if (c && !c.ended) captions(m.text, m.type === "partial");
      break;
    case "voice":
      if (c && !c.ended) onVoice(m);
      break;
    case "aivoice":
      if (c) {
        c.aiVoice = m;
        if (!c.ended && c.analysis) renderCard(c.analysis);
      }
      break;
    case "analysis":
      if (c && !c.ended) onAnalysis(m);
      break;
  }
}

// ---------- Ringing ----------
function newCall(fields) {
  return { analysis: null, voice: null, aiVoice: null, aiFlagged: null, alertLevel: null, ended: false, connected: false, streaming: false, callId: null, startedAt: null, handedOff: false, ...fields };
}

function ring({ kind, number, lookup }) {
  S.call = newCall({ kind, number, lookup });
  $("in-number").textContent = number;
  renderAi($("in-ai"), lookupLine(lookup), lookup?.known ? (lookup.reported ? "scam" : "suspicious") : "safe");
  show("incoming");
  S.sounds?.ringtone();
  navigator.vibrate?.([400, 300, 400]);
}

function lookupLine(lookup) {
  if (!lookup?.known) return { text: "No reports for this number. Safe Signal will screen the call." };
  const ai = lookup.aiVoice ? "Uses an AI voice. " : "";
  return lookup.reported
    ? { who: `Maybe: ${lookup.label}`, text: `${ai}Reported ${lookup.reports}× for ${lookup.scamType.toLowerCase()}.` }
    : { who: `Maybe: ${lookup.label}`, text: `${ai}This number was linked to a reported scam voice.` };
}

function renderAi(node, { who, text }, level = "safe") {
  node.className = `ai-line ${level}`;
  node.replaceChildren(el("span", { class: "dot" }), el("span", {}, who ? el("span", { class: "who" }, `${who} · `) : "", text));
}

$("btn-test").addEventListener("click", async () => {
  try {
    await ensureAudio();
    if (!S.ws || S.ws.readyState !== WebSocket.OPEN) await connect();
  } catch (e) {
    $("w-help").textContent = e.message;
    return;
  }
  ring({ kind: "local", number: $("test-number").value.trim() || "Unknown", lookup: null });
});

$("btn-decline").addEventListener("click", () => {
  const c = S.call;
  S.sounds?.stop();
  if (c?.kind === "phone") send({ type: "decline" });
  S.call = null;
  show("home");
});

$("btn-accept").addEventListener("click", async () => {
  const c = S.call;
  if (!c) return;
  S.sounds.stop();
  await S.ctx.resume().catch(() => { });
  $("c-number").textContent = c.number;
  $("c-timer").textContent = "connecting…";
  $("c-card").classList.add("hidden");
  $("c-captions").textContent = "";
  renderAi($("c-ai"), lookupLine(c.lookup), c.lookup?.known ? "scam" : "safe");
  show("call");
  if (c.kind === "phone") send({ type: "answer" });
  else {
    send({ type: "start", mode: "call", number: c.number });
    onConnected(null);
  }
});

async function onConnected(callId) {
  const c = S.call;
  c.callId = callId || c.callId;
  c.connected = true;
  c.startedAt = Date.now();
  c.timer = setInterval(() => {
    const s = Math.floor((Date.now() - c.startedAt) / 1000);
    $("c-timer").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 500);
  $("c-timer").textContent = "00:00";
  // Both phones play the notice before anyone's voice is analyzed.
  $("c-captions").textContent = "🔊 “This call may be recorded or monitored for fraud protection.”";
  await speak("This call may be recorded or monitored for fraud protection.");
  if (c.ended) return;
  $("c-captions").textContent = "";
  c.streaming = true;
  if (!c.analysis && !c.lookup?.known) renderAi($("c-ai"), { text: "Safe Signal is listening. Nothing unusual so far." });
}

function speak(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return setTimeout(resolve, 2500);
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    u.onend = fin;
    u.onerror = fin;
    setTimeout(fin, 6000);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

// ---------- During the call ----------
function captions(text, live) {
  const n = $("c-captions");
  n.textContent = `“${text}”`;
  n.classList.toggle("live", live);
}

function onVoice(m) {
  const c = S.call;
  if (m.status !== "match") return;
  c.voice = m;
  updateAiLine();
  if (c.analysis) renderCard(c.analysis);
}

function onAnalysis(a) {
  const c = S.call;
  c.analysis = a;
  updateAiLine();
  if (a.level === "safe") return;
  if (RANK[a.level] > (RANK[c.alertLevel] ?? 0)) {
    c.alertLevel = a.level;
    S.sounds?.chime();
    navigator.vibrate?.([120, 60, 120]);
  }
  renderCard(a);
}

function updateAiLine() {
  const c = S.call;
  const a = c.analysis;
  const who = c.voice ? `Maybe: ${c.voice.profile.label}` : c.lookup?.known ? `Maybe: ${c.lookup.label}` : null;
  const text = a ? a.summary : "Nothing unusual so far.";
  const level = a && a.level !== "safe" ? a.level : who ? "suspicious" : "safe";
  renderAi($("c-ai"), { who, text }, level);
}

function renderCard(a) {
  const c = S.call;
  const w = WORDING[S.tone];
  $("k-pct").textContent = `${Math.round(a.score * 100)}% ${a.level === "scam" ? "likely scam" : "suspicious"}`;
  $("k-title").textContent = a.level === "scam" ? w.scam : w.suspicious;
  $("k-say").textContent = `“${a.advice.say}”`;
  $("k-do").textContent = a.advice.do;
  $("k-why").replaceChildren(...a.signals.slice(0, 4).map((s) =>
    el("li", {}, s.label, s.evidence ? " " : "", s.evidence ? el("q", {}, s.evidence) : "")));

  // AI-generated voice hint, with an optional "flag" the customer chooses.
  const ai = c.aiVoice;
  const aiRow = $("k-ai");
  if (ai && (ai.status === "likely" || ai.status === "checking")) {
    const pct = Math.round(ai.probability * 100);
    $("k-ai-text").textContent = ai.status === "likely"
      ? `🤖 This voice sounds AI-generated (${pct}%). Bad phone lines can fool this, so treat it as a hint.`
      : `🤖 Might be an AI voice (${pct}%). Still checking…`;
    const b = $("btn-flag-ai");
    b.classList.toggle("hidden", ai.status !== "likely");
    if (c.aiFlagged) {
      b.disabled = true;
      b.textContent = `Flagged · ${c.aiFlagged}`;
    } else if (!b.dataset.busy) {
      b.disabled = false;
      b.textContent = "Flag as AI caller";
    }
    aiRow.classList.remove("hidden");
  } else {
    aiRow.classList.add("hidden");
  }
  const v = $("k-voice");
  if (c.voice) {
    const p = c.voice.profile;
    const others = p.numbers.map((n) => n.number).filter((n) => n.replace(/\D/g, "").slice(-10) !== c.number.replace(/\D/g, "").slice(-10));
    v.textContent = `🎙️ ${w.voice} ${p.label} (${Math.round(c.voice.similarity * 100)}% match). Reported ${p.reports}×${others.length ? `, also called from ${others.join(", ")}` : ""}.`;
    v.classList.remove("hidden");
  } else {
    v.classList.add("hidden");
  }
  $("c-card").classList.remove("hidden");
}

async function flagAi(button) {
  const c = S.call;
  if (!c?.callId || c.aiFlagged) return;
  button.disabled = true;
  button.dataset.busy = "1";
  button.textContent = "Flagging…";
  try {
    const r = await api("/api/flag-ai", { callId: c.callId });
    c.aiFlagged = r.profile.label;
    button.textContent = `Flagged · ${r.profile.label}`;
  } catch (e) {
    button.disabled = false;
    button.textContent = e.message.length > 40 ? "Try again" : e.message;
  }
  delete button.dataset.busy;
}
$("btn-flag-ai").addEventListener("click", (e) => flagAi(e.currentTarget));

$("btn-why").addEventListener("click", () => {
  const why = $("k-why");
  why.classList.toggle("hidden");
  $("btn-why").textContent = why.classList.contains("hidden") ? "Why?" : "Less";
});

$("key-mute").addEventListener("click", () => {
  if (!S.mic) return;
  S.mic.muted = !S.mic.muted;
  $("key-mute").classList.toggle("on", S.mic.muted);
});
$("key-speaker").addEventListener("click", () => {
  if (!S.player) return;
  const loud = S.player.gain.gain.value < 2;
  S.player.gain.gain.value = loud ? 3 : 1.4;
  $("key-speaker").classList.toggle("on", loud);
});

// ---------- Ending ----------
$("btn-end").addEventListener("click", () => hangUp());
$("btn-handoff").addEventListener("click", () => handoff());

function stopCallState(c) {
  c.ended = true;
  c.streaming = false;
  c.connected = false;
  clearInterval(c.timer);
  speechSynthesis?.cancel();
  c.durationMs = c.startedAt ? Date.now() - c.startedAt : 0;
}

// Ends a test-mode call and waits for the server to flush the last sentence.
function stopLocal() {
  return new Promise((resolve) => {
    const prev = S.ws.onmessage;
    const t = setTimeout(done, 3000);
    function done() {
      clearTimeout(t);
      S.ws.onmessage = prev;
      resolve();
    }
    S.ws.onmessage = (e) => {
      prev(e);
      if (typeof e.data === "string" && JSON.parse(e.data).type === "stopped") done();
    };
    send({ type: "stop" });
  });
}

async function hangUp() {
  const c = S.call;
  if (!c || c.ended) return;
  if (c.kind === "phone") {
    c.hungUpByMe = true;
    send({ type: "hangup" }); // server answers with "ended"
    return;
  }
  stopCallState(c);
  await stopLocal();
  await showEnded("Call Ended");
  showSummary("hangup");
}

async function handoff() {
  const c = S.call;
  if (!c || c.ended) return;
  if (c.kind === "phone") {
    c.wantsHandoff = true;
    send({ type: "handoff" }); // server cuts the caller off, then sends "ended"
    return;
  }
  stopCallState(c);
  await stopLocal();
  runHandoff();
}

async function onPhoneEnded(m) {
  const c = S.call;
  stopCallState(c);
  c.callId = m.callId || c.callId;
  S.sounds?.hangup();
  if (!c.startedAt) {
    // Never answered: the caller gave up or it timed out.
    await showEnded(m.reason === "no-answer" ? "Missed Call" : "Call Ended");
    S.call = null;
    show("home");
    return;
  }
  if (m.reason === "transferred" || c.wantsHandoff) return runHandoff();
  await showEnded(m.reason === "disconnected" ? "Call Failed" : "Call Ended");
  showSummary(c.hungUpByMe ? "hangup" : "they-hung-up");
}

function endLocally(status) {
  const c = S.call;
  stopCallState(c);
  showEnded(status).then(() => showSummary("failed"));
}

async function showEnded(status) {
  $("e-number").textContent = S.call?.number || "";
  $("e-status").textContent = status;
  show("ended");
  await sleep(1300);
}

function row(text, sub, cls = "") {
  return el("div", { class: `row ${cls}` }, text, sub ? el("small", {}, sub) : "");
}

async function runHandoff() {
  const c = S.call;
  show("handoff");
  const steps = $("h-steps");
  steps.replaceChildren();
  $("h-msg").classList.add("hidden");
  $("h-msg-h").classList.add("hidden");
  const add = async (text, sub) => {
    const r = row(text, sub, "pending");
    steps.append(r);
    await sleep(350);
    r.classList.remove("pending");
  };

  await add("✅ Caller moved to the fraud protection line", "They heard that the call was transferred to T-Mobile.");
  if (!c.callId) return add("⚠️ Nothing was analyzed on this call", "No voiceprint was saved.");

  let r;
  try {
    r = await api("/api/handoff", { callId: c.callId });
  } catch (e) {
    return add("⚠️ Couldn't file the report", e.message);
  }
  c.handedOff = true;
  if (r.voiceprint) {
    const p = r.voiceprint.profile;
    await add(
      r.voiceprint.merged ? `✅ Added this number to ${p.label}` : `✅ Scam voice saved as ${p.label}`,
      `Numbers on file: ${p.numbers.map((n) => n.number).join(", ")}. Only voiceprints are kept, never audio.`,
    );
  } else {
    await add("ℹ️ No voiceprint saved", "The caller didn't speak long enough (need one sentence over 1.5s).");
  }
  await add(r.photon.status === "sent" ? "✅ iMessage alert sent" : "ℹ️ iMessage alert (simulated)", r.photon.status === "sent" ? "Check Messages." : r.photon.reason);
  $("h-msg").textContent = r.photon.text;
  $("h-msg").classList.remove("hidden");
  $("h-msg-h").classList.remove("hidden");
}

$("btn-to-summary").addEventListener("click", () => showSummary("handoff"));
$("btn-done").addEventListener("click", () => {
  S.call = null;
  show("home");
});

function showSummary(how) {
  const c = S.call;
  if (!c) return show("home");
  const a = c.analysis;
  const level = a?.level || "safe";
  const pct = a ? Math.round(a.score * 100) : 0;
  const secs = Math.round((c.durationMs || 0) / 1000);
  const verdict = { scam: `Likely scam · ${pct}%`, suspicious: `Suspicious · ${pct}%`, safe: "No scam signals" }[level];
  const howText = { handoff: "T-Mobile took over the call", hangup: "You hung up", "they-hung-up": "The caller hung up", failed: "The call dropped" }[how];

  const body = $("s-body");
  body.replaceChildren(
    el("h2", {}, c.number),
    el("p", { class: "sub" }, `${Math.floor(secs / 60)}m ${secs % 60}s · ${howText}`),
    el("div", { class: "group" },
      row(el("span", { class: `verdict ${level}` }, verdict), level === "safe" ? "We didn't hear anything that looked like a scam." : a.category.name),
      a && a.summary !== "Nothing unusual so far." ? row("What the caller did", a.summary) : null,
      c.voice ? row(`Voice matched ${c.voice.profile.label}`, `${Math.round(c.voice.similarity * 100)}% match`) : null,
      c.aiVoice?.status === "likely"
        ? row("🤖 Sounded like an AI voice", `${Math.round(c.aiVoice.probability * 100)}% from ${c.aiVoice.seconds}s of speech${c.aiFlagged ? ` · flagged as ${c.aiFlagged}` : ""}`)
        : null),
  );
  if (c.aiVoice?.status === "likely" && !c.aiFlagged && c.callId) {
    const fb = el("button", { class: "btn gray" }, "Flag Caller as AI Voice");
    fb.addEventListener("click", () => flagAi(fb));
    body.append(fb);
  }
  if (level !== "safe") {
    body.append(
      el("div", { class: "group-h" }, "Next steps"),
      el("div", { class: "group" },
        row("Don't call this number back"),
        row("Shared card or bank info?", "Call your bank using the number on your card."),
        row("Gave out a password or code?", "Change it now."),
        row("Report it", "reportfraud.ftc.gov · forward scam texts to 7726")),
    );
  } else {
    body.append(el("p", { class: "sub" }, "No audio or transcript from this call is saved."));
  }
  if (!c.handedOff && c.callId) {
    const b = el("button", { class: "btn danger" }, "Report Caller as Scam");
    b.addEventListener("click", async () => {
      b.disabled = true;
      b.textContent = "Reporting…";
      try {
        const r = await api("/api/handoff", { callId: c.callId });
        c.handedOff = true;
        b.textContent = r.voiceprint ? `Reported · saved as ${r.voiceprint.profile.label}` : "Reported";
      } catch (e) {
        b.textContent = e.message;
      }
    });
    body.append(b);
  }
  show("summary");
}

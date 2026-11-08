// Scammer phone: dials the customer through the Safe Signal server.
import { createAudioContext, Mic, Player, Sounds, wsUrl } from "./mic.js";
import { SCENARIOS } from "./scenarios.js";

const $ = (id) => document.getElementById(id);
const NUMBERS = ["+1 (469) 555-0142", "+1 (214) 555-0199", "+1 (972) 555-0177", "+1 (817) 555-0123"];

const S = { ctx: null, mic: null, player: null, sounds: null, ws: null, number: NUMBERS[0], state: "idle", streaming: false, online: false };

function show(v) {
  document.querySelectorAll(".view").forEach((x) => x.classList.toggle("active", x.id === `v-${v}`));
}

// ---------- Caller ID chips ----------
function renderNumbers() {
  const box = $("numbers");
  box.replaceChildren(...NUMBERS.map((n) => {
    const b = document.createElement("button");
    b.className = `chip ${n === S.number && !$("custom-number").value ? "on" : ""}`;
    b.textContent = n;
    b.addEventListener("click", () => {
      $("custom-number").value = "";
      S.number = n;
      renderNumbers();
    });
    return b;
  }));
}
$("custom-number").addEventListener("input", () => {
  if ($("custom-number").value.trim()) S.number = $("custom-number").value.trim();
  renderNumbers();
});
renderNumbers();

// ---------- Script ideas ----------
const scripts = SCENARIOS.filter((s) => s.id !== "safe");
function showScript(id) {
  S.scriptId = id;
  const s = scripts.find((x) => x.id === id);
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  $("script").replaceChildren(...s.lines.filter((l) => l.who === "caller").map((l) => Object.assign(document.createElement("li"), { textContent: l.text })));
}
$("tabs").replaceChildren(...scripts.map((s) => {
  const b = document.createElement("button");
  b.textContent = { irs: "IRS", repeat: "Bank fraud", grandkid: "Grandkid" }[s.id] || s.title;
  b.dataset.id = s.id;
  b.addEventListener("click", () => showScript(s.id));
  return b;
}));
showScript(scripts[0].id);

// ---------- Connection ----------
function setLine(text, on) {
  $("line").classList.toggle("on", on);
  $("line-text").textContent = text;
}

function connect() {
  const ws = new WebSocket(wsUrl());
  ws.binaryType = "arraybuffer";
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello-caller" }));
  ws.onclose = () => {
    setLine("Reconnecting…", false);
    if (S.state !== "idle") ended("disconnected");
    setTimeout(connect, 2000);
  };
  ws.onmessage = (e) => {
    if (typeof e.data !== "string") {
      if (S.state === "active") S.player?.play(e.data);
      return;
    }
    onMessage(JSON.parse(e.data));
  };
  S.ws = ws;
}
connect();

function send(msg) {
  if (S.ws?.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg));
}

function onMessage(m) {
  switch (m.type) {
    case "line":
      S.online = m.online;
      setLine(m.online ? (m.busy ? "Customer is on a call" : "Customer is online") : "Customer is offline (open the customer link, tap Go online)", m.online && !m.busy);
      break;
    case "dial-failed":
      S.sounds?.stop();
      S.state = "idle";
      show("dial");
      alert(m.reason);
      break;
    case "ringing":
      $("c-status").textContent = "ringing…";
      S.sounds.ringback();
      break;
    case "connected":
      onConnected();
      break;
    case "ended":
      ended(m.reason);
      break;
  }
}

// ---------- Calling ----------
$("btn-call").addEventListener("click", async () => {
  if (S.state !== "idle") return;
  try {
    if (!S.ctx) {
      S.ctx = createAudioContext(); // inside the tap (iOS)
      S.sounds = new Sounds(S.ctx);
      S.player = new Player(S.ctx);
      S.mic = new Mic(S.ctx, { voiceCall: true });
      await S.mic.start();
      S.mic.onChunk = (pcm) => {
        if (S.aiPlaying) return; // the AI voice is talking instead
        if (S.state === "active" && S.streaming && S.ws?.readyState === WebSocket.OPEN) S.ws.send(pcm.buffer);
      };
    } else {
      await S.ctx.resume();
    }
  } catch (e) {
    alert(e.message);
    return;
  }
  S.state = "dialing";
  $("c-status").textContent = "calling…";
  $("c-from").className = "ai-line";
  $("c-from").textContent = `Showing caller ID ${S.number}`;
  show("call");
  send({ type: "dial", number: S.number });
});

async function onConnected() {
  S.sounds.stop();
  S.state = "active";
  renderAiLines();
  S.startedAt = Date.now();
  S.timer = setInterval(() => {
    const s = Math.floor((Date.now() - S.startedAt) / 1000);
    $("c-status").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 500);
  // The scammer hears the monitoring notice too. Their mic stays off until it's done,
  // so the notice isn't mistaken for their voice.
  await speak("This call may be recorded or monitored for fraud protection.");
  if (S.state === "active") S.streaming = true;
}

// ---------- AI voice mode ----------
const VOICE_NAMES = { michael: "Michael (male)", adam: "Adam (male)", heart: "Heart (female)" };
S.voiceMode = "mine";
S.aiVoice = "michael";

$("voice-mode").addEventListener("click", (e) => {
  const mode = e.target.closest("button")?.dataset.mode;
  if (!mode) return;
  S.voiceMode = mode;
  document.querySelectorAll("#voice-mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  $("ai-voices").classList.toggle("hidden", mode !== "ai");
  $("ai-help").classList.toggle("hidden", mode !== "ai");
  $("script-h").textContent = mode === "ai" ? "Script (the AI voice will say these lines)" : "Script ideas (read them out loud)";
});

function renderAiVoices() {
  $("ai-voices").replaceChildren(...Object.entries(VOICE_NAMES).map(([id, name]) => {
    const b = document.createElement("button");
    b.className = `chip ${id === S.aiVoice ? "on" : ""}`;
    b.textContent = name;
    b.addEventListener("click", () => {
      S.aiVoice = id;
      renderAiVoices();
    });
    return b;
  }));
}
renderAiVoices();

function renderAiLines() {
  const box = $("ai-lines");
  box.classList.toggle("hidden", S.voiceMode !== "ai");
  if (S.voiceMode !== "ai") return;
  const tabs = document.createElement("div");
  tabs.className = "tabs";
  for (const s of scripts) {
    const t = document.createElement("button");
    t.textContent = { irs: "IRS", repeat: "Bank fraud", grandkid: "Grandkid" }[s.id] || s.title;
    t.classList.toggle("on", s.id === S.scriptId);
    t.addEventListener("click", () => {
      S.scriptId = s.id;
      renderAiLines();
    });
    tabs.append(t);
  }
  const s = scripts.find((x) => x.id === S.scriptId);
  const lines = s.lines.filter((l) => l.who === "caller").map((l) => l.text);
  box.replaceChildren(tabs, ...lines.map((text, i) => {
    const b = document.createElement("button");
    b.className = "ai-line-btn";
    b.textContent = `▶ ${text}`;
    b.addEventListener("click", () => playAiLine(s.id, i, b));
    return b;
  }));
}

async function playAiLine(scriptId, i, btn) {
  if (S.aiPlaying || S.state !== "active" || !S.streaming) return;
  const all = [...document.querySelectorAll(".ai-line-btn")];
  all.forEach((b) => (b.disabled = b !== btn));
  btn.classList.add("loading");
  let pcm;
  try {
    const res = await fetch(`/api/tts/${scriptId}/${i}?voice=${S.aiVoice}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "AI voice unavailable");
    pcm = new Int16Array(await res.arrayBuffer());
  } catch (e) {
    alert(e.message);
    all.forEach((b) => (b.disabled = false));
    btn.classList.remove("loading");
    return;
  }
  btn.classList.remove("loading");
  btn.classList.add("playing");
  S.aiPlaying = true;
  // Stream the clip into the call in real time, 100 ms at a time, and play it here too.
  for (let o = 0; o < pcm.length && S.state === "active"; o += 1600) {
    const chunk = pcm.slice(o, o + 1600);
    if (S.ws?.readyState === WebSocket.OPEN) S.ws.send(chunk.buffer);
    S.player.play(chunk.buffer.slice(0));
    await new Promise((r) => setTimeout(r, 100));
  }
  // A little silence so the customer's side marks the end of the sentence.
  for (let k = 0; k < 8 && S.state === "active"; k++) {
    if (S.ws?.readyState === WebSocket.OPEN) S.ws.send(new Int16Array(1600).buffer);
    await new Promise((r) => setTimeout(r, 100));
  }
  S.aiPlaying = false;
  btn.classList.remove("playing");
  all.forEach((b) => (b.disabled = false));
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
    setTimeout(fin, 8000);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

$("btn-end").addEventListener("click", () => {
  if (S.state === "idle") return show("dial");
  send({ type: "hangup" });
  ended("caller-hung-up");
});

function ended(reason) {
  if (S.state === "idle") return;
  const wasActive = S.state === "active";
  S.state = "idle";
  S.streaming = false;
  clearInterval(S.timer);
  S.sounds?.stop();
  speechSynthesis.cancel();

  const notice = $("e-notice");
  notice.classList.add("hidden");
  if (reason === "transferred") {
    $("e-status").textContent = "Call Transferred";
    notice.textContent = "📵 This call was transferred to T-Mobile Fraud Protection. Your voice and this number have been reported.";
    notice.classList.remove("hidden");
    speak("This call has been transferred to T-Mobile Fraud Protection. This number has been reported.");
  } else {
    S.sounds?.hangup();
    $("e-status").textContent = {
      declined: "Call Declined",
      "no-answer": "No Answer",
      disconnected: "Call Failed",
    }[reason] || (wasActive ? "Call Ended" : "Call Canceled");
  }
  show("ended");
}

$("btn-back").addEventListener("click", () => show("dial"));

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

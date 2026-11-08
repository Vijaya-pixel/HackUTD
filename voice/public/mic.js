// Audio helpers shared by the customer app, scammer phone, and voice database.
//
// iOS Safari rules this follows:
//  - The page must be HTTPS (use the cloudflared tunnel).
//  - The AudioContext must be created inside a tap handler.
//
// Wire format: 16 kHz mono Int16 PCM, ~100 ms per WebSocket binary frame.

export const RATE = 16000;

export function createAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  ctx.resume();
  return ctx;
}

export function wsUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

function toInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

// Microphone -> onChunk(Int16Array, peak)
export class Mic {
  constructor(ctx, { voiceCall = true } = {}) {
    this.ctx = ctx;
    this.voiceCall = voiceCall;
    this.onChunk = null;
    this.muted = false;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(location.protocol === "https:" ? "This browser can't use the microphone." : "Microphone needs HTTPS. Open the https link.");
    }
    // voiceCall: echo cancellation on, so the other person's voice coming out
    // of this phone isn't sent back to them.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: this.voiceCall
        ? { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        : { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    });
    await this.ctx.audioWorklet.addModule("pcm-worklet.js");
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-downsampler");
    const silent = this.ctx.createGain();
    silent.gain.value = 0;
    src.connect(this.node).connect(silent).connect(this.ctx.destination);
    this.node.port.onmessage = (e) => {
      const peak = this.muted ? 0 : e.data.peak;
      const pcm = this.muted ? new Int16Array(e.data.samples.length) : toInt16(e.data.samples);
      this.onChunk?.(pcm, peak);
    };
  }

  stop() {
    if (this.node) this.node.port.onmessage = null;
    this.stream?.getTracks().forEach((t) => t.stop());
  }
}

// Plays Int16 16 kHz chunks from the other phone with a small jitter buffer.
export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 1.4;
    this.gain.connect(ctx.destination);
    this.next = 0;
  }

  play(arrayBuffer) {
    const i16 = new Int16Array(arrayBuffer);
    if (!i16.length) return;
    const buf = this.ctx.createBuffer(1, i16.length, RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < i16.length; i++) ch[i] = i16[i] / 32768;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    const now = this.ctx.currentTime;
    if (this.next < now + 0.05 || this.next > now + 0.6) this.next = now + 0.15; // resync on gaps or drift
    src.start(this.next);
    this.next += buf.duration;
  }
}

// ---------- Phone sounds (synthesized, original melodies) ----------
function tone(ctx, dest, { freq, start, dur, type = "sine", vol = 0.2, decay = true }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(vol, start + 0.01);
  if (decay) {
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  } else {
    g.gain.setValueAtTime(vol, start + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, start + dur);
  }
  o.connect(g).connect(dest);
  o.start(start);
  o.stop(start + dur + 0.05);
}

export class Sounds {
  constructor(ctx) {
    this.ctx = ctx;
    this.loop = null;
  }

  stop() {
    clearInterval(this.loop);
    this.loop = null;
  }

  // Marimba-style ringtone for the incoming call.
  ringtone() {
    this.stop();
    const notes = [784, 988, 1175, 988, 784, 1175, 1319, 1175];
    const once = () => {
      const t = this.ctx.currentTime + 0.05;
      notes.forEach((f, i) => {
        tone(this.ctx, this.ctx.destination, { freq: f, start: t + i * 0.16, dur: 0.5, type: "sine", vol: 0.28 });
        tone(this.ctx, this.ctx.destination, { freq: f * 4, start: t + i * 0.16, dur: 0.08, type: "sine", vol: 0.05 });
      });
    };
    once();
    this.loop = setInterval(once, 2600);
  }

  // North American ringback (what the caller hears while it rings).
  ringback() {
    this.stop();
    const once = () => {
      const t = this.ctx.currentTime + 0.05;
      tone(this.ctx, this.ctx.destination, { freq: 440, start: t, dur: 2, vol: 0.08, decay: false });
      tone(this.ctx, this.ctx.destination, { freq: 480, start: t, dur: 2, vol: 0.08, decay: false });
    };
    once();
    this.loop = setInterval(once, 6000);
  }

  // Three short beeps when a call ends.
  hangup() {
    this.stop();
    const t = this.ctx.currentTime + 0.05;
    for (let i = 0; i < 3; i++) tone(this.ctx, this.ctx.destination, { freq: 620, start: t + i * 0.22, dur: 0.14, vol: 0.12, decay: false });
  }

  // Soft two-note chime for a Safe Signal warning.
  chime() {
    const t = this.ctx.currentTime + 0.02;
    tone(this.ctx, this.ctx.destination, { freq: 880, start: t, dur: 0.35, vol: 0.12 });
    tone(this.ctx, this.ctx.destination, { freq: 660, start: t + 0.18, dur: 0.45, vol: 0.12 });
  }
}

// ---------- Single-device listener (mic test + voice enrollment) ----------
export class Listener {
  // handlers: { onMessage(msg), onLevel(peak), onClose() }
  constructor(handlers) {
    this.h = handlers;
  }

  async start(ctx, { number = "", mode = "call" } = {}) {
    this.ctx = ctx;
    this.mic = new Mic(ctx, { voiceCall: false });
    await this.mic.start();
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl());
      ws.binaryType = "arraybuffer";
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Could not connect to the Safe Signal server."));
      ws.onmessage = (e) => {
        if (typeof e.data !== "string") return;
        try { this.h.onMessage?.(JSON.parse(e.data)); } catch { /* ignore */ }
      };
      ws.onclose = () => this.h.onClose?.();
      this.ws = ws;
    });
    this.ws.send(JSON.stringify({ type: "start", number, mode }));
    this.mic.onChunk = (pcm, peak) => {
      this.h.onLevel?.(peak);
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(pcm.buffer);
    };
  }

  // Stops the mic and waits for the server to flush the last sentence.
  stop() {
    return new Promise((resolve) => {
      this.mic?.stop();
      this.ctx?.close?.().catch(() => { });
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return resolve(null);
      const prev = this.h.onMessage;
      const timer = setTimeout(() => resolve(null), 4000);
      this.h.onMessage = (msg) => {
        prev?.(msg);
        if (msg.type === "stopped") {
          clearTimeout(timer);
          resolve(msg);
          setTimeout(() => ws.close(), 100);
        }
      };
      ws.send(JSON.stringify({ type: "stop" }));
    });
  }
}

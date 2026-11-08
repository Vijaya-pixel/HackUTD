// Deepgram streaming speech-to-text for Twilio Media Streams (8 kHz mulaw, mono).
// Cost guards: a socket is opened only when a call's audio actually starts, closed on stop,
// and force-closed after MAX_MS so a forgotten stream cannot run up the bill.
import 'dotenv/config';
import WebSocket from 'ws';

const KEY = process.env.DEEPGRAM_API_KEY || '';
const MODEL = process.env.DEEPGRAM_MODEL || 'nova-3';
const MAX_MS = Number(process.env.STT_MAX_SECONDS || 240) * 1000;

export const sttEnabled = () => !!KEY;

/**
 * Open a transcription session. onUtterance(text) fires once per finished utterance.
 * Returns { send(buffer), close(), stats() }.
 */
export function openStt({ onUtterance, onError = console.error, tag = '' }) {
  if (!KEY) throw new Error('DEEPGRAM_API_KEY not set');
  const params = new URLSearchParams({
    model: MODEL, encoding: 'mulaw', sample_rate: '8000', channels: '1',
    smart_format: 'true', interim_results: 'true', endpointing: '400', utterance_end_ms: '1200', vad_events: 'false',
  });
  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, { headers: { Authorization: `Token ${KEY}` } });
  let open = false, closed = false, bytes = 0, pieces = [];
  const queue = [];
  const flush = () => { const text = pieces.join(' ').replace(/\s+/g, ' ').trim(); pieces = []; if (text) onUtterance(text); };
  const keep = setInterval(() => { if (open && !closed) ws.send(JSON.stringify({ type: 'KeepAlive' })); }, 5000);
  const kill = setTimeout(() => { console.warn(`[stt${tag}] max duration reached, closing`); close(); }, MAX_MS);

  ws.on('open', () => { open = true; for (const b of queue) ws.send(b); queue.length = 0; });
  ws.on('message', data => {
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.type === 'Results') {
      const t = m.channel?.alternatives?.[0]?.transcript || '';
      if (t && m.is_final) pieces.push(t);
      if (m.speech_final) flush();
    } else if (m.type === 'UtteranceEnd') flush();
    else if (m.type === 'Error') onError(new Error('deepgram: ' + JSON.stringify(m)));
  });
  ws.on('error', e => onError(e));
  ws.on('close', () => { closed = true; clearInterval(keep); clearTimeout(kill); flush(); });

  function close() {
    if (closed) return;
    try { if (open) ws.send(JSON.stringify({ type: 'CloseStream' })); } catch {}
    setTimeout(() => { try { ws.close(); } catch {} }, 300);
  }
  return {
    send(buf) { if (closed) return; bytes += buf.length; if (open) ws.send(buf); else if (queue.length < 400) queue.push(buf); },
    close,
    stats: () => ({ seconds: Math.round(bytes / 8000), open, closed }),
  };
}

/* API client for the ScamShield backend (server/). Same-origin when served by the API (localhost:8788 or
   the ngrok tunnel), falls back to localhost:8787 when the UI is opened from the static python server. */
const API = (() => {
  const p = location.port;
  if (p === '8787' || p === '8788' || !p) return '/api';
  return 'http://localhost:8787/api';
})();

// ngrok's free tier answers browser-looking requests with an interstitial page unless this header is present.
// Same-origin, so it adds no CORS preflight.
const BASE_HEADERS = { 'ngrok-skip-browser-warning': '1' };

async function http(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { ...BASE_HEADERS, 'Content-Type': 'application/json' } : BASE_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new Error((data && data.error) || `${method} ${path} failed (${res.status})`);
  return data;
}

const api = {
  base: API,
  get: p => http('GET', p),
  post: (p, b) => http('POST', p, b || {}),
  put: (p, b) => http('PUT', p, b || {}),
  patch: (p, b) => http('PATCH', p, b || {}),
  del: p => http('DELETE', p),

  /** Subscribe to server-sent events. handlers: { call, activity, line, lists, learn, hello, open }.
      Implemented over fetch rather than EventSource so the ngrok bypass header can be sent; reconnects on its own
      and calls handlers.open on every (re)connect so the UI can resync anything it missed. */
  events(handlers) {
    let closed = false, ctrl = null;
    const dispatch = (name, data) => { const fn = handlers[name]; if (!fn) return; try { fn(data === undefined ? undefined : JSON.parse(data)); } catch (err) { console.error(err); } };
    const parseBlock = block => {
      let ev = 'message'; const data = [];
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const i = line.indexOf(':'); const field = i < 0 ? line : line.slice(0, i); const val = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
        if (field === 'event') ev = val; else if (field === 'data') data.push(val);
      }
      if (data.length) dispatch(ev, data.join('\n'));
    };
    const connect = async () => {
      if (closed) return;
      ctrl = new AbortController();
      try {
        const res = await fetch(API + '/events', { headers: { ...BASE_HEADERS, Accept: 'text/event-stream' }, cache: 'no-store', signal: ctrl.signal });
        if (!res.ok || !/text\/event-stream/.test(res.headers.get('content-type') || '')) throw new Error('bad stream ' + res.status);
        if (handlers.open) { try { handlers.open(); } catch (err) { console.error(err); } }
        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf('\n\n')) >= 0) { parseBlock(buf.slice(0, i)); buf = buf.slice(i + 2); }
        }
      } catch (err) { if (!closed) console.warn('events: reconnecting', err.message); }
      if (!closed) setTimeout(connect, 2000);
    };
    connect();
    return { close() { closed = true; if (ctrl) ctrl.abort(); } };
  },
};

/* API client for the ScamShield backend (server/). Same-origin when served by the API,
   falls back to localhost:8787 when the UI is opened from the static python server. */
const API = (() => {
  const p = location.port;
  if (p === '8787' || p === '8788' || !p) return '/api';
  return 'http://localhost:8787/api';
})();

async function http(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
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

  /** Subscribe to server-sent events. handlers: { call, activity, line, lists, report, hello } */
  events(handlers) {
    const es = new EventSource(API + '/events');
    for (const [name, fn] of Object.entries(handlers)) {
      es.addEventListener(name, e => { try { fn(JSON.parse(e.data)); } catch (err) { console.error(err); } });
    }
    es.onerror = () => { /* EventSource reconnects on its own */ };
    return es;
  },
};

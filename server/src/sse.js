// Tiny server-sent-events hub. The UI subscribes once and receives call and activity events.
const clients = new Set();

export function subscribe(stream) {
  clients.add(stream);
  return () => clients.delete(stream);
}

export function publish(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try { c.write(payload); } catch { clients.delete(c); }
  }
}

export const clientCount = () => clients.size;

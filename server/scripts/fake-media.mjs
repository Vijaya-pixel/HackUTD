// Pretends to be Twilio Media Streams: start, ~1s of mulaw silence, stop.
import WebSocket from 'ws';
const [,, url, callId] = process.argv;
const ws = new WebSocket(url);
ws.on('open', async () => {
  ws.send(JSON.stringify({ event: 'start', start: { streamSid: 'MZtest', callSid: 'CA_test2', customParameters: { callId, mode: 'inbound' } } }));
  const silence = Buffer.alloc(160, 0xff).toString('base64');
  for (let i = 0; i < 50; i++) { ws.send(JSON.stringify({ event: 'media', media: { payload: silence } })); await new Promise(r => setTimeout(r, 20)); }
  ws.send(JSON.stringify({ event: 'stop' }));
  setTimeout(() => { console.log('fake stream done'); ws.close(); process.exit(0); }, 1500);
});
ws.on('error', e => { console.error('ws error', e.message); process.exit(1); });

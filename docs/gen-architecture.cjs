// Generates docs/architecture.drawio for ScamShield in T-Life. Every box maps to a real file, service or table.
// Layout: each server module sits under the external service it talks to, and arrows use reserved gutters,
// so no arrow passes through a box.
const fs = require('fs');
const out = process.argv[2];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cells = []; let eid = 0;
const C = {
  user: { fill: '#FFFFFF', stroke: '#6B6B6B' }, edge: { fill: '#E8F1FF', stroke: '#2B6BE4' }, client: { fill: '#FCE4F1', stroke: '#E20074' },
  server: { fill: '#E6F6EC', stroke: '#1E9E5A' }, ai: { fill: '#F1E8FF', stroke: '#7A3BFF' }, data: { fill: '#E3F4F6', stroke: '#0F7A87' },
};
const lane = (id, title, sub, x, y, w, h, c) => cells.push(`<mxCell id="${id}" value="${esc(`<b style="font-size:15px">${title}</b>${sub ? `&nbsp;&nbsp;<span style="font-size:11px;color:#555">${sub}</span>` : ''}`)}" style="rounded=1;arcSize=2;whiteSpace=wrap;html=1;fillColor=${c.fill};strokeColor=${c.stroke};strokeWidth=2;opacity=60;verticalAlign=top;align=left;spacingLeft=14;spacingTop=6;fontFamily=Helvetica;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`);
const box = (id, x, y, w, h, title, body, c) => cells.push(`<mxCell id="${id}" value="${esc(`<b>${title}</b>${body ? `<br><span style="font-size:11px">${body}</span>` : ''}`)}" style="rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=${c.stroke};strokeWidth=1.5;fontSize=13;fontFamily=Helvetica;spacing=5;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`);
const note = (id, x, y, w, h, html, extra = '') => cells.push(`<mxCell id="${id}" value="${esc(html)}" style="rounded=1;arcSize=3;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=12;fontSize=12;fontFamily=Helvetica;${extra}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`);
const FC = { 1: '#E20074', 2: '#D7263D', 3: '#7A3BFF', 4: '#E09A00', 5: '#1E9E5A', s: '#2B6BE4' };
// p: exit/entry points as [exitX, exitY, entryX, entryY]
const arrow = (src, dst, label, flow, p, extra = '') => cells.push(`<mxCell id="e${++eid}" value="${esc(label || '')}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=${FC[flow]};strokeWidth=2;fontSize=10;fontStyle=1;fontColor=${FC[flow]};labelBackgroundColor=#FFFFFF;endArrow=block;endFill=1;${p ? `exitX=${p[0]};exitY=${p[1]};exitDx=0;exitDy=0;entryX=${p[2]};entryY=${p[3]};entryDx=0;entryDy=0;` : ''}${extra}" edge="1" parent="1" source="${src}" target="${dst}"><mxGeometry relative="1" as="geometry"/></mxCell>`);

note('title', 40, 20, 1780, 64, '<b style="font-size:24px;color:#E20074">ScamShield in T-Life</b><span style="font-size:13px;color:#444">&nbsp;&nbsp;·&nbsp; carrier-side scam protection, a live AI Call Screener, Safe Signal practice texts and the ScamShield Quest game, inside T-Mobile\'s T-Life app</span>', 'fillColor=none;strokeColor=none;verticalAlign=middle;');

/* ---------- people and devices ---------- */
lane('L1', 'People and devices', '', 40, 96, 1780, 178, C.user);
box('u_demo', 70, 140, 380, 108, 'Demo / judge browser', 'the same web app on localhost:8788<br>simulated calls for the walkthrough', C.user);
box('u_family', 470, 140, 420, 108, 'Family lines on the account', 'Harsh, Marco, Grandma Rosa · protection per line<br>guardian alert by iMessage on high-risk calls', C.user);
box('u_phone', 960, 140, 440, 108, "Customer's iPhone", 'Phone app (real calls) · iMessage (practice texts)<br>Safari running the T-Life web app over the tunnel', C.user);
box('u_caller', 1420, 140, 370, 108, 'Unknown or scam caller', 'any phone on the public network<br>dials the protected T-Mobile number', C.user);

/* ---------- client | external edge ---------- */
lane('L2', 'T-Life web client', 'vanilla JS, no build step, served by the API', 40, 300, 880, 336, C.client);
box('c_buddy', 70, 350, 400, 120, 'buddy.js · Buddy and the trap reveal', 'energy and mood from server events<br>link-tap reveal: every red flag and the exact<br>message where you should have stopped', C.client);
box('c_3d', 490, 350, 400, 120, 'buddy3d.js · three.js r170', 'procedural 3D mascot with 8 expressions<br>damped motion per expression, effects<br>one WebGL renderer reused across screens', C.client);
box('c_app', 70, 490, 275, 125, 'app.js · T-Life shell', 'Home, Learn, Benefits, Services, Account<br>ScamShield screens, family<br>live call overlay + screening card', C.client);
box('c_api', 360, 490, 275, 125, 'api.js · transport', 'REST + server-sent events read over fetch<br>resync on reconnect, wake, 3 s poll<br>(iOS suspends Safari during calls)', C.client);
box('c_game', 650, 490, 255, 125, 'game.js · ScamShield Quest', 'cloud map, 10 stops, 6 game engines<br>stars, unlocks, weekly T-Mobile<br>tasks, 180-point reward bar', C.client);

lane('L3', 'External services: carrier and messaging', '', 950, 300, 870, 336, C.edge);
box('e_photon', 980, 350, 420, 265, 'Photon Spectrum<br>(spectrum-ts SDK)', 'iMessage provider on a shared line<br>long-lived project stream: app.messages<br><br>outbound practice texts<br>guardian alerts<br>number check and report by text<br><br>constraint handled: the line can only<br>text a number after it texts first', C.edge);
box('e_twilio', 1420, 350, 370, 140, 'Twilio Programmable Voice', 'owned +1 844 number · TwiML Say, Pause,<br>Redirect, Dial · signed webhooks<br>Media Streams (μ-law 8 kHz over WSS)<br>status + dial callbacks · Polly voice', C.edge);
box('e_ngrok', 1420, 510, 370, 105, 'ngrok tunnel (HTTPS + WSS)', 'public URL → localhost:8788<br>webhooks, media socket, the phone\'s browser<br>bypass header lets the event stream through', C.edge);

/* ---------- server ---------- */
lane('L4', 'ScamShield API · Node 24 + Hono', 'one process: REST, webhooks, WebSocket media server, event hub, Photon stream', 40, 662, 1780, 392, C.server);
box('s_api', 70, 720, 300, 150, 'index.js · REST API (48 routes)', 'call state machine:<br>ringing → screening → connected → ended<br>snapshot for reconnecting clients<br>reports, lists, lines, premium', C.server);
box('s_sse', 400, 720, 230, 150, 'sse.js · event hub', 'pub/sub to every open client<br><br>call · activity · pet<br>learn · lists · report', C.server);
box('s_risk', 690, 720, 340, 150, 'risk.js · pre-ring decision engine', 'allow list → block list → crowd reputation<br>→ neighbor-spoof boost → category routing<br>→ Scam Block at risk ≥ 80, label at ≥ 45<br>in-call verdicts with similar known scripts', C.server);
box('s_photon', 1050, 720, 330, 150, 'photon.js · iMessage', 'claims each message id in the database<br>so only one server ever replies<br>routes practice replies, number checks,<br>reports and guardian alerts', C.server);
box('s_twilio', 1400, 720, 390, 150, 'twilio.js · voice control', 'voice, status, dial and dial-status webhooks<br>2 s TwiML wait loop speaks each question<br>Dial hand-off to the subscriber<br>WebSocket /twilio/media feeds speech-to-text', C.server);
box('s_learn', 70, 890, 350, 140, 'learn.js · Safe Signal practice', 'personal, link-first scam texts (Gemini persona)<br>safety filter: never asks for PIN, code, card, SSN<br>PII redaction · lesson builder<br>/p/:token trap link → reveal in T-Life', C.server);
box('s_pet', 440, 890, 345, 140, 'pet.js · Buddy and Quest economy', 'energy = 40 + protections (≤ 20)<br>+ last 30 days of events<br>game results, stars, XP and level<br>weekly task per stop, 180-pt goal → reward', C.server);
box('s_llm', 800, 890, 300, 140, 'llm.js · Gemini gateway', 'answers against JSON response schemas<br>4–7 s timeout on every call<br>rule-based fallback classifier<br>when the model is slow or down', C.server);
box('s_screener', 1115, 890, 385, 140, 'screener.js · AI Call Screener', '3 questions: who, why, company + callback<br>Gemini summary: caller, reason, red flags, risk<br>outright fraud is refused<br>everyone else rings you with the summary', C.server);
box('s_stt', 1515, 890, 275, 140, 'stt.js · speech-to-text', 'Deepgram streaming client<br>emits finished utterances<br>4-minute cap per call', C.server);

/* ---------- data ---------- */
lane('L5', 'TigerData · TimescaleDB 2.31 on Postgres 18', 'pg pool over TLS · SQL migrations 001–007', 40, 1080, 1780, 210, C.data);
box('d_core', 70, 1130, 280, 135, 'Core', 'accounts · lines (toggles JSONB)<br>numbers (crowd reputation)<br>list_entries · category_prefs<br>reports · lookups', C.data);
box('d_ts', 365, 1130, 325, 135, 'Time series (TimescaleDB)', 'call_events hypertable + retention policy<br>line_daily continuous aggregate<br>(real time, feeds the stats)<br>learn_messages hypertable', C.data);
box('d_vec', 705, 1130, 225, 135, 'Vector search (pgvector)', 'scam_scripts<br>1024-d embeddings<br>HNSW index, cosine<br>+ keyword fallback', C.data);
box('d_learn', 970, 1130, 200, 135, 'Practice', 'learn_consents<br>learn_sessions<br>learn_skills<br><i>(learn.js)</i>', C.data);
box('d_game', 1185, 1130, 215, 135, 'Game', 'pet_events · game_progress<br>game_tasks · game_rewards<br><i>(pet.js)</i>', C.data);
box('d_msg', 1415, 1130, 190, 135, 'Messaging', 'photon_inbound<br>one reply per message<br>across servers<br><i>(photon.js)</i>', C.data);

/* ---------- AI services ---------- */
lane('L6', 'AI services', '', 40, 1316, 1780, 150, C.ai);
box('a_embed', 70, 1360, 360, 85, 'gemini-embedding-001', '1024-dimension vectors for the<br>known scam-script library (seeded)', C.ai);
box('a_polly', 450, 1360, 380, 85, 'Amazon Polly, through Twilio Say', 'Polly.Matthew voice for the screener:<br>questions, nudges, hand-off lines', C.ai);
box('a_gemini', 845, 1360, 455, 85, 'Google Gemini 3.5 Flash Lite', 'via @google/genai · call verdicts · screening summaries<br>scammer persona turns · lesson rules · SMS replies', C.ai);
box('a_dg', 1315, 1360, 475, 85, 'Deepgram nova-3', 'live speech-to-text over WebSocket<br>μ-law 8 kHz straight from Twilio Media Streams', C.ai);

/* ---------- flows (each pinned to a clear path) ---------- */
// ① incoming call → screener
arrow('u_caller', 'e_twilio', '① call', 1, [0.5, 1, 0.5, 0]);
arrow('e_twilio', 'e_ngrok', 'webhooks + media', 1, [0.5, 1, 0.5, 0]);
arrow('e_ngrok', 's_twilio', '① voice webhook · media socket', 1, [0.5, 1, 0.53, 0]);
arrow('s_twilio', 's_risk', '① pre-ring check', 1, [0.08, 1, 0.75, 1]);
arrow('s_twilio', 's_stt', 'caller audio', 1, [0.8, 1, 0.6, 0]);
arrow('s_stt', 's_screener', 'utterances', 1, [0, 0.5, 1, 0.5]);
arrow('s_screener', 's_llm', 'summarize', 1, [0, 0.5, 1, 0.5]);
arrow('s_llm', 'a_gemini', 'JSON verdicts', 1, [0.5, 1, 0.23, 0]);
arrow('s_stt', 'a_dg', 'audio stream', 1, [0.45, 1, 0.68, 0]);
// ② hand-off and live UI
arrow('e_twilio', 'u_phone', '② your phone rings', 2, [0.1, 0, 0.9, 1]);
arrow('s_sse', 'c_api', '② live call events', 2, [0.5, 0, 0.6, 1]);
arrow('c_api', 'c_app', 'summary card', 2, [0, 0.5, 1, 0.5]);
// ③ in-call detection
arrow('s_risk', 'd_vec', '③ similar scripts', 3, [0.3, 1, 0.39, 0]);
// ④ practice text and trap
arrow('c_api', 's_learn', '④ start practice', 4, [0.09, 1, 0.9, 0]);
arrow('s_learn', 's_photon', '④ personal scam text', 4, [0.97, 0, 0.5, 1]);
arrow('s_photon', 'e_photon', '④ send', 4, [0.5, 0, 0.6, 1]);
arrow('e_photon', 'u_phone', '④ iMessage with link', 4, [0.5, 0, 0.5, 1]);
arrow('s_learn', 's_pet', 'trap −25', 4, [1, 0.5, 0, 0.5]);
// ⑤ Quest
arrow('c_game', 's_pet', '⑤ game result', 5, [0.04, 1, 0.63, 0]);
// publish
arrow('s_api', 's_sse', 'publish', 's', [1, 0.5, 0, 0.5]);

/* ---------- side panel ---------- */
note('flows', 1860, 96, 560, 640,
  '<b style="font-size:16px">Request flows</b><br><br>' +
  '<b style="color:#E20074">① Incoming call, screened by AI</b><br>Twilio posts the call through the tunnel. The pre-ring engine checks allow and block lists, crowd reputation, neighbor spoofing, blocked categories and Scam Block. Unknown callers get a spoken 3-question interview while their audio streams to Deepgram.<br><br>' +
  '<b style="color:#D7263D">② Hand-off with a summary</b><br>Gemini turns the answers into caller, company, reason, callback, red flags and a risk score. Outright fraud is refused. Everyone else is bridged to your phone with Dial while the summary card appears live in T-Life.<br><br>' +
  '<b style="color:#7A3BFF">③ In-call detection</b><br>Each utterance is matched against known scam scripts by vector similarity, then judged by Gemini. Fraud or AI-voice alerts appear mid-call and can notify a family guardian.<br><br>' +
  '<b style="color:#E09A00">④ Safe Signal practice text</b><br>A personal, believable scam text with a link goes out over iMessage. Tapping it hits /p/:token: Buddy loses 25 energy and T-Life opens on the reveal, showing the red flags and where you should have stopped.<br><br>' +
  '<b style="color:#1E9E5A">⑤ ScamShield Quest</b><br>Ten playable stops, each one scam situation. Results update stars, Buddy\'s energy and this week\'s T-Mobile tasks; 180 points earns a T-Mobile Tuesdays reward.',
  'fillColor=#FFFFFF;strokeColor=#BBBBBB;');
note('decisions', 1860, 756, 560, 534,
  '<b style="font-size:16px">Engineering decisions</b><br><br>' +
  '<b>Fail soft.</b> Every model call has a timeout and a rule-based fallback, so a slow model never drops a call or freezes the UI.<br><br>' +
  '<b>Structured AI output.</b> Gemini answers against JSON schemas, and replies are validated before use: practice texts must contain the link and must never ask for codes or card numbers.<br><br>' +
  '<b>Time-series native.</b> Call history is a TimescaleDB hypertable with a retention policy; stats come from a real-time continuous aggregate.<br><br>' +
  '<b>Vector + keyword search</b> over known scam scripts with pgvector HNSW.<br><br>' +
  '<b>Mobile reality.</b> iOS suspends Safari during a call, so the client resyncs from a call snapshot on wake; events stream over fetch so they can carry the tunnel header.<br><br>' +
  '<b>Multi-instance safety.</b> Photon delivers every message to every server on the project; a claim row in the database guarantees one reply.<br><br>' +
  '<b>Privacy.</b> Calls with contacts are never analyzed; practice replies are redacted before storage; Buddy sees outcomes, never content.',
  'fillColor=#FFF8FC;strokeColor=#E20074;');
note('legend', 1860, 1310, 560, 156,
  '<b style="font-size:14px">Legend</b><br>' +
  '<span style="color:#E20074">━━</span> ① incoming call &nbsp; <span style="color:#D7263D">━━</span> ② hand-off + live UI &nbsp; <span style="color:#7A3BFF">━━</span> ③ in-call detection<br>' +
  '<span style="color:#E09A00">━━</span> ④ practice text + trap &nbsp; <span style="color:#1E9E5A">━━</span> ⑤ Quest &nbsp; <span style="color:#2B6BE4">━━</span> event publish<br><br>' +
  '<span style="font-size:11px;color:#555">Stack: Node 24 · Hono · pg · ws · twilio · @google/genai · spectrum-ts · three.js r170 (CDN import map) · TigerData (TimescaleDB, pgvector) · Twilio · Deepgram · Gemini · Photon · ngrok</span>',
  'fillColor=#FFFFFF;strokeColor=#BBBBBB;');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" agent="ScamShield architecture generator" version="24.7.17">
  <diagram id="scamshield-arch" name="ScamShield architecture">
    <mxGraphModel dx="2400" dy="1600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="2460" pageHeight="1500" background="#FFFFFF" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
fs.writeFileSync(out, xml);
console.log('cells', cells.length, 'edges', eid, 'bytes', xml.length);

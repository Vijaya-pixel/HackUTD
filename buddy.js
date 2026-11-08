/* ScamShield Buddy: a pet whose health mirrors the subscriber's security habits.
   Loaded before app.js; everything here runs at call time and uses app.js globals (S, api, ico, esc, row, header, …).
   Three pieces: the Buddy tab (pet stage + security health dashboard), pop quizzes that surface subtly while the
   app is in use, and the trap reveal when a practice-scam link is tapped. */

const PET_LINES = {
  thriving: ['I feel unstoppable. Send the scammers my way.', 'Look at this armor. Nothing gets past us.', 'Top form. Keep spotting those red flags.'],
  happy: ['Feeling good. One quick check and I level up.', 'Nice habits. Scam Block has my back.', 'Steady and healthy. Keep it up.'],
  tired: ['A bit drained. A quick check would perk me up.', 'Could use a win. Catch the next practice text?', 'Not my best day. Turn on a protection for me?'],
  sick: ['Ugh. Too many traps lately. Help me recover.', 'I need some wins. Try a practice text and catch it.', 'Scam Block and Caller ID would help me heal.'],
  critical: ['I am barely standing. Please do not tap any links.', 'Critical. Every correct answer counts now.', 'Help. Turn protections on and catch the next scam.'],
};
const KIND_LABEL = { caught: 'Caught a practice scam', fell: 'Fell for a practice scam', trap: 'Tapped the trap link', quiz_right: 'Quick check answered', quiz_wrong: 'Quick check missed', report: 'Reported a number', bonus: 'Bonus' };
const TOGGLE_LABEL = { scamBlock: 'Scam Block', callerId: 'Caller ID', screener: 'Call Screener', aiVoice: 'AI voice detection', inCall: 'In-call alerts' };
const pickLine = arr => arr[Math.floor(Date.now() / 60000) % arr.length];
const petTimers = {};

/* ---------- the pet ---------- */
function petSvg(mood) {
  const face = { thriving: { eyes: 'happy', mouth: 'M37 62 Q50 76 63 62', cheeks: true }, happy: { eyes: 'open', mouth: 'M40 63 Q50 71 60 63', cheeks: true }, tired: { eyes: 'half', mouth: 'M41 67 L59 67' }, sick: { eyes: 'half', mouth: 'M40 69 Q50 61 60 69', sweat: true }, critical: { eyes: 'x', mouth: 'M40 70 Q50 62 60 70', sweat: true } }[mood] || { eyes: 'open', mouth: 'M40 63 Q50 71 60 63' };
  const eye = cx => face.eyes === 'x' ? `<path d="M${cx - 4} 46 l8 8 M${cx + 4} 46 l-8 8" stroke="#1A1A1A" stroke-width="3" stroke-linecap="round"/>`
    : face.eyes === 'half' ? `<path d="M${cx - 5} 50 Q${cx} 55 ${cx + 5} 50" stroke="#1A1A1A" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : face.eyes === 'happy' ? `<path d="M${cx - 5} 52 Q${cx} 44 ${cx + 5} 52" stroke="#1A1A1A" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : `<circle cx="${cx}" cy="50" r="4.4" fill="#1A1A1A"/><circle cx="${cx + 1.6}" cy="48.4" r="1.4" fill="#fff"/>`;
  return `<svg class="pet" viewBox="0 0 100 110" aria-hidden="true">
    <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF4FA3"/><stop offset="1" stop-color="#E20074"/></linearGradient></defs>
    <ellipse cx="50" cy="105" rx="26" ry="3.5" fill="rgba(0,0,0,.12)"/>
    <g class="body">
      <path d="M50 6 L86 18 V52 C86 76 68 92 50 100 C32 92 14 76 14 52 V18 Z" fill="url(#pg)"/>
      <path d="M50 14 L78 23 V51 C78 70 64 83 50 90 C36 83 22 70 22 51 V23 Z" fill="rgba(255,255,255,.14)"/>
      <path d="M36 22 q14 -6 28 0" stroke="rgba(255,255,255,.5)" stroke-width="3" fill="none" stroke-linecap="round"/>
      ${eye(39)}${eye(61)}
      <path d="${face.mouth}" stroke="#1A1A1A" stroke-width="3" fill="none" stroke-linecap="round"/>
      ${face.cheeks ? '<circle cx="30" cy="60" r="4" fill="rgba(255,255,255,.45)"/><circle cx="70" cy="60" r="4" fill="rgba(255,255,255,.45)"/>' : ''}
      ${face.sweat ? '<path d="M78 32 q5 7 0 10 q-5 -3 0 -10z" fill="#7CC4FF"/>' : ''}
    </g></svg>`;
}

async function loadPet() { S.pet = await api.get(`/pet/${curLine().lineId}`); render(); }
function petAnimate(kind, delta, from) {
  S.petAnim = { kind, delta, from, at: Date.now() }; render();
  clearTimeout(petTimers.anim); petTimers.anim = setTimeout(() => { S.petAnim = null; render(); }, kind === 'trap' ? 3600 : 1800);
}
function onPetEvent(ev) {
  if (ev.lineId !== curLine().lineId) return;
  const prev = S.pet?.health;
  S.pet = ev.state; S.petLast = ev.event;
  const d = ev.event.delta;
  if (d) petAnimate(d < 0 ? (ev.event.kind === 'trap' ? 'trap' : 'hurt') : 'heal', d, prev ?? Math.max(0, Math.min(100, ev.state.health - d)));
  else render();
  if (d && current() !== 'pet' && !S.trap) toast(d < 0 ? `Buddy lost ${-d} health: ${ev.event.note}` : `Buddy gained ${d} health: ${ev.event.note}`, d < 0 ? 'block' : '');
}

/* ---------- the trap: a practice-scam link was tapped ---------- */
async function startTrap(sessionId) {
  S.tab = 'pet'; S.stack = []; S.sheet = null; S.quiz = null; S.trap = { sessionId, session: null }; save(); render(true);
  const hadAnim = !!S.petAnim;
  try { S.trap.session = await api.get(`/learn/session/${sessionId}`); } catch (e) { S.trap.error = e.message; }
  try { await loadPet(); } catch {}
  // Opened from the phone (the stream was not connected when the event fired): still play the hit.
  if (!hadAnim && S.pet) petAnimate('trap', -25, Math.min(100, S.pet.health + 25));
  render();
}
function trapFlags(s) {
  const msgs = (s.lesson?.replay || s.messages || []).filter(m => m.role === 'scammer');
  const flags = [], seen = new Set();
  msgs.forEach((m, i) => (m.redFlags || []).forEach(f => { if (!seen.has(f.category)) { seen.add(f.category); flags.push({ cat: f.category, why: f.explanation, idx: i }); } }));
  const stop = msgs.findIndex(m => (m.redFlags || []).length);
  const brand = s.scenario?.brand && s.scenario.brand !== 'none' ? s.scenario.brand : (s.scenario?.categoryLabel || 'practice');
  return { flags, stop: stop >= 0 ? { n: stop + 1, text: msgs[stop].text } : null, brand, rule: s.lesson?.ruleToRemember, mistakes: s.lesson?.mistakes || [] };
}
function trapCard(t) {
  const s = t.session;
  if (!s) return `<div class="card trap"><div class="eyebrow">Buddy says</div><div class="big">${t.error ? 'I could not load that practice session.' : 'Ouch. Let me look at what happened…'}</div></div>`;
  const f = trapFlags(s);
  const quote = f.stop ? (f.stop.text.length > 170 ? f.stop.text.slice(0, 168) + '…' : f.stop.text) : '';
  return `<div class="card trap">
    <div class="eyebrow">Buddy says</div>
    <div class="big">You tapped the ${esc(f.brand)} link. That was the scam.</div>
    <p class="desc">Nothing real was shared, but a real link like that steals passwords and card numbers. Here is where it went wrong.</p>
    ${f.stop ? `<div class="stopat"><div class="lbl">Where you should have stopped</div><div class="q">Message ${f.stop.n} (${esc(f.brand)}): “${esc(quote)}”</div><div class="hint">The red flags were already there. The safe move was to open the official app yourself and never tap.</div></div>` : ''}
    <div class="flaglist">${f.flags.map(x => `<div class="feat"><span class="badge ${FLAG_CLS[x.cat] || ''}">${flagLabel(x.cat)}</span><span>${esc(x.why)}</span></div>`).join('')}</div>
    ${f.mistakes.length ? `<div class="mistakes">${f.mistakes.map(m => `<div class="feat">${ico('alert')}<span>${esc(m)}</span></div>`).join('')}</div>` : ''}
    ${f.rule ? `<div class="rule">${ico('shieldCheck')}<span>${esc(f.rule)}</span></div>` : ''}
    <div class="btn-row"><button class="btn primary" data-act="trapLesson" data-val="${esc(s.id)}">Replay the full lesson</button><button class="btn outline" data-act="trapDone">I've got it</button></div>
  </div>`;
}

/* ---------- the Buddy tab ---------- */
function meter(label, value, frac, hint, cls) {
  return `<div class="meter"><div class="lbl"><span>${label}</span><b>${value}</b></div><div class="bar"><div class="fill ${cls || ''}" style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></div></div><div class="hint">${hint}</div></div>`;
}
function petScreen() {
  const P = S.pet;
  if (!P || P.lineId !== curLine().lineId) { loadPet().catch(fail); return `${header('Buddy', {})}<div class="card"><p class="desc">Waking Buddy up…</p></div>`; }
  const a = S.petAnim, trap = S.trap, b = P.breakdown;
  const from = a && a.from != null ? a.from : P.health;
  setTimeout(() => { const f = document.querySelector('.hbar .fill[data-to]'); if (f) requestAnimationFrame(() => { f.style.width = f.dataset.to + '%'; }); }, 0);
  const line = trap ? 'Ouch. That link was the trap.' : a?.kind === 'heal' ? 'Yes! I feel stronger already.' : a?.kind === 'hurt' ? 'Ow. That one got me.' : pickLine(PET_LINES[P.mood] || PET_LINES.happy);
  const pillCls = P.health >= 60 ? 'green' : P.health >= 40 ? '' : 'amber';
  const barCls = P.health >= 60 ? 'good' : P.health >= 40 ? 'mid' : 'low';
  const offList = b.settings.off.map(k => TOGGLE_LABEL[k]).join(', ');
  return `
  ${header('Buddy', { icons: [['info', 'toast', "Buddy's health follows your ScamShield habits: protections on, practice scams caught, quick checks answered."]] })}
  <div class="card stage mood-${P.mood} ${a ? 'anim-' + a.kind : ''}">
    <div class="between"><div><div class="eyebrow">ScamShield Buddy</div><div class="big">Level ${P.level}</div></div><span class="dotpill ${pillCls}">${P.status}</span></div>
    <div class="petwrap">${petSvg(P.mood)}${a && a.delta ? `<div class="float ${a.delta < 0 ? 'neg' : 'pos'}">${a.delta > 0 ? '+' : ''}${a.delta}</div>` : ''}<div class="flash"></div></div>
    <div class="bubble">${esc(line)}</div>
    <div class="hbar"><div class="lbl"><span>Health</span><b>${P.health}/100</b></div><div class="bar"><div class="fill ${barCls}" style="width:${from}%" data-to="${P.health}"></div></div></div>
    <div class="xbar"><div class="lbl"><span>XP to level ${P.level + 1}</span><b>${P.xpInLevel}/100</b></div><div class="bar"><div class="fill" style="width:${P.xpInLevel}%"></div></div></div>
  </div>
  ${trap ? trapCard(trap) : ''}
  <h2 class="section">Security health</h2>
  <div class="card">
    ${meter('Protection settings', `${b.settings.pts}/${b.settings.max}`, b.settings.pts / b.settings.max, offList ? `Turn on ${offList} to armor Buddy up` : 'Every protection is on')}
    ${meter('Scam practice', `${b.practice.caught}/${b.practice.total} caught`, b.practice.total ? b.practice.caught / b.practice.total : 0, b.practice.traps ? `${b.practice.traps} trap link${b.practice.traps > 1 ? 's' : ''} tapped this month` : 'No trap links tapped this month')}
    ${meter('Quick checks', `${b.quiz.right}/${b.quiz.total} right`, b.quiz.total ? b.quiz.right / b.quiz.total : 0, 'Short questions pop up now and then while you use T-Life')}
    ${meter('Reports', `${b.reports} this month`, Math.min(1, b.reports / 5), 'Every number you report feeds Buddy and ScamShield')}
  </div>
  <h2 class="section">Strengthen Buddy</h2>
  <div class="card flush">
    ${row({ icon: 'sparkles', title: 'Answer a quick check', sub: '+5 health when you get it right', act: 'quizNow', val: '' })}
    ${row({ icon: 'message', title: 'Practice a scam text', sub: '+12 when you catch it, -25 if you tap the link', act: 'practice', val: 'simulator' })}
    ${row({ icon: 'shieldCheck', title: 'Review protection settings', sub: b.settings.off.length ? `${b.settings.off.length} protection${b.settings.off.length > 1 ? 's' : ''} still off` : 'All protections on', act: 'lessonGo', val: 'scamshield' })}
    <div class="row"><div class="ico">${ico('bell')}</div><div class="txt"><div class="t">Pop quizzes</div><div class="s">A subtle question every 20 to 40 seconds</div></div><button class="switch ${S.quizOn ? 'on' : ''}" data-act="quizToggle" role="switch" aria-checked="${!!S.quizOn}"></button></div>
  </div>
  <h2 class="section">Recent</h2>
  <div class="card flush">${P.events.length ? P.events.map(e => row({ icon: e.delta < 0 ? 'alert' : 'checkCircle', cls: e.delta < 0 ? 'red' : 'green', title: esc(KIND_LABEL[e.kind] || e.kind), sub: esc(e.note || ''), meta: `<b class="${e.delta < 0 ? 'neg' : 'pos'}">${e.delta > 0 ? '+' : ''}${e.delta}</b>`, chev: false })).join('') : emptyHtml('Nothing yet. Buddy is waiting for your first move.', 'heart')}</div>
  <p class="note">Health is 40 to start, up to 20 more from protection settings, plus the last 30 days of practice outcomes, quick checks and reports. Buddy only ever sees outcomes, never the content of real calls or texts.</p>`;
}

/* ---------- pop quizzes ---------- */
const quizTimers = {};
let nextQuizAt = Date.now() + 20000;
function quizTick() {
  if (!S.ready || !S.quizOn || S.quiz || S.call || S.sheet || S.trap) return;
  if (current() === 'learn-chat' || document.visibilityState !== 'visible') return;
  if (Date.now() < nextQuizAt) return;
  popQuiz().catch(() => { nextQuizAt = Date.now() + 30000; });
}
async function popQuiz(force) {
  if (S.quiz && !force) return;
  const qn = await api.get(`/pet/${curLine().lineId}/quiz`);
  S.quiz = { ...qn, shownAt: Date.now(), result: null }; renderOverlay();
  clearTimeout(quizTimers.auto); quizTimers.auto = setTimeout(() => { if (S.quiz && !S.quiz.result) dismissQuiz(); }, 18000);
}
function dismissQuiz() { S.quiz = null; nextQuizAt = Date.now() + 20000 + Math.random() * 20000; clearTimeout(quizTimers.auto); renderOverlay(); }
async function answerQuiz(choice) {
  const qz = S.quiz; if (!qz || qz.result) return;
  qz.result = { pending: true }; renderOverlay();
  try {
    const r = await api.post(`/pet/${curLine().lineId}/quiz`, { id: qz.id, choice: +choice });
    qz.result = r; qz.choice = +choice; renderOverlay();
    clearTimeout(quizTimers.auto); quizTimers.auto = setTimeout(dismissQuiz, 7000);
  } catch (e) { qz.result = null; renderOverlay(); fail(e); }
}
function quizHtml() {
  const qz = S.quiz; if (!qz) return '';
  const r = qz.result, done = r && !r.pending;
  return `<div class="quizpop ${done ? (r.correct ? 'right' : 'wrong') : ''}">
    <div class="qh"><div class="mini">${petSvg(done ? (r.correct ? 'thriving' : 'sick') : (S.pet?.mood || 'happy'))}</div><div class="qt"><div class="eyebrow">Quick check from Buddy</div><div class="q">${esc(qz.q)}</div></div><button class="icon-btn" data-act="quizDismiss" aria-label="Dismiss">${ico('x')}</button></div>
    ${done ? `<div class="qr"><b>${r.correct ? `Right. +${r.delta} health` : `Not quite. ${r.delta} health`}</b><p>${esc(r.why)}</p></div>`
           : `<div class="qo">${qz.options.map((o, i) => `<button class="chip" data-act="quizAnswer" data-val="${i}" ${r?.pending ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>`}
  </div>`;
}
function BUDDY_ACTIONS(v) {
  return {
    quizAnswer: () => answerQuiz(v),
    quizDismiss: dismissQuiz,
    quizNow: () => popQuiz(true).catch(fail),
    quizToggle: () => { S.quizOn = !S.quizOn; if (!S.quizOn) S.quiz = null; render(); toast(S.quizOn ? 'Pop quizzes on' : 'Pop quizzes off'); },
    trapDone: () => { S.trap = null; render(true); },
    trapLesson: () => { S.trap = null; openLesson(v).catch(fail); },
  };
}
setInterval(quizTick, 1000);

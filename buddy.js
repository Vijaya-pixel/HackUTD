/* ScamShield Buddy: the pet that gamifies the Learn tab. Its energy mirrors security habits: protections on,
   practice scams caught, quick checks answered, numbers reported; traps and wrong answers drain it.
   Loaded before app.js; everything here runs at call time and uses app.js globals (S, api, ico, esc, row, …).
   Pieces: the pet stage (top of Learn), the security-energy dashboard, the "Question?" bubble quiz that only
   appears on the Learn tab, and the trap reveal when a practice-scam link is tapped. */

const PET_LINES = {
  thriving: ['I feel unstoppable. Send the scammers my way.', 'Look at this armor. Nothing gets past us.', 'Top form. Keep spotting those red flags.'],
  happy: ['Feeling good. One quick check and I level up.', 'Nice habits. Scam Block has my back.', 'Steady and charged. Keep it up.'],
  tired: ['A bit drained. A quick check would perk me up.', 'Could use a win. Catch the next practice text?', 'Not my best day. Turn on a protection for me?'],
  sick: ['Ugh. Too many traps lately. Help me recharge.', 'I need some wins. Try a practice text and catch it.', 'Scam Block and Caller ID would help me recover.'],
  critical: ['I am barely standing. Please do not tap any links.', 'Critical. Every correct answer counts now.', 'Help. Turn protections on and catch the next scam.'],
};
const KIND_LABEL = { game_win: 'Cleared a Quest stop', game_loss: 'Lost a Quest stop', caught: 'Caught a practice scam', fell: 'Fell for a practice scam', trap: 'Tapped the trap link', quiz_right: 'Quick check answered', quiz_wrong: 'Quick check missed', report: 'Reported a number', bonus: 'Bonus' };
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
  if (d && current() !== 'learn' && !S.trap) toast(d < 0 ? `Buddy lost ${-d} energy: ${ev.event.note}` : `Buddy gained ${d} energy: ${ev.event.note}`, d < 0 ? 'block' : '');
}

/* ---------- the trap: a practice-scam link was tapped ---------- */
async function startTrap(sessionId) {
  S.tab = 'learn'; S.stack = []; S.sheet = null; S.quiz = null; S.trap = { sessionId, session: null }; save(); render(true);
  const hadAnim = !!S.petAnim;
  try { S.trap.session = await api.get(`/learn/session/${sessionId}`); } catch (e) { S.trap.error = e.message; }
  try { await loadPet(); } catch {}
  loadLearn().catch(() => {});
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

/* ---------- pet stage (top of the Learn tab) ---------- */
function bubbleHtml(P, a, trap) {
  const qz = S.quiz;
  if (qz && !trap) {
    const r = qz.result, done = r && !r.pending;
    if (!qz.open) return `<button class="bubble ask" data-act="quizOpen" data-hover="quizOpen"><span class="qmark">?</span><span>Buddy has a question for you</span><span class="tap">Tap to see</span></button>`;
    return `<div class="bubble quiz ${done ? (r.correct ? 'right' : 'wrong') : ''}">
      <div class="qh"><div class="eyebrow">Quick check</div><button class="icon-btn" data-act="quizDismiss" aria-label="Dismiss">${ico('x')}</button></div>
      <div class="q">${esc(qz.q)}</div>
      ${done ? `<div class="qr"><b>${r.correct ? `Right. +${r.delta} energy` : `Not quite. ${r.delta} energy`}</b><p>${esc(r.why)}</p></div>`
             : `<div class="qo">${qz.options.map((o, i) => `<button class="chip" data-act="quizAnswer" data-val="${i}" ${r?.pending ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>`}
    </div>`;
  }
  const line = trap ? 'Ouch. That link was the trap.' : a?.kind === 'heal' ? 'Yes! I feel stronger already.' : a?.kind === 'hurt' ? 'Ow. That one got me.' : pickLine(PET_LINES[P.mood] || PET_LINES.happy);
  return `<div class="bubble">${esc(line)}</div>`;
}
function petStage() {
  const P = S.pet;
  if (!P || P.lineId !== curLine().lineId) { loadPet().catch(fail); return `<div class="card stage"><div class="petwrap">${petSvg('happy')}</div><div class="bubble">Waking up…</div></div>`; }
  const a = S.petAnim, trap = S.trap;
  const from = a && a.from != null ? a.from : P.health;
  setTimeout(() => { const f = document.querySelector('.hbar .fill[data-to]'); if (f) requestAnimationFrame(() => { f.style.width = f.dataset.to + '%'; }); }, 0);
  // 3D mascot reactions: temporary expressions on top of the health-driven one
  const reaction = a?.kind === 'heal' ? 'celebrating' : a && a.kind !== 'heal' ? 'surprised' : (S.quiz?.open && !S.quiz.result) ? 'determined' : null;
  setTimeout(() => { const el = document.querySelector('.petwrap .pet3d'); if (el && window.Buddy3D && window.Buddy3D.attach(el, { health: P.health, reaction })) el.classList.add('live'); }, 0);
  const pillCls = P.health >= 60 ? 'green' : P.health >= 40 ? '' : 'amber';
  const barCls = P.health >= 60 ? 'good' : P.health >= 40 ? 'mid' : 'low';
  return `
  <div class="card stage mood-${P.mood} ${a ? 'anim-' + a.kind : ''}">
    <div class="between"><div><div class="eyebrow">ScamShield Buddy</div><div class="big">Level ${P.level}</div></div><span class="dotpill ${pillCls}">${P.status}</span></div>
    <div class="petwrap"><div class="pet3d">${petSvg(P.mood)}</div>${a && a.delta ? `<div class="float ${a.delta < 0 ? 'neg' : 'pos'}">${a.delta > 0 ? '+' : ''}${a.delta}</div>` : ''}<div class="flash"></div></div>
    ${bubbleHtml(P, a, trap)}
    <div class="hbar"><div class="lbl"><span>Energy</span><b>${P.health}/100</b></div><div class="bar"><div class="fill ${barCls}" style="width:${from}%" data-to="${P.health}"></div></div></div>
    <div class="xbar"><div class="lbl"><span>XP to level ${P.level + 1}</span><b>${P.xpInLevel}/100</b></div><div class="bar"><div class="fill" style="width:${P.xpInLevel}%"></div></div></div>
  </div>
  ${trap ? trapCard(trap) : ''}`;
}
function meter(label, value, frac, hint) {
  return `<div class="meter"><div class="lbl"><span>${label}</span><b>${value}</b></div><div class="bar"><div class="fill" style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></div></div><div class="hint">${hint}</div></div>`;
}
function petDashboard() {
  const P = S.pet; if (!P || P.lineId !== curLine().lineId) return '';
  const b = P.breakdown, offList = b.settings.off.map(k => TOGGLE_LABEL[k]).join(', ');
  return `
  <h2 class="section">Buddy's energy</h2>
  <div class="card">
    ${meter('Protection settings', `${b.settings.pts}/${b.settings.max}`, b.settings.pts / b.settings.max, offList ? `Turn on ${offList} to armor Buddy up` : 'Every protection is on')}
    ${meter('Scam practice', `${b.practice.caught}/${b.practice.total} caught`, b.practice.total ? b.practice.caught / b.practice.total : 0, b.practice.traps ? `${b.practice.traps} trap link${b.practice.traps > 1 ? 's' : ''} tapped this month, -25 each` : 'No trap links tapped this month')}
    ${meter('Quick checks', `${b.quiz.right}/${b.quiz.total} right`, b.quiz.total ? b.quiz.right / b.quiz.total : 0, 'Buddy asks a question now and then while you are here. +5 right, -6 wrong')}
    ${meter('Reports', `${b.reports} this month`, Math.min(1, b.reports / 5), 'Every number you report gives Buddy +4')}
  </div>`;
}
function petLog() {
  const P = S.pet; if (!P || P.lineId !== curLine().lineId || !P.events.length) return '';
  return `<h2 class="section">Energy log</h2>
  <div class="card flush">${P.events.slice(0, 6).map(e => row({ icon: e.delta < 0 ? 'alert' : 'checkCircle', cls: e.delta < 0 ? 'red' : 'green', title: esc(KIND_LABEL[e.kind] || e.kind), sub: esc(e.note || ''), meta: `<b class="${e.delta < 0 ? 'neg' : 'pos'}">${e.delta > 0 ? '+' : ''}${e.delta}</b>`, chev: false })).join('')}</div>`;
}

/* ---------- quick checks: a "Question?" bubble on Buddy, only on the Learn tab ---------- */
const quizTimers = {};
let nextQuizAt = Date.now() + 20000;
function quizTick() {
  if (!S.ready || !S.quizOn || S.quiz || S.call || S.sheet || S.trap) return;
  if (current() !== 'learn' || document.visibilityState !== 'visible') return;
  if (Date.now() < nextQuizAt) return;
  popQuiz().catch(() => { nextQuizAt = Date.now() + 30000; });
}
async function popQuiz(force) {
  if (S.quiz && !force) return;
  const qn = await api.get(`/pet/${curLine().lineId}/quiz`);
  S.quiz = { ...qn, shownAt: Date.now(), result: null, open: !!force }; render();
  clearTimeout(quizTimers.auto); quizTimers.auto = setTimeout(() => { if (S.quiz && !S.quiz.result && !S.quiz.open) dismissQuiz(); }, 45000);
}
function openQuiz() { if (S.quiz && !S.quiz.open) { S.quiz.open = true; clearTimeout(quizTimers.auto); render(); } }
function dismissQuiz() { S.quiz = null; nextQuizAt = Date.now() + 20000 + Math.random() * 20000; clearTimeout(quizTimers.auto); render(); }
async function answerQuiz(choice) {
  const qz = S.quiz; if (!qz || qz.result) return;
  qz.result = { pending: true }; render();
  try {
    const r = await api.post(`/pet/${curLine().lineId}/quiz`, { id: qz.id, choice: +choice });
    qz.result = r; qz.choice = +choice; render();
    clearTimeout(quizTimers.auto); quizTimers.auto = setTimeout(dismissQuiz, 8000);
  } catch (e) { qz.result = null; render(); fail(e); }
}
function quizHtml() { return ''; } // the question lives in Buddy's bubble now
function BUDDY_ACTIONS(v) {
  return {
    quizAnswer: () => answerQuiz(v),
    quizOpen: openQuiz,
    quizDismiss: dismissQuiz,
    quizNow: () => popQuiz(true).catch(fail),
    quizToggle: () => { S.quizOn = !S.quizOn; if (!S.quizOn) S.quiz = null; render(); toast(S.quizOn ? 'Quick checks on' : 'Quick checks off'); },
    trapDone: () => { S.trap = null; render(true); },
    trapLesson: () => { S.trap = null; openLesson(v).catch(fail); },
  };
}
// Quick questions retired: learning happens in the Quest minigames now.
document.addEventListener('buddy3d-ready', () => { if (typeof current === 'function' && current() === 'learn') render(); });

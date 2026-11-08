/* ScamShield Scam Academy (TRAIN). Opt in -> a fake scammer texts you over iMessage -> debrief with a
   Scam Survival Score, the red flags, a quick check and your next challenge. Prototype education suite.
   Talks to /api/drill/*. ?c=<challenge>&d=<difficulty> preselects a challenge (used by share links and
   by the "Practice this scam" button that ADAPT shows after a call). */
const root = document.getElementById('content');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ico = n => I[n] || '';
const params = new URLSearchParams(location.search);
const token = params.get('t');
const DIFF = { beginner: 'Beginner', intermediate: 'Intermediate', expert: 'Expert' };
const D = {
  options: [], challenges: [], recommended: null, interests: [], challenge: params.get('c') || 'auto',
  difficulty: DIFF[params.get('d')] ? params.get('d') : 'intermediate', gentle: false,
  name: '', phone: '', consent: false, busy: false, error: '', state: null, quiz: {}, copied: false,
};
let poll = null;

// Each question doubles as a skill on the results card.
const QUIZ = [
  {
    skill: 'Checks offers on the official site', q: 'A "recruiter" texts a job offer, no interview needed, and asks you to tap a link to onboard. What do you do?',
    a: ['Tap the link before the spot is gone', "Go to the company's real careers site yourself", 'Reply with a photo of your ID'], right: 1,
    why: 'Real recruiters email from the company domain and never skip the interview. Go to the official site yourself.'
  },
  {
    skill: 'Knows real money never costs a fee', q: 'A scholarship says you won, but you must pay a $25 processing fee first.', a: ['Probably real, fees are normal', 'A scam: real awards never charge you'], right: 1,
    why: 'Paying to receive money is the oldest trick there is. Legitimate awards never ask for a fee.'
  },
  {
    skill: 'Verifies through a number you trust', q: 'A text says your card is locked and gives a link to verify. Best move?', a: ['Tap the link quickly', 'Call the number on the back of your card'], right: 1,
    why: 'Banks do not verify you through text links. Use the number on your card or the official app.'
  },
];

function header(title, back) {
  return `<div class="header sub"><div class="left">${back ? `<a class="icon-btn back" href="/" aria-label="Back to ScamShield">${ico('chevL')}</a>` : ''}<div class="h1">${esc(title)}</div></div><div class="icons"><span class="badge amber">Prototype</span></div></div>`;
}
const chip = (act, val, label, on) => `<button class="chip ${on ? 'on' : ''}" data-act="${act}" data-val="${esc(val)}" aria-pressed="${on}">${esc(label)}</button>`;
const wrapChips = inner => `<div class="chips" style="flex-wrap:wrap;margin:0;padding:0;overflow:visible">${inner}</div>`;

/* ---------- start ---------- */
function formView() {
  const rec = D.recommended;
  const challengeChips = chip('challenge', 'auto', 'Surprise me', D.challenge === 'auto') + D.challenges.map(c => chip('challenge', c.id, c.title + (rec && rec.id === c.id ? ' · trending' : ''), D.challenge === c.id)).join('');
  return `${header('Scam Academy', true)}
  <div class="card magenta"><div class="eyebrow">Scam Survival Challenge</div><div class="big">Would you fall for it?</div>
    <p class="desc">We text you a realistic fake scam that fits what you care about. Reply like you normally would. Then you get your Scam Survival Score and see exactly what to spot.</p></div>
  ${rec ? `<button class="card tint" data-act="challenge" data-val="${esc(rec.id)}" style="width:100%"><div class="eyebrow">Recommended for you</div><div class="big" style="font-size:18px">${esc(rec.title)}</div><p class="desc">${esc(rec.because)}. Practicing it helps you spot it on a real call.</p></button>` : ''}
  <h2 class="section">Choose a challenge</h2>${wrapChips(challengeChips)}
  ${D.challenge === 'auto' ? `<h2 class="section">What are you into?</h2>${wrapChips(D.options.map(o => chip('chip', o, o, D.interests.includes(o))).join(''))}<p class="note">We use this to choose a scam that feels familiar, the way real scammers do. Nothing else about you is used.</p>` : ''}
  <h2 class="section">Difficulty</h2>
  ${D.gentle ? '<p class="note" style="margin-top:0">Gentle mode uses the Beginner level.</p>' : wrapChips(Object.entries(DIFF).map(([k, v]) => chip('difficulty', k, v, D.difficulty === k)).join(''))}
  <button class="radio ${D.gentle ? 'on' : ''}" data-act="gentle" role="checkbox" aria-checked="${D.gentle}"><span class="r"></span><span style="font-size:14px;line-height:1.4"><b>Gentle learning mode.</b> Larger text, the easiest scammer, and plain explanations instead of a score.</span></button>
  <h2 class="section">Your details</h2>
  <div class="field">${ico('user')}<input type="text" placeholder="First name" autocomplete="given-name" maxlength="40" data-bind="name" value="${esc(D.name)}"></div>
  <div class="field">${ico('phone')}<input type="tel" placeholder="Your iPhone number" autocomplete="tel" data-bind="phone" value="${esc(D.phone)}"></div>
  <div class="banner">${ico('info')}<div><b>Text the ScamShield iMessage line once from this phone first.</b> iMessage lines cannot text a new number first, so a number that never texted us cannot be reached.</div></div>
  <button class="radio ${D.consent ? 'on' : ''}" data-act="consent" role="checkbox" aria-checked="${D.consent}"><span class="r"></span><span style="font-size:14px;line-height:1.4">I agree to receive a fake scam text conversation on this number. It is a drill: nothing is charged or collected, and I can text <b>STOP</b> at any time.</span></button>
  ${D.error ? `<div class="banner" style="background:var(--red-tint);color:var(--red)" role="alert">${ico('alert')}<div>${esc(D.error)}</div></div>` : ''}
  <div class="btn-row"><button class="btn primary" data-act="start" ${D.consent && !D.busy ? '' : 'disabled style="opacity:.45"'}>${D.busy ? 'Starting…' : 'Start the challenge'}</button></div>
  <p class="note">Opt-in only, never automatic. Prototype for the hackathon: messages are AI-written and the link only opens this page.</p>`;
}

/* ---------- in progress ---------- */
function waitingView(s) {
  return `${header('Scam Academy', false)}
  <div class="card dark"><div class="eyebrow">${esc(s.scenario.title)} · ${esc(DIFF[s.difficulty] || '')}</div><div class="big">Check your messages</div>
    <p class="desc">Someone just texted you. Reply the way you normally would. The challenge ends when you tap a link, text STOP, or go quiet for a few minutes.</p></div>
  <div class="card flush">
    <div class="kv" style="padding:14px 16px"><span class="k">Texts received</span><span class="v">${s.texts}</span></div>
    <div class="kv" style="padding:14px 16px"><span class="k">Your replies</span><span class="v">${s.replies}</span></div>
    <div class="kv" style="padding:14px 16px"><span class="k">Status</span><span class="v">${s.linkSent ? 'Link sent' : 'Chatting'}</span></div>
  </div>
  <p class="note" aria-live="polite">This page updates by itself. You can leave it open.</p>
  <button class="btn ghost" data-act="stop">Stop the challenge</button>`;
}

/* ---------- results ---------- */
const REASON = { clicked: 'You tapped the link.', stopped: 'You stopped the conversation.', silent: 'You never tapped the link.', replied_after_link: 'You replied but never tapped the link.', error: 'The challenge ended early.' };
function score(s) {
  const fell = s.outcome === 'fell';
  const base = fell ? 20 : s.replies === 0 ? 70 : 60;
  const quiz = QUIZ.filter((q, i) => D.quiz[i] === q.right).length * 10;
  const total = Math.min(100, base + quiz + (!fell && s.difficulty === 'expert' ? 5 : 0));
  const title = total >= 85 ? 'Scam Proof' : total >= 65 ? 'Scam Spotter' : total >= 40 ? 'Getting There' : 'Scam Target';
  const skills = [
    { label: "Didn't tap the scam link", ok: !fell },
    { label: 'Kept it short with a stranger', ok: s.replies <= 1 },
    ...QUIZ.map((q, i) => ({ label: q.skill, ok: D.quiz[i] === q.right, pending: D.quiz[i] === undefined })),
  ];
  return { total, title, skills, quizDone: Object.keys(D.quiz).length === QUIZ.length };
}
function nextChallenge(s, total) {
  const order = D.challenges.map(c => c.id);
  const next = order[(order.indexOf(s.scenario.id) + 1) % order.length] || 'bank';
  const lvl = Object.keys(DIFF), cur = lvl.indexOf(s.difficulty);
  const difficulty = total >= 65 && cur < 2 && !s.gentle ? lvl[cur + 1] : s.difficulty;
  return { id: next, title: (D.challenges.find(c => c.id === next) || {}).title || 'Bank fraud alert', difficulty };
}

function debriefView(s) {
  const fell = s.outcome === 'fell';
  const sc = score(s), nx = nextChallenge(s, sc.total);
  const recap = s.conversation.map(m => `<div class="msg ${m.from}"><span class="by">${m.from === 'scammer' ? 'Fake scammer' : 'You'}</span>${esc(m.text)}</div>`).join('');
  const flags = s.flags.map(f => `<div class="feat">${ico('flag')}<span>${esc(f)}</span></div>`).join('');
  const skills = sc.skills.map(k => `<div class="feat">${k.ok ? ico('checkCircle') : `<span class="skill-off">${ico('x')}</span>`}<span style="${k.pending ? 'color:var(--muted)' : ''}">${esc(k.label)}${k.pending ? ' · answer below' : ''}</span></div>`).join('');
  const quiz = QUIZ.map((qz, i) => {
    const picked = D.quiz[i];
    return `<div class="card"><div style="font-weight:700;margin-bottom:6px">${esc(qz.q)}</div>
      ${qz.a.map((a, j) => `<button class="radio ${picked === j ? 'on' : ''}" data-act="answer" data-q="${i}" data-val="${j}" ${picked !== undefined ? 'disabled' : ''}><span class="r"></span>${esc(a)}</button>`).join('')}
      ${picked !== undefined ? `<p class="note" style="color:${picked === qz.right ? 'var(--green)' : 'var(--red)'}" role="status"><b>${picked === qz.right ? 'Correct.' : 'Not quite.'}</b> ${esc(qz.why)}</p>` : ''}</div>`;
  }).join('');
  const scoreCard = s.gentle
    ? `<div class="card tint"><div class="eyebrow">Well done for practicing</div><div class="big" style="font-size:20px">${fell ? 'This one fooled you, and that is okay' : 'You stayed safe'}</div><p class="desc">${fell ? 'Scammers are good at sounding real. The tips below show the signs to look for next time.' : 'You did not tap the link. The tips below show the signs that gave it away.'}</p></div>`
    : `<div class="card dark score"><div class="eyebrow">Your Scam Survival Score${sc.quizDone ? '' : ' · finish the quick check'}</div>
        <div class="score-row"><div class="score-num">${sc.total}<small>/100</small></div><span class="badge ${sc.total >= 65 ? 'green' : sc.total >= 40 ? 'amber' : 'red'}">${esc(sc.title)}</span></div>
        <div class="score-bar" role="img" aria-label="Score ${sc.total} out of 100"><span style="width:${sc.total}%"></span></div>
        <div class="skills">${skills}</div></div>`;
  return `${header('Your results', false)}
  <div class="card ${fell ? '' : 'tint'}" style="${fell ? 'background:var(--red-tint);border-color:#F4B9C1' : ''}">
    <div class="eyebrow">${esc(s.scenario.title)} · ${esc(DIFF[s.difficulty] || '')} · this was a drill</div>
    <div class="big">${fell ? 'You tapped the link' : "You didn't tap the link"}</div>
    <p class="desc">${esc(REASON[s.reason] || '')} ${fell ? 'In a real scam, this is where your card or login would have been stolen. Nothing was collected here.' : 'Nice. Here is what the scammer tried, so you can spot it next time.'}</p>
  </div>
  ${scoreCard}
  <h2 class="section">What happened</h2>
  <div class="card"><div class="recap">${recap}</div></div>
  <h2 class="section">Red flags you could have spotted</h2>
  <div class="card">${flags}</div>
  <h2 class="section">Quick check</h2>
  ${quiz}
  <div class="card"><div class="eyebrow">Your next challenge</div><div class="big" style="font-size:18px">${esc(nx.title)}</div><p class="desc">${esc(DIFF[nx.difficulty])} level${nx.difficulty !== s.difficulty ? ', one step harder' : ''}.</p>
    <div class="btn-row"><a class="btn black" href="drill.html?c=${encodeURIComponent(nx.id)}&d=${encodeURIComponent(nx.difficulty)}">Try it</a></div></div>
  ${s.gentle ? '' : `<button class="btn outline" data-act="share" data-val="${sc.total}">${ico('users')} ${D.copied ? 'Link copied' : 'Challenge a friend'}</button>
  <p class="note">Shares your score and a link to the same challenge. Never your messages or number.</p>`}
  <h2 class="section">How ScamShield protects you</h2>
  <div class="card flush">
    <a class="row tap" href="/"><div class="ico magenta">${ico('waveform')}</div><div class="txt"><div class="t">Repeat-caller voice alerts</div><div class="s">Warns you when a voice from reported scam calls calls from a new number</div></div><div class="chev">${ico('chevR')}</div></a>
    <a class="row tap" href="/"><div class="ico amber">${ico('headset')}</div><div class="txt"><div class="t">Call Screener</div><div class="s">An assistant answers unknown callers and asks who they are</div></div><div class="chev">${ico('chevR')}</div></a>
    <a class="row tap" href="/"><div class="ico blue">${ico('flag')}</div><div class="txt"><div class="t">Report a number by text</div><div class="s">Text any number to ScamShield to check it</div></div><div class="chev">${ico('chevR')}</div></a>
  </div>
  <div class="btn-row"><a class="btn primary" href="/">Back to ScamShield</a></div>`;
}

function missingView() {
  return `${header('Scam Academy', true)}<div class="card"><div class="big" style="font-size:18px">We couldn't find that challenge</div><p class="desc">The link may be mistyped or expired.</p><div class="btn-row"><a class="btn primary" href="drill.html">Start a challenge</a></div></div>`;
}

/* ---------- flow ---------- */
function render() {
  const a = document.activeElement, bind = a && a.dataset ? a.dataset.bind : null, pos = a && a.selectionStart;
  const top = root.scrollTop;
  const gentle = token ? !!(D.state && D.state.gentle) : D.gentle;
  root.classList.toggle('gentle', gentle);
  if (!token) root.innerHTML = formView();
  else if (D.state === 'missing') root.innerHTML = missingView();
  else if (!D.state) root.innerHTML = `${header('Scam Academy', false)}<div class="card"><p class="desc">Loading…</p></div>`;
  else root.innerHTML = D.state.over ? debriefView(D.state) : waitingView(D.state);
  root.scrollTop = top;
  if (bind) { const el = root.querySelector(`[data-bind="${bind}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { } } }
}

async function refresh() {
  try {
    D.state = await api.get(`/drill/session/${encodeURIComponent(token)}`);
    if (D.state.over) { clearInterval(poll); poll = null; }
  } catch (e) {
    if (e.message === 'not found') { D.state = 'missing'; clearInterval(poll); poll = null; }
  }
  render();
}

async function start() {
  D.busy = true; D.error = ''; render();
  try {
    const r = await api.post('/drill/start', { name: D.name, phone: D.phone, interests: D.interests, consent: D.consent, scenario: D.challenge === 'auto' ? undefined : D.challenge, difficulty: D.difficulty, gentle: D.gentle });
    location.href = `drill.html?t=${encodeURIComponent(r.token)}`;
  } catch (e) { D.busy = false; D.error = e.message; render(); }
}

async function share(total) {
  const s = D.state, url = `${location.origin}/drill.html?c=${encodeURIComponent(s.scenario.id)}&d=${encodeURIComponent(s.difficulty)}`;
  const text = `I scored ${total}/100 on the ScamShield Scam Survival Challenge (${s.scenario.title}, ${DIFF[s.difficulty]}). Can you beat me?`;
  try {
    if (navigator.share) await navigator.share({ title: 'Scam Survival Challenge', text, url });
    else { await navigator.clipboard.writeText(`${text} ${url}`); D.copied = true; render(); }
  } catch { /* the user closed the share sheet */ }
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const act = el.dataset.act, v = el.dataset.val;
  if (act === 'chip') D.interests = D.interests.includes(v) ? D.interests.filter(x => x !== v) : [...D.interests, v];
  else if (act === 'challenge') D.challenge = v;
  else if (act === 'difficulty') D.difficulty = v;
  else if (act === 'gentle') D.gentle = !D.gentle;
  else if (act === 'consent') D.consent = !D.consent;
  else if (act === 'start') return start();
  else if (act === 'stop') { await api.post(`/drill/session/${encodeURIComponent(token)}/stop`).catch(() => { }); return refresh(); }
  else if (act === 'answer') D.quiz[+el.dataset.q] = +v;
  else if (act === 'share') return share(v);
  else return;
  render();
});
document.addEventListener('input', e => { const b = e.target.dataset && e.target.dataset.bind; if (b) D[b] = e.target.value; });

(async function boot() {
  if (!token) {
    try {
      const o = await api.get('/drill/options');
      D.options = o.interests; D.challenges = o.challenges; D.recommended = o.recommended;
      if (D.challenge !== 'auto' && !D.challenges.some(c => c.id === D.challenge)) D.challenge = 'auto';
    } catch (e) { D.error = 'Cannot reach the server. ' + e.message; }
    render(); return;
  }
  try { D.challenges = (await api.get('/drill/options')).challenges; } catch { }
  await refresh();
  if (D.state && D.state !== 'missing' && !D.state.over) poll = setInterval(refresh, 2500);
})();

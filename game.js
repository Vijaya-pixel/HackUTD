/* ScamShield Quest: the Learn tab as a game. Buddy travels a map of stops; each stop is a short, playable
   minigame built around one scam situation. Stars unlock the next stop, wins and losses change Buddy's energy
   on the server (pet_events), progress is saved per line (game_progress).
   Loaded before app.js; uses app.js globals (S, api, ico, esc, row, toast, render, renderOverlay, …). */

/* ---------- the map ---------- */
const QUEST = [
  { id: 'texttrap', title: 'Text Trap', kind: 'sorter', icon: 'message', x: 50, y: 80, color: '#E20074', blurb: 'Texts fly in. Call each one Legit or Scam before the timer runs out.', teaches: 'Delivery, toll and account texts' },
  { id: 'linklens', title: 'Link Lens', kind: 'links', icon: 'globe', x: 18, y: 58, color: '#7A3BFF', blurb: 'Three links, one is real. Read what comes right before the first slash.', teaches: 'Look-alike domains' },
  { id: 'hangup', title: 'Hang Up', kind: 'call', icon: 'phoneOff', x: 80, y: 60, color: '#D7263D', blurb: 'A caller talks. Hit Hang up the moment you hear the red flag, before they ask for anything.', teaches: 'Phone scams and pressure' },
  { id: 'codekeeper', title: 'Code Keeper', kind: 'chat', icon: 'lock', x: 28, y: 30, color: '#1E9E5A', blurb: 'Your "bank" is texting. Pick the reply that keeps your code yours.', teaches: 'One-time codes and PINs' },
  { id: 'familysos', title: 'Family SOS', kind: 'chat', icon: 'users', x: 76, y: 32, color: '#E09A00', blurb: 'An emergency text from "family". Choose what to do, step by step.', teaches: 'Family emergency scams' },
  { id: 'storm', title: 'Scam Storm', kind: 'storm', icon: 'alert', x: 52, y: 10, color: '#1A1A1A', boss: true, blurb: 'Boss round. Everything at once, faster. Eight of ten to clear it.', teaches: 'All of the above, under pressure' },
];
const STARS = r => r >= .9 ? 3 : r >= .7 ? 2 : r >= .5 ? 1 : 0;
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------- content ---------- */
const SMS_POOL = [
  { from: 'ParcelGo', text: 'Your package is held. Pay a $3.50 redelivery fee within 24h: parcelgo-fee.co/x92', scam: true, why: 'Carriers never charge redelivery fees by text link.' },
  { from: '77283', text: 'Your prescription is ready for pickup at CVS 4th St. Reply STOP to opt out.', scam: false, why: 'A short code, no link, no urgency, and it matches something you actually use.' },
  { from: 'TollPass', text: 'Unpaid toll $6.90. Avoid a $50 fine, pay today: tollpass-secure.net', scam: true, why: 'Toll agencies bill by mail or in their app, and the domain is a look-alike.' },
  { from: 'T-Mobile', text: 'Your bill of $142.50 is ready in T-Life. AutoPay runs Nov 25.', scam: false, why: 'Tells you to open the app you already have. No link, no ask.' },
  { from: '+1 (469) 555-0142', text: "Mom it's me, new number. Lost my phone and need $300 for a tow, can you Zelle? Don't call the old one.", scam: true, why: 'New number, urgent money and "do not call" is the family-emergency script.' },
  { from: 'Chase', text: 'Did you spend $412.19 at BestBuy? Reply YES or NO.', scam: false, why: 'Real fraud alerts ask yes or no only. They never ask for a code or a link.' },
  { from: 'NorthLine Bank', text: 'Suspicious login detected. Verify your identity now: northline-verify.com/secure', scam: true, why: 'Banks do not send verification links. The domain is not the bank.' },
  { from: 'Recruiter Rachel', text: 'Shortlisted for a $38/hr remote role, no interview. Pay $45 for your laptop kit to start.', scam: true, why: 'A fee to start a job is always a scam.' },
  { from: 'Dentist', text: 'Reminder: cleaning Tue 2:30pm with Dr. Patel. Reply C to confirm.', scam: false, why: 'Expected, specific, and asks only for a confirmation letter.' },
  { from: 'USPS', text: 'Address incomplete, package returned in 12h. Update here: usps-redeliver.info', scam: true, why: 'USPS does not text links for address problems. The domain is fake.' },
  { from: 'Marco', text: 'Running 10 late, order me the usual?', scam: false, why: 'A contact you know, about something ordinary.' },
  { from: 'Apple', text: 'Your Apple ID was used to sign in on a new device. If this was not you, visit appleid-recovery.help', scam: true, why: 'Apple alerts point you to Settings, never to a third-party domain.' },
];
const LINK_ROUNDS = [
  { brand: 'Amazon order', options: ['amazon-support-verify.net/orders', 'amazon.com/your-orders', 'amaz0n.help/track'], answer: 1, why: 'Only amazon.com ends in the real domain right before the slash.' },
  { brand: 'T-Mobile bill', options: ['t-mobile.com/pay', 'tmobile-billing.co/pay', 't-mobile.payments-online.com'], answer: 0, why: 'In payments-online.com, t-mobile is just a subdomain. The real site is t-mobile.com.' },
  { brand: 'USPS tracking', options: ['usps-redelivery.info', 'tools.usps.com/go/TrackConfirm', 'usps.track-package.co'], answer: 1, why: 'tools.usps.com is a subdomain of usps.com. The others end in a different domain.' },
  { brand: 'Chase sign in', options: ['chase.com', 'chase-secure-login.com', 'secure.chase.com.verify-id.net'], answer: 0, why: 'A long chain of dots ending in verify-id.net is not chase.com.' },
  { brand: 'Netflix payment', options: ['netflix-billing.com/update', 'netflix.com/youraccount', 'account-netflix.co/pay'], answer: 1, why: 'Dashes and extra words around a brand are the tell.' },
  { brand: 'IRS refund', options: ['irs-refund-status.com', 'irs.gov/refunds', 'irsgov-refund.net'], answer: 1, why: 'Government sites end in .gov. Anything else is not the IRS.' },
];
const CALLS = [
  { caller: 'Unknown · (312) 555-0107', lines: [
    { who: 'caller', text: "Hi, this is Jordan with your vehicle's service center." },
    { who: 'caller', text: "Our records show your extended warranty is about to expire.", flag: true },
    { who: 'caller', text: 'This is the final notice before coverage lapses, so I need to act today.' },
    { who: 'caller', text: 'To lock in the rate I just need the card you would like on file.', ask: true },
    { who: 'you', text: 'Sure, it is 4532 1198…', lose: true } ] },
  { caller: 'Caller ID: "Chase Fraud Dept"', lines: [
    { who: 'caller', text: 'This is the Chase fraud department. We flagged a $900 charge in Miami.' },
    { who: 'caller', text: "To reverse it I need to verify you. I've just sent a 6-digit code to your phone.", flag: true },
    { who: 'caller', text: 'Please read me that code so I can confirm it is really you.', ask: true },
    { who: 'you', text: 'It says 8 4 2 …', lose: true } ] },
  { caller: 'Unknown · (702) 555-0119', lines: [
    { who: 'caller', text: "Grandma? It's me. I'm so embarrassed. I got in a small accident." },
    { who: 'caller', text: "I'm at the station and I need $2,000 for bail tonight. Please don't tell Mom.", flag: true },
    { who: 'caller', text: 'My lawyer says gift cards are the fastest way. Can you get them in the next hour?', ask: true },
    { who: 'you', text: 'Okay, which store…', lose: true } ] },
];
const CHATS = {
  codekeeper: { them: 'NorthLine Bank', steps: [
    { them: 'NorthLine: We blocked a $640 charge at an electronics store. Was this you? Reply YES or NO.', choices: [{ t: 'NO', good: true, why: 'Yes or no is all a real alert needs.' }, { t: 'Who is this?', good: true, why: 'Fine. Caution costs nothing.' }, { t: 'NO, here is my card number so you can check', good: false, why: 'They did not ask, and a real bank never needs it by text.' }] },
    { them: 'Thanks. To secure your account we sent you a one-time code. Reply with the 6 digits to confirm it is you.', choices: [{ t: 'Reply with the code', good: false, end: 'loss', why: 'That code is the key to your account. Sharing it is how takeovers happen.' }, { t: 'Open the bank app yourself and check', good: true, why: 'The app shows real alerts. Anything urgent will be there.' }, { t: 'Call the number on the back of your card', good: true, why: 'You dialed, so you know who answered.' }] },
    { them: 'This is time sensitive. If you do not confirm in 5 minutes the account will be frozen.', choices: [{ t: 'Fine, sending it now', good: false, end: 'loss', why: 'Pressure is the tactic. Real banks freeze accounts themselves and never rush you for a code.' }, { t: 'Ignore and forward the text to 7726', good: true, why: 'Reporting to 7726 flags the sender for everyone on the network.' }, { t: 'Ask them for the code they claim to have', good: true, why: 'A real bank cannot read you the code, and a scammer cannot either.' }] },
  ] },
  familysos: { them: 'Unknown number', steps: [
    { them: "Mom it's me, I dropped my phone in the sink, this is my friend's number. Are you home?", choices: [{ t: 'Call your kid on their usual number', good: true, why: 'The known number settles it in ten seconds.' }, { t: 'Reply: which friend?', good: true, why: 'A verification question they cannot answer is a good move.' }, { t: 'Save the new number and reply yes', good: false, why: 'You just trusted an unknown number because it said so.' }] },
    { them: "I can't talk, I'm at urgent care. I need $450 for the visit before they see me. Can you send it to this Zelle?", choices: [{ t: 'Send it, it is an emergency', good: false, end: 'loss', why: 'Urgency plus a new payment target is the whole scam.' }, { t: 'Say you will pay the clinic directly and ask which one', good: true, why: 'A real emergency survives a verification step.' }, { t: 'Ask a question only your kid knows', good: true, why: 'Scripts break on personal details.' }] },
    { them: "Please hurry, they won't see me. And don't tell Dad, he'll freak out.", choices: [{ t: 'Call Dad and your kid right now', good: true, why: 'Secrecy is the red flag. Involving family is exactly what the scammer fears.' }, { t: 'Okay, sending half now', good: false, end: 'loss', why: 'Half is still money gone. The pressure and secrecy told you everything.' }, { t: 'Stop replying and block the number', good: true, why: 'Nothing real is lost by verifying first.' }] },
  ] },
};

/* ---------- state ---------- */
function gameState() { if (!S.game) S.game = { progress: null, current: null, run: null, loading: false }; return S.game; }
async function loadGame() {
  const g = gameState(); if (g.loading) return; g.loading = true;
  try { const r = await api.get(`/game/${curLine().lineId}`); g.progress = r.progress || {}; if (r.pet) S.pet = r.pet; if (!g.current) g.current = defaultNode(); }
  catch (e) { g.progress = g.progress || {}; }
  g.loading = false; render();
}
const nodeIndex = id => QUEST.findIndex(n => n.id === id);
function unlocked(i) { const g = gameState(); return i === 0 || (g.progress?.[QUEST[i - 1].id]?.stars || 0) >= 1; }
function defaultNode() { const g = gameState(); for (let i = 0; i < QUEST.length; i++) if (unlocked(i) && !(g.progress?.[QUEST[i].id]?.stars)) return QUEST[i].id; return QUEST[QUEST.length - 1].id; }
const totalStars = () => QUEST.reduce((a, n) => a + (gameState().progress?.[n.id]?.stars || 0), 0);

/* ---------- free-roam map ----------
   Buddy walks wherever the player sends it: D-pad taps (or arrow keys) move it one short, animated step; standing on a
   checkpoint opens that stop's card. Tapping a checkpoint walks Buddy there step by step. */
const STEP = { x: 9, y: 7 }, NEAR = { x: 9, y: 7 }, BOUNDS = { x: [10, 90], y: [8, 86] };
const posKey = () => `buddyPos:${curLine().lineId}`;
function petPos() {
  const g = gameState();
  if (!g.pos) { try { g.pos = JSON.parse(localStorage.getItem(posKey())) || null; } catch {} if (!g.pos) { const n = QUEST[0]; g.pos = { x: n.x, y: n.y }; } }
  return g.pos;
}
function nearNode() { const p = petPos(); return QUEST.find(n => Math.abs(n.x - p.x) <= NEAR.x && Math.abs(n.y - p.y) <= NEAR.y) || null; }
const walkTimers = {};
function moveBuddy(dx, dy) {
  const g = gameState(); if (g.run) return;
  const p = petPos(), before = nearNode()?.id || null;
  p.x = Math.max(BOUNDS.x[0], Math.min(BOUNDS.x[1], p.x + dx * STEP.x));
  p.y = Math.max(BOUNDS.y[0], Math.min(BOUNDS.y[1], p.y + dy * STEP.y));
  try { localStorage.setItem(posKey(), JSON.stringify(p)); } catch {}
  const av = document.querySelector('.quest .avatar');
  if (av) { av.style.left = p.x + '%'; av.style.top = p.y + '%'; av.classList.remove('hop'); void av.offsetWidth; av.classList.add('hop'); }
  if (dx && window.Buddy3D) window.Buddy3D.face(dx);
  const after = nearNode()?.id || null;
  if (after !== before) { g.current = after; clearTimeout(walkTimers.rerender); walkTimers.rerender = setTimeout(() => render(), 340); }
}
function walkTo(id) {
  const n = QUEST[nodeIndex(id)]; if (!n) return; clearInterval(walkTimers.auto);
  walkTimers.auto = setInterval(() => {
    const p = petPos();
    if (gameState().run || (Math.abs(n.x - p.x) <= NEAR.x && Math.abs(n.y - p.y) <= NEAR.y)) { clearInterval(walkTimers.auto); return; }
    const dx = Math.abs(n.x - p.x) > NEAR.x ? Math.sign(n.x - p.x) : 0, dy = Math.abs(n.y - p.y) > NEAR.y ? Math.sign(n.y - p.y) : 0;
    moveBuddy(dx, dy);
  }, 300);
}
function questMap() {
  const g = gameState();
  if (!g.progress) { loadGame(); return `<div class="quest"><div class="map loading"><div class="sky"></div><p>Loading your map…</p></div></div>`; }
  const P = S.pet, p = petPos(), here = nearNode(); g.current = here?.id || null;
  const stars = n => { const s = g.progress[n.id]?.stars || 0; return `<div class="stars">${[1, 2, 3].map(i => `<span class="${i <= s ? 'on' : ''}">★</span>`).join('')}</div>`; };
  const nodes = QUEST.map((n, i) => { const un = unlocked(i), done = (g.progress[n.id]?.stars || 0) > 0; return `<button class="node ${un ? '' : 'locked'} ${done ? 'done' : ''} ${here?.id === n.id ? 'current' : ''} ${n.boss ? 'boss' : ''}" style="left:${n.x}%;top:${n.y}%;--c:${n.color}" data-act="questSelect" data-val="${n.id}"><div class="pad"></div><div class="orb">${ico(un ? n.icon : 'lock')}</div>${stars(n)}<div class="nl">${n.title}</div></button>`; }).join('');
  const reaction = S.petAnim?.kind === 'heal' ? 'celebrating' : S.petAnim ? 'surprised' : (S.quiz?.open && !S.quiz.result) ? 'determined' : null;
  setTimeout(() => {
    const av = document.querySelector('.quest .avatar'); if (!av) return;
    const el = av.querySelector('.pet3d'); if (el && window.Buddy3D && P && window.Buddy3D.attach(el, { health: P.health, reaction })) el.classList.add('live');
    const bar = document.querySelector('.quest .hud .fill[data-to]'); if (bar) requestAnimationFrame(() => { bar.style.width = bar.dataset.to + '%'; });
  }, 0);
  const energy = P ? P.health : 0, eCls = energy >= 60 ? 'good' : energy >= 40 ? 'mid' : 'low';
  const deco = [[8, 20], [40, 44], [62, 74], [90, 14], [14, 84], [92, 44]].map(([x, y], i) => `<i class="bush b${i % 3}" style="left:${x}%;top:${y}%"></i>`).join('');
  let card;
  if (here) {
    const i = nodeIndex(here.id), prog = g.progress[here.id], locked = !unlocked(i);
    card = `<div class="nodecard" style="--c:${here.color}">
      <div class="nc-top"><div class="orb">${ico(here.icon)}</div><div class="nc-t"><div class="eyebrow">${here.boss ? 'Boss checkpoint' : `Checkpoint ${i + 1} of ${QUEST.length}`} · ${esc(here.teaches)}</div><div class="big">${here.title}</div></div>${stars(here)}</div>
      <p class="desc">${esc(here.blurb)}</p>
      ${prog ? `<div class="nc-meta">Best ${prog.best} · played ${prog.plays}×</div>` : ''}
      ${locked ? `<button class="btn outline" disabled>${ico('lock')} Clear ${QUEST[i - 1].title} first</button>` : `<button class="btn primary" data-act="questPlay" data-val="${here.id}">${ico('sparkles')} ${prog ? 'Play again' : 'Play'}</button>`}
    </div>`;
  } else {
    const next = QUEST.find((n, i) => unlocked(i) && !(g.progress[n.id]?.stars)) || QUEST[QUEST.length - 1];
    card = `<div class="nodecard hint" style="--c:#E20074"><div class="nc-top"><div class="orb">${ico('paw')}</div><div class="nc-t"><div class="eyebrow">Walk Buddy to a checkpoint</div><div class="big">Use the arrows, or tap a checkpoint</div></div></div><p class="desc">Next up: <b>${next.title}</b> · ${esc(next.teaches)}. ${totalStars()}/${QUEST.length * 3} stars so far.</p><button class="btn outline" data-act="questSelect" data-val="${next.id}">${ico('paw')} Walk to ${next.title}</button></div>`;
  }
  return `
  <div class="quest">
    <div class="hud">
      <div class="e"><div class="lbl"><span>${ico('heart')} Buddy's energy</span><b>${energy}</b></div><div class="bar"><div class="fill ${eCls}" style="width:${S.petAnim?.from ?? energy}%" data-to="${energy}"></div></div></div>
      <div class="pill">Lv ${P?.level || 1}</div><div class="pill star">★ ${totalStars()}/${QUEST.length * 3}</div>
    </div>
    <div class="map">
      <div class="sky"><i class="cloud c1"></i><i class="cloud c2"></i><i class="cloud c3"></i></div>
      <div class="hills"></div>${deco}
      ${nodes}
      <div class="avatar" style="left:${p.x}%;top:${p.y}%"><div class="pet3d">${petSvg(P?.mood || 'happy')}</div></div>
      <div class="dpad" aria-label="Move Buddy">
        <button class="k up" data-act="questMove" data-val="0,-1" aria-label="Up">${ico('chevD')}</button>
        <button class="k left" data-act="questMove" data-val="-1,0" aria-label="Left">${ico('chevL')}</button>
        <span class="k mid">${ico('paw')}</span>
        <button class="k right" data-act="questMove" data-val="1,0" aria-label="Right">${ico('chevR')}</button>
        <button class="k down" data-act="questMove" data-val="0,1" aria-label="Down">${ico('chevD')}</button>
      </div>
      <button class="signpost" data-act="practice" data-val="imessage">${ico('phone')}<span>Field test<br><small>Text my phone</small></span></button>
    </div>
    ${S.quiz ? `<div class="speech">${bubbleHtml(P || { mood: 'happy' }, S.petAnim, S.trap)}</div>` : ''}
    ${card}
  </div>`;
}

/* ---------- minigame engine ---------- */
const gameTimers = {};
function startRun(id) {
  const n = QUEST[nodeIndex(id)]; if (!n) return;
  const run = { node: n, kind: n.kind, i: 0, score: 0, phase: 'play', fb: null, log: [], startedAt: Date.now() };
  if (n.kind === 'sorter') { run.items = shuffle(SMS_POOL).slice(0, 8); run.max = 8; run.per = 8000; }
  if (n.kind === 'storm') { run.items = shuffle(SMS_POOL).slice(0, 10); run.max = 10; run.per = 5000; }
  if (n.kind === 'links') { run.items = shuffle(LINK_ROUNDS); run.max = run.items.length; run.per = 12000; }
  if (n.kind === 'call') { run.items = CALLS; run.max = CALLS.length * 3; run.call = 0; run.shown = 0; run.per = 0; }
  if (n.kind === 'chat') { run.chat = CHATS[n.id]; run.items = run.chat.steps; run.max = run.items.length; run.hist = []; run.per = 0; }
  gameState().run = run; S.quiz = null;
  armTimer(); renderOverlay();
}
function armTimer() {
  const run = gameState().run; clearInterval(gameTimers.tick); clearTimeout(gameTimers.next); if (!run || run.phase !== 'play') return;
  if (run.kind === 'call') { run.shown = 0; revealLine(); return; }
  if (!run.per) return;
  run.deadline = Date.now() + run.per;
  gameTimers.tick = setInterval(() => {
    const bar = document.querySelector('.arena .timer .fill'); const left = Math.max(0, run.deadline - Date.now());
    if (bar) bar.style.width = (left / run.per * 100) + '%';
    if (left <= 0) { clearInterval(gameTimers.tick); answer(null); }
  }, 100);
}
function revealLine() {
  const run = gameState().run; if (!run || run.phase !== 'play') return;
  const call = run.items[run.call];
  if (run.shown >= call.lines.length) return;
  const line = call.lines[run.shown];
  if (line.lose) { // they never hung up: the "you" line plays and the round is lost
    run.shown++; run.fb = { ok: false, title: 'You gave it away', why: 'The ask came and went. Hang up the moment the pitch turns to pressure or a request.' }; run.phase = 'fb'; renderOverlay();
    gameTimers.next = setTimeout(nextCall, 3200); return;
  }
  run.shown++; renderOverlay();
  gameTimers.next = setTimeout(revealLine, 2300);
}
function hangUp() {
  const run = gameState().run; if (!run || run.kind !== 'call' || run.phase !== 'play') return;
  clearTimeout(gameTimers.next);
  const call = run.items[run.call], seen = call.lines.slice(0, run.shown);
  const flagAt = call.lines.findIndex(l => l.flag), askAt = call.lines.findIndex(l => l.ask);
  let pts, title, why;
  if (run.shown - 1 < flagAt) { pts = 2; title = 'Early, and that is fine'; why = `Hanging up on an unknown caller is never wrong. The red flag was coming next: “${call.lines[flagAt].text}”`; }
  else if (run.shown - 1 < askAt) { pts = 3; title = 'Perfect timing'; why = `You caught it at the red flag: “${call.lines[flagAt].text}”`; }
  else { pts = 1; title = 'Late, but out'; why = 'You hung up after they asked. Next time the pressure line itself is your cue.'; }
  run.score += pts; run.fb = { ok: pts >= 2, title, why, pts }; run.phase = 'fb'; renderOverlay();
  gameTimers.next = setTimeout(nextCall, 3000);
}
function nextCall() {
  const run = gameState().run; if (!run) return;
  run.call++; run.fb = null;
  if (run.call >= run.items.length) return finishRun();
  run.phase = 'play'; renderOverlay(); armTimer();
}
function answer(choice) {
  const run = gameState().run; if (!run || run.phase !== 'play') return;
  clearInterval(gameTimers.tick);
  const item = run.items[run.i];
  let ok = false, why = item.why, end = null, label = '';
  if (run.kind === 'sorter' || run.kind === 'storm') { ok = choice !== null && (choice === 'scam') === item.scam; label = item.scam ? 'That was a scam' : 'That one was legit'; }
  if (run.kind === 'links') { ok = choice !== null && +choice === item.answer; label = `Real one: ${item.options[item.answer]}`; }
  if (run.kind === 'chat') { const c = item.choices[+choice]; ok = !!c?.good; why = c ? c.why : 'Time ran out.'; end = c?.end || null; run.hist.push({ them: item.them, you: c ? c.t : '(no reply)', ok }); label = ok ? 'Safe move' : 'Risky move'; }
  if (ok) run.score++;
  run.log.push({ ok, item });
  run.fb = { ok, title: choice === null ? 'Out of time' : ok ? 'Right' : 'Not quite', label, why, end };
  run.phase = 'fb'; renderOverlay();
  gameTimers.next = setTimeout(() => {
    run.fb = null;
    if (end === 'loss') { run.lost = true; return finishRun(); }
    run.i++;
    if (run.i >= run.items.length) return finishRun();
    run.phase = 'play'; renderOverlay(); armTimer();
  }, ok ? 1300 : 2800);
}
async function finishRun() {
  const run = gameState().run; if (!run) return;
  clearInterval(gameTimers.tick); clearTimeout(gameTimers.next);
  const ratio = run.lost ? 0 : run.score / run.max;
  const need = run.kind === 'storm' ? .8 : .5;
  run.stars = run.lost ? 0 : Math.max(ratio >= need ? 1 : 0, STARS(ratio));
  run.win = run.stars >= 1; run.phase = 'end'; run.posting = true; renderOverlay();
  try {
    const r = await api.post(`/game/${curLine().lineId}/result`, { node: run.node.id, title: run.node.title, score: run.score, max: run.max, stars: run.stars, win: run.win });
    gameState().progress = r.progress; run.delta = run.win ? 8 : -5;
  } catch (e) { run.error = e.message; }
  run.posting = false; renderOverlay(); render();
}
function closeRun(again) {
  const g = gameState(); const id = g.run?.node.id; clearInterval(gameTimers.tick); clearTimeout(gameTimers.next); g.run = null;
  if (again && id) return startRun(id);
  if (id && g.progress?.[id]?.stars) { const i = nodeIndex(id); if (i + 1 < QUEST.length && unlocked(i + 1)) g.current = QUEST[i + 1].id; }
  renderOverlay(); render();
}

/* ---------- arena rendering ---------- */
function arenaHtml() {
  const run = gameState().run; if (!run) return '';
  const n = run.node;
  const dots = run.kind === 'call' ? run.items.map((_, i) => `<i class="${i < run.call ? 'done' : i === run.call ? 'cur' : ''}"></i>`).join('') : run.items.map((_, i) => `<i class="${i < run.i ? (run.log[i]?.ok ? 'done' : 'miss') : i === run.i ? 'cur' : ''}"></i>`).join('');
  const top = `<div class="atop"><button class="icon-btn" data-act="questQuit" aria-label="Quit">${ico('x')}</button><div class="at"><div class="eyebrow">${n.boss ? 'Boss stop' : 'Stop ' + (nodeIndex(n.id) + 1)}</div><div class="t">${n.title}</div></div><div class="score">${run.score}<small>/${run.max}</small></div></div><div class="dots">${dots}</div>${run.per ? `<div class="timer"><div class="fill"></div></div>` : ''}`;
  if (run.phase === 'end') return `<div class="arena end" style="--c:${n.color}">${top}<div class="stage"><div class="result ${run.win ? 'win' : 'loss'}">
      <div class="starsbig">${[1, 2, 3].map(i => `<span class="${i <= run.stars ? 'on' : ''}" style="animation-delay:${i * .18}s">★</span>`).join('')}</div>
      <h3>${run.win ? (run.stars === 3 ? 'Flawless' : 'Cleared') : run.lost ? 'Buddy took the hit' : 'Not this time'}</h3>
      <p>${run.lost ? 'You handed over the one thing the scammer wanted.' : `${run.score} of ${run.max}. ${run.win ? n.title + ' is cleared.' : 'Half or more clears the stop.'}`}</p>
      <div class="delta ${run.win ? 'pos' : 'neg'}">${run.posting ? 'Saving…' : run.error ? 'Could not save: ' + esc(run.error) : (run.win ? '+8' : '-5') + ' energy'}</div>
      ${run.log.filter(l => !l.ok).length ? `<div class="recap"><div class="lbl">What to remember</div>${run.log.filter(l => !l.ok).slice(0, 3).map(l => `<div class="feat">${ico('alert')}<span>${esc(l.item.why || l.item.choices?.find(c => !c.good)?.why || '')}</span></div>`).join('')}</div>` : ''}
    </div></div><div class="actrl"><button class="btn primary" data-act="questClose">Back to the map</button><button class="btn outline" data-act="questAgain">Play again</button></div></div>`;
  const fb = run.fb ? `<div class="fb ${run.fb.ok ? 'ok' : 'bad'}"><div class="fbt">${ico(run.fb.ok ? 'checkCircle' : 'alert')} ${esc(run.fb.title)}</div>${run.fb.label ? `<div class="fbl">${esc(run.fb.label)}</div>` : ''}<p>${esc(run.fb.why)}</p></div>` : '';
  let stage = '', ctrl = '';
  if (run.kind === 'sorter' || run.kind === 'storm') {
    const it = run.items[run.i];
    stage = `<div class="smscard ${run.fb ? (run.fb.ok ? 'fly-ok' : 'shake') : 'fly-in'}" key="${run.i}"><div class="from">${ico('message')} ${esc(it.from)}</div><div class="txt">${esc(it.text)}</div></div>${fb}`;
    ctrl = `<button class="bigbtn legit" data-act="questAnswer" data-val="legit" ${run.fb ? 'disabled' : ''}>${ico('checkCircle')} Legit</button><button class="bigbtn scam" data-act="questAnswer" data-val="scam" ${run.fb ? 'disabled' : ''}>${ico('block')} Scam</button>`;
  }
  if (run.kind === 'links') {
    const it = run.items[run.i];
    stage = `<div class="prompt fly-in" key="${run.i}"><div class="eyebrow">Which link is really</div><div class="big">${esc(it.brand)}?</div></div>
      <div class="links">${it.options.map((u, i) => `<button class="link ${run.fb ? (i === it.answer ? 'real' : 'fake') : ''}" data-act="questAnswer" data-val="${i}" ${run.fb ? 'disabled' : ''}>${ico('globe')}<span>${esc(u)}</span></button>`).join('')}</div>${fb}`;
  }
  if (run.kind === 'call') {
    const call = run.items[run.call];
    stage = `<div class="callhead"><div class="eyebrow">Incoming call</div><div class="big">${esc(call.caller)}</div></div>
      <div class="lines">${call.lines.slice(0, run.shown).map((l, i) => `<div class="line ${l.who} ${i === run.shown - 1 ? 'new' : ''}">${esc(l.text)}</div>`).join('')}${run.phase === 'play' && run.shown < call.lines.length ? '<div class="line caller typing"><i></i><i></i><i></i></div>' : ''}</div>${fb}`;
    ctrl = `<button class="hang" data-act="questHangup" ${run.phase !== 'play' ? 'disabled' : ''}>${ico('phoneOff')}<span>Hang up</span></button>`;
  }
  if (run.kind === 'chat') {
    const it = run.items[run.i];
    stage = `<div class="chatlog">${run.hist.map(h => `<div class="msg them">${esc(h.them)}</div><div class="msg me ${h.ok ? '' : 'bad'}">${esc(h.you)}</div>`).join('')}<div class="msg them new">${esc(it.them)}</div></div>${fb}`;
    ctrl = `<div class="choices">${it.choices.map((c, i) => `<button class="chip" data-act="questAnswer" data-val="${i}" ${run.fb ? 'disabled' : ''}>${esc(c.t)}</button>`).join('')}</div>`;
  }
  return `<div class="arena kind-${run.kind}" style="--c:${n.color}">${top}<div class="stage">${stage}</div><div class="actrl">${ctrl}</div></div>`;
}

function GAME_ACTIONS(v) {
  return {
    questSelect: () => walkTo(v),
    questMove: () => { const [dx, dy] = String(v).split(',').map(Number); clearInterval(walkTimers.auto); moveBuddy(dx, dy); },
    questPlay: () => startRun(v),
    questAnswer: () => answer(v),
    questHangup: hangUp,
    questQuit: () => closeRun(false),
    questClose: () => closeRun(false),
    questAgain: () => closeRun(true),
  };
}
document.addEventListener('keydown', e => {
  if (typeof current !== 'function' || current() !== 'learn' || gameState().run || S.sheet) return;
  const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key]; if (!d) return;
  e.preventDefault(); clearInterval(walkTimers.auto); moveBuddy(d[0], d[1]);
});

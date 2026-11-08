/* ScamShield — T-Life feature extension. UI over the server/ API (TigerData + Gemini + Photon). */
const KEY = 'tlife-scamshield-ui-v3';
const ACCOUNT = 'acct_anne';

/* ---------- state ---------- */
let S = Object.assign({ tab: 'home', stack: [], line: 0, filter: 'all' }, loadPrefs(), {
  ready: false, error: null, premium: false, toggles: {}, categories: {}, blocked: [], allowed: [], lookups: [],
  stats: { blocked: 0, flagged: 0, identified: 0 }, allStats: {}, activity: [],
  sheet: null, toast: null, call: null, lookupQ: '', lookupRes: null, reason: null, addNum: '', reportText: '',
});
function loadPrefs() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify({ tab: S.tab, stack: S.stack, line: S.line, filter: S.filter })); } catch { } }

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ico = n => I[n] || '';
const digits = n => String(n || '').replace(/\D/g, '');
function fmtNum(n) { let d = digits(n); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : n; }
function ago(m) { if (m < 1) return 'Just now'; if (m < 60) return m + 'm ago'; if (m < 1440) return Math.round(m / 60) + 'h ago'; const d = Math.round(m / 1440); return d === 1 ? 'Yesterday' : d + 'd ago'; }
const curLine = () => LINES[S.line] || LINES[0];
const lineActivity = () => S.activity;
const findAct = id => S.activity.find(a => String(a.id) === String(id));
const isBlocked = num => S.blocked.some(b => b.num === num);
const isAllowed = num => S.allowed.some(b => b.num === num);
const riskLabel = r => r >= 80 ? 'High risk' : r >= 45 ? 'Medium risk' : 'Low risk';
const riskCls = r => r >= 80 ? 'red' : r >= 45 ? 'amber' : 'green';
const stats = () => S.stats;
const TYPE = {
  blocked: { icon: 'phoneOff', cls: 'red', label: 'Blocked' },
  scam: { icon: 'alert', cls: 'magenta', label: 'Scam Likely · rang' },
  spam: { icon: 'voicemail', cls: 'amber', label: 'To voicemail' },
  identified: { icon: 'phoneIn', cls: 'green', label: 'Identified' },
  screened: { icon: 'headset', cls: 'blue', label: 'Screened' },
  ai: { icon: 'sparkles', cls: 'amber', label: 'AI voice detected' },
  fraud: { icon: 'shieldAlert', cls: 'red', label: 'Fraud · call ended' },
};
const FILTERS = [['all', 'All'], ['blocked', 'Blocked'], ['scam', 'Scam Likely'], ['spam', 'Spam'], ['identified', 'Identified'], ['screened', 'Screened']];
function matchesFilter(a) {
  const f = S.filter; if (f === 'all') return true;
  if (f === 'blocked') return ['blocked', 'fraud'].includes(a.type);
  if (f === 'scam') return ['scam', 'ai'].includes(a.type);
  return a.type === f;
}

/* ---------- data loading ---------- */
async function loadAll() {
  const lines = await api.get('/lines');
  LINES.length = 0;
  lines.forEach((l, i) => LINES.push({ id: i, lineId: l.id, name: l.name, device: l.device, num: l.num, initials: l.initials, primary: l.is_primary, toggles: l.toggles, guardian: l.notify_guardian }));
  S.premium = !!lines[0]?.premium;
  if (S.line >= LINES.length) S.line = 0;
  const all = await Promise.all(LINES.map(l => api.get(`/lines/${l.lineId}/stats`).catch(() => null)));
  all.forEach((st, i) => { if (st) S.allStats[i] = st; });
  await loadLine(false);
  S.ready = true; S.error = null;
}
async function loadLine(doRender = true) {
  const L = curLine(); if (!L) return;
  const [st, act, lists, cats, lookups] = await Promise.all([
    api.get(`/lines/${L.lineId}/stats`), api.get(`/lines/${L.lineId}/activity`), api.get(`/lines/${L.lineId}/lists`),
    api.get(`/lines/${L.lineId}/categories`), api.get(`/lines/${L.lineId}/lookups`),
  ]);
  S.stats = st; S.allStats[S.line] = st; S.activity = act; S.toggles = L.toggles || {}; S.categories = cats; S.lookups = lookups;
  applyLists(lists);
  if (doRender) render();
}
function applyLists(lists) {
  const when = d => { const m = Math.round((Date.now() - new Date(d).getTime()) / 60000); return m < 2 ? 'Added just now' : 'Added ' + ago(m); };
  S.blocked = lists.filter(x => x.kind === 'block').map(x => ({ num: x.num, name: x.label, when: when(x.created_at) }));
  S.allowed = lists.filter(x => x.kind === 'allow').map(x => ({ num: x.num, name: x.label, when: x.label === 'Mom' ? 'From contacts' : when(x.created_at) }));
}
async function refreshLists() { applyLists(await api.get(`/lines/${curLine().lineId}/lists`)); render(); }
/* ADAPT: what ScamShield learned across all customers, turned into a lesson. */
async function loadInsights() { try { S.insights = await api.get('/insights'); render(); } catch { /* optional */ } }
function insightsCard() {
  const n = S.insights; if (!n) return '';
  const v = n.voices.filter(x => x.numbers > 1);
  const rows = [
    v.length ? `<div class="feat">${ico('waveform')}<span><b>${v.length} scam voice${v.length === 1 ? '' : 's'}</b> used more than one number. Top: ${esc(v[0].name)}, ${v[0].numbers} numbers, ${v[0].reports} report${v[0].reports === 1 ? '' : 's'}.</span></div>` : '',
    ...n.tactics.slice(0, 2).map(t => `<div class="feat">${ico('alert')}<span><b>${esc(t.label)}</b> in ${t.calls} call${t.calls === 1 ? '' : 's'} this week.</span></div>`),
  ].filter(Boolean).join('');
  if (!rows) return '';
  const r = n.recommended;
  return `<div class="card"><div class="eyebrow">Adapt · what ScamShield learned</div><div class="big" style="font-size:19px">Threats we're seeing</div>${rows}
    ${r ? `<div class="btn-row"><a class="btn black" href="drill.html?c=${encodeURIComponent(r.id)}">${ico('sparkles')} Practice: ${esc(r.title)}</a></div><p class="note">${esc(r.because)}.</p>` : ''}</div>`;
}
async function refreshStats() { S.stats = await api.get(`/lines/${curLine().lineId}/stats`); S.allStats[S.line] = S.stats; render(); }
const fail = e => toast(e.message || 'Something went wrong');

/* ---------- navigation & transient UI ---------- */
let callTimer = null;
function go(screen) { S.stack.push({ screen }); S.sheet = null; save(); render(true); }
function back() { S.stack.pop(); S.sheet = null; save(); render(true); }
function setTab(t) { S.tab = t; S.stack = []; S.sheet = null; save(); render(true); }
const current = () => S.stack.length ? S.stack[S.stack.length - 1].screen : S.tab;
function toast(msg, kind) { S.toast = { msg, kind }; renderOverlay(); clearTimeout(toast.t); toast.t = setTimeout(() => { S.toast = null; renderOverlay(); }, 2800); }
function openSheet(name, data) { S.sheet = { name, data }; S.reason = null; renderOverlay(); }
function closeSheet() { S.sheet = null; S.reason = null; renderOverlay(); }

/* ---------- shared components ---------- */
function header(title, o = {}) {
  const icons = (o.icons || []).map(([ic, act, val]) => `<button class="icon-btn" data-act="${act}" data-val="${esc(val || '')}" aria-label="${ic}">${ico(ic)}</button>`).join('');
  if (o.back) return `<div class="header sub"><div class="left"><button class="icon-btn back" data-act="back" aria-label="Back">${ico('chevL')}</button><div class="h1">${title}</div></div><div class="icons">${icons}</div></div>`;
  return `<div class="header"><div class="h1 ${o.brand ? 'brand' : ''}">${title}</div><div class="icons">${icons}</div></div>`;
}
const tile = (icon, label, act, val, accent) => `<button class="tile ${accent ? 'accent' : ''}" data-act="${act}" data-val="${esc(val)}">${ico(icon)}<span>${label}</span></button>`;
function row(o) {
  const tag = o.act ? 'button' : 'div';
  return `<${tag} class="row ${o.act ? 'tap' : ''}" ${o.act ? `data-act="${o.act}" data-val="${esc(o.val)}"` : ''}>
    ${o.icon ? `<div class="ico ${o.cls || ''}">${ico(o.icon)}</div>` : ''}${o.avatar || ''}
    <div class="txt"><div class="t">${o.title}${o.badge || ''}</div>${o.sub ? `<div class="s">${o.sub}</div>` : ''}</div>
    ${o.meta ? `<div class="meta">${o.meta}</div>` : ''}${o.right || ''}${o.chev === false ? '' : `<div class="chev">${ico('chevR')}</div>`}
  </${tag}>`;
}
function switchHtml(key, locked) { return `<button class="switch ${S.toggles[key] ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="toggle" data-val="${key}" role="switch" aria-checked="${!!S.toggles[key]}"></button>`; }
function toggleRow(key, icon, cls, title, sub, prem) {
  const locked = prem && !S.premium;
  return `<div class="row"><div class="ico ${cls}">${ico(icon)}</div><div class="txt"><div class="t">${title}${prem ? `<span class="badge prem">${S.premium ? 'Premium' : ico('lock') + ' Premium'}</span>` : ''}</div><div class="s" style="white-space:normal">${sub}</div></div>${switchHtml(key, locked)}</div>`;
}
const emptyHtml = (msg, icon = 'shieldCheck') => `<div class="empty">${ico(icon)}<div>${msg}</div></div>`;
function actRow(a) {
  const t = TYPE[a.type] || TYPE.identified;
  return row({ icon: t.icon, cls: t.cls, title: esc(a.name || a.num), sub: `${t.label} · ${esc(a.cat)}${a.times > 1 ? ` · ${a.times}×` : ''}`, meta: ago(a.ago), act: 'detail', val: a.id });
}
const filterChips = () => `<div class="chips">${FILTERS.map(([k, l]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-act="filter" data-val="${k}">${l}</button>`).join('')}</div>`;
const riskMeter = r => `<div class="risk"><div class="bar"><div class="fill" style="width:${r}%"></div></div><div class="lbl"><span>Risk score</span><span><b>${r}</b> · ${riskLabel(r)}</span></div></div>`;

/* ---------- T-Life shell screens ---------- */
function homeScreen() {
  const st = stats();
  return `
  ${header('Hey, Anne', { brand: true, icons: [['chat', 'toast', 'Messages are not part of this demo'], ['bell', 'toast', 'No new notifications']] })}
  <p class="subhead">See what's new in T Life today</p>
  <button class="card tint" data-act="go" data-val="scamshield" style="width:100%">
    <div class="head"><div class="ico">${ico('shieldCheck')}</div><div><div class="lbl">ScamShield</div><div class="big" style="font-size:20px">${st.blocked} calls blocked this month</div></div></div>
    <p class="desc">Scam Block, Caller ID and AI voice detection are protecting ${LINES.length} lines on your account.</p>
    <div class="cta"><span>Open ScamShield</span>${ico('chevR')}</div>
  </button>
  <div class="stat-dark"><div class="st"><div class="n">4.88</div><div class="l">GB used this month</div></div><div class="st"><div class="n">17</div><div class="l">Days until bill</div></div></div>
  <div class="card"><div class="eyebrow">Your bill</div><div class="big">$142.50</div><p class="desc">Due Nov 25 · AutoPay is on</p>
    <div class="btn-row"><button class="btn primary sm" data-act="toast" data-val="Payments are not part of this demo">Pay now</button><button class="btn outline sm" data-act="toast" data-val="Bill details are not part of this demo">View bill</button></div></div>
  <h2 class="section">Quick actions</h2>
  <div class="tiles">${tile('dollar', 'Pay bill', 'toast', 'Payments are not part of this demo')}${tile('shield', 'ScamShield', 'go', 'scamshield', true)}${tile('userPlus', 'Add a line', 'tab', 'shop')}${tile('upgrade', 'Upgrade', 'tab', 'shop')}${tile('headset', 'Support', 'toast', 'Support chat is not part of this demo')}</div>
  <h2 class="section">More for you</h2>
  <div class="promo">
    <div class="card dark"><div class="eyebrow">T-Satellite</div><div class="big">Connecting you anywhere</div></div>
    <div class="card"><div class="eyebrow">Home Internet</div><div class="big">Get the fastest 5G.</div></div>
  </div>`;
}
function shopScreen() {
  const na = 'Shopping is not part of this demo';
  return `
  ${header('Shop', { icons: [['cart', 'toast', 'Your cart is empty']] })}
  <div class="tiles">${tile('upgrade', 'Upgrade', 'toast', na)}${tile('userPlus', 'Add a line', 'toast', na)}${tile('sim', 'Bring device', 'toast', na)}${tile('dollar', 'Earn', 'toast', na)}</div>
  <h2 class="section">Browse by category</h2>
  <div class="chips">${['Phones', 'Accessories', 'Tablets', 'Watches', 'Home Internet'].map(c => `<button class="chip" data-act="toast" data-val="${na}"><span class="thumb"></span>${c}</button>`).join('')}</div>
  <h2 class="section">Promotions for you</h2>
  <div class="card flush">
    ${row({ icon: 'tag', cls: 'gray', title: 'See 4 promotions', act: 'toast', val: na })}
    <div style="padding:16px"><div class="eyebrow">Apple</div><div class="big" style="font-size:18px">iPhone 17 Pro</div>
      <div class="swatches"><span style="background:#E6E6E6"></span><span style="background:#3B3F4E"></span><span style="background:#FF7A00"></span></div>
      <div style="font-size:14px;font-weight:600">Starting at <span class="strike">$45.84</span> $11.25/month for 24 months</div>
      <div style="font-size:13px;color:var(--muted);margin-top:4px">$0.00 down + tax due today</div>
      <div style="font-size:12px;color:var(--faint);margin-top:2px">Full Price: $1,099.99</div></div>
  </div>`;
}
function benefitsScreen() {
  const na = 'Benefits are not part of this demo';
  return `
  <div class="hero-head">${header('Benefits', { icons: [['bookmark', 'toast', na], ['search', 'toast', na]] })}
    <div class="chips on-magenta">${['Tuesdays', 'Travel', 'Dining', 'Entertainment', 'Netflix'].map((c, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-act="toast" data-val="${na}">${c}</button>`).join('')}</div></div>
  <h2 class="section">This Tuesday</h2>
  ${PERKS.map(p => `<button class="perk" style="background:${p.bg};width:100%" data-act="toast" data-val="${na}"><div class="b">${p.brand}</div><div class="t">${p.title}</div></button>`).join('')}
  <h2 class="section">Your perks</h2>
  <div class="card flush">${row({ icon: 'gift', cls: 'magenta', title: '1K redeemed today', sub: 'Keep your 6-week streak going', act: 'toast', val: na })}
  ${row({ icon: 'star', cls: 'amber', title: 'Magenta Status', sub: 'Hotel, rental car and dining upgrades', act: 'toast', val: na })}</div>`;
}
function servicesScreen() {
  const st = stats(), na = 'Not part of this demo';
  return `
  ${header('Services', { icons: [['plus', 'toast', na]] })}
  <div class="map"><div class="pin">${ico('pin')}</div><div class="cov"><div><div class="s">Network coverage</div><div class="t">5G UC coverage available</div><div class="s">Near Greenwood Ave</div></div><div class="tag">5G<sup style="font-size:8px">UC</sup></div></div></div>
  <h2 class="section">Your services</h2>
  <div class="card flush">
    ${row({ icon: 'shieldCheck', cls: 'magenta', title: 'ScamShield', badge: `<span class="badge green">${S.toggles.scamBlock ? 'Protected' : 'Partial'}</span>`, sub: `${st.blocked} calls blocked this month`, act: 'go', val: 'scamshield' })}
    ${row({ icon: 'satellite', cls: 'blue', title: 'T-Satellite', sub: 'Text, data and calls off the grid', act: 'toast', val: na })}
    ${row({ icon: 'wifi', cls: 'green', title: 'Home Internet', sub: 'Gateway online · 612 Mbps', act: 'toast', val: na })}
    ${row({ icon: 'pin', cls: 'amber', title: 'SyncUP DRIVE', sub: 'Last trip 2h ago', act: 'toast', val: na })}
    ${row({ icon: 'card', cls: 'gray', title: 'T-Mobile MONEY', sub: 'Checking · 4.00% APY', act: 'toast', val: na })}
  </div>
  <h2 class="section">More for you</h2>
  <div class="promo"><div class="card dark"><div class="eyebrow">T-Satellite</div><div class="big">Connecting you anywhere</div></div><div class="card"><div class="eyebrow">T-Mobile Visa®</div><div class="big">Rewards that don't play</div></div></div>`;
}
function accountScreen() {
  const na = 'Not part of this demo';
  return `
  ${header('Account', { icons: [['settings', 'toast', na]] })}
  <div class="card"><div style="display:flex;gap:14px;align-items:center"><div class="avatar lg">AR</div><div><div class="big" style="font-size:20px">Anne Rivera</div><p class="desc" style="margin-top:2px">Experience More · ${LINES.length} lines</p><p class="desc" style="margin-top:0">Account ending in 4471</p></div></div></div>
  <div class="card flush"><div class="rows-title">Lines</div>
    ${LINES.map(l => row({ avatar: `<div class="avatar ${l.primary ? '' : 'gray'}">${l.initials}</div>`, title: esc(l.device), sub: `${l.num} · ScamShield ${l.toggles?.scamBlock ? 'on' : 'partial'}`, act: 'lineGo', val: l.id })).join('')}
  </div>
  <div class="card flush">
    ${row({ icon: 'dollar', cls: 'gray', title: 'Billing & payments', sub: '$142.50 due Nov 25', act: 'toast', val: na })}
    ${row({ icon: 'shield', cls: 'magenta', title: 'ScamShield Premium', sub: S.premium ? 'Active · $4.00/mo per line' : 'Not added', act: 'sheet', val: 'premium' })}
    ${row({ icon: 'user', cls: 'gray', title: 'Caller ID name', sub: 'Anne Rivera', act: 'toast', val: 'Caller ID name changes are not part of this demo' })}
    ${row({ icon: 'lock', cls: 'gray', title: 'Privacy & security', act: 'toast', val: na })}
    ${row({ icon: 'bell', cls: 'gray', title: 'Notifications', act: 'go', val: 'ss-settings' })}
  </div>
  <button class="btn ghost" data-act="toast" data-val="Sign out is not part of this demo">Sign out</button>`;
}

/* ---------- ScamShield screens ---------- */
function premiumCard() {
  return `<div class="card dark"><div class="eyebrow">ScamShield Premium</div><div class="price">$4<small>/mo per line</small></div>
    ${['Block spam by category (telemarketing, surveys, political)', 'AI voice and deepfake detection', 'In-call fraud alerts and Call Screener', 'Reverse number lookup with name and carrier', 'Voicemail-to-text for blocked and unknown calls'].map(f => `<div class="feat">${ico('checkCircle')}<span>${f}</span></div>`).join('')}
    <div class="btn-row"><button class="btn primary" data-act="sheet" data-val="premium">Add Premium</button></div></div>`;
}
function scamshieldScreen() {
  const L = curLine(), st = stats(), on = S.toggles.scamBlock;
  const acts = lineActivity().filter(matchesFilter).slice(0, 5);
  return `
  ${header('ScamShield', { back: true, icons: [['search', 'go', 'lookup'], ['settings', 'go', 'ss-settings']] })}
  <div class="card dark">
    <div class="shield-status"><div class="orb ${on ? '' : 'off'}">${ico(on ? 'shieldCheck' : 'shield')}</div>
      <div><div class="big">${on ? "You're protected" : 'Scam Block is off'}</div><p class="desc" style="margin-top:2px">${on ? `Scam Block is on for ${esc(L.device)}` : `Scam Likely calls will ring through on ${esc(L.device)}`}</p></div></div>
    <div class="proto-stats"><div class="st"><div class="n">${st.blocked}</div><div class="l">Blocked</div></div><div class="st"><div class="n">${st.flagged}</div><div class="l">Flagged</div></div><div class="st"><div class="n">${st.identified}</div><div class="l">Identified</div></div></div>
    <div class="note" style="color:rgba(255,255,255,.5)">Last 30 days · Built into the network, no extra app needed</div>
  </div>
  <div class="chips">${LINES.map(l => `<button class="chip ${l.id === S.line ? 'on' : ''}" data-act="line" data-val="${l.id}">${l.name}${l.primary ? ' (you)' : ''}</button>`).join('')}<button class="chip" data-act="go" data-val="family">${ico('users')} Family</button></div>
  <h2 class="section">Quick actions</h2>
  <div class="tiles">${tile('block', 'Block list', 'go', 'blocklist')}${tile('search', 'Look up', 'go', 'lookup')}${tile('flag', 'Report', 'sheet', 'report')}${tile('checkCircle', 'Allow list', 'go', 'allowlist')}${tile('voicemail', 'Categories', 'go', 'categories')}</div>
  <h2 class="section">Protection</h2>
  <div class="card flush">
    ${toggleRow('scamBlock', 'shieldCheck', 'magenta', 'Scam Block', 'Automatically block Scam Likely calls before your phone rings')}
    ${toggleRow('callerId', 'user', 'blue', 'Caller ID', 'Name and location for callers not in your contacts')}
    ${toggleRow('scamLikely', 'alert', 'amber', 'Scam Likely alerts', 'Label suspicious calls so you can decide')}
    ${toggleRow('aiVoice', 'sparkles', 'amber', 'AI voice detection', 'Warns you mid-call when a voice sounds synthetic or cloned', true)}
    ${toggleRow('inCall', 'ear', 'red', 'In-call scam alerts', 'Flags fraud tactics like passcode or gift card requests as they happen', true)}
    ${toggleRow('screener', 'headset', 'blue', 'Call Screener', 'Unknown callers are asked who they are before your phone rings', true)}
  </div>
  <h2 class="section">Recent activity <button class="link" data-act="go" data-val="activity">See all</button></h2>
  ${filterChips()}
  <div class="card flush">${acts.length ? acts.map(actRow).join('') : emptyHtml('Nothing here yet')}</div>
  <div class="card"><div class="eyebrow">Try it</div><div class="big" style="font-size:19px">See ScamShield in action</div><p class="desc">Simulate an incoming call on ${esc(L.device)}.</p>
    <div class="pill-demo"><button class="btn black" data-act="call" data-val="scam">${ico('phoneOff')} Scam Likely call</button><button class="btn outline" data-act="call" data-val="fraud">${ico('sparkles')} AI voice scam</button><button class="btn outline" data-act="call" data-val="screener">${ico('headset')} Screen a call</button><button class="btn outline" data-act="call" data-val="voice">${ico('waveform')} Known scam voice</button></div></div>
  <div class="card"><div class="eyebrow">Protect · demo story</div><div class="big" style="font-size:19px">Same voice, new number</div><p class="desc">A scammer calls Anne. ScamShield has never heard this voice, so it learns it. Then the same voice calls Rosa from a different number, and ScamShield recognizes it.</p>
    <div class="pill-demo"><button class="btn black" data-act="story" data-val="story1:line_0">${ico('phoneIn')} 1 · Scammer calls Anne</button><button class="btn primary" data-act="story" data-val="story2:line_2">${ico('waveform')} 2 · New number calls Rosa</button><button class="btn ghost" data-act="storyReset">Reset story</button></div>
    <a class="btn outline" href="caller.html" style="margin-top:10px">${ico('mic')} Be the scammer: call from your browser</a>
    <p class="note">Answer each call. Call 1 takes about 10 seconds to be judged a scam; end it, then place call 2.</p></div>
  ${insightsCard()}
  <a class="card" href="drill.html" style="display:block"><div class="head"><div class="ico" style="background:var(--ink)">${ico('message')}</div><div class="big" style="font-size:18px">Scam Academy</div></div><p class="desc">Take the Scam Survival Challenge: we text you a realistic fake scam, then score how you did and show you the red flags. Opt-in. Prototype.</p></a>
  ${S.premium ? '' : premiumCard()}
  <button class="card" data-act="go" data-val="family" style="width:100%"><div class="head"><div class="ico" style="background:var(--blue)">${ico('users')}</div><div class="big" style="font-size:18px">Protect your whole family</div></div>
    <p class="desc">Set up Scam Block and Caller ID for every line on your account in under two minutes. Calls with people they know are never analyzed.</p><div class="cta"><span>Manage family protection</span>${ico('chevR')}</div></button>
  <p class="note">Turning on Scam Block might block calls you want; disable any time. Qualifying service and capable device required.</p>`;
}
function activityScreen() {
  const acts = lineActivity().filter(matchesFilter);
  const q = (S.lookupQ || '').toLowerCase();
  const list = q ? acts.filter(a => (a.name || '').toLowerCase().includes(q) || (digits(q) && digits(a.num).includes(digits(q))) || (a.cat || '').toLowerCase().includes(q)) : acts;
  return `
  ${header('Recent activity', { back: true, icons: [['flag', 'sheet', 'report']] })}
  <div class="field">${ico('search')}<input placeholder="Search number, name or category" data-bind="lookupQ" value="${esc(S.lookupQ || '')}"></div>
  ${filterChips()}
  <div class="card flush">${list.length ? list.map(actRow).join('') : emptyHtml('No matching calls')}</div>
  <p class="note">ScamShield keeps 90 days of activity for ${esc(curLine().device)}. Calls from your contacts are never analyzed or listed.</p>`;
}
function lookupScreen() {
  const r = S.lookupRes;
  return `
  ${header('Look up a number', { back: true })}
  <div class="field">${ico('search')}<input type="tel" placeholder="Enter a phone number" data-bind="lookupQ" data-enter="lookup" value="${esc(S.lookupQ || '')}"><button class="btn black" data-act="lookup">Search</button></div>
  ${r ? lookupResult(r) : ''}
  ${!S.premium ? `<div class="banner">${ico('lock')}<div><b>Free lookups show risk and category.</b> ScamShield Premium adds the caller's name, carrier and line type.</div></div>` : ''}
  <h2 class="section">Recent lookups</h2>
  <div class="card flush">${S.lookups.length ? S.lookups.map(n => row({ icon: 'clock', cls: 'gray', title: esc(n), act: 'lookupRecent', val: n })).join('') : emptyHtml('No lookups yet', 'search')}</div>`;
}
function lookupResult(r) {
  const blur = S.premium ? '' : 'blur';
  return `<div class="card">
    <div class="caller-head"><div class="avatar ${r.risk >= 45 ? '' : 'gray'}" style="${r.risk >= 80 ? 'background:var(--red)' : ''}">${ico(r.risk >= 80 ? 'alert' : 'phone')}</div><div><div class="name">${esc(S.premium ? r.name : (r.risk >= 45 ? r.cat : 'Number found'))}</div><div class="num">${esc(r.num)} · ${esc(r.loc)}</div></div></div>
    <span class="badge ${riskCls(r.risk)}">${esc(r.cat)}</span>
    ${riskMeter(r.risk)}
    <div style="margin-top:10px">
      <div class="kv"><span class="k">Reported (30 days)</span><span class="v">${Number(r.reports).toLocaleString()} customers</span></div>
      <div class="kv"><span class="k">Name</span><span class="v ${blur}">${esc(r.name)}</span></div>
      <div class="kv"><span class="k">Carrier</span><span class="v ${blur}">${esc(r.carrier)}</span></div>
      <div class="kv"><span class="k">Line type</span><span class="v ${blur}">${esc(r.type)}</span></div>
    </div>
    <p class="note">${esc(r.note)}</p>
    ${!S.premium ? `<div class="btn-row"><button class="btn primary" data-act="sheet" data-val="premium">${ico('lock')} Unlock full lookup</button></div>` : ''}
    ${numActions(r.num)}</div>`;
}
function numActions(num) {
  return `<div class="actions">
      <button data-act="${isBlocked(num) ? 'unblock' : 'block'}" data-val="${esc(num)}"><div class="c red">${ico('block')}</div>${isBlocked(num) ? 'Unblock' : 'Block'}</button>
      <button data-act="${isAllowed(num) ? 'unallow' : 'allow'}" data-val="${esc(num)}"><div class="c green">${ico('checkCircle')}</div>${isAllowed(num) ? 'Allowed' : 'Allow'}</button>
      <button data-act="reportNum" data-val="${esc(num)}"><div class="c magenta">${ico('flag')}</div>Report</button>
      <button data-act="toast" data-val="Added to contacts"><div class="c">${ico('userPlus')}</div>Contact</button>
    </div>`;
}
async function doLookup(q) {
  const d = digits(q).replace(/^1(?=\d{10}$)/, '');
  if (d.length !== 10) { toast('Enter a 10-digit phone number'); return; }
  try {
    const r = await api.get(`/numbers/${d}?line=${curLine().lineId}`);
    S.lookupRes = { num: r.num, name: r.display_name || 'Unknown', carrier: r.carrier || 'Unknown', type: r.line_type || 'Unknown', loc: r.location || 'United States', risk: r.risk, reports: r.reports_30d, cat: r.category || 'Unknown', note: r.note || '' };
    S.lookups = await api.get(`/lines/${curLine().lineId}/lookups`);
    render();
  } catch (e) { fail(e); }
}
function listScreen(kind) {
  const isB = kind === 'blocklist'; const items = isB ? S.blocked : S.allowed;
  return `
  ${header(isB ? 'Block list' : 'Allow list', { back: true })}
  <div class="field">${ico(isB ? 'block' : 'checkCircle')}<input type="tel" placeholder="Add a phone number" data-bind="addNum" data-enter="${isB ? 'addBlock' : 'addAllow'}" value="${esc(S.addNum || '')}"><button class="btn black" data-act="${isB ? 'addBlock' : 'addAllow'}">Add</button></div>
  <div class="card flush"><div class="rows-title">${items.length} number${items.length === 1 ? '' : 's'}</div>
    ${items.length ? items.map(b => row({ icon: isB ? 'phoneOff' : 'phone', cls: isB ? 'red' : 'green', title: esc(b.name || b.num), sub: b.name ? `${esc(b.num)} · ${esc(b.when)}` : esc(b.when), chev: false, right: `<button class="icon-btn" data-act="${isB ? 'unblock' : 'unallow'}" data-val="${esc(b.num)}" aria-label="Remove">${ico('trash')}</button>` })).join('') : emptyHtml(isB ? 'No blocked numbers' : 'No allowed numbers')}
  </div>
  <p class="note">${isB ? 'Blocked numbers go straight to voicemail without ringing. Scam Likely calls are handled automatically by Scam Block, so you do not need to add them here.' : 'Allowed numbers always ring through, even when Scam Block or a blocked category would stop them. Your contacts are allowed automatically.'}</p>`;
}
function categoriesScreen() {
  const total = CATEGORIES.filter(c => S.categories[c.id]).reduce((a, c) => a + c.est, 0);
  return `
  ${header('Block spam categories', { back: true })}
  ${S.premium ? '' : `<div class="banner">${ico('lock')}<div><b>Premium feature.</b> Scam &amp; fraud blocking is included free. Add ScamShield Premium to send other categories to voicemail.</div></div>`}
  <div class="card tint"><div class="eyebrow">Estimated</div><div class="big">~${total} calls/mo</div><p class="desc">sent to voicemail on ${esc(curLine().device)}</p></div>
  <div class="card flush">
    ${CATEGORIES.map(c => { const locked = !S.premium && c.id !== 'fraud'; return `<div class="row"><div class="ico ${c.id === 'fraud' ? 'red' : 'gray'}">${ico(c.icon)}</div><div class="txt"><div class="t">${c.name}${c.id === 'fraud' ? '<span class="badge green">Free</span>' : ''}</div><div class="s">${c.desc} · ~${c.est}/mo</div></div><button class="switch ${S.categories[c.id] ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="cat" data-val="${c.id}" role="switch"></button></div>`; }).join('')}
  </div>
  <p class="note">Categorized calls skip the ring and land in voicemail. With Voicemail-to-text, you get a transcript by text so you never miss something real.</p>`;
}
function settingsScreen() {
  return `
  ${header('ScamShield settings', { back: true })}
  <div class="card flush"><div class="rows-title">Calls</div>
    ${toggleRow('vmText', 'message', 'blue', 'Voicemail-to-text', 'Transcribe voicemails from blocked and unknown callers and text them to you', true)}
    ${toggleRow('unknownVm', 'voicemail', 'gray', 'Send unknown callers to voicemail', 'Anyone not in your contacts or allow list')}
    ${toggleRow('callback', 'phone', 'green', 'Callback protection', 'Hear a warning before you dial a number flagged as a scam')}
  </div>
  <div class="card flush"><div class="rows-title">Alerts</div>
    ${toggleRow('safeWeb', 'globe', 'magenta', 'Safe web browsing alerts', 'Get told when the network blocks a phishing or scam site')}
    ${toggleRow('weekly', 'bell', 'amber', 'Weekly protection summary', 'A Monday recap of what ScamShield stopped')}
  </div>
  <div class="card flush">
    ${row({ icon: 'user', cls: 'gray', title: 'Caller ID name', sub: 'Anne Rivera', act: 'toast', val: 'Caller ID name changes are not part of this demo' })}
    ${row({ icon: 'shield', cls: 'magenta', title: 'ScamShield Premium', sub: S.premium ? 'Active · $4.00/mo per line' : 'Not added', act: 'sheet', val: 'premium' })}
    ${row({ icon: 'info', cls: 'gray', title: 'How ScamShield works', sub: 'Network data, call behavior and reports from 100M+ customers', act: 'toast', val: 'Learn more is not part of this demo' })}
    ${row({ icon: 'globe', cls: 'blue', title: 'Backend', sub: `${esc(api.base)} · live data from TigerData`, chev: false })}
  </div>
  <button class="btn ghost" data-act="reset">Reset app preferences</button>`;
}
function familyScreen() {
  return `
  ${header('Family protection', { back: true })}
  <div class="card magenta"><div class="eyebrow">ScamShield for families</div><div class="big">Every line, protected</div><p class="desc">Scam Block and Caller ID are on for all ${LINES.length} lines. Calls with people they know, like you, are never processed.</p></div>
  <div class="card flush">
    ${LINES.map(l => { const st = S.allStats[l.id] || { blocked: 0 }; const on = l.toggles?.scamBlock; return row({ avatar: `<div class="avatar ${l.primary ? '' : 'gray'}">${l.initials}</div>`, title: esc(l.name), badge: `<span class="badge ${on ? 'green' : 'amber'}">${on ? 'Protected' : 'Partial'}</span>`, sub: `${esc(l.device)} · ${st.blocked} blocked this month`, act: 'lineGo', val: l.id }); }).join('')}
  </div>
  <div class="card"><div class="big" style="font-size:18px">Extra care for Rosa</div><p class="desc">Grandparent and family-emergency scams target older adults. For Rosa's line, AI voice detection and in-call alerts also notify you by text when a high-risk call is flagged.</p>
    <div class="row" style="padding:12px 0 0;border:0"><div class="txt"><div class="t">Notify me about Rosa's high-risk calls</div></div>${switchHtml('rosaAlerts')}</div></div>
  <button class="btn outline" data-act="toast" data-val="Adding a line is not part of this demo">${ico('plus')} Add a line to ScamShield</button>`;
}

/* ---------- sheets ---------- */
function detailSheet(a) {
  const t = TYPE[a.type] || TYPE.identified;
  return `
    <div class="caller-head"><div class="avatar ${a.risk >= 80 ? '' : 'gray'}" style="${a.risk >= 80 ? 'background:var(--red)' : ''}">${a.name ? esc(a.name.split(' ').map(w => w[0]).join('').slice(0, 2)) : ico(a.risk >= 80 ? 'alert' : 'phone')}</div>
      <div><div class="name">${esc(a.name || (a.risk >= 80 ? a.cat : 'Unknown caller'))}</div><div class="num">${esc(a.num)} · ${esc(a.loc || 'United States')}</div></div></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 4px"><span class="badge ${t.cls === 'magenta' ? 'magenta' : t.cls}">${t.label}</span><span class="badge">${esc(a.cat)}</span>${isBlocked(a.num) ? '<span class="badge red">On your block list</span>' : ''}${isAllowed(a.num) ? '<span class="badge green">Allowed</span>' : ''}</div>
    ${riskMeter(a.risk ?? 0)}
    <div style="margin-top:8px">
      <div class="kv"><span class="k">Reported (30 days)</span><span class="v">${Number(a.reports || 0).toLocaleString()} customers</span></div>
      <div class="kv"><span class="k">Called this line</span><span class="v">${a.times} time${a.times === 1 ? '' : 's'}</span></div>
      <div class="kv"><span class="k">When</span><span class="v">${ago(a.ago)}</span></div>
    </div>
    ${a.note ? `<p class="note" style="color:var(--text);background:var(--bg);padding:10px 12px;border-radius:10px">${ico('info')} ${esc(a.note)}</p>` : ''}
    ${numActions(a.num)}
    <p class="note">Calls with people in your contacts are never analyzed. Blocking sends this number to voicemail on ${esc(curLine().device)}.</p>`;
}
const REASONS = ['Scam or fraud', 'Telemarketing', 'Robocall', 'Political', 'Survey', 'Not spam (wrongly flagged)'];
function reportSheet(num) {
  return `<div class="title">Report a number</div><div class="sub">Reports from T-Mobile customers train ScamShield for everyone.</div>
    ${num ? `<div class="card" style="padding:12px 16px;display:flex;align-items:center;gap:12px"><div class="ico" style="width:36px;height:36px;border-radius:10px;background:var(--magenta-tint);color:var(--magenta);display:flex;align-items:center;justify-content:center">${ico('flag')}</div><b>${esc(num)}</b></div>`
      : `<div class="field">${ico('phone')}<input type="tel" placeholder="Phone number to report" data-bind="addNum" value="${esc(S.addNum || '')}"></div>`}
    ${REASONS.map(r => `<button class="radio ${S.reason === r ? 'on' : ''}" data-act="reason" data-val="${r}"><span class="r"></span>${r}</button>`).join('')}
    <textarea class="area" placeholder="What did they say? (optional)" data-bind="reportText">${esc(S.reportText || '')}</textarea>
    <div class="btn-row"><button class="btn primary" data-act="submitReport" data-val="${esc(num || '')}">Submit report</button></div>`;
}
function premiumSheet() {
  const L = curLine();
  return `<div class="title">ScamShield Premium</div><div class="sub">Advanced calling features for ${esc(L.device)}.</div>
    <div class="price">$4<small>/mo per line · cancel anytime</small></div>
    <div style="margin:10px 0 6px">${['Block spam by category', 'AI voice and deepfake detection', 'In-call fraud alerts', 'Call Screener for unknown callers', 'Reverse number lookup with name and carrier', 'Voicemail-to-text'].map(f => `<div class="feat">${ico('checkCircle')}<span>${f}</span></div>`).join('')}</div>
    ${S.premium ? `<div class="btn-row"><button class="btn outline" data-act="premiumRemove">Remove Premium</button></div>` : `<div class="btn-row"><button class="btn primary" data-act="premiumAdd">Add to ${esc(L.name)}'s line</button></div>`}
    <p class="note">Billed on your next statement. Included at no extra cost on some Experience plans. Turning on Scam Block might block calls you want; disable any time.</p>`;
}

/* ---------- calls (driven by server events) ---------- */
function startCall(scn) {
  api.post('/calls/simulate', { lineId: curLine().lineId, scenario: scn }).catch(fail);
}
function startTimer() { clearInterval(callTimer); callTimer = setInterval(() => { if (!S.call || S.call.phase !== 'connected') return; S.call.t++; renderOverlay(); }, 1000); }
function onCallEvent(ev) {
  if (ev.phase === 'blocked') { toast(`ScamShield blocked a ${ev.label} call from ${ev.num}`, 'block'); return; }
  if (ev.phase === 'ringing' || ev.phase === 'screening') {
    if (!S.call || S.call.id !== ev.id) S.call = { id: ev.id, lineId: ev.lineId, scn: ev.scenario, num: ev.num, loc: ev.loc, label: ev.label, risk: ev.risk, callerId: ev.callerId, transcript: [], alerts: [], dismissed: false, t: 0 };
    S.call.phase = ev.phase; S.call.label = ev.label || S.call.label; if (ev.loc) S.call.loc = ev.loc; if (ev.remote) S.call.remote = true;
  }
  if (ev.remote && S.call) S.call.remote = true;
  if (!S.call || (ev.id && S.call.id !== ev.id)) { renderOverlay(); return; }
  if (ev.phase === 'transcript') S.call.transcript.push({ who: ev.who, text: ev.text });
  if (ev.phase === 'alert') S.call.alerts.push({ kind: ev.kind, title: ev.title, text: ev.text, pct: ev.pct, profile: ev.profile, replayed: ev.replayed, fusion: ev.fusion });
  if (ev.phase === 'connected') { S.call.phase = 'connected'; S.call.t = 0; startTimer(); }
  if (ev.phase === 'ended') { S.call.phase = 'ended'; S.call.endedBy = ev.endedBy; S.call.outcome = ev.outcome; S.call.lesson = ev.lesson || null; clearInterval(callTimer); loadInsights(); }
  renderOverlay();
}
function callAction(a) {
  const c = S.call; if (!c) return;
  const post = p => api.post(`/calls/${c.id}/${p}`).catch(fail);
  if (a === 'accept') post('answer');
  else if (a === 'decline') post('decline');
  else if (a === 'end') post('end?by=' + (c.alerts.some(x => x.kind === 'fraud') ? 'ScamShield' : 'you'));
  else if (a === 'hangup') post('end?by=you');
  else if (a === 'takeover') post('takeover');
  else if (a === 'dismiss') { c.dismissed = true; renderOverlay(); }
  else if (a === 'done') { S.call = null; clearInterval(callTimer); renderOverlay(); }
  else if (a === 'report') { const num = c.num; S.call = null; clearInterval(callTimer); renderOverlay(); openSheet('report', num); }
}
/* "This voice was recognized" card: the caller's voiceprint matched a reported scammer in the voice database. */
function voiceCard(a) {
  const p = a.profile || {}, pct = Math.max(0, Math.min(100, a.pct || 0)), n = p.reports || 1, f = a.fusion;
  const numbers = (p.numbers || []).map(x => `<span class="badge">${esc(x)}</span>`).join('');
  const why = f ? `<div class="vwhy"><div class="vlabel">Why we flagged this · <b>${esc(f.level)} risk (${f.score}/100)</b></div>${f.signals.map(s => `<div class="vsig">${ico('check')}<span><b>${esc(s.label)}.</b> ${esc(s.detail)}</span></div>`).join('')}</div>` : '';
  return `<div class="alert voice"><div class="ah"><div class="i magenta">${ico('waveform')}</div>${esc(a.title)}${p.aiVoice ? '<span class="badge amber">AI voice</span>' : ''}</div>
    <p>${esc(a.text)}</p>
    <div class="vmeter" role="img" aria-label="${pct}% similar to previously reported scam audio"><span style="width:${pct}%"></span></div>
    <div class="vmeta"><span>${pct}% similar</span><span>${n} report${n === 1 ? '' : 's'}${p.status === 'pending' ? ' · unconfirmed' : ''}</span></div>
    ${numbers ? `<div class="vnums"><span class="vlabel">Also called from</span>${numbers}</div>` : ''}
    ${why}
    <p class="vnote">${a.replayed ? 'Demo call: a saved voice sample stands in for live audio. ' : ''}A voice match is a hint, not proof. We never block a call on voice alone.</p>
    <div class="btn-row"><button class="btn outline" data-act="dispute" data-val="${esc(p.id || '')}">Not a scam?</button><button class="btn danger" data-act="callAct" data-val="end">End call</button></div>
    <div class="brand">${ico('shieldCheck')} ScamShield voice database</div></div>`;
}
const fmtTime = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
function callHtml() {
  const c = S.call;
  const ctl = (cls, icon, label, act) => `<button class="ctl" data-act="callAct" data-val="${act}"><div class="c ${cls}">${ico(icon)}</div>${label}</button>`;
  const labelCls = /scam likely/i.test(c.label) ? '' : /spam/i.test(c.label) ? 'amber' : 'gray';
  const bubbles = c.transcript.map(l => `<div class="bubble ${l.who === 'ScamShield' || l.who === 'you' ? 'us' : 'them'}"><span class="by">${esc(l.who === 'ScamShield' ? 'ScamShield' : l.who === 'you' ? 'You' : 'Caller')}</span>${esc(l.text)}</div>`).join('');
  const alerts = c.alerts.map(a => a.kind === 'voiceprint' ? voiceCard(a) : a.kind === 'fraud'
    ? (c.dismissed ? '' : `<div class="alert danger"><div class="ah"><div class="i red">${ico('shieldAlert')}</div>${esc(a.title)}</div><p>${esc(a.text)} <b>Use extreme caution</b> or end the call now.</p><div class="btn-row"><button class="btn outline" data-act="callAct" data-val="dismiss">Dismiss warning</button><button class="btn danger" data-act="callAct" data-val="end">End call</button></div><div class="brand">${ico('shieldCheck')} ScamShield in-call protection</div></div>`)
    : `<div class="alert"><div class="ah"><div class="i amber">${ico('sparkles')}</div>${esc(a.title)}</div><p>${esc(a.text)}</p><div class="brand">${ico('shieldCheck')} ScamShield</div></div>`).join('');
  let body = '', controls = '', state = '';
  if (c.phase === 'ringing' && c.remote) { state = 'Real call via Twilio · waiting for pickup'; controls = ctl('red', 'phoneOff', 'Cancel', 'end'); }
  else if (c.phase === 'ringing') { state = 'T-Mobile · incoming call'; controls = ctl('red', 'phoneOff', 'Decline', 'decline') + ctl('green', 'phone', 'Accept', 'accept'); body = bubbles ? `<div class="transcript">${bubbles}</div>` : ''; }
  if (c.phase === 'screening') { state = 'ScamShield is screening this call'; body = `<div class="transcript">${bubbles}</div>` + alerts; controls = ctl('red', 'phoneOff', 'Hang up', 'hangup') + ctl('green', 'phone', 'Take over', 'takeover'); }
  if (c.phase === 'connected') {
    state = `<span class="timer">${fmtTime(c.t)}</span>`;
    controls = ctl('gray', 'mic', 'Mute', 'noop') + ctl('red', 'phoneOff', 'End', 'end') + ctl('gray', 'voicemail', 'Speaker', 'noop');
    body = (bubbles ? `<div class="transcript">${bubbles}</div>` : '') + alerts;
  }
  if (c.phase === 'ended') {
    const byShield = c.endedBy === 'ScamShield';
    const msg = { fraud: 'This number was flagged as fraud and added to your activity. The verdict came from the live transcript.', screened: 'The caller would not identify themselves and was hung up on. Nothing rang on your phone.', scam: 'This Scam Likely call was logged. Turn on Scam Block to stop calls like this before they ring.', ai: 'A synthetic voice was detected on this call and it was logged.' }[c.outcome] || 'Call logged in your ScamShield activity.';
    body = `<div class="summary"><div class="orb">${ico(byShield ? 'shieldCheck' : 'phoneOff')}</div><h3>${byShield ? 'Call ended by ScamShield' : 'Call ended'}</h3><p>${msg}</p></div>`;
    controls = `<div style="width:100%;display:flex;flex-direction:column;gap:10px">${c.lesson ? `<a class="btn white" href="drill.html?c=${encodeURIComponent(c.lesson.id)}">${ico('sparkles')} Practice this scam: ${esc(c.lesson.title)}</a>` : ''}<button class="btn primary" data-act="callAct" data-val="report">${ico('flag')} Report this number</button><button class="btn outline-light" data-act="callAct" data-val="done">Done</button></div>`;
  }
  return `<div class="call"><div class="top"><div class="label ${labelCls}">${ico(c.phase === 'screening' ? 'headset' : 'alert')} ${esc(c.label)}</div><div class="who">${esc(c.num)}</div><div class="where">${esc(c.loc || '')}${c.callerId ? ' · T-Mobile Caller ID' : ''}</div><div class="state">${state}</div></div><div class="body">${body}</div><div class="controls">${controls}</div></div>`;
}

/* ---------- render ---------- */
const TABS = [['home', 'Home', 'home'], ['shop', 'Shop', 'shop'], ['benefits', 'Benefits', 'gift'], ['services', 'Services', 'grid'], ['account', 'Account', 'user']];
const SCREENS = { home: homeScreen, shop: shopScreen, benefits: benefitsScreen, services: servicesScreen, account: accountScreen, scamshield: scamshieldScreen, activity: activityScreen, lookup: lookupScreen, blocklist: () => listScreen('blocklist'), allowlist: () => listScreen('allowlist'), categories: categoriesScreen, 'ss-settings': settingsScreen, family: familyScreen };
function render(resetScroll) {
  const content = document.getElementById('content'), tabbar = document.getElementById('tabbar');
  if (!S.ready) {
    content.innerHTML = S.error
      ? `<div class="header"><div class="h1">ScamShield</div></div><div class="card"><div class="big" style="font-size:18px">Cannot reach the backend</div><p class="desc">${esc(S.error)}</p><p class="desc">Start it with <code>npm --prefix server start</code> and open <code>http://localhost:8787</code>.</p><div class="btn-row"><button class="btn primary" data-act="retry">Retry</button></div></div>`
      : `<div class="header"><div class="h1 brand">Hey, Anne</div></div><div class="card"><p class="desc">Loading your lines from TigerData…</p></div>`;
    tabbar.classList.add('hidden'); return;
  }
  const scr = current(); const top = content.scrollTop; const active = document.activeElement; const bind = active && active.dataset ? active.dataset.bind : null; const pos = active && active.selectionStart;
  content.innerHTML = (SCREENS[scr] || homeScreen)();
  content.classList.toggle('no-tabs', S.stack.length > 0);
  content.classList.toggle('hero', scr === 'benefits');
  tabbar.classList.toggle('hidden', S.stack.length > 0);
  tabbar.innerHTML = TABS.map(([id, label, icon]) => `<button class="tab ${S.tab === id ? 'on' : ''}" data-act="tab" data-val="${id}">${ico(icon)}<span>${label}</span></button>`).join('');
  content.scrollTop = resetScroll ? 0 : top;
  if (bind) { const el = content.querySelector(`[data-bind="${bind}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { } } }
  renderOverlay();
}
const last = { sheet: '', call: null, toast: '' };
function callKey() { const c = S.call; return [c.scn, c.phase, c.endedBy, c.callerId, c.label, c.remote].join('|') + '#' + [c.dismissed, c.transcript.length, c.alerts.length, S.premium].join('|'); }
function updateCall(callEl, k) {
  const html = callHtml();
  const sameShell = last.call && last.call.split('#')[0] === k.split('#')[0] && callEl.querySelector('.body');
  if (sameShell) { const tpl = document.createElement('div'); tpl.innerHTML = html; callEl.querySelector('.body').innerHTML = tpl.querySelector('.body').innerHTML; }
  else callEl.innerHTML = html;
  last.call = k;
}
function renderOverlay() {
  const ov = document.getElementById('overlay');
  if (!ov.querySelector('#sheetov')) ov.innerHTML = '<div id="sheetov"></div><div id="callov"></div><div id="toastov"></div>';
  const [sheetEl, callEl, toastEl] = ['#sheetov', '#callov', '#toastov'].map(s => ov.querySelector(s));
  let sh = '';
  if (S.sheet) {
    const { name, data } = S.sheet; let inner = '';
    if (name === 'detail') { const a = findAct(data); inner = a ? detailSheet(a) : ''; }
    if (name === 'report') inner = reportSheet(data);
    if (name === 'premium') inner = premiumSheet();
    sh = `<div class="backdrop" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>${inner}</div></div>`;
  }
  if (sh !== last.sheet) {
    const a = document.activeElement, b = a && a.dataset ? a.dataset.bind : null, p = a && a.selectionStart;
    sheetEl.innerHTML = sh; last.sheet = sh;
    if (b) { const f = sheetEl.querySelector(`[data-bind="${b}"]`); if (f) { f.focus(); try { f.setSelectionRange(p, p); } catch (err) { } } }
  }
  if (!S.call) { if (last.call !== null) { callEl.innerHTML = ''; last.call = null; } }
  else { const k = callKey(); if (k !== last.call) updateCall(callEl, k); else { const t = callEl.querySelector('.timer'); if (t) t.textContent = fmtTime(S.call.t); } }
  const th = S.toast ? `<div class="toast ${S.toast.kind || ''}">${ico(S.toast.kind === 'block' ? 'shieldCheck' : 'checkCircle')}<span>${esc(S.toast.msg)}</span></div>` : '';
  if (th !== last.toast) { toastEl.innerHTML = th; last.toast = th; }
  document.querySelector('.statusbar').classList.toggle('light', !!S.call || current() === 'benefits');
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.classList.contains('backdrop') && e.target.closest('.sheet')) return;
  const act = el.dataset.act, v = el.dataset.val;
  const L = curLine();
  const A = {
    tab: () => setTab(v), go: () => go(v), back, retry: () => boot(),
    line: () => { S.line = +v; save(); render(); loadLine().catch(fail); },
    lineGo: () => { S.line = +v; save(); S.stack = []; S.tab = 'services'; go('scamshield'); loadLine().catch(fail); },
    toggle: () => {
      if (el.classList.contains('locked')) return openSheet('premium');
      const val = !S.toggles[v]; S.toggles = { ...S.toggles, [v]: val }; L.toggles = S.toggles; render();
      if (v === 'scamBlock') toast(val ? 'Scam Block is on. Scam Likely calls will be blocked.' : 'Scam Block is off. Scam Likely calls will ring.');
      api.patch(`/lines/${L.lineId}`, { toggles: { [v]: val } }).then(r => { L.toggles = r.toggles; }).catch(fail);
    },
    cat: () => { if (el.classList.contains('locked')) return openSheet('premium'); S.categories[v] = !S.categories[v]; render(); api.put(`/lines/${L.lineId}/categories`, { [v]: S.categories[v] }).catch(fail); },
    filter: () => { S.filter = v; save(); render(); },
    detail: () => openSheet('detail', v), sheet: () => openSheet(v, null), close: () => closeSheet(),
    call: () => startCall(v), callAct: () => callAction(v),
    story: () => { const [scn, lineId] = v.split(':'); api.post('/calls/simulate', { lineId, scenario: scn }).catch(fail); },
    storyReset: () => api.post('/demo/story/reset').then(r => toast(`Story reset. Forgot ${r.forgotten} learned voice${r.forgotten === 1 ? '' : 's'}.`)).catch(fail),
    dispute: () => api.post(`/voices/${v}/dispute`).then(() => toast('Thanks. Your dispute was recorded and lowers trust in this voice match.')).catch(fail),
    block: () => api.post(`/lines/${L.lineId}/lists`, { kind: 'block', num: v }).then(() => { toast(`${v} blocked. Calls go to voicemail.`); return refreshLists(); }).catch(fail),
    unblock: () => api.del(`/lines/${L.lineId}/lists/block/${digits(v)}`).then(() => { toast(`${v} removed from block list`); return refreshLists(); }).catch(fail),
    allow: () => api.post(`/lines/${L.lineId}/lists`, { kind: 'allow', num: v }).then(() => { toast(`${v} will always ring through`); return refreshLists(); }).catch(fail),
    unallow: () => api.del(`/lines/${L.lineId}/lists/allow/${digits(v)}`).then(() => { toast(`${v} removed from allow list`); return refreshLists(); }).catch(fail),
    addBlock: () => { const d = digits(S.addNum); if (d.length < 10) return toast('Enter a 10-digit phone number'); const n = fmtNum(d); S.addNum = ''; api.post(`/lines/${L.lineId}/lists`, { kind: 'block', num: n }).then(() => { toast(`${n} blocked`); return refreshLists(); }).catch(fail); },
    addAllow: () => { const d = digits(S.addNum); if (d.length < 10) return toast('Enter a 10-digit phone number'); const n = fmtNum(d); S.addNum = ''; api.post(`/lines/${L.lineId}/lists`, { kind: 'allow', num: n }).then(() => { toast(`${n} allowed`); return refreshLists(); }).catch(fail); },
    reportNum: () => openSheet('report', v), reason: () => { S.reason = v; renderOverlay(); },
    submitReport: () => {
      const n = v || fmtNum(S.addNum || '');
      if (!digits(n) || digits(n).length < 10) return toast('Enter a 10-digit phone number');
      if (!S.reason) return toast('Choose a reason');
      api.post('/reports', { lineId: L.lineId, num: n, reason: S.reason, text: S.reportText || '' })
        .then(() => { S.addNum = ''; S.reportText = ''; closeSheet(); toast('Thanks. Your report helps protect 100M+ T-Mobile customers.'); }).catch(fail);
    },
    premiumAdd: () => api.post(`/accounts/${ACCOUNT}/premium`, { premium: true })
      .then(() => api.patch(`/lines/${L.lineId}`, { toggles: { aiVoice: true, inCall: true } }))
      .then(() => loadAll()).then(() => { closeSheet(); toast(`ScamShield Premium added to ${L.name}'s line`); render(); }).catch(fail),
    premiumRemove: () => api.post(`/accounts/${ACCOUNT}/premium`, { premium: false })
      .then(() => loadAll()).then(() => { closeSheet(); toast('ScamShield Premium removed'); render(); }).catch(fail),
    lookup: () => doLookup(S.lookupQ), lookupRecent: () => { S.lookupQ = v; doLookup(v); },
    toast: () => toast(v), noop: () => { },
    reset: () => { localStorage.removeItem(KEY); location.reload(); },
  };
  (A[act] || (() => { }))();
});
document.addEventListener('input', e => { const b = e.target.dataset && e.target.dataset.bind; if (!b) return; S[b] = e.target.value; if (b === 'lookupQ' && current() === 'activity') render(); });
document.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const a = e.target.dataset && e.target.dataset.enter; if (a) { e.preventDefault(); const btn = document.querySelector(`[data-act="${a}"]`); if (btn) btn.click(); } });

/* ---------- boot ---------- */
let es = null;
async function boot() {
  S.error = null; render();
  try { await loadAll(); } catch (e) { S.error = e.message; render(); return; }
  loadInsights();
  render(true);
  if (!es) es = api.events({
    call: onCallEvent,
    activity: a => { if (a.line !== curLine().lineId) return; S.activity = [a, ...S.activity.filter(x => x.id !== a.id && !(x.e164 === a.e164 && x.type === a.type))]; refreshStats().catch(() => render()); },
    line: l => { const L = LINES.find(x => x.lineId === l.id); if (L) { L.toggles = l.toggles; if (L === curLine()) { S.toggles = l.toggles; render(); } } },
    lists: () => refreshLists().catch(() => { }),
  });
}
boot();

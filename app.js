/* ScamShield — T-Life feature extension. UI over the server/ API (TigerData + Gemini + Photon). */
const KEY = 'tlife-scamshield-ui-v3';
const ACCOUNT = 'acct_anne';

/* ---------- state ---------- */
let S = Object.assign({ tab: 'home', stack: [], line: 0, filter: 'all', quizOn: true },loadPrefs(), {
  ready: false, error: null, premium: false, toggles: {}, categories: {}, blocked: [], allowed: [], lookups: [],
  stats: { blocked: 0, flagged: 0, identified: 0 }, allStats: {}, activity: [],
  sheet: null, toast: null, call: null, lookupQ: '', lookupRes: null, reason: null, addNum: '', reportText: '',
  learn: null, session: null, lessonSession: null, learnInput: '', detectText: '', detectRes: null, optin: { channel: 'simulator', interests: ['mobile_account', 'package_delivery'] }, pickCategory: null,
});
function loadPrefs() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify({ tab: S.tab, stack: S.stack, line: S.line, filter: S.filter })); } catch {} }

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
  blocked:    { icon: 'phoneOff',    cls: 'red',     label: 'Blocked' },
  scam:       { icon: 'alert',       cls: 'magenta', label: 'Scam Likely · rang' },
  spam:       { icon: 'voicemail',   cls: 'amber',   label: 'To voicemail' },
  identified: { icon: 'phoneIn',     cls: 'green',   label: 'Identified' },
  screened:   { icon: 'headset',     cls: 'blue',    label: 'Screened' },
  forwarded:  { icon: 'phoneIn',     cls: 'green',   label: 'Screened · answered' },
  missed:     { icon: 'headset',     cls: 'amber',   label: 'Screened · not answered' },
  ai:         { icon: 'sparkles',    cls: 'amber',   label: 'AI voice detected' },
  fraud:      { icon: 'shieldAlert', cls: 'red',     label: 'Fraud · call ended' },
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
async function refreshStats() { S.stats = await api.get(`/lines/${curLine().lineId}/stats`); S.allStats[S.line] = S.stats; render(); }
const fail = e => toast(e.message || 'Something went wrong');

/* ---------- navigation & transient UI ---------- */
let callTimer = null;
function go(screen) { S.stack.push({ screen }); S.sheet = null; save(); render(true); }
function back() { S.stack.pop(); S.sheet = null; save(); render(true); }
function setTab(t) { if (t === 'pet') t = 'learn'; S.tab = t; S.stack = []; S.sheet = null; save(); render(true); }
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
    <div class="txt"><div class="t">${o.title}${o.badge || ''}</div>${o.sub ? `<div class="s ${o.wrap ? 'wrap' : ''}">${o.sub}</div>` : ''}${o.pill ? `<div class="pillrow">${o.pill}</div>` : ''}</div>
    ${o.meta ? `<div class="meta">${o.meta}</div>` : ''}${o.right || ''}${o.chev === false ? '' : `<div class="chev">${ico('chevR')}</div>`}
  </${tag}>`;
}
function switchHtml(key, locked) { return `<button class="switch ${S.toggles[key] ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="toggle" data-val="${key}" role="switch" aria-checked="${!!S.toggles[key]}"></button>`; }
function toggleRow(key, icon, cls, title, sub, prem) {
  const locked = prem && !S.premium;
  return `<div class="row"><div class="ico">${ico(icon)}</div><div class="txt"><div class="t">${title}${prem ? `<span class="badge prem">${S.premium ? 'Premium' : ico('lock') + ' Premium'}</span>` : ''}</div><div class="s" style="white-space:normal">${sub}</div></div>${switchHtml(key, locked)}</div>`;
}
const emptyHtml = (msg, icon = 'shieldCheck') => `<div class="empty">${ico(icon)}<div>${msg}</div></div>`;
function actRow(a) {
  const t = TYPE[a.type] || TYPE.identified;
  return row({ icon: t.icon, cls: t.cls, title: esc(a.name || a.num), sub: `${t.label} · ${esc(a.cat)}${a.times > 1 ? ` · ${a.times}×` : ''}`, meta: ago(a.ago), act: 'detail', val: a.id });
}
const filterChips = () => `<div class="chips">${FILTERS.map(([k, l]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-act="filter" data-val="${k}">${l}</button>`).join('')}</div>`;
const riskMeter = r => `<div class="risk"><div class="bar"><div class="fill" style="width:${r}%"></div></div><div class="lbl"><span>Risk score</span><span><b>${r}</b> · ${riskLabel(r)}</span></div></div>`;

/* ---------- T-Life shell screens ---------- */
function balanceCard() {
  return `<div class="card"><div class="between"><div class="label">Current balance</div><span class="dotpill">AutoPay on</span></div><div class="amount">$142.50</div>
    <div class="saving">${ico('dollar')} You're saving $20.00 with AutoPay</div>
    <p class="fine">AutoPay scheduled on <b>Nov 25, 2026</b> using <b>Visa *0000</b></p>
    <div class="btn-row"><button class="btn primary sm" data-act="toast" data-val="Payments are not part of this demo">Pay now</button><button class="btn outline sm" data-act="toast" data-val="Bill details are not part of this demo">View bill</button></div></div>`;
}
function homeScreen() {
  const st = stats();
  return `
  <div class="hero-head home">
    <div class="brandbar"><span class="tmark">${ico('tmo')}</span><span class="tlife">T Life</span></div>
    ${header('Hey, Harsh', { brand: true, icons: [['chat', 'toast', 'Messages are not part of this demo'], ['bell', 'toast', 'No new notifications']] })}
    <p class="subhead">See what's new in T Life today</p>
  </div>
  ${balanceCard()}
  <div class="card flush">${row({ icon: 'gift', title: 'T-Mobile Tuesdays', sub: "This week: free 7-Eleven coffee, 15¢ off gas at Shell, $5 off Little Caesars", act: 'tab', val: 'benefits', wrap: true })}</div>
  <h2 class="section">Quick actions</h2>
  <div class="tiles">${tile('dollar', 'Pay bill', 'toast', 'Payments are not part of this demo')}${tile('shield', 'ScamShield', 'go', 'scamshield')}${tile('paw', 'Train with Buddy', 'tab', 'learn')}${tile('upgrade', 'Upgrade', 'toast', 'Shopping is not part of this demo')}${tile('headset', 'Support', 'toast', 'Support chat is not part of this demo')}</div>
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
    ${row({ icon: 'tag', cls: '', title: 'See 4 promotions', act: 'toast', val: na })}
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
  <div class="card flush">${row({ icon: 'gift', cls: '', title: '1K redeemed today', sub: 'Keep your 6-week streak going', act: 'toast', val: na })}
  ${row({ icon: 'star', cls: '', title: 'Magenta Status', sub: 'Hotel, rental car and dining upgrades', act: 'toast', val: na })}</div>`;
}
function servicesScreen() {
  const st = stats(), na = 'Not part of this demo';
  return `
  ${header('Services', { icons: [['plus', 'toast', na]] })}
  <div class="map"><div class="pin">${ico('pin')}</div><div class="cov"><div><div class="s">Network coverage</div><div class="t">5G UC coverage available</div><div class="s">Near Greenwood Ave</div></div><div class="tag">5G<sup style="font-size:8px">UC</sup></div></div></div>
  <h2 class="section">Your services</h2>
  <div class="card flush">
    ${row({ icon: 'shieldCheck', cls: '', title: 'ScamShield', sub: `${st.blocked} calls blocked this month`, pill: `<span class="dotpill ${S.toggles.scamBlock ? 'green' : 'amber'}">${S.toggles.scamBlock ? 'Protected' : 'Partial protection'}</span>`, act: 'go', val: 'scamshield' })}
    ${row({ icon: 'satellite', cls: '', title: 'T-Satellite', sub: 'Text, data and calls off the grid', act: 'toast', val: na })}
    ${row({ icon: 'wifi', cls: '', title: 'Home Internet', sub: 'Gateway online · 612 Mbps', act: 'toast', val: na })}
    ${row({ icon: 'pin', cls: '', title: 'SyncUP DRIVE', sub: 'Last trip 2h ago', act: 'toast', val: na })}
    ${row({ icon: 'card', cls: '', title: 'T-Mobile MONEY', sub: 'Checking · 4.00% APY', act: 'toast', val: na })}
  </div>
  <h2 class="section">More for you</h2>
  <div class="promo"><div class="card dark"><div class="eyebrow">T-Satellite</div><div class="big">Connecting you anywhere</div></div><div class="card"><div class="eyebrow">T-Mobile Visa®</div><div class="big">Rewards that don't play</div></div></div>`;
}
function accountScreen() {
  const na = 'Not part of this demo';
  return `
  ${header('Account', { icons: [['settings', 'toast', na], ['user', 'toast', na]] })}
  <div class="plan-title">Experience More plan</div>
  <div class="plan-sub">+ Home Internet</div>
  <div class="tiles">${tile('clipboard', 'My plans', 'toast', na)}${tile('plus', 'Add-ons', 'toast', na)}${tile('userPlus', 'Add a line', 'toast', na)}${tile('shield', 'ScamShield', 'go', 'scamshield')}${tile('book', 'Scam practice', 'tab', 'learn')}</div>
  <h2 class="section">Billing and payments</h2>
  ${balanceCard()}
  <h2 class="section">Lines and devices</h2>
  <div class="card flush">
    ${LINES.map(l => { const on = l.toggles?.scamBlock; return row({ icon: 'sim', title: `${esc(l.name)}${l.primary ? ' (You)' : ''}`, sub: `${esc(l.device)}<br>${l.num}`, wrap: true, pill: `<span class="dotpill ${on ? 'green' : 'amber'}">ScamShield ${on ? 'on' : 'partial'}</span>`, act: 'lineGo', val: l.id }); }).join('')}
  </div>
  <h2 class="section">Settings</h2>
  <div class="card flush">
    ${row({ icon: 'shield', title: 'ScamShield Premium', sub: S.premium ? 'Active · $4.00/mo per line' : 'Not added', act: 'sheet', val: 'premium' })}
    ${row({ icon: 'user', title: 'Caller ID name', sub: 'Harsh Rivera', act: 'toast', val: 'Caller ID name changes are not part of this demo' })}
    ${row({ icon: 'lock', title: 'Privacy & security', act: 'toast', val: na })}
    ${row({ icon: 'bell', title: 'Notifications', act: 'go', val: 'ss-settings' })}
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
  <div class="card status">
    <div class="shield-status"><div class="orb ${on ? '' : 'off'}">${ico(on ? 'shieldCheck' : 'shield')}</div>
      <div><div class="big">${on ? "You're protected" : 'Scam Block is off'}</div><p class="desc" style="margin-top:2px">${on ? 'Scam Block is on · last 30 days' : `Scam Likely calls ring through on ${esc(L.device)}`}</p></div></div>
    <div class="stat-row"><div class="st"><div class="n">${st.blocked}</div><div class="l">Blocked</div></div><div class="st"><div class="n">${st.flagged}</div><div class="l">Flagged</div></div><div class="st"><div class="n">${st.identified}</div><div class="l">Identified</div></div></div>
  </div>
  <h2 class="section">Quick actions</h2>
  <div class="tiles wrap">${tile('block', 'Block list', 'go', 'blocklist')}${tile('flag', 'Report', 'sheet', 'report')}${tile('checkCircle', 'Allow list', 'go', 'allowlist')}</div>
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
    <div class="pill-demo"><button class="btn outline" data-act="call" data-val="scam">${ico('phoneOff')} Scam Likely call</button><button class="btn outline" data-act="call" data-val="fraud">${ico('sparkles')} AI voice scam</button><button class="btn outline" data-act="call" data-val="screener">${ico('headset')} Screen a call</button></div></div>
  ${S.premium ? '' : premiumCard()}
  <button class="card" data-act="go" data-val="family" style="width:100%"><div class="head"><div class="ico neutral">${ico('users')}</div><div class="big" style="font-size:18px">Protect your whole family</div></div>
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
  <div class="field">${ico('search')}<input type="tel" placeholder="Enter a phone number" data-bind="lookupQ" data-enter="lookup" value="${esc(S.lookupQ || '')}"><button class="btn primary" data-act="lookup">Search</button></div>
  ${r ? lookupResult(r) : ''}
  ${!S.premium ? `<div class="banner">${ico('lock')}<div><b>Free lookups show risk and category.</b> ScamShield Premium adds the caller's name, carrier and line type.</div></div>` : ''}
  <h2 class="section">Recent lookups</h2>
  <div class="card flush">${S.lookups.length ? S.lookups.map(n => row({ icon: 'clock', cls: '', title: esc(n), act: 'lookupRecent', val: n })).join('') : emptyHtml('No lookups yet', 'search')}</div>`;
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
  <div class="field">${ico(isB ? 'block' : 'checkCircle')}<input type="tel" placeholder="Add a phone number" data-bind="addNum" data-enter="${isB ? 'addBlock' : 'addAllow'}" value="${esc(S.addNum || '')}"><button class="btn primary" data-act="${isB ? 'addBlock' : 'addAllow'}">Add</button></div>
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
    ${row({ icon: 'user', cls: '', title: 'Caller ID name', sub: 'Harsh Rivera', act: 'toast', val: 'Caller ID name changes are not part of this demo' })}
    ${row({ icon: 'shield', cls: '', title: 'ScamShield Premium', sub: S.premium ? 'Active · $4.00/mo per line' : 'Not added', act: 'sheet', val: 'premium' })}
    ${row({ icon: 'voicemail', cls: '', title: 'Block spam categories', sub: 'Telemarketing, surveys, political and more', act: 'go', val: 'categories' })}
    ${row({ icon: 'info', cls: '', title: 'How ScamShield works', sub: 'Network data, call behavior and reports from 100M+ customers', act: 'toast', val: 'Learn more is not part of this demo' })}
    ${row({ icon: 'globe', cls: '', title: 'Backend', sub: `${esc(api.base)} · live data from TigerData`, chev: false })}
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
const doneCalls = new Set(); // calls the user dismissed with Done/Report; a resync must not bring them back
/** Replace the overlay state with the server's snapshot of the current call. Used when the stream (re)connects,
    when the page wakes up (Safari suspends the page while the phone is on a call) and as a polling safety net. */
function applySnapshot(snap) {
  if (!snap || doneCalls.has(snap.id)) return;
  if (snap.lineId !== curLine().lineId) return;
  const c = S.call;
  if (c && c.id === snap.id) {
    const changed = c.phase !== snap.phase || c.transcript.length !== snap.transcript.length || c.alerts.length !== snap.alerts.length;
    if (!changed) return;
    c.phase = snap.phase; c.transcript = snap.transcript; c.alerts = snap.alerts; c.endedBy = snap.endedBy; c.outcome = snap.outcome; c.label = snap.label || c.label;
    if (snap.summary) { c.summary = snap.summary; c.forwarded = true; c.risk = snap.risk; }
    if (snap.phase === 'connected') { c.t = snap.t; startTimer(); } else if (snap.phase === 'ended') clearInterval(callTimer);
  } else {
    if (c && c.phase !== 'ended' && c.id !== snap.id && snap.phase === 'ended') return; // keep a live call over an old ended one
    S.call = { id: snap.id, lineId: snap.lineId, scn: snap.scenario, num: snap.num, loc: snap.loc, label: snap.label, risk: snap.risk, callerId: snap.callerId, remote: snap.remote,
      transcript: snap.transcript, alerts: snap.alerts, dismissed: false, t: snap.t, phase: snap.phase, endedBy: snap.endedBy, outcome: snap.outcome, summary: snap.summary || undefined, forwarded: snap.forwarded };
    if (snap.phase === 'connected') startTimer(); else clearInterval(callTimer);
  }
  renderOverlay();
}
function syncCall() { return api.get(`/calls/current?lineId=${curLine().lineId}`).then(applySnapshot).catch(() => {}); }
function onCallEvent(ev) {
  if (ev.phase === 'blocked') { toast(`ScamShield blocked a ${ev.label} call from ${ev.num}`, 'block'); return; }
  if (ev.phase === 'ringing' || ev.phase === 'screening') {
    if (!S.call || S.call.id !== ev.id) S.call = { id: ev.id, lineId: ev.lineId, scn: ev.scenario, num: ev.num, loc: ev.loc, label: ev.label, risk: ev.risk, callerId: ev.callerId, transcript: [], alerts: [], dismissed: false, t: 0 };
    S.call.phase = ev.phase; S.call.label = ev.label || S.call.label; if (ev.loc) S.call.loc = ev.loc; if (ev.remote) S.call.remote = true;
    if (ev.summary) { S.call.summary = ev.summary; S.call.forwarded = true; if (ev.risk != null) S.call.risk = ev.risk; }
  }
  if (ev.remote && S.call) S.call.remote = true;
  if (!S.call || (ev.id && S.call.id !== ev.id)) { renderOverlay(); return; }
  if (ev.phase === 'transcript') S.call.transcript.push({ who: ev.who, text: ev.text });
  if (ev.phase === 'alert') S.call.alerts.push({ kind: ev.kind, title: ev.title, text: ev.text });
  if (ev.phase === 'connected') { S.call.phase = 'connected'; S.call.t = 0; startTimer(); }
  if (ev.phase === 'ended') { S.call.phase = 'ended'; S.call.endedBy = ev.endedBy; S.call.outcome = ev.outcome; clearInterval(callTimer); }
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
  else if (a === 'done') { doneCalls.add(c.id); S.call = null; clearInterval(callTimer); renderOverlay(); }
  else if (a === 'report') { doneCalls.add(c.id); const num = c.num; S.call = null; clearInterval(callTimer); renderOverlay(); openSheet('report', num); }
}
const fmtTime = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
/** Card shown while the subscriber's phone rings: what the caller told the screener and what ScamShield makes of it. */
function screeningCard(c) {
  const s = c.summary;
  const cls = s.recommendation === 'decline' ? 'red' : s.recommendation === 'caution' ? 'amber' : 'green';
  const rec = { answer: 'Looks okay to answer', caution: 'Answer with caution', decline: 'We recommend not answering' }[s.recommendation] || 'Use your judgment';
  const kv = [['Caller', s.caller_name], ['Company', s.organization], ['Reason', s.purpose], ['Callback number', s.callback_offered ? 'Offered' : 'None given']]
    .map(([k, v]) => `<div><span>${k}</span><b>${esc(v || 'Not given')}</b></div>`).join('');
  const flags = (s.red_flags || []).map(f => `<span class="chip">${esc(f)}</span>`).join('');
  return `<div class="alert screen"><div class="ah"><div class="i ${cls}">${ico('headset')}</div>Screening summary<span class="riskpill ${cls}">Risk ${s.risk}</span></div>
    <div class="kv">${kv}</div><p>${esc(s.summary)}</p>${flags ? `<div class="chips">${flags}</div>` : ''}
    <div class="rec ${cls}">${ico(s.recommendation === 'answer' ? 'checkCircle' : 'alert')} ${rec}</div>
    <div class="brand">${ico('shieldCheck')} ScamShield asked the caller ${c.transcript.filter(l => l.who === 'ScamShield' && /\?$/.test(l.text)).length || 3} questions</div></div>`;
}
function callHtml() {
  const c = S.call;
  const ctl = (cls, icon, label, act) => `<button class="ctl" data-act="callAct" data-val="${act}"><div class="c ${cls}">${ico(icon)}</div>${label}</button>`;
  const labelCls = /scam likely/i.test(c.label) ? '' : /spam/i.test(c.label) ? 'amber' : 'gray';
  const bubbles = c.transcript.map(l => `<div class="bubble ${l.who === 'ScamShield' || l.who === 'you' ? 'us' : 'them'}"><span class="by">${esc(l.who === 'ScamShield' ? 'ScamShield' : l.who === 'you' ? 'You' : 'Caller')}</span>${esc(l.text)}</div>`).join('');
  const alerts = c.alerts.map(a => a.kind === 'fraud'
    ? (c.dismissed ? '' : `<div class="alert danger"><div class="ah"><div class="i red">${ico('shieldAlert')}</div>${esc(a.title)}</div><p>${esc(a.text)} <b>Use extreme caution</b> or end the call now.</p><div class="btn-row"><button class="btn outline" data-act="callAct" data-val="dismiss">Dismiss warning</button><button class="btn danger" data-act="callAct" data-val="end">End call</button></div><div class="brand">${ico('shieldCheck')} ScamShield in-call protection</div></div>`)
    : `<div class="alert"><div class="ah"><div class="i amber">${ico('sparkles')}</div>${esc(a.title)}</div><p>${esc(a.text)}</p><div class="brand">${ico('shieldCheck')} ScamShield</div></div>`).join('');
  let body = '', controls = '', state = '';
  if (c.phase === 'ringing' && c.summary) {
    // screener finished its interview and is ringing the subscriber: show the summary while they decide
    state = c.remote ? 'Screened by ScamShield · ringing your phone' : 'Screened by ScamShield · incoming call';
    body = screeningCard(c);
    controls = c.remote
      ? `<div class="slide"><div class="knob">${ico('phone')}</div><span>slide to answer on your phone</span></div>`
      : ctl('red', 'phoneOff', 'Decline', 'decline') + ctl('green', 'phone', 'Accept', 'accept');
  }
  else if (c.phase === 'ringing' && c.remote) { state = 'Real call via Twilio · waiting for pickup'; controls = ctl('red', 'phoneOff', 'Cancel', 'end'); }
  else if (c.phase === 'ringing') { state = 'T-Mobile · incoming call'; controls = ctl('red', 'phoneOff', 'Decline', 'decline') + ctl('green', 'phone', 'Accept', 'accept'); body = bubbles ? `<div class="transcript">${bubbles}</div>` : ''; }
  if (c.phase === 'screening') { state = 'ScamShield is screening this call'; body = `<div class="transcript">${bubbles}</div>`; controls = ctl('red', 'phoneOff', 'Hang up', 'hangup') + ctl('green', 'phone', 'Take over', 'takeover'); }
  if (c.phase === 'connected') {
    state = `<span class="timer">${fmtTime(c.t)}</span>`;
    controls = ctl('gray', 'mic', 'Mute', 'noop') + ctl('red', 'phoneOff', 'End', 'end') + ctl('gray', 'voicemail', 'Speaker', 'noop');
    body = (bubbles ? `<div class="transcript">${bubbles}</div>` : '') + alerts;
  }
  if (c.phase === 'ended') {
    const byShield = c.endedBy === 'ScamShield';
    const msg = { fraud: 'This number was flagged as fraud and added to your activity. The verdict came from the live transcript.', screened: 'The caller would not identify themselves and was hung up on. Nothing rang on your phone.', scam: c.summary ? 'ScamShield interviewed this caller, judged it a likely scam and ended the call. Nothing rang on your phone.' : 'This Scam Likely call was logged. Turn on Scam Block to stop calls like this before they ring.', ai: 'A synthetic voice was detected on this call and it was logged.', forwarded: 'ScamShield interviewed this caller and connected them to you. The summary is saved in your activity.', missed: 'ScamShield interviewed this caller, but the call was not picked up. The summary is saved in your activity.' }[c.outcome] || 'Call logged in your ScamShield activity.';
    body = `<div class="summary"><div class="orb">${ico(byShield ? 'shieldCheck' : 'phoneOff')}</div><h3>${byShield ? 'Call ended by ScamShield' : 'Call ended'}</h3><p>${msg}</p>${c.summary ? `<p class="recap">${esc(c.summary.summary)}</p>` : ''}</div>`;
    controls = `<div style="width:100%;display:flex;flex-direction:column;gap:10px"><button class="btn primary" data-act="callAct" data-val="report">${ico('flag')} Report this number</button><button class="btn outline-light" data-act="callAct" data-val="done">Done</button></div>`;
  }
  // iPhone call-screen layout: caller label line, big number, location, then the ScamShield state line.
  const l1 = /unknown caller/i.test(c.label) ? (c.loc || 'Unknown') : c.label;
  const showMini = c.phase === 'ringing' || c.phase === 'screening';
  const mini = showMini ? `<div class="mini"><button class="m" data-act="callAct" data-val="noop">${ico('message')}<span>Message</span></button><button class="m" data-act="callAct" data-val="${c.phase === 'ringing' && c.remote ? 'end' : 'noop'}">${ico(c.phase === 'ringing' && c.remote ? 'phoneOff' : 'voicemail')}<span>${c.phase === 'ringing' && c.remote ? 'Decline' : 'Voicemail'}</span></button></div>` : '';
  return `<div class="call ${c.phase}"><button class="info" data-act="callAct" data-val="noop" aria-label="Info">i</button><div class="top"><div class="l1 ${labelCls}">${esc(l1)}</div><div class="who">${esc(c.num)}</div><div class="where">${c.loc && l1 !== c.loc ? esc(c.loc) : ''}${c.callerId ? (c.loc && l1 !== c.loc ? ' · ' : '') + 'T-Mobile Caller ID' : ''}</div><div class="state">${state}</div></div><div class="body">${body}</div><div class="controls">${mini}<div class="mainrow">${controls}</div></div></div>`;
}

/* ---------- Learn tab (Safe Signal practice) ---------- */
const INTERESTS = [['mobile_account', 'Mobile account'], ['package_delivery', 'Package delivery'], ['finance', 'Banking'], ['driving', 'Tolls & driving'], ['career', 'Job offers'], ['family', 'Family'], ['shopping', 'Shopping'], ['travel', 'Travel']];
const CAT_ICON = { package_delivery: 'tag', toll_fee: 'card', job_offer: 'clipboard', family_emergency: 'users', bank_alert: 'dollar', tmobile_account: 'sim' };
const FLAG_CLS = { urgency: 'amber', impersonation: 'red', secrecy: 'blue', unusual_payment_or_code: 'red', suspicious_link_or_sender: 'magenta', too_good_to_be_true: 'amber' };
const flagLabel = c => ({ urgency: 'Urgency', impersonation: 'Impersonation', secrecy: 'Secrecy', unusual_payment_or_code: 'Payment / code', suspicious_link_or_sender: 'Suspicious link', too_good_to_be_true: 'Too good to be true' })[c] || c;
const isOver = s => s && ['ended_caught', 'ended_fell', 'ended_timeout', 'opted_out'].includes(s.state);
async function loadLearn() { S.learn = await api.get(`/learn/${curLine().lineId}`); render(); }
async function openSession(id) { S.session = await api.get(`/learn/session/${id}`); if (current() !== 'learn-chat') go('learn-chat'); else render(); }
async function openLesson(id) { S.lessonSession = await api.get(`/learn/session/${id}`); if (current() !== 'lesson') go('lesson'); else render(); }
function learnScreen() {
  const L = S.learn; if (!L) loadLearn().catch(() => {});
  return `
  ${header('Learn', { icons: [['clipboard', 'sheet', 'stats'], ['settings', 'sheet', 'optin']] })}
  ${S.trap ? trapCard(S.trap) : ''}
  ${L?.active ? `<button class="card practice-live" data-act="session" data-val="${L.active.id}" style="width:100%"><div class="between"><div><div class="eyebrow">Practice text in progress</div><div class="big" style="font-size:18px">${esc(L.active.scenario?.brand && L.active.scenario.brand !== 'none' ? L.active.scenario.brand : 'Someone')} is texting you</div></div>${ico('chevR')}</div></button>` : ''}
  ${questMap()}`;
}
/* Stats sheet: the dashboard that used to be the Learn page */
function statsSheet() {
  const L = S.learn; if (!L) { loadLearn().catch(() => {}); return '<div class="title">Your stats</div><p class="desc">Loading…</p>'; }
  const st = L.stats;
  const sessionRow = s => row({ icon: CAT_ICON[s.scenario?.category] || 'message', cls: s.outcome === 'caught' ? 'green' : s.outcome ? 'red' : 'amber', title: esc(s.scenario?.brand && s.scenario.brand !== 'none' ? s.scenario.brand : (s.scenario?.categoryLabel || s.scenarioId)), sub: `${s.outcome === 'caught' ? 'You caught it' : s.outcome === 'fell_for_it' ? 'You fell for it' : s.outcome === 'opted_out' ? 'Opted out' : 'In progress'}${s.channel === 'imessage' ? ' · iMessage' : ''}`, meta: ago(Math.round((Date.now() - new Date(s.startedAt)) / 60000)), act: isOver(s) ? 'lesson' : 'session', val: s.id });
  return `<div class="title">Your stats</div><div class="sub">${st.total} practice session${st.total === 1 ? '' : 's'} · ${st.caught} caught · ${totalStars()} stars on the map</div>
    ${petDashboard()}
    ${L.skills.length ? `<h2 class="section">Your scam radar</h2><div class="card">${L.skills.sort((a, b) => a.score - b.score).map(k => `<div class="skill"><div class="row-top"><span>${esc(k.label)}</span><span class="muted">${k.caught}/${k.encountered} caught</span></div><div class="bar"><div class="fill ${k.score >= .67 ? 'good' : k.score >= .34 ? 'mid' : 'low'}" style="width:${Math.max(6, Math.round(k.score * 100))}%"></div></div></div>`).join('')}</div>` : ''}
    <h2 class="section">Recent practice texts</h2>
    <div class="card flush">${L.sessions.length ? L.sessions.slice(0, 6).map(sessionRow).join('') : emptyHtml('No practice texts yet', 'message')}</div>
    ${petLog()}
    `;
}
function learnChatScreen() {
  const s = S.session;
  if (!s) return `${header('Practice', { back: true })}<div class="card"><p class="desc">Loading…</p></div>`;
  const over = isOver(s);
  const msgs = s.messages.map(m => m.role === 'system' ? `<div class="sysnote">${esc(m.text)}</div>` : `<div class="msg ${m.role === 'user' ? 'me' : 'them'}"><div class="by">${m.role === 'user' ? 'You' : esc(s.scenario?.brand || 'Unknown')}</div>${linkify(m.text, s)}</div>`).join('');
  return `
  ${header(esc(s.scenario?.brand || 'Practice'), { back: true, icons: over ? [['flag', 'lesson', s.id]] : [] })}
  <div class="banner">${ico('info')}<div><b>Sandbox.</b> This is a Safe Signal practice text${s.channel === 'imessage' ? ', mirrored from your iMessage thread' : ''}. Reply like you would to a real text.</div></div>
  <div class="chat">${msgs}</div>
  ${over ? `<div class="card ${s.outcome === 'caught' ? 'tint' : ''}"><div class="big" style="font-size:18px">${s.outcome === 'caught' ? 'You caught it' : s.outcome === 'fell_for_it' ? 'This was a practice scam' : 'Session ended'}</div><p class="desc">${s.outcome === 'caught' ? 'You called it out before sharing anything.' : 'Nothing was shared with anyone. See what gave it away.'}</p><div class="btn-row"><button class="btn primary" data-act="lesson" data-val="${s.id}">See your lesson</button></div></div>`
        : `<div class="quick"><button class="chip" data-act="quick" data-val="This is a scam, I'm blocking you">This is a scam</button><button class="chip" data-act="quick" data-val="Ok, how do I fix it?">Ok, how?</button><button class="chip" data-act="quick" data-val="Who is this?">Who is this?</button><button class="chip" data-act="tapLink" data-val="${s.id}">${ico('globe')} Tap the link</button></div>
           <div class="field">${ico('message')}<input placeholder="Reply as you normally would" data-bind="learnInput" data-enter="sendReply" value="${esc(S.learnInput || '')}"><button class="btn primary" data-act="sendReply">Send</button></div>`}`;
}
function linkify(text, s) { return esc(text).replace(/https?:\/\/\S+/g, u => `<button class="inline-link" data-act="tapLink" data-val="${s.id}">${u.length > 38 ? u.slice(0, 36) + '…' : u}</button>`); }
function lessonScreen() {
  const s = S.lessonSession, L = s && s.lesson;
  if (!L) return `${header('Your lesson', { back: true })}<div class="card"><p class="desc">${s ? 'The lesson is still being written…' : 'Loading…'}</p></div>`;
  const caught = L.outcome === 'caught';
  const replay = L.replay.map(m => `<div class="msg ${m.role === 'user' ? 'me' : 'them'}"><div class="by">${m.role === 'user' ? 'You' : esc(L.scenario?.brand || 'Scammer')}</div>${esc(m.text)}${m.role === 'scammer' && m.redFlags.length ? `<div class="flags">${[...new Map(m.redFlags.map(f => [f.category, f])).values()].map(f => `<span class="badge ${FLAG_CLS[f.category] || ''}" title="${esc(f.explanation)}">${flagLabel(f.category)}</span>`).join('')}</div><div class="why">${[...new Map(m.redFlags.map(f => [f.category, f])).values()].map(f => `<div>• ${esc(f.explanation)}</div>`).join('')}</div>` : ''}</div>`).join('');
  return `
  ${header('Your lesson', { back: true })}
  <div class="card ${caught ? 'tint' : 'dark'}"><div class="eyebrow">${esc(L.scenario?.categoryLabel || '')} · ${esc(L.scenario?.brand || '')}</div><div class="big">${caught ? 'Great job, you caught it' : 'You fell for this one'}</div><p class="desc">${caught ? 'You spotted the red flags and refused to play along.' : 'It happens to everyone. Here is what to watch for next time.'}</p></div>
  <h2 class="section">Replay with red flags</h2>
  <div class="chat replay">${replay}</div>
  <h2 class="section">${L.mistakes.length ? 'Your key mistakes' : 'No major mistakes'}</h2>
  ${L.mistakes.length ? `<div class="card">${L.mistakes.map(m => `<div class="feat">${ico('alert')}<span>${esc(m)}</span></div>`).join('')}</div>` : ''}
  <h2 class="section">What you did well</h2>
  <div class="card">${L.strengths.map(m => `<div class="feat">${ico('checkCircle')}<span>${esc(m)}</span></div>`).join('')}</div>
  <div class="card magenta"><div class="eyebrow">Rule to remember</div><div class="big" style="font-size:19px">${esc(L.ruleToRemember)}</div></div>
  <h2 class="section">Protect yourself now</h2>
  <div class="card flush">
    ${row({ icon: 'shieldCheck', cls: '', title: 'Turn on Scam Block', sub: S.toggles.scamBlock ? 'Already on for this line' : 'Stop Scam Likely calls before they ring', act: 'lessonGo', val: 'scamshield' })}
    ${row({ icon: 'voicemail', cls: '', title: 'Block spam categories', sub: 'Send telemarketing and surveys to voicemail', act: 'lessonGo', val: 'categories' })}
    ${row({ icon: 'flag', cls: '', title: 'Report a real scam text', sub: 'Forward it to 7726 or text it to ScamShield', act: 'sheet', val: 'report' })}
    ${row({ icon: 'message', cls: '', title: 'Practice again', sub: `Next focus: ${esc(L.nextWeakLabel || 'urgency')}`, act: 'practice', val: 'simulator' })}
  </div>`;
}
function optinSheet() {
  const o = S.optin;
  return `<div class="title">Scam practice preferences</div><div class="sub">Safe Signal sends realistic practice scams. Replies are redacted before storage and nothing is ever shared.</div>
    <div class="rows-title" style="padding-left:0">Where to practice</div>
    <button class="radio ${o.channel === 'simulator' ? 'on' : ''}" data-act="optChannel" data-val="simulator"><span class="r"></span>In the app (sandbox chat)</button>
    <button class="radio ${o.channel === 'imessage' ? 'on' : ''}" data-act="optChannel" data-val="imessage"><span class="r"></span>On my phone over iMessage <span class="badge magenta" style="margin-left:6px">Photon</span></button>
    <div class="rows-title" style="padding-left:0;margin-top:8px">Interests</div>
    <div class="chips" style="margin:0 0 8px;flex-wrap:wrap">${INTERESTS.map(([id, l]) => `<button class="chip ${o.interests.includes(id) ? 'on' : ''}" data-act="optInterest" data-val="${id}">${l}</button>`).join('')}</div>
    <p class="note">You can opt out any time here or by texting STOP PRACTICE. Max 5 practice texts per day; none during quiet hours.</p>
    <div class="btn-row"><button class="btn primary" data-act="optinSave">${S.learn?.consent?.active ? 'Save preferences' : 'Enable practice'}</button></div>
    ${S.learn?.consent?.active ? `<button class="btn ghost" data-act="optout">Turn practice off</button>` : ''}`;
}
function detectSheet() {
  const r = S.detectRes;
  return `<div class="title">Check a text</div><div class="sub">Paste a message you received. Rules plus Gemini score it in a second.</div>
    <textarea class="area" placeholder="Paste the text here" data-bind="detectText">${esc(S.detectText || '')}</textarea>
    <div class="btn-row"><button class="btn primary" data-act="detect">Check it</button></div>
    ${r ? `<div class="card" style="margin-top:14px"><span class="badge ${r.label === 'scam' ? 'red' : r.label === 'suspicious' ? 'amber' : 'green'}">${r.label.replace('_', ' ')}</span> <span class="muted" style="font-size:13px">confidence ${Math.round(r.confidence * 100)}%</span>
      ${r.reasons.slice(0, 4).map(x => `<div class="feat">${ico('alert')}<span>${esc(x)}</span></div>`).join('')}<p class="note">${r.label === 'likely_safe' ? 'Nothing stood out, but verify through the official app if it asks you to act.' : 'Do not tap links or reply. Forward it to 7726 to report it to T-Mobile.'}</p></div>` : ''}`;
}

/* ---------- render ---------- */
const TABS = [['home', 'Home', 'home'], ['learn', 'Learn', 'paw'], ['benefits', 'Benefits', 'gift'], ['services', 'Services', 'grid'], ['account', 'Account', 'user']];
const SCREENS = { home: homeScreen, pet: learnScreen, shop: shopScreen, learn: learnScreen, 'learn-chat': learnChatScreen, lesson: lessonScreen, benefits: benefitsScreen, services: servicesScreen, account: accountScreen, scamshield: scamshieldScreen, activity: activityScreen, lookup: lookupScreen, blocklist: () => listScreen('blocklist'), allowlist: () => listScreen('allowlist'), categories: categoriesScreen, 'ss-settings': settingsScreen, family: familyScreen };
function render(resetScroll) {
  const content = document.getElementById('content'), tabbar = document.getElementById('tabbar');
  if (!S.ready) {
    content.innerHTML = S.error
      ? `<div class="header"><div class="h1">ScamShield</div></div><div class="card"><div class="big" style="font-size:18px">Cannot reach the backend</div><p class="desc">${esc(S.error)}</p><p class="desc">Start it with <code>npm --prefix server start</code> and open <code>http://localhost:8787</code>.</p><div class="btn-row"><button class="btn primary" data-act="retry">Retry</button></div></div>`
      : `<div class="header"><div class="h1 brand">Hey, Harsh</div></div><div class="card"><p class="desc">Loading your lines from TigerData…</p></div>`;
    tabbar.classList.add('hidden'); return;
  }
  const scr = current(); const top = content.scrollTop; const active = document.activeElement; const bind = active && active.dataset ? active.dataset.bind : null; const pos = active && active.selectionStart;
  content.innerHTML = (SCREENS[scr] || homeScreen)();
  content.classList.toggle('no-tabs', S.stack.length > 0);
  content.classList.toggle('hero', scr === 'benefits' || scr === 'home');
  tabbar.classList.toggle('hidden', S.stack.length > 0);
  tabbar.innerHTML = TABS.map(([id, label, icon]) => `<button class="tab ${S.tab === id ? 'on' : ''}" data-act="tab" data-val="${id}">${ico(icon)}<span>${label}</span></button>`).join('');
  content.scrollTop = resetScroll ? 0 : top;
  if (bind) { const el = content.querySelector(`[data-bind="${bind}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
  renderOverlay();
}
const last = { sheet: '', call: null, toast: '', quiz: '', game: '' };
function callKey() { const c = S.call; return [c.scn, c.phase, c.endedBy, c.callerId, c.label, c.remote, !!c.summary].join('|') + '#' + [c.dismissed, c.transcript.length, c.alerts.length, S.premium].join('|'); }
function updateCall(callEl, k) {
  const html = callHtml();
  const sameShell = last.call && last.call.split('#')[0] === k.split('#')[0] && callEl.querySelector('.body');
  if (sameShell) { const tpl = document.createElement('div'); tpl.innerHTML = html; callEl.querySelector('.body').innerHTML = tpl.querySelector('.body').innerHTML; }
  else callEl.innerHTML = html;
  last.call = k;
}
function renderOverlay() {
  const ov = document.getElementById('overlay');
  if (!ov.querySelector('#sheetov')) ov.innerHTML = '<div id="sheetov"></div><div id="gameov"></div><div id="callov"></div><div id="quizov"></div><div id="toastov"></div>';
  const [sheetEl, callEl, toastEl, quizEl] = ['#sheetov', '#callov', '#toastov', '#quizov'].map(s => ov.querySelector(s));
  const gh = S.call ? '' : arenaHtml();
  if (gh !== last.game) { ov.querySelector('#gameov').innerHTML = gh; last.game = gh; }
  const qh = S.call ? '' : quizHtml();
  if (qh !== last.quiz) { quizEl.innerHTML = qh; last.quiz = qh; }
  let sh = '';
  if (S.sheet) {
    const { name, data } = S.sheet; let inner = '';
    if (name === 'detail') { const a = findAct(data); inner = a ? detailSheet(a) : ''; }
    if (name === 'report') inner = reportSheet(data);
    if (name === 'premium') inner = premiumSheet();
    if (name === 'optin') inner = optinSheet();
    if (name === 'detect') inner = detectSheet();
    if (name === 'stats') inner = statsSheet();
    sh = `<div class="backdrop" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>${inner}</div></div>`;
  }
  if (sh !== last.sheet) {
    const a = document.activeElement, b = a && a.dataset ? a.dataset.bind : null, p = a && a.selectionStart;
    sheetEl.innerHTML = sh; last.sheet = sh;
    if (b) { const f = sheetEl.querySelector(`[data-bind="${b}"]`); if (f) { f.focus(); try { f.setSelectionRange(p, p); } catch (err) {} } }
  }
  if (!S.call) { if (last.call !== null) { callEl.innerHTML = ''; last.call = null; } }
  else { const k = callKey(); if (k !== last.call) updateCall(callEl, k); else { const t = callEl.querySelector('.timer'); if (t) t.textContent = fmtTime(S.call.t); } }
  const th = S.toast ? `<div class="toast ${S.toast.kind || ''}">${ico(S.toast.kind === 'block' ? 'shieldCheck' : 'checkCircle')}<span>${esc(S.toast.msg)}</span></div>` : '';
  if (th !== last.toast) { toastEl.innerHTML = th; last.toast = th; }
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
    toast: () => toast(v), noop: () => {},
    /* Learn tab */
    pickCat: () => { S.pickCategory = S.pickCategory === v ? null : v; render(); },
    practice: () => {
      if (!S.learn?.consent?.active) return openSheet('optin');
      const cat = S.pickCategory; const body = { channel: v || 'simulator' };
      api.get('/learn/scenarios').then(all => { if (cat) { const pool = all.filter(x => x.category === cat); body.scenarioId = pool[Math.floor(Math.random() * pool.length)]?.id; } return api.post(`/learn/${L.lineId}/practice`, body); })
        .then(s => { closeSheet(); if (s.channel === 'imessage') toast(s.sent?.delivered ? 'Practice text sent to your phone' : `Could not text your phone: ${s.sent?.reason || 'unknown'}`); S.session = s; go('learn-chat'); loadLearn().catch(() => {}); })
        .catch(e => { if (/in progress/.test(e.message)) { toast('Finish the current practice first'); } else fail(e); });
    },
    session: () => openSession(v).catch(fail),
    lesson: () => openLesson(v).catch(fail),
    lessonGo: () => { S.stack = []; S.tab = 'home'; go(v); },
    quick: () => { S.learnInput = v; document.querySelector('[data-act="sendReply"]')?.click(); },
    sendReply: () => { const t = (S.learnInput || '').trim(); if (!t || !S.session) return; S.learnInput = ''; S.session.messages.push({ id: 'tmp', role: 'user', text: t, redFlags: [] }); render(); api.post(`/learn/session/${S.session.id}/reply`, { text: t }).then(s => { S.session = s; render(); if (isOver(s)) loadLearn().catch(() => {}); }).catch(fail); },
    tapLink: () => api.post(`/learn/session/${v}/click`).then(s => { S.session = s; loadLearn().catch(() => {}); startTrap(s.id); }).catch(fail),
    optChannel: () => { S.optin.channel = v; renderOverlay(); },
    optInterest: () => { const i = S.optin.interests; S.optin.interests = i.includes(v) ? i.filter(x => x !== v) : [...i, v]; renderOverlay(); },
    optinSave: () => api.post(`/learn/${L.lineId}/optin`, { channel: S.optin.channel, interests: S.optin.interests, maxPerDay: 5 }).then(o => { S.learn = o; closeSheet(); toast(S.optin.channel === 'imessage' ? 'Practice on. Text the ScamShield number once if you have not yet.' : 'Scam practice is on'); render(); }).catch(fail),
    optout: () => api.del(`/learn/${L.lineId}/optin`).then(() => { closeSheet(); toast('Practice turned off'); return loadLearn(); }).catch(fail),
    detect: () => { const t = (S.detectText || '').trim(); if (!t) return toast('Paste a message first'); api.post('/learn/detect', { text: t, senderKnown: false }).then(r => { S.detectRes = r; renderOverlay(); }).catch(fail); },
    reset: () => { localStorage.removeItem(KEY); location.reload(); },
    ...BUDDY_ACTIONS(v, el),
    ...GAME_ACTIONS(v, el),
  };
  (A[act] || (() => {}))();
});
document.addEventListener('input', e => { const b = e.target.dataset && e.target.dataset.bind; if (!b) return; S[b] = e.target.value; if (b === 'lookupQ' && current() === 'activity') render(); });
document.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const a = e.target.dataset && e.target.dataset.enter; if (a) { e.preventDefault(); const btn = document.querySelector(`[data-act="${a}"]`); if (btn) btn.click(); } });

/* ---------- boot ---------- */
let es = null;
async function boot() {
  S.error = null; render();
  try { await loadAll(); } catch (e) { S.error = e.message; render(); return; }
  render(true);
  if (!es) es = api.events({
    open: syncCall,
    call: onCallEvent,
    pet: onPetEvent,
    activity: a => { if (a.line !== curLine().lineId) return; S.activity = [a, ...S.activity.filter(x => x.id !== a.id && !(x.e164 === a.e164 && x.type === a.type))]; refreshStats().catch(() => render()); },
    line: l => { const L = LINES.find(x => x.lineId === l.id); if (L) { L.toggles = l.toggles; if (L === curLine()) { S.toggles = l.toggles; render(); } } },
    lists: () => refreshLists().catch(() => {}),
    learn: ev => {
      if (S.session && ev.sessionId === S.session.id) {
        if (ev.message && !S.session.messages.some(m => m.id === ev.message.id)) { S.session.messages = S.session.messages.filter(m => m.id !== 'tmp'); S.session.messages.push(ev.message); }
        if (ev.state) api.get(`/learn/session/${S.session.id}`).then(s => { S.session = s; render(); }).catch(() => {});
        render();
      }
      if (ev.state && current() === 'learn') loadLearn().catch(() => {});
    },
  });
  // Resync the call overlay whenever the page wakes up, and poll as a safety net while visible
  // (iOS Safari suspends the page and drops the stream while the phone is on a call).
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncCall(); });
  window.addEventListener('pageshow', () => syncCall());
  setInterval(() => { if (document.visibilityState === 'visible') syncCall(); }, 3000);
  // Deep link from a practice text: /?lesson=<sessionId>
  // Trap link from a practice text (/p/:token redirects here): land on Buddy taking the hit.
  const trapId = new URLSearchParams(location.search).get('trap');
  if (trapId) { history.replaceState(null, '', location.pathname); startTrap(trapId); return; }
  const want = new URLSearchParams(location.search).get('lesson');
  if (want) { history.replaceState(null, '', location.pathname); S.tab = 'learn'; S.stack = []; render(true); openLesson(want).catch(fail); }
}
boot();

/* ScamShield Quest: the Learn tab as a game. Buddy travels a map of stops; each stop is a short, playable
   minigame built around one scam situation. Stars unlock the next stop, wins and losses change Buddy's energy
   on the server (pet_events), progress is saved per line (game_progress).
   Loaded before app.js; uses app.js globals (S, api, ico, esc, row, toast, render, renderOverlay, …). */

/* ---------- the map ---------- */
const QUEST = [
  { id: 'texttrap', title: 'Text Trap', kind: 'sorter', icon: 'message', x: 47, y: 92, s: 1.04, color: '#E20074', blurb: 'Texts fly in. Call each one Legit or Scam before the timer runs out.', teaches: 'Delivery, toll and account texts' },
  { id: 'linklens', title: 'Link Lens', kind: 'links', icon: 'globe', x: 19, y: 81, s: 0.9, color: '#7A3BFF', blurb: 'Three links, one is real. Read what comes right before the first slash.', teaches: 'Look-alike domains' },
  { id: 'hangup', title: 'Hang Up', kind: 'call', icon: 'phoneOff', x: 78, y: 80, s: 0.86, color: '#D7263D', blurb: 'A caller talks. Hit Hang up the moment you hear the red flag, before they ask for anything.', teaches: 'Phone scams and pressure' },
  { id: 'situations', title: 'Situation Room', kind: 'pick', icon: 'clipboard', x: 81, y: 61, s: 0.96, color: '#2B6BE4', blurb: 'Seven everyday moments. Pick the move that keeps you safe.', teaches: 'QR codes, pop-ups, deposits, donations' },
  { id: 'codekeeper', title: 'Code Keeper', kind: 'chat', icon: 'lock', x: 50, y: 58, s: 0.92, color: '#1E9E5A', blurb: 'Your "bank" is texting. Pick the reply that keeps your code yours.', teaches: 'One-time codes and PINs' },
  { id: 'jobhunt', title: 'Dream Job', kind: 'chat', icon: 'star', x: 17, y: 50, s: 1.02, color: '#0FA3B1', blurb: 'A recruiter texts the perfect offer. See how far you get without paying to work.', teaches: 'Fake checks and advance fees' },
  { id: 'familysos', title: 'Family SOS', kind: 'chat', icon: 'users', x: 45, y: 38, s: 0.88, color: '#E09A00', blurb: 'An emergency text from "family". Choose what to do, step by step.', teaches: 'Family emergency scams' },
  { id: 'deepfake', title: 'Voice Clone', kind: 'call', calls: 'clone', icon: 'mic', x: 81, y: 38, s: 0.96, color: '#8E44AD', blurb: 'Voices that sound exactly like people you know. Hang up on the pressure, not the person.', teaches: 'AI voice clones and CEO fraud' },
  { id: 'romance', title: 'Too Good', kind: 'chat', icon: 'heart', x: 61, y: 23, s: 0.9, color: '#E0527A', blurb: 'A new connection wants to help you invest. Keep your heart and your wallet apart.', teaches: 'Romance and crypto investment scams' },
  { id: 'storm', title: 'Scam Storm', kind: 'storm', icon: 'alert', x: 27, y: 12, s: 1.1, color: '#1A1A1A', boss: true, blurb: 'Boss round. Everything at once, faster. Eight of ten to clear it.', teaches: 'All of the above, under pressure' },
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

SMS_POOL.push(
  { from: 'Venmo', text: 'You received $250 from a buyer. To release the funds, upgrade to a business account for $25: venmo-upgrade.co', scam: true, why: 'Venmo never asks you to pay to receive money.' },
  { from: 'Delta', text: 'Flight DL1204 is on time. Gate B12, boarding 2:40pm.', scam: false, why: 'Information only, specific to your trip, no link and no ask.' },
  { from: '+1 (877) 555-0188', text: 'Your Netflix is suspended. Update payment within 24h: netflix-billing.com', scam: true, why: 'Look-alike domain plus a deadline.' },
  { from: 'Mom', text: 'Call me when you get a sec, nothing urgent.', scam: false, why: 'A known contact, and explicitly not urgent.' },
  { from: 'FedEx', text: 'Customs fee $1.99 due for package 7731. Pay now to avoid return: fedex-customs.pay', scam: true, why: 'Carriers do not collect tiny fees by text link, and the domain is not fedex.com.' },
  { from: 'Costco', text: 'Congrats! You were chosen for a $500 loyalty reward. Claim within 1 hour: costco-rewards.win', scam: true, why: 'A prize you never entered, with a countdown, is bait.' },
);
const SITUATIONS = [
  { q: 'A sticker QR code on a parking meter looks newer than the sign around it.', options: ['Scan it, QR codes are safe', 'Use the city parking app or the meter keypad', 'Scan it and check for a padlock icon'], answer: 1, why: 'Fake QR stickers send you to clone payment pages. A padlock only means the fake site has HTTPS.' },
  { q: 'A pop-up says your computer is infected and shows a Microsoft support number to call.', options: ['Call the number', 'Close the browser; real warnings never include a phone number', 'Install the cleaner it suggests'], answer: 1, why: 'Microsoft does not put phone numbers in warnings. The call leads to remote access and a fee.' },
  { q: 'An email says your Netflix payment failed. The sender is billing@netflix-account.co.', options: ['Tap Update payment', 'Open Netflix yourself from the app or a typed address', 'Reply asking which card failed'], answer: 1, why: 'netflix-account.co is not netflix.com. Go in through the front door you already know.' },
  { q: 'A landlord on a listing site wants a deposit by Zelle before you can view the apartment.', options: ['Send a smaller deposit to hold it', 'Never pay before seeing the place and the owner in person', 'Ask for a receipt first'], answer: 1, why: 'Deposit-before-viewing is the rental scam. Receipts from scammers are free to type.' },
  { q: 'After a hurricane, a text asks for donations to a relief fund, payable in gift cards.', options: ['Buy the cards, people need help', 'Give through a known charity site you typed yourself', 'Send half now and half later'], answer: 1, why: 'No charity takes gift cards. Disasters bring out fake funds within hours.' },
  { q: 'Someone you met on a dating app wants you to try their crypto platform with guaranteed returns.', options: ['Start with $100 to test it', 'Decline; romance plus investing is a known scam', 'Ask for screenshots of their gains'], answer: 1, why: 'The platform is fake and the screenshots are too. This is called pig butchering.' },
  { q: 'A voicemail says your Social Security number was suspended for criminal activity.', options: ['Call back right away', 'Delete it; numbers cannot be suspended and agencies write by mail', 'Pay the small reactivation fee'], answer: 1, why: 'There is no such thing as a suspended SSN. Fear plus a callback number is the tell.' },
  { q: 'Airport Wi-Fi named "Airport_Free_WiFi_2" asks you to log in with your email password.', options: ['Log in, it is the airport', 'Use cellular or the network named on official signage, and never a password', 'Log in but change the password later'], answer: 1, why: 'Rogue hotspots harvest passwords. Real captive portals never ask for your email password.' },
  { q: 'A Marketplace buyer overpays with a check and asks you to refund the difference.', options: ['Refund the difference by Zelle', 'Do not refund; the check will bounce. Cancel the sale', 'Refund after the check shows as cleared'], answer: 1, why: 'Banks show checks as available days before they bounce. Overpayment is always the scam.' },
  { q: 'Your "boss" emails from a new address asking you to buy $500 in gift cards for clients today.', options: ['Buy them, the boss asked', 'Call your boss on a number you already have', 'Reply asking which brand of card'], answer: 1, why: 'New address, secrecy and gift cards is business email compromise. One phone call ends it.' },
];
const CALLS_CLONE = [
  { caller: 'Caller ID: "Dad"', lines: [
    { who: 'caller', text: "Hey sweetheart, it's Dad. I'm okay, but I was in an accident." },
    { who: 'caller', text: "Please don't tell your mother. I need you to wire $3,000 to the lawyer right now.", flag: true },
    { who: 'caller', text: 'He says the court only takes Bitcoin ATM payments today. Can you go now?', ask: true },
    { who: 'you', text: "Okay, where's the nearest ATM…", lose: true } ] },
  { caller: 'Caller ID: "Dana (CEO)"', lines: [
    { who: 'caller', text: "This is Dana. I'm in a board meeting and can't talk long." },
    { who: 'caller', text: 'I need you to handle something confidential and fast. Keep it between us.', flag: true },
    { who: 'caller', text: 'Buy five $200 gift cards and text me the codes in the next 30 minutes.', ask: true },
    { who: 'you', text: 'On it, heading to the store…', lose: true } ] },
  { caller: 'Unknown · sounds like your sister', lines: [
    { who: 'caller', text: "Hey it's me, I'm on a stranger's phone. I got mugged downtown." },
    { who: 'caller', text: "I'm scared, please just send money to this Cash App, I'll explain later.", flag: true },
    { who: 'caller', text: "They're saying I have to pay the cab $400 right now or they call the police.", ask: true },
    { who: 'you', text: 'Sending now…', lose: true } ] },
];
CHATS.jobhunt = { them: 'Talent team', steps: [
  { them: 'Hi! Your resume stood out. Remote data entry, $34/hr, start Monday. Interested?', choices: [{ t: 'Interested, tell me more', good: true, why: 'Asking costs nothing. Watch what comes next.' }, { t: 'Send me the onboarding link', good: false, why: 'You asked for the link before learning who they are.' }, { t: 'Which company, and who referred me?', good: true, why: 'Specific questions expose vague recruiters.' }] },
  { them: 'Great, no interview needed. HR will mail a check for your laptop. Deposit it and send $450 to our vendor for setup.', choices: [{ t: 'Deposit the check and pay the vendor', good: false, end: 'loss', why: 'The check bounces days later and the $450 is gone. Fake-check jobs are the whole scam.' }, { t: 'Say you only use company-issued equipment', good: true, why: 'Real employers ship equipment. They never route money through you.' }, { t: 'Look up the company careers page yourself', good: true, why: 'If the role is not there, it does not exist.' }] },
  { them: 'The offer expires tonight. Just confirm your bank details so payroll can set you up.', choices: [{ t: 'Send bank details', good: false, end: 'loss', why: 'Bank details plus urgency equals a drained account.' }, { t: 'Decline and report the recruiter', good: true, why: 'Deadlines on job offers by text are pressure, not process.' }, { t: 'Ask for a video interview first', good: true, why: 'Scammers avoid live verification.' }] },
] };
CHATS.romance = { them: 'Alex', steps: [
  { them: "Good morning! I've loved our talks this week. Can I show you how I make side income with crypto? It changed my life.", choices: [{ t: 'Sure, show me', good: false, why: 'Curiosity is fine, but this is the pivot from romance to money.' }, { t: 'I keep money and dating separate', good: true, why: 'A clean boundary. Real connections survive it.' }, { t: 'How long have you been doing it?', good: true, why: 'Questions slow the script down.' }] },
  { them: 'My uncle works at an exchange. Start with $200 on this platform and watch it grow by Friday. I will guide you.', choices: [{ t: 'Deposit $200 to try', good: false, end: 'loss', why: 'The platform is fake. The gains on screen are numbers the scammer types, and withdrawals never come.' }, { t: 'Say no and suggest a video call instead', good: true, why: 'Investment pressure plus avoiding video is the pig-butchering pattern.' }, { t: 'Search the platform name with the word scam', good: true, why: 'Two minutes of searching beats months of regret.' }] },
  { them: 'I thought you trusted me. If you cared you would at least try. Please, for us.', choices: [{ t: 'Fine, $200', good: false, end: 'loss', why: 'Guilt is the lever. Love does not require a deposit.' }, { t: 'End the conversation and block', good: true, why: 'Emotional pressure about money is the end of the line.' }, { t: 'Tell a friend what is happening', good: true, why: 'A second opinion breaks the isolation scammers rely on.' }] },
] };

/* ---------- state ---------- */
function gameState() { if (!S.game) S.game = { progress: null, current: null, run: null, loading: false }; return S.game; }
async function loadGame() {
  const g = gameState(); if (g.loading) return; g.loading = true; g.loadedAt = Date.now();
  try { const r = await api.get(`/game/${curLine().lineId}`); g.progress = r.progress || {}; g.week = r.week || null; if (r.pet) S.pet = r.pet; if (!g.current) g.current = defaultNode(); }
  catch (e) { g.progress = g.progress || {}; }
  g.loading = false; render();
}
const nodeIndex = id => QUEST.findIndex(n => n.id === id);
function unlocked(i) { const g = gameState(); return i === 0 || (g.progress?.[QUEST[i - 1].id]?.stars || 0) >= 1; }
function defaultNode() { const g = gameState(); for (let i = 0; i < QUEST.length; i++) if (unlocked(i) && !(g.progress?.[QUEST[i].id]?.stars)) return QUEST[i].id; return QUEST[QUEST.length - 1].id; }
const totalStars = () => QUEST.reduce((a, n) => a + (gameState().progress?.[n.id]?.stars || 0), 0);

/* ---------- cloud map ----------
   Checkpoints are clouds joined by a dotted path. Tap a cloud and Buddy glides over to it; the stop's card opens
   when Buddy lands. Position is remembered per line. */
const posKey = () => `buddyPos:${curLine().lineId}`;
function petPos() {
  const g = gameState();
  if (!g.pos) { try { g.pos = JSON.parse(localStorage.getItem(posKey())) || null; } catch {} if (!g.pos) { const n = QUEST[0]; g.pos = { x: n.x, y: n.y, at: n.id }; } }
  { const at = QUEST.find(q => q.id === g.pos.at); if (at) { g.pos.x = at.x; g.pos.y = at.y; } } // layouts change; the checkpoint is the truth
  if (!g.pos.at) { const n = QUEST.find(q => Math.abs(q.x - g.pos.x) < 6 && Math.abs(q.y - g.pos.y) < 6) || QUEST[0]; g.pos = { x: n.x, y: n.y, at: n.id }; }
  // a remembered spot that is locked now (layout changed, new line) goes back to the next open stop
  if (g.progress && !unlocked(nodeIndex(g.pos.at))) { const n = QUEST[nodeIndex(defaultNode())]; g.pos = { x: n.x, y: n.y, at: n.id }; try { localStorage.setItem(posKey(), JSON.stringify(g.pos)); } catch {} }
  return g.pos;
}
function nearNode() { const p = petPos(); return QUEST.find(n => n.id === p.at) || null; }
const cloudPath = () => {
  const p = QUEST.map(n => [n.x, n.y]), bend = [9, -6, 12, -10, 7, -12, 5, 11, -8];
  let d = `M ${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i], b = bend[(i - 1) % bend.length], dx = x1 - x0, dy = y1 - y0;
    d += ` C ${x0 + dx * .3 + b} ${y0 + dy * .15} ${x0 + dx * .7 - b * .6} ${y0 + dy * .85} ${x1} ${y1}`;
  }
  return d;
};
/** Avatar anchor kept inside the map: Buddy stands above its cloud, so it needs headroom at the top and margin at the sides. */
const avLeft = x => `clamp(56px, ${x}%, calc(100% - 56px))`;
const avTop = y => `clamp(calc(96px * var(--k, 1)), ${y}%, 100%)`;
const walkTimers = {};
function walkTo(id) {
  const g = gameState(); if (g.run) return;
  const n = QUEST[nodeIndex(id)]; if (!n) return;
  const p = petPos(); if (p.at === id) { g.current = id; return arrive(id); }
  const dx = Math.sign(n.x - p.x), dist = Math.hypot(n.x - p.x, (n.y - p.y) * 1.4), ms = Math.max(600, Math.min(1500, dist * 22));
  p.x = n.x; p.y = n.y; p.at = id;
  try { localStorage.setItem(posKey(), JSON.stringify(p)); } catch {}
  if (window.Buddy3D) window.Buddy3D.face(dx);
  const av = document.querySelector('.quest .avatar');
  if (av) { av.style.transitionDuration = ms + 'ms'; av.style.setProperty('--hops', String(Math.max(2, Math.round(ms / 300)))); av.style.left = avLeft(n.x); av.style.top = avTop(n.y); av.classList.remove('travel'); void av.offsetWidth; av.style.animationDuration = ms + 'ms'; av.classList.add('travel'); }
  document.querySelectorAll('.quest .node').forEach(el => el.classList.toggle('target', el.dataset.val === id));
  clearTimeout(walkTimers.arrive);
  walkTimers.arrive = setTimeout(() => { if (window.Buddy3D) window.Buddy3D.face(0); g.current = id; arrive(id); }, ms + 60);
}
function arrive(id) {
  const g = gameState(), i = nodeIndex(id);
  if (!unlocked(i)) { render(); const av = document.querySelector('.quest .avatar'); if (av) { av.classList.add('nope'); setTimeout(() => av.classList.remove('nope'), 600); } toast(`Clear ${QUEST[i - 1].title} first`); return; }
  g.diving = id; render();
  clearTimeout(walkTimers.dive); walkTimers.dive = setTimeout(() => startRun(id), 700);
}
function taskFor(id) { return gameState().week?.tasks?.find(t => t.node === id) || null; }
function questMap() {
  const g = gameState();
  if (g.progress && !g.run && Date.now() - (g.loadedAt || 0) > 10000) loadGame(); // keep the bar in step with the server
  if (!g.progress) { loadGame(); return `<div class="quest"><div class="map loading"><p>Loading your map…</p></div></div>`; }
  const P = S.pet, p = petPos(), here = nearNode(), W = g.week; g.current = here?.id || null;
  const stars = n => { const s = g.progress[n.id]?.stars || 0; return `<div class="stars">${[1, 2, 3].map(i => `<span class="${i <= s ? 'on' : ''}">★</span>`).join('')}</div>`; };
  const nodes = QUEST.map((n, i) => { const un = unlocked(i), done = (g.progress[n.id]?.stars || 0) > 0, t = taskFor(n.id); return `<button class="node cloudnode ${un ? '' : 'locked'} ${done ? 'done' : ''} ${here?.id === n.id ? 'current' : ''} ${n.boss ? 'boss' : ''}" style="left:${n.x}%;top:${n.y}%;--c:${n.color};--s:${n.s || 1}" data-act="questSelect" data-val="${n.id}"><div class="cloudshape ${g.diving === n.id ? 'puff' : ''}"><i></i><i></i><i></i><div class="orb">${ico(un ? n.icon : 'lock')}</div>${t ? `<div class="pts ${t.done ? 'done' : ''}">${t.done ? ico('check') : '+' + t.points}</div>` : ''}</div>${stars(n)}<div class="nl">${n.title}</div></button>`; }).join('');
  const reaction = S.petAnim?.kind === 'heal' ? 'celebrating' : S.petAnim ? 'surprised' : null;
  const emerge = g.emerge; g.emerge = false;
  setTimeout(() => {
    const av = document.querySelector('.quest .avatar'); if (!av) return;
    const el = av.querySelector('.pet3d'); if (el && window.Buddy3D && P && window.Buddy3D.attach(el, { health: P.health, reaction })) el.classList.add('live');
    const bar = document.querySelector('.quest .hud .fill[data-to]'); if (bar) requestAnimationFrame(() => { bar.style.width = bar.dataset.to + '%'; });
    // open the map where Buddy stands (the path starts at the bottom), once per visit
    if (g.scrolledTo !== p.at) { g.scrolledTo = p.at; const c = document.getElementById('content'); const r = av.getBoundingClientRect(), cr = c.getBoundingClientRect(); c.scrollTop += (r.top - cr.top) - cr.height * 0.45; }
  }, 0);
  const energy = P ? P.health : 0, eCls = energy >= 60 ? 'good' : energy >= 40 ? 'mid' : 'low';
  const pct = W ? Math.min(100, Math.round(W.points / W.goal * 100)) : 0;
  return `
  <div class="quest">
    <div class="hud one">
      <div class="e">
        <div class="lbl"><span>${ico('heart')} Buddy <b>${energy}</b></span>${W ? `<span class="wk">${ico('gift')} ${W.points}/${W.goal} pts${W.rewardEarned ? ' · reward earned' : ''}</span>` : ''}<span class="st">★ ${totalStars()}/${QUEST.length * 3} · Lv ${P?.level || 1}</span></div>
        <div class="bar"><div class="fill ${eCls}" style="width:${S.petAnim?.from ?? energy}%" data-to="${energy}"></div>${W ? `<div class="pin ${W.rewardEarned ? 'earned' : ''}" style="left:${pct}%">${ico('gift')}</div>` : ''}</div>
      </div>
    </div>
    <div class="map">
      <div class="hills"></div>
      <div class="playfield">
        <svg class="road dotted" viewBox="0 0 100 100" preserveAspectRatio="none"><path class="dots" d="${cloudPath()}"/></svg>
        ${nodes}
        <div class="avatar ${g.diving ? 'dive' : emerge ? 'emerge' : ''}" style="left:${avLeft(p.x)};top:${avTop(p.y)}"><div class="pet3d">${petSvg(P?.mood || 'happy')}</div></div>
      </div>
      <button class="signpost" data-act="practice" data-val="imessage">${ico('phone')}<span>Field test<br><small>Text my phone</small></span></button>
    </div>
  </div>`;
}

/* ---------- minigame engine ---------- */
const gameTimers = {};
function startRun(id) {
  const n = QUEST[nodeIndex(id)]; if (!n) return;
  const run = { node: n, kind: n.kind, i: 0, score: 0, phase: 'play', fb: null, log: [], startedAt: Date.now() };
  if (n.kind === 'sorter') { run.items = shuffle(SMS_POOL).slice(0, 8); run.max = 8; run.per = 8000; }
  if (n.kind === 'storm') { run.items = shuffle(SMS_POOL).slice(0, 10); run.max = 10; run.per = 5000; }
  if (n.kind === 'pick') { run.items = shuffle(SITUATIONS).slice(0, 7); run.max = 7; run.per = 15000; }
  if (n.kind === 'links') { run.items = shuffle(LINK_ROUNDS); run.max = run.items.length; run.per = 12000; }
  if (n.kind === 'call') { run.items = n.calls === 'clone' ? CALLS_CLONE : CALLS; run.max = run.items.length * 3; run.call = 0; run.shown = 0; run.per = 0; }
  if (n.kind === 'chat') { run.chat = CHATS[n.id]; run.items = run.chat.steps; run.max = run.items.length; run.hist = []; run.per = 0; }
  gameState().run = run; gameState().diving = null;
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
  if (run.kind === 'pick') { ok = choice !== null && +choice === item.answer; label = ok ? 'Safe move' : 'Safer: ' + item.options[item.answer]; }
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
    gameState().progress = r.progress; gameState().week = r.week || gameState().week; run.task = r.task || null; run.delta = run.win ? 8 : -5;
  } catch (e) { run.error = e.message; }
  run.posting = false; renderOverlay(); render();
}
function closeRun(again) {
  const g = gameState(); const id = g.run?.node.id; clearInterval(gameTimers.tick); clearTimeout(gameTimers.next); g.run = null; g.diving = null; g.emerge = true;
  if (again && id) return startRun(id);
  if (id && g.progress?.[id]?.stars) { const i = nodeIndex(id); if (i + 1 < QUEST.length && unlocked(i + 1)) g.current = QUEST[i + 1].id; }
  renderOverlay(); render();
}

/* ---------- arena rendering ---------- */
function arenaHtml() {
  const run = gameState().run; if (!run) return '';
  const n = run.node;
  const dots = run.kind === 'call' ? run.items.map((_, i) => `<i class="${i < run.call ? 'done' : i === run.call ? 'cur' : ''}"></i>`).join('') : run.items.map((_, i) => `<i class="${i < run.i ? (run.log[i]?.ok ? 'done' : 'miss') : i === run.i ? 'cur' : ''}"></i>`).join('');
  const top = `<div class="atop"><button class="cancel" data-act="questQuit">${ico('x')} Cancel</button><div class="at"><div class="eyebrow">${n.boss ? 'Boss stop' : 'Stop ' + (nodeIndex(n.id) + 1)}</div><div class="t">${n.title}</div></div><div class="score">${run.score}<small>/${run.max}</small></div></div><div class="dots">${dots}</div>${run.per ? `<div class="timer"><div class="fill"></div></div>` : ''}`;
  const task = run.task, earned = task?.justEarned;
  if (run.phase === 'end') return `<div class="arena-bg"></div><div class="arena modal end ${earned ? 'celebrate' : ''}" style="--c:${n.color}">${earned ? '<div class="confetti">' + Array.from({ length: 18 }, (_, i) => `<i style="left:${(i * 53) % 100}%;animation-delay:${(i % 6) * .15}s;background:${['#E20074', '#F5B301', '#1E9E5A', '#7A3BFF'][i % 4]}"></i>`).join('') + '</div>' : ''}${top}<div class="stage"><div class="result ${run.win ? 'win' : 'loss'}">
      <div class="starsbig">${[1, 2, 3].map(i => `<span class="${i <= run.stars ? 'on' : ''}" style="animation-delay:${i * .18}s">★</span>`).join('')}</div>
      <h3>${run.win ? (run.stars === 3 ? 'Flawless' : 'Cleared') : run.lost ? 'Buddy took the hit' : 'Not this time'}</h3>
      <p>${run.lost ? 'You handed over the one thing the scammer wanted.' : `${run.score} of ${run.max}. ${run.win ? n.title + ' is cleared.' : 'Half or more clears the stop.'}`}</p>
      <div class="delta ${run.win ? 'pos' : 'neg'}">${run.posting ? 'Saving…' : run.error ? 'Could not save: ' + esc(run.error) : (run.win ? '+8' : '-5') + ' energy'}</div>
      ${task?.completed ? `<div class="taskdone">${ico('tmo')} T-Mobile task done: <b>+${task.points} pts</b> · ${esc(task.label)}</div>` : run.win && taskFor(n.id) && !taskFor(n.id).done ? `<div class="taskmiss">This week's task needs ${'★'.repeat(taskFor(n.id).needStars)} here for +${taskFor(n.id).points} pts</div>` : ''}
      ${earned ? `<div class="reward">${ico('gift')}<div><div class="rl">Weekly goal reached</div><div class="rn">${esc(gameState().week?.reward || 'T-Mobile reward')}</div></div></div>` : ''}
      ${run.log.filter(l => !l.ok).length ? `<div class="recap"><div class="lbl">What to remember</div>${run.log.filter(l => !l.ok).slice(0, 3).map(l => `<div class="feat">${ico('alert')}<span>${esc(l.item.why || l.item.choices?.find(c => !c.good)?.why || '')}</span></div>`).join('')}</div>` : ''}
    </div></div><div class="actrl"><button class="btn primary" data-act="questClose">Back to the game</button><button class="btn outline" data-act="questAgain">Play again</button></div></div>`;
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
  if (run.kind === 'pick') {
    const it = run.items[run.i];
    stage = `<div class="prompt sit fly-in" key="${run.i}"><div class="eyebrow">What do you do?</div><div class="big">${esc(it.q)}</div></div>
      <div class="links opts">${it.options.map((o, i) => `<button class="link ${run.fb ? (i === it.answer ? 'real' : 'fake') : ''}" data-act="questAnswer" data-val="${i}" ${run.fb ? 'disabled' : ''}>${ico(run.fb && i === it.answer ? 'checkCircle' : 'chevR')}<span>${esc(o)}</span></button>`).join('')}</div>${fb}`;
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
  return `<div class="arena-bg"></div><div class="arena modal kind-${run.kind}" style="--c:${n.color}">${top}<div class="stage">${stage}</div><div class="actrl">${ctrl}</div></div>`;
}

function GAME_ACTIONS(v) {
  return {
    questSelect: () => walkTo(v),
    questPlay: () => startRun(v),
    questAnswer: () => answer(v),
    questHangup: hangUp,
    questQuit: () => closeRun(false),
    questClose: () => closeRun(false),
    questAgain: () => closeRun(true),
  };
}

// ScamShield Buddy: a pet whose health mirrors the subscriber's cyber-security habits.
//   health  = 40 base + up to 20 from protection toggles + the last 30 days of events, clamped 0..100
//   xp      = all positive deltas x10; level = 1 + floor(xp / 100)
// Events come from practice outcomes (learn.js), link traps, reports, and the pop quizzes answered in the app.
import { q, one } from './db.js';
import { publish } from './sse.js';

export const DELTA = { caught: 12, fell: -15, trap: -25, quiz_right: 5, quiz_wrong: -6, report: 4, bonus: 3, game_win: 8, game_loss: -5 };
const TOGGLE_PTS = { scamBlock: 6, callerId: 3, screener: 4, aiVoice: 3, inCall: 4 }; // 20 max
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export const QUIZ = [
  { id: 'otp', cat: 'unusual_payment_or_code', q: 'Your bank texts: "Reply with the 6-digit code we just sent to confirm it is you." What do you do?', options: ['Reply with the code', 'Ignore it and call the number on my card', 'Reply STOP'], answer: 1, why: 'Banks never ask you to send a one-time code. The code is what lets a scammer into your account.' },
  { id: 'toll', cat: 'suspicious_link_or_sender', q: 'A text says you owe a $6.99 unpaid toll and links to pay. The link is "ezpass-toll-secure.co". Safe?', options: ['Yes, it is a small amount', 'No, toll agencies do not text payment links', 'Only if I use Apple Pay'], answer: 1, why: 'Toll agencies bill by mail or in their official app. A look-alike domain is the giveaway.' },
  { id: 'grand', cat: 'urgency', q: 'A caller crying says they are your grandchild, in jail, and need bail money tonight. First move?', options: ['Send money fast, they sound scared', 'Hang up and call your grandchild on their known number', 'Ask for the jail address'], answer: 1, why: 'Urgency plus secrecy is the family-emergency script. Verify on a number you already have.' },
  { id: 'gift', cat: 'unusual_payment_or_code', q: 'Which payment request is a near-certain scam?', options: ['Pay a fine with gift cards', 'Pay a bill with a check', 'Pay with the official app'], answer: 0, why: 'No agency or company accepts gift cards. Gift card codes are untraceable cash for scammers.' },
  { id: 'job', cat: 'too_good_to_be_true', q: 'A recruiter texts a $38/hr remote job, no interview, but you must pay for equipment first.', options: ['Great deal, pay it', 'Real employers never charge you to start', 'Negotiate the fee'], answer: 1, why: 'Advance fees and "fake check" setups are the whole scam. Legitimate jobs never cost money to accept.' },
  { id: 'tmo', cat: 'impersonation', q: '"T-Mobile" texts: your account PIN must be confirmed in 10 minutes or service is suspended.', options: ['Reply with my PIN', 'Check T-Life or call 611 instead', 'Tap the link to be safe'], answer: 1, why: 'T-Mobile never asks for your PIN by text. Open the app yourself rather than any link you were sent.' },
  { id: 'remote', cat: 'unusual_payment_or_code', q: 'A "Microsoft technician" calls about a virus and asks you to install AnyDesk.', options: ['Install it so they can fix it', 'Hang up. Microsoft does not cold-call', 'Ask for their employee ID'], answer: 1, why: 'Remote-access tools hand your whole computer to the caller. Tech companies never call you first.' },
  { id: 'pkg', cat: 'suspicious_link_or_sender', q: 'A delivery text asks for a $3.50 redelivery fee via link. You are expecting a package. What now?', options: ['Pay, it is cheap', 'Check tracking in the carrier app, not the link', 'Reply with my address'], answer: 1, why: 'Carriers do not charge redelivery fees by text. Expecting a package is exactly what the scam counts on.' },
  { id: 'screen', cat: 'urgency', q: 'ScamShield screened a caller who refused to give a company or callback number. Your call?', options: ['Pick up, might be important', 'Let it go; a real caller leaves a way to call back', 'Call the number back'], answer: 1, why: 'Legitimate callers can always be reached back. Refusing a callback number is a strong red flag.' },
  { id: 'secret', cat: 'secrecy', q: 'A caller says "do not tell anyone about this, not even your bank." That request is…', options: ['Normal for fraud cases', 'A red flag: secrecy keeps you from getting a second opinion', 'Fine if they have a case number'], answer: 1, why: 'Scammers isolate you so nobody can talk you out of it. Real agencies encourage you to verify.' },
  { id: 'link', cat: 'suspicious_link_or_sender', q: 'Which link most likely belongs to the real company?', options: ['amazon-support-verify.net', 'amazon.com/your-orders', 'amaz0n.help'], answer: 1, why: 'Look at what comes right before the first slash. Extra words, dashes or swapped letters mean a fake.' },
  { id: 'irs', cat: 'impersonation', q: 'A voicemail says the IRS has a warrant for your arrest unless you call back and pay today.', options: ['Call back immediately', 'Delete it; the IRS contacts you by mail first', 'Pay a smaller amount'], answer: 1, why: 'Government agencies do not threaten arrest by phone or demand same-day payment.' },
  { id: 'callerid', cat: 'impersonation', q: 'Caller ID shows your bank\'s real name and number. Does that prove it is the bank?', options: ['Yes, caller ID cannot be faked', 'No, numbers can be spoofed; hang up and call back', 'Only on weekdays'], answer: 1, why: 'Caller ID is trivially spoofed. Scam Likely labels help, but the safe habit is to call back yourself.' },
  { id: 'crypto', cat: 'urgency', q: 'Someone you met online needs you to move money to a "safe account" tonight because yours is compromised.', options: ['Move it, time matters', 'Stop: no real bank asks you to move money to a new account', 'Move half'], answer: 1, why: '"Safe account" is a fraud phrase. Banks freeze accounts themselves; they never ask you to transfer out.' },
  { id: 'report', cat: 'suspicious_link_or_sender', q: 'You got an obvious scam text. Best thing to do with it?', options: ['Reply "STOP"', 'Forward it to 7726 and delete it', 'Tap the link to see what it is'], answer: 1, why: 'Forwarding to 7726 (SPAM) reports it to your carrier. Replying confirms your number is live.' },
  { id: 'qr', cat: 'suspicious_link_or_sender', q: 'A parking meter has a QR code sticker that looks newer than the sign. Pay with it?', options: ['Yes, QR codes are safe', 'No, use the official parking app or the meter itself', 'Only if it loads a padlock icon'], answer: 1, why: 'Fake QR stickers send you to clone payment pages. A padlock only means the fake site has HTTPS.' },
];

export async function petEvent(lineId, kind, note, meta = {}) {
  const delta = DELTA[kind] ?? 0;
  await q('INSERT INTO pet_events (line_id, kind, delta, note, meta) VALUES ($1,$2,$3,$4,$5)', [lineId, kind, delta, note || null, JSON.stringify(meta)]);
  const state = await petState(lineId);
  publish('pet', { lineId, event: { kind, delta, note, meta }, state });
  return state;
}

export const moodFor = h => h >= 80 ? 'thriving' : h >= 60 ? 'happy' : h >= 40 ? 'tired' : h >= 20 ? 'sick' : 'critical';
const STATUS = { thriving: 'Thriving', happy: 'Healthy', tired: 'Tired', sick: 'Sick', critical: 'Critical' };

export async function petState(lineId) {
  const line = await one('SELECT * FROM lines WHERE id = $1', [lineId]);
  if (!line) return null;
  const t = line.toggles || {};
  const settings = Object.entries(TOGGLE_PTS).reduce((a, [k, v]) => a + (t[k] ? v : 0), 0);
  const recent = (await q(`SELECT kind, delta, note, meta, time FROM pet_events WHERE line_id = $1 AND time > now() - interval '30 days' ORDER BY time DESC`, [lineId])).rows;
  const all = await one(`SELECT COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END),0)::int AS pos FROM pet_events WHERE line_id = $1`, [lineId]);
  const health = clamp(40 + settings + recent.reduce((a, e) => a + e.delta, 0), 0, 100);
  const xp = all.pos * 10, level = 1 + Math.floor(xp / 100);
  const practice = await one(`SELECT count(*) FILTER (WHERE outcome = 'caught')::int AS caught, count(*) FILTER (WHERE outcome IN ('caught','fell_for_it'))::int AS total FROM learn_sessions WHERE line_id = $1`, [lineId]);
  const quiz = { right: recent.filter(e => e.kind === 'quiz_right').length, wrong: recent.filter(e => e.kind === 'quiz_wrong').length };
  const mood = moodFor(health);
  return {
    lineId, name: 'Buddy', health, mood, status: STATUS[mood], xp, level, xpInLevel: xp % 100,
    breakdown: {
      settings: { pts: settings, max: 20, on: Object.keys(TOGGLE_PTS).filter(k => t[k]), off: Object.keys(TOGGLE_PTS).filter(k => !t[k]) },
      practice: { caught: practice.caught, total: practice.total, traps: recent.filter(e => e.kind === 'trap').length },
      quiz: { ...quiz, total: quiz.right + quiz.wrong },
      reports: recent.filter(e => e.kind === 'report').length,
    },
    events: recent.slice(0, 12).map(e => ({ kind: e.kind, delta: e.delta, note: e.note, time: e.time, meta: e.meta })),
  };
}

/** A quiz question this line has not seen in the last two hours. Never includes the answer. */
export async function nextQuestion(lineId) {
  const seen = new Set((await q(`SELECT meta->>'qid' AS qid FROM pet_events WHERE line_id = $1 AND kind LIKE 'quiz_%' AND time > now() - interval '2 hours'`, [lineId])).rows.map(r => r.qid));
  const pool = QUIZ.filter(x => !seen.has(x.id));
  const pick = (pool.length ? pool : QUIZ)[Math.floor(Math.random() * (pool.length ? pool.length : QUIZ.length))];
  return { id: pick.id, cat: pick.cat, q: pick.q, options: pick.options };
}

/* ---------- ScamShield Quest: weekly T-Mobile tasks ---------- */
// One task per checkpoint per week, picked at random from these. Points scale with length and importance.
const TASKS = {
  texttrap: [{ id: 'tt-clear', label: 'Sort 8 texts before the timer', points: 25, need: 1 }, { id: 'tt-perfect', label: 'A perfect Text Trap round', points: 50, need: 3 }],
  linklens: [{ id: 'll-clear', label: 'Spot 4 of 6 real links', points: 25, need: 1 }, { id: 'll-perfect', label: 'All six links right', points: 45, need: 3 }],
  hangup: [{ id: 'hu-clear', label: 'Get through three scam calls', points: 30, need: 1 }, { id: 'hu-sharp', label: 'Hang up at the red flag, all three calls', points: 50, need: 2 }],
  codekeeper: [{ id: 'ck-clear', label: 'Keep your code through three asks', points: 35, need: 1 }, { id: 'ck-clean', label: 'Code Keeper with no risky replies', points: 50, need: 3 }],
  familysos: [{ id: 'fs-clear', label: 'Verify the family emergency', points: 35, need: 1 }, { id: 'fs-clean', label: 'Family SOS without sending a cent', points: 50, need: 3 }],
  situations: [{ id: 'sr-clear', label: 'Handle 4 of 7 situations safely', points: 30, need: 1 }, { id: 'sr-perfect', label: 'Situation Room, all seven right', points: 50, need: 3 }],
  jobhunt: [{ id: 'jh-clear', label: 'Turn down the Dream Job without paying', points: 35, need: 1 }, { id: 'jh-clean', label: 'Dream Job with no risky replies', points: 50, need: 3 }],
  deepfake: [{ id: 'vc-clear', label: 'Hang up on three cloned voices', points: 40, need: 1 }, { id: 'vc-sharp', label: 'Voice Clone, every hang-up at the red flag', points: 60, need: 2 }],
  romance: [{ id: 'ro-clear', label: 'Keep your wallet out of Too Good', points: 35, need: 1 }, { id: 'ro-clean', label: 'Too Good with no risky replies', points: 50, need: 3 }],
  storm: [{ id: 'st-clear', label: 'Clear the Scam Storm boss', points: 60, need: 1 }, { id: 'st-perfect', label: 'Scam Storm, ten for ten', points: 80, need: 3 }],
};
export const WEEK_GOAL = 180;
export const WEEK_REWARD = '500 T-Mobile Tuesdays points';
export function weekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 4 - day);
  const y = date.getUTCFullYear(), w = Math.ceil(((date - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
export async function weekTasks(lineId) {
  const week = weekKey();
  let rows = (await q('SELECT node, task_id, label, points, need_stars, done_at FROM game_tasks WHERE line_id = $1 AND week = $2', [lineId, week])).rows;
  // one task per checkpoint; checkpoints added mid-week get theirs on the next load
  const have = new Set(rows.map(r => r.node));
  const missing = Object.entries(TASKS).filter(([node]) => !have.has(node));
  if (missing.length) {
    for (const [node, list] of missing) {
      const t = list[Math.floor(Math.random() * list.length)];
      await q('INSERT INTO game_tasks (line_id, week, node, task_id, label, points, need_stars) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [lineId, week, node, t.id, t.label, t.points, t.need]);
    }
    rows = (await q('SELECT node, task_id, label, points, need_stars, done_at FROM game_tasks WHERE line_id = $1 AND week = $2', [lineId, week])).rows;
  }
  // Credit stops already cleared this week with enough stars (including wins from before the task was drawn).
  const credited = await q(`UPDATE game_tasks t SET done_at = w.first_win
      FROM (SELECT meta->>'node' AS node, max((meta->>'stars')::int) AS stars, min(time) AS first_win
              FROM pet_events WHERE line_id = $1 AND kind = 'game_win' AND time >= date_trunc('week', now()) GROUP BY 1) w
      WHERE t.line_id = $1 AND t.week = $2 AND t.done_at IS NULL AND t.node = w.node AND w.stars >= t.need_stars`, [lineId, week]);
  if (credited.rowCount) rows = (await q('SELECT node, task_id, label, points, need_stars, done_at FROM game_tasks WHERE line_id = $1 AND week = $2', [lineId, week])).rows;
  let reward = await one('SELECT reward, earned_at FROM game_rewards WHERE line_id = $1 AND week = $2', [lineId, week]);
  const points = rows.filter(r => r.done_at).reduce((a, r) => a + r.points, 0);
  if (!reward && points >= WEEK_GOAL) {
    await q('INSERT INTO game_rewards (line_id, week, reward) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [lineId, week, WEEK_REWARD]);
    reward = await one('SELECT reward, earned_at FROM game_rewards WHERE line_id = $1 AND week = $2', [lineId, week]);
  }
  return { key: week, goal: WEEK_GOAL, points, reward: WEEK_REWARD, rewardEarned: !!reward, earnedAt: reward?.earned_at || null,
    tasks: rows.map(r => ({ node: r.node, taskId: r.task_id, label: r.label, points: r.points, needStars: r.need_stars, done: !!r.done_at })) };
}
/** A cleared stop completes this week's task for that checkpoint when the star requirement is met. */
async function completeTask(lineId, node, stars) {
  const week = weekKey();
  const t = await one('SELECT * FROM game_tasks WHERE line_id = $1 AND week = $2 AND node = $3', [lineId, week, node]);
  if (!t || t.done_at || stars < t.need_stars) return { completed: false, justEarned: false };
  await q('UPDATE game_tasks SET done_at = now() WHERE line_id = $1 AND week = $2 AND node = $3', [lineId, week, node]);
  const hadReward = !!(await one('SELECT 1 FROM game_rewards WHERE line_id = $1 AND week = $2', [lineId, week])); // before weekTasks, which can grant it
  const w = await weekTasks(lineId);
  let justEarned = false;
  if (w.points >= WEEK_GOAL && !hadReward) {
    await q('INSERT INTO game_rewards (line_id, week, reward) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [lineId, week, WEEK_REWARD]);
    justEarned = true;
    petEvent(lineId, 'bonus', `Weekly goal reached: ${WEEK_REWARD}`, { week }).catch(() => {});
  }
  return { completed: true, points: t.points, label: t.label, justEarned };
}

/* ---------- ScamShield Quest progress ---------- */
export async function gameProgress(lineId) {
  const rows = (await q('SELECT node, stars, best, plays, updated FROM game_progress WHERE line_id = $1', [lineId])).rows;
  return Object.fromEntries(rows.map(r => [r.node, { stars: r.stars, best: r.best, plays: r.plays, updated: r.updated }]));
}

export function registerPet(app) {
  app.get('/api/game/:lineId', async c => c.json({ progress: await gameProgress(c.req.param('lineId')), pet: await petState(c.req.param('lineId')), week: await weekTasks(c.req.param('lineId')) }));
  app.post('/api/game/:lineId/result', async c => {
    const lineId = c.req.param('lineId');
    const { node, title, score = 0, max = 1, stars = 0, win = false } = await c.req.json();
    if (!node) return c.json({ error: 'node required' }, 400);
    await q(`INSERT INTO game_progress (line_id, node, stars, best, plays) VALUES ($1,$2,$3,$4,1)
             ON CONFLICT (line_id, node) DO UPDATE SET stars = GREATEST(game_progress.stars, EXCLUDED.stars), best = GREATEST(game_progress.best, EXCLUDED.best), plays = game_progress.plays + 1, updated = now()`,
      [lineId, node, Math.max(0, Math.min(3, Number(stars) || 0)), Number(score) || 0]);
    const state = await petEvent(lineId, win ? 'game_win' : 'game_loss', `${win ? 'Cleared' : 'Lost'} ${title || node}: ${score}/${max}`, { node, score, max, stars });
    const task = win ? await completeTask(lineId, node, Number(stars) || 0) : { completed: false, justEarned: false };
    return c.json({ progress: await gameProgress(lineId), pet: state, task, week: await weekTasks(lineId) });
  });
  app.get('/api/pet/:lineId', async c => { const s = await petState(c.req.param('lineId')); return s ? c.json(s) : c.json({ error: 'line not found' }, 404); });
  app.get('/api/pet/:lineId/quiz', async c => c.json(await nextQuestion(c.req.param('lineId'))));
  app.post('/api/pet/:lineId/quiz', async c => {
    const { id, choice } = await c.req.json();
    const Q = QUIZ.find(x => x.id === id); if (!Q) return c.json({ error: 'unknown question' }, 400);
    const correct = Number(choice) === Q.answer;
    const state = await petEvent(c.req.param('lineId'), correct ? 'quiz_right' : 'quiz_wrong', correct ? `Quick check: ${Q.id} answered right` : `Quick check: ${Q.id} missed`, { qid: Q.id, choice });
    return c.json({ correct, answer: Q.answer, why: Q.why, delta: DELTA[correct ? 'quiz_right' : 'quiz_wrong'], state });
  });
}

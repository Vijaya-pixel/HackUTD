// Writes the "scammer" side of a scam drill with Gemini, one text at a time, so the conversation reacts to
// what the participant actually says. If Gemini is missing, slow or returns junk, a canned line is used so
// a live demo never stalls.
import 'dotenv/config';
import { GoogleGenAI, Type } from '@google/genai';

const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const ai = KEY ? new GoogleGenAI({ apiKey: KEY }) : null;
const TIMEOUT_MS = 7000;
export const brainEnabled = () => !!ai;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING, description: 'The next text message to send, in character. No markdown.' },
    sendLink: { type: Type.BOOLEAN, description: 'True only if reply contains the {LINK} placeholder.' },
  },
  required: ['reply', 'sendLink'],
};

const LEVEL = {
  beginner: 'Difficulty BEGINNER: make the red flags fairly easy to notice (obvious urgency, a too-good offer, a slightly generic greeting).',
  intermediate: 'Difficulty INTERMEDIATE: sound believable, with the usual pressure tactics.',
  expert: 'Difficulty EXPERT: be very convincing. Mirror their tone, refer to what they just said, sound professional and calm, keep the urgency subtle, no ALL CAPS and no obvious mistakes.',
};
const system = (scenario, name, mustLink, difficulty = 'intermediate') => [
  LEVEL[difficulty] || LEVEL.intermediate,
  `You are playing a scammer in a SAFE, CONSENTED scam-awareness drill. ${name} signed up to be tested and knows drills happen, just not when. Nothing real is at stake: the link only opens an educational page.`,
  `Persona: ${scenario.persona}`,
  `Goal: get ${name} to tap a link. Build a little rapport, then add time pressure, then ask them to tap the link. Sound like a real, slightly-too-friendly scam text.`,
  `Rules:`,
  `- Write like a real text: short, casual, plain text, at most one emoji, under 280 characters.`,
  `- Never ask for passwords, card numbers, SSNs or codes inside the chat. The only ask is to tap the link.`,
  `- To send the link, set sendLink true and put the exact placeholder {LINK} in the reply. Send it at most once.`,
  mustLink ? `- This is the final step: you MUST send the link now (sendLink true, with {LINK}).` : `- Do not send the link in your first message. Wait until ${name} has replied at least once.`,
  `- If ${name} is suspicious, give one calm reassurance, then keep going. Never be abusive or threatening.`,
].join('\n');

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('gemini timeout')), ms))]);

/**
 * history: [{role:'assistant'|'user', text}] oldest first. Returns { reply, sendLink, engine }.
 * turn = number of scammer messages already sent; a link is forced once turn >= maxTurns - 1.
 */
export async function nextScamText({ scenario, name, history, turn, maxTurns = 4, difficulty = 'intermediate' }) {
  const mustLink = turn >= maxTurns - 1;
  if (ai) {
    try {
      const contents = history.length
        ? history.map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] }))
        : [{ role: 'user', parts: [{ text: '(Send your opening text.)' }] }];
      const res = await withTimeout(ai.models.generateContent({
        model: MODEL, contents,
        config: { systemInstruction: system(scenario, name, mustLink, difficulty), responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.85 },
      }), TIMEOUT_MS);
      const j = JSON.parse(res.text);
      let reply = String(j.reply || '').trim().slice(0, 320);
      let sendLink = !!j.sendLink && reply.includes('{LINK}');
      if (turn === 0) {                                  // never open with the hook: drop the whole sentence that carried the link
        sendLink = false;
        const kept = reply.split(/(?<=[.!?])\s+/).filter(x => !x.includes('{LINK}')).join(' ').trim();
        reply = kept || reply.replaceAll('{LINK}', '').trim();
      }
      if (mustLink && !sendLink) { reply = (reply ? reply + ' ' : '') + '{LINK}'; sendLink = true; }
      if (reply) return { reply, sendLink, engine: MODEL };
    } catch (e) { console.warn('[drill] gemini failed, using canned line:', e.message); }
  }
  const lines = scenario.fallback(name);
  const i = Math.min(turn, lines.length - 1);
  const line = lines[i];
  return { reply: line, sendLink: line.includes('{LINK}'), engine: 'canned' };
}

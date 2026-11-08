// Gemini wrapper with a rule-based fallback so the demo runs without a key or when the API is slow.
import 'dotenv/config';
import { GoogleGenAI, Type } from '@google/genai';

const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
const TIMEOUT_MS = 4000;
const ai = KEY ? new GoogleGenAI({ apiKey: KEY }) : null;

export const llmEnabled = () => !!ai;

const VERDICT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    tactic: { type: Type.STRING, enum: ['otp_request', 'gift_card', 'urgency_money', 'impersonation', 'remote_access', 'sales', 'none'] },
    confidence: { type: Type.NUMBER, description: '0 to 1 that this is a scam or unwanted call' },
    synthetic_voice_hint: { type: Type.BOOLEAN, description: 'true if the wording suggests a scripted or synthetic voice' },
    one_line_warning: { type: Type.STRING, description: 'Short warning to show the user, under 120 characters' },
    category: { type: Type.STRING, enum: ['Scam Likely', 'Fraud', 'Telemarketing', 'Survey', 'Political', 'Nuisance', 'Legitimate', 'Unknown'] },
  },
  required: ['tactic', 'confidence', 'synthetic_voice_hint', 'one_line_warning', 'category'],
};

const RULES = [
  [/\b(one[- ]time|verification|security) (pass)?code\b|\bread me the code\b|\b(six|6)[- ]digit\b/i, 'otp_request', 0.95, 'Fraud'],
  [/gift card|google play card|itunes card|steam card/i, 'gift_card', 0.95, 'Fraud'],
  [/\b(wire|cash app|zelle|bitcoin|crypto)\b.*\b(now|tonight|immediately)\b|\bbail\b|\bmove your money\b|\bsafe account\b/i, 'urgency_money', 0.9, 'Fraud'],
  [/fraud department|social security|irs\b|medicare|warrant for your arrest|from microsoft|amazon security/i, 'impersonation', 0.85, 'Scam Likely'],
  [/remote access|anydesk|teamviewer|install this/i, 'remote_access', 0.9, 'Fraud'],
  [/extended warranty|lower your interest|solar|free vacation|you have won|timeshare/i, 'sales', 0.7, 'Telemarketing'],
  [/\bsurvey\b|opinion poll/i, 'none', 0.4, 'Survey'],
  [/campaign|vote for|candidate/i, 'none', 0.35, 'Political'],
];

export function ruleClassify(transcript) {
  for (const [re, tactic, confidence, category] of RULES) {
    if (re.test(transcript)) {
      const warn = {
        otp_request: 'Never share a one-time passcode. Your bank will not ask for it.',
        gift_card: 'Gift cards are not a legal way to pay anything. This is a scam.',
        urgency_money: 'Pressure to move money right now is a classic fraud tactic.',
        impersonation: 'Caller is claiming an authority they likely do not have.',
        remote_access: 'Do not install remote access software for an unknown caller.',
        sales: 'Unsolicited sales call.',
        none: 'Low risk so far.',
      }[tactic];
      return { tactic, confidence, synthetic_voice_hint: /this is a recorded|press one/i.test(transcript), one_line_warning: warn, category, engine: 'rules' };
    }
  }
  return { tactic: 'none', confidence: 0.1, synthetic_voice_hint: false, one_line_warning: 'No scam tactics detected yet.', category: 'Unknown', engine: 'rules' };
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('llm timeout')), ms))]);
}

/**
 * Classify the latest transcript window of a call. `context` is an array of similar known scam scripts.
 * Always resolves: falls back to rules on any error or timeout.
 */
export async function classifyTranscript(transcript, context = []) {
  if (!ai) return ruleClassify(transcript);
  const prompt = `You are ScamShield, a carrier-side fraud detector listening to one side of a phone call.
Known scam scripts that resemble this call (for reference only):
${context.map((c, i) => `${i + 1}. [${c.label}] ${c.text}`).join('\n') || '(none)'}

Transcript so far (caller speech, newest last):
"""${transcript.slice(-2000)}"""

Decide whether the caller is using a scam or fraud tactic. Be decisive on requests for passcodes, gift cards, urgent money movement, impersonation of banks or government, or remote access. Treat ordinary business calls as Legitimate.`;
  try {
    const res = await withTimeout(ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { responseMimeType: 'application/json', responseSchema: VERDICT_SCHEMA, temperature: 0.1 },
    }), TIMEOUT_MS);
    const v = JSON.parse(res.text);
    v.confidence = Math.max(0, Math.min(1, Number(v.confidence) || 0));
    v.engine = MODEL;
    return v;
  } catch (e) {
    const v = ruleClassify(transcript);
    v.fallback_reason = e.message;
    return v;
  }
}

/** 1024-dim embedding, or throws when Gemini is not configured. */
export async function embed(text) {
  if (!ai) throw new Error('GEMINI_API_KEY not set');
  const res = await withTimeout(ai.models.embedContent({
    model: EMBED_MODEL,
    contents: text,
    config: { outputDimensionality: 1024 },
  }), 8000);
  return res.embeddings[0].values;
}

/** Short reply text for the Photon report-by-text flow. Rules when no key. */
export async function draftReply(number, info) {
  const base = `${number}: ${info.category || 'Unknown'}, risk ${info.risk}/100, reported by ${info.reports_30d} customers in 30 days.`;
  if (!ai) return base + (info.risk >= 80 ? ' Do not call back.' : '');
  try {
    const res = await withTimeout(ai.models.generateContent({
      model: MODEL,
      contents: `Write one friendly SMS under 160 characters telling a T-Mobile customer the result of a ScamShield number check. Facts: ${base} Note: ${info.note || ''}`,
    }), TIMEOUT_MS);
    return (res.text || base).trim().slice(0, 300);
  } catch { return base; }
}

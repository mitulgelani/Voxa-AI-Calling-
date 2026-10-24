import { config } from './config.js';
import { buildAgentPrompt, capReply } from './prompt.js';

const URL = 'https://openrouter.ai/api/v1/chat/completions';
const FAST = 'google/gemini-2.5-flash';
const CAREFUL = 'google/gemini-2.5-pro';

export interface Question { key: string; type: string; prompt: string; required: boolean; options?: string[] }
export interface Script {
  agentName: string; goal: string; persona: string; opening: string; disclosure: string;
  questions: Question[]; languages: string[];
}
export interface Line { speaker: 'agent' | 'customer'; text: string; seq: number; start_ms: number; end_ms: number; interrupted?: boolean }

const LANG_LABEL: Record<string, string> = {
  hinglish: 'Hinglish (Hindi sentences in Devanagari with common English words kept in English letters)',
  'hi-IN': 'Hindi, in Devanagari script', 'gu-IN': 'Gujarati, in Gujarati script', 'en-IN': 'Indian English', 'en-US': 'American English',
};

export function systemPrompt(s: Script, lang: string, contact: { name: string; attrs: Record<string, string> }): string {
  const facts = Object.entries(contact.attrs).slice(0, 12).map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`).join('; ');
  return buildAgentPrompt({
    name: s.agentName,
    brief: s.persona.slice(0, 3000),
    goal: s.goal.slice(0, 1000),
    steps: s.questions.map((q) => `${q.prompt}${q.type === 'rating' ? ' (a number from 1 to 5)' : q.type === 'choice' && q.options ? ` (one of: ${q.options.join(', ')})` : ''}${q.required ? '' : ' (optional: only if the call is going well)'}`),
    contact: `You are speaking with ${contact.name || 'the customer'}.${facts ? ` Known details: ${facts}.` : ''}`,
    opened: true,
    languageRules: `Speak ${LANG_LABEL[lang] ?? lang}. If the customer clearly switches to another of these languages, switch with them and start your reply with [LANG:code]: ${s.languages.join(', ')}.`,
    extraRules: [
      '- If an answer is unclear, ask once to confirm. Never put words in their mouth.',
      '- If they do not want calls: apologise briefly, confirm they will not be called again, and end with [OPTOUT] [END].',
      '- If they ask to be called later: agree a time if they give one, thank them, and end with [CALLBACK] [END].',
    ],
    reminder: `Remember: reply in ${LANG_LABEL[lang] ?? lang}, and match your length to the question.`,
  });
}

export interface Reply { text: string; end: boolean; optOut: boolean; callback: boolean; lang: string | null; ms: number; tokens: number }

export async function reply(system: string, lines: Line[], languages: string[]): Promise<Reply> {
  const started = Date.now();
  const messages = [
    { role: 'system', content: system },
    ...lines.slice(-16).map((l) => ({ role: l.speaker === 'agent' ? 'assistant' : 'user', content: l.text + (l.interrupted ? ' (cut off)' : '') })),
  ];
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openrouterKey}`, 'Content-Type': 'application/json', 'X-Title': 'VaniDial gateway' },
    body: JSON.stringify({ model: FAST, max_tokens: 700, temperature: 0.5, provider: { sort: 'latency' }, messages }),
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}`);
  const d = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
  let text = String(d.choices?.[0]?.message?.content ?? '').trim();
  const tag = text.match(/\[LANG:([a-zA-Z-]+)\]/);
  const lang = tag && languages.includes(tag[1]) ? tag[1] : null;
  const end = /\[END\]/.test(text);
  const optOut = /\[OPTOUT\]/.test(text);
  const callback = /\[CALLBACK\]/.test(text);
  text = capReply(text);
  text = text.replace(/\[[A-Z]+(:[a-zA-Z-]+)?\]/g, '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim();
  return { text, end, optOut, callback, lang, ms: Date.now() - started, tokens: d.usage?.total_tokens ?? 0 };
}

/**
 * Split a reply into speakable chunks: whole sentences, merged up to ~220 characters so short ones
 * don't each pay a synthesis round trip. Handles . ! ? and the Devanagari danda.
 */
export function speechChunks(text: string, max = 220): string[] {
  // split only where end punctuation is followed by a space, so "4.5" and "₹4,999.50" stay whole
  const sentences = text.split(/(?<=[.!?।]["')\]]*)\s+/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    const last = out[out.length - 1];
    if (last && last.length + s.length + 1 <= max) out[out.length - 1] = `${last} ${s}`;
    else out.push(s);
  }
  return out.length ? out : [text];
}

/** Phrases that mean "stop calling me", caught even if the model misses them. */
export const OPT_OUT = /(don'?t|do not|stop|never)\s+(call|calling|ring)|remove my number|unsubscribe|call mat (karo|kariye|karna)|phone mat (karo|kariye)|(कॉल|फोन|फ़ोन)\s*मत\s*(करो|करिए|करना|कीजिए)|दोबारा\s*(कॉल|फोन)\s*मत|ફોન\s*ના\s*કરશો|કૉલ\s*ના\s*કરશો/i;

export interface Extracted { key: string; value: unknown; confidence: number; turn: number | null }

/**
 * After the call: read the timecoded transcript and pull out each answer with the customer
 * turn it came from. The turn's timestamps become the evidence span.
 */
export async function extract(s: Script, lines: Line[]): Promise<{ answers: Extracted[]; tokens: number }> {
  const transcript = lines.map((l) => `#${l.seq} ${l.speaker.toUpperCase()}: ${l.text}`).join('\n');
  const schema = s.questions.map((q) => `- ${q.key} (${q.type}${q.type === 'choice' && q.options ? `: ${q.options.join(' | ')}` : ''}): ${q.prompt}`).join('\n');
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openrouterKey}`, 'Content-Type': 'application/json', 'X-Title': 'VaniDial extraction' },
    body: JSON.stringify({
      model: CAREFUL, temperature: 0, max_tokens: 1200, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You extract survey answers from phone call transcripts. Only use what the CUSTOMER actually said. If a question was not answered, set value to null. Never guess. Return JSON: {"answers":[{"key":string,"value":any,"confidence":number 0..1,"turn":number|null}]}. "turn" is the #number of the CUSTOMER line that contains the answer. Types: rating → integer 1-5; yes_no → true/false; choice → one of the listed options exactly; number → number; date → YYYY-MM-DD; text → a short English summary of what they said. Lower confidence when the answer was hedged, sarcastic, contradicted later, or inferred.' },
        { role: 'user', content: `Questions:\n${schema}\n\nTranscript:\n${transcript}` },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`extraction ${res.status}`);
  const d = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
  const raw = String(d.choices?.[0]?.message?.content ?? '{}').replace(/^```(json)?|```$/g, '');
  const parsed = JSON.parse(raw) as { answers?: Extracted[] };
  const keys = new Set(s.questions.map((q) => q.key));
  const customerTurns = new Set(lines.filter((l) => l.speaker === 'customer').map((l) => l.seq));
  const answers = (parsed.answers ?? [])
    .filter((a) => keys.has(a.key))
    .map((a) => ({
      key: a.key, value: normalise(s.questions.find((q) => q.key === a.key)!, a.value),
      confidence: Math.max(0, Math.min(1, Number(a.confidence) || 0)),
      turn: typeof a.turn === 'number' && customerTurns.has(a.turn) ? a.turn : null,
    }));
  return { answers, tokens: d.usage?.total_tokens ?? 0 };
}

function normalise(q: Question, v: unknown): unknown {
  if (v === null || v === undefined || v === '') return null;
  if (q.type === 'rating') { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : null; }
  if (q.type === 'number') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  if (q.type === 'yes_no') return typeof v === 'boolean' ? v : /^(true|yes|haan|ha)$/i.test(String(v));
  if (q.type === 'choice') return q.options?.find((o) => o.toLowerCase() === String(v).toLowerCase()) ?? null;
  return String(v).slice(0, 500);
}

import { NextResponse } from 'next/server';
import { LANGUAGES, getLanguage, matchesScript, parseLanguageTag } from '@/lib/languages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const KIE_URL = 'https://api.kie.ai/codex/v1/responses';

const OR_MODELS = [
  'google/gemini-2.5-flash',
  'openai/gpt-4o-mini',
  'meta-llama/llama-3.3-70b-instruct',
  'deepseek/deepseek-chat',
];
const KIE_MODELS = ['deepseek-v4-1-flash', 'gpt-5-5', 'gpt-6-luna'];
const OR_FAST = 'google/gemini-2.5-flash';
const KIE_FAST = 'deepseek-v4-1-flash';

const HISTORY_TURNS = 8;
const TURN_CHARS = 1200;

// Built-in personas from the original brief, kept for backward compatibility.
const PRESET_PERSONAS: Record<string, string> = {
  delivery:
    'You are Maya, a warm caller from a fictional delivery desk, on a clearly disclosed demo call about a parcel.',
  appointment:
    'You are Ravi, a calm caller confirming an appointment. You are a clearly disclosed AI demo assistant.',
  support:
    'You are Neha, a patient support agent following up on an open support request. You are a clearly disclosed AI demo assistant.',
};

type Provider = 'or' | 'kie';
interface Route {
  provider: Provider;
  model: string;
}
interface HistoryItem {
  role: 'agent' | 'caller' | 'assistant' | 'user';
  text?: string;
  content?: string;
  interrupted?: boolean;
}
interface AgentInput {
  name?: string;
  persona?: string;
  goal?: string;
  brevity?: 'short' | 'natural';
  discloseAI?: boolean;
  language?: string;
}
interface ChatBody {
  text?: string;
  history?: HistoryItem[];
  persona?: string;
  agent?: AgentInput;
  contact?: Record<string, string>;
  model?: string;
  /** 'reply' (default) | 'silence' — the caller has gone quiet. */
  event?: string;
  /** Client's guess at the caller's language, from Whisper detection or the script of the words. */
  callerLanguage?: string;
}

function resolveRoute(id: string | undefined): Route {
  const raw = (id || '').trim();
  const colon = raw.indexOf(':');
  if (colon > 0) {
    const prefix = raw.slice(0, colon);
    const model = raw.slice(colon + 1);
    if (prefix === 'or' && OR_MODELS.includes(model)) return { provider: 'or', model };
    if (prefix === 'kie' && KIE_MODELS.includes(model)) return { provider: 'kie', model };
  } else if (raw) {
    // Bare model names, for backward compatibility.
    if (OR_MODELS.includes(raw)) return { provider: 'or', model: raw };
    if (KIE_MODELS.includes(raw)) return { provider: 'kie', model: raw };
  }
  return { provider: 'or', model: OR_FAST };
}

function clip(text: string, max: number): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) : t;
}

function buildSystemPrompt(body: ChatBody): string {
  const agent = body.agent || {};
  const persona =
    clip(agent.persona || '', 2400) ||
    PRESET_PERSONAS[body.persona || ''] ||
    PRESET_PERSONAS.delivery;
  const name = clip(agent.name || '', 60);
  const goal = clip(agent.goal || '', 600);
  const short = agent.brevity !== 'natural';
  const lang = getLanguage(agent.language);

  const contactLines = Object.entries(body.contact || {})
    .filter(([k, v]) => k && v)
    .slice(0, 20)
    .map(([k, v]) => `${clip(k, 40)}: ${clip(v, 200)}`)
    .join('; ');

  const lines = [
    name ? `Your name is ${name}.` : '',
    persona,
    goal ? `Goal of this call: ${goal}` : '',
    agent.discloseAI !== false ? 'You are openly an AI voice assistant and said so when the call started.' : '',
    contactLines ? `What you know about the person you are talking to: ${contactLines}.` : '',
    '',
    `LANGUAGE (most important rule): speak ONLY ${lang.label}. ${lang.style} Every reply must be in ${lang.label}, even though these instructions, the persona and the notes are written in English. Never answer in English unless the call language is English or the caller switched to English.`,
    `LANGUAGE SWITCH: if the caller speaks a full sentence in another language, or asks you to talk in another language, switch to it from this reply on and begin your reply with [LANG:code], using one of: ${LANGUAGES.map((l) => `${l.id} (${l.label})`).join(', ')}. Indian callers speaking English → en-IN; mixing Hindi and English → hinglish. A few English words inside a Hindi sentence (okay, order, time, problem) are NOT a switch. If you cannot tell which language they prefer, ask in one short question which language is comfortable for them.`,
    '',
    'This is a live spoken phone call, not a chat. Talk like a real person on the phone.',
    short
      ? '- Reply with ONE short spoken sentence, under 20 words (or about 40 characters in Chinese, Japanese or Korean). Hard limit.'
      : '- Reply with one or two short spoken sentences, under 35 words total. Hard limit.',
    '- Ask at most one question per reply, then stop and let them talk.',
    '- React to what they just said before moving on. Mirror their energy and pace. Use everyday spoken words, not written language.',
    '- A light natural opener ("oh", "got it", "accha", "hmm") is fine sometimes, never every reply.',
    '- Plain spoken words only. No lists, no markdown, no emoji, no stage directions.',
    '- Never repeat a greeting or re-introduce yourself.',
    '- If they only acknowledge ("okay", "haan", "mm-hmm"), keep the call moving without starting a new topic.',
    '- If what they said is garbled, half-heard or makes no sense, say you did not catch that and ask them to repeat. Never guess wildly.',
    '- If they interrupted you (a line ending "(cut off)"), drop what you were saying and answer them directly. Do not repeat the cut-off sentence.',
    '- If they sound annoyed or confused, slow down, apologise briefly, and make it simpler.',
    '- If they say they are busy or driving, offer to call back later and wrap up.',
    '- If they ask whether you are a human or an AI, answer honestly that you are an AI assistant.',
    '- Never ask for card numbers, passwords, one time codes, PINs or identity documents.',
    '- When the conversation is finished and you have said goodbye, end your reply with [END].',
    '',
    `Remember: reply in ${lang.label}.`,
  ];
  return lines.filter(Boolean).join('\n').trim();
}

function normaliseHistory(history: HistoryItem[] | undefined) {
  return (Array.isArray(history) ? history : [])
    .slice(-HISTORY_TURNS)
    .map((h) => {
      const isAgent = h.role === 'agent' || h.role === 'assistant';
      let text = clip(h.text ?? h.content ?? '', TURN_CHARS);
      if (isAgent && h.interrupted) text = `${text} (cut off)`;
      return { role: isAgent ? ('assistant' as const) : ('user' as const), text };
    })
    .filter((h) => h.text);
}

function userMessage(body: ChatBody): string {
  const lang = getLanguage(body.agent?.language);
  const reminder = `\n(Reply in ${lang.label}.${body.callerLanguage ? ` The caller's words look like ${clip(body.callerLanguage, 30)}.` : ''})`;
  if (body.event === 'silence') {
    return `[The caller has gone silent for a while. Check in briefly and naturally in ${lang.label}, like "Hello, are you still there?". If you have already checked in, say a short goodbye and end with [END].]`;
  }
  if (body.event === 'start') {
    const disclose = body.agent?.discloseAI !== false ? ', say briefly that you are an AI assistant' : '';
    return `[The call just connected. Open the call naturally in one or two short sentences in ${lang.label}: greet them, introduce yourself by name${disclose}, and say why you are calling.]`;
  }
  return (clip(body.text || '', TURN_CHARS) || '[inaudible]') + reminder;
}

async function callOpenRouter(model: string, system: string, history: ReturnType<typeof normaliseHistory>, text: string) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'Voxa Voice Agent',
      },
      body: JSON.stringify({
        model,
        max_tokens: 90,
        temperature: 0.6,
        provider: { sort: 'latency' },
        messages: [
          { role: 'system', content: system },
          ...history.map((h) => ({ role: h.role, content: h.text })),
          { role: 'user', content: text },
        ],
      }),
    });
    if (!res.ok) throw new Error(`openrouter ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return String(data.choices?.[0]?.message?.content || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

function extractKieText(data: unknown): string {
  const d = data as {
    output_text?: string;
    output?: { content?: { type?: string; text?: string }[] }[];
  };
  if (typeof d?.output_text === 'string' && d.output_text.trim()) return d.output_text.trim();
  const parts: string[] = [];
  for (const item of d?.output || []) {
    for (const c of item?.content || []) {
      if (c && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join(' ').trim();
}

async function callKieOnce(model: string, system: string, history: ReturnType<typeof normaliseHistory>, text: string) {
  const key = process.env.KIE_API_KEY;
  if (!key) throw new Error('KIE_API_KEY not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(KIE_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        instructions: system,
        max_output_tokens: 120,
        temperature: 0.6,
        stream: false,
        // KIE rejects bare {role, content}: every item needs type "message".
        input: [
          ...history.map((h) => ({
            type: 'message',
            role: h.role,
            content: [{ type: h.role === 'assistant' ? 'output_text' : 'input_text', text: h.text }],
          })),
          { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
        ],
      }),
    });
    if (!res.ok) throw new Error(`kie ${res.status}`);
    const raw = await res.text();
    if (!raw.trim()) throw new Error('kie empty body');
    return extractKieText(JSON.parse(raw));
  } finally {
    clearTimeout(timer);
  }
}

async function callKie(model: string, system: string, history: ReturnType<typeof normaliseHistory>, text: string) {
  // KIE intermittently returns an empty or 5xx body: retry once.
  try {
    const out = await callKieOnce(model, system, history, text);
    if (out) return out;
  } catch {
    /* retry below */
  }
  return callKieOnce(model, system, history, text);
}

async function attempt(route: Route, system: string, history: ReturnType<typeof normaliseHistory>, text: string) {
  return route.provider === 'or'
    ? callOpenRouter(route.model, system, history, text)
    : callKie(route.model, system, history, text);
}

export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const route = resolveRoute(body.model);
  const system = buildSystemPrompt(body);
  const history = normaliseHistory(body.history);
  const text = userMessage(body);

  const fallback: Route =
    route.provider === 'or' ? { provider: 'kie', model: KIE_FAST } : { provider: 'or', model: OR_FAST };

  const started = Date.now();
  for (const r of [route, fallback]) {
    try {
      let reply = await attempt(r, system, history, text);
      if (reply) {
        // The model may switch language on the caller's request: [LANG:en-IN].
        const switched = parseLanguageTag(reply);
        const target = switched || getLanguage(body.agent?.language);
        reply = reply.replace(/\[LANG:[^\]]*\]/gi, '').trim();
        // Language lock: if the reply came back in the wrong language or script, rewrite it once.
        if (reply && !matchesScript(reply, target.id)) {
          try {
            const fixed = await attempt(
              r,
              `Rewrite the user's line as natural spoken ${target.label}. ${target.style} Keep the meaning, keep it short, keep any [END] token. Output only the rewritten line.`,
              [],
              reply,
            );
            if (fixed && matchesScript(fixed, target.id)) reply = fixed.trim();
          } catch {
            /* keep the original */
          }
        }
        return NextResponse.json({
          reply,
          model: `${r.provider}:${r.model}`,
          language: switched ? switched.id : undefined,
          ms: Date.now() - started,
        });
      }
    } catch (error) {
      console.warn(`[chat] ${r.provider}:${r.model} failed: ${(error as Error).message}`);
    }
  }
  return NextResponse.json(
    { error: 'No model answered. Check OPENROUTER_API_KEY / KIE_API_KEY.', reply: '' },
    { status: 502 },
  );
}

export async function GET() {
  return NextResponse.json({
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    kie: Boolean(process.env.KIE_API_KEY),
  });
}

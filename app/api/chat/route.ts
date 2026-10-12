import { NextResponse } from 'next/server';
import { getLanguage } from '@/lib/languages';

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
    agent.discloseAI !== false ? 'You are openly an AI voice assistant; you already said so in your greeting.' : '',
    contactLines ? `What you know about the person you are talking to: ${contactLines}.` : '',
    '',
    'This is a live spoken phone call, not a chat. Talk like a real person on the phone.',
    `- Language: reply only in ${lang.label}. ${lang.style} If the caller clearly switches to another language, follow them.`,
    short
      ? '- Reply with ONE short spoken sentence, under 20 words (or about 40 characters in Chinese, Japanese or Korean). Hard limit.'
      : '- Reply with one or two short spoken sentences, under 35 words total. Hard limit.',
    '- Ask at most one question per reply.',
    '- Use contractions and everyday words. React to what they just said before moving on. Mirror their energy.',
    '- A light natural opener like "oh", "ah", "got it" or "hmm" is fine sometimes, never every reply.',
    '- Plain spoken words only. No lists, no markdown, no emoji, no stage directions.',
    '- Never repeat a greeting. You already introduced yourself.',
    '- If the caller only acknowledges with "okay", "yeah" or "mm-hmm", keep the call moving, do not start a new topic.',
    '- If what they said is garbled or makes no sense, say you did not catch that and ask them to repeat it.',
    '- If they say they are busy, ask for a better time or wrap up politely.',
    '- If they ask whether you are a human or an AI, answer honestly that you are an AI assistant.',
    '- Never ask for card numbers, passwords, one time codes, PINs or identity documents.',
    '- If a line in the history ends with "(cut off)", they interrupted you there; respond to what they said, do not finish the old sentence.',
    '- When the conversation is clearly finished and you have said goodbye, end your reply with the token [END].',
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
  if (body.event === 'silence') {
    return '[The caller has gone silent for a while. Check in briefly and naturally, like "Hello, you still there?". If you have already checked in, say a short goodbye and end with [END].]';
  }
  if (body.event === 'start') {
    return '[The call just connected and the caller has not said anything yet. Open the call naturally in one sentence.]';
  }
  return clip(body.text || '', TURN_CHARS) || '[inaudible]';
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
      const reply = await attempt(r, system, history, text);
      if (reply) {
        return NextResponse.json({ reply, model: `${r.provider}:${r.model}`, ms: Date.now() - started });
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

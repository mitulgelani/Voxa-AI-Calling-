import 'server-only';
import { serverEnv } from '@/lib/server-env';
import { BRIEF_BUILDER_PROMPT, briefBuilderInput, buildAgentPrompt, capReply, humanizeReply } from '@/lib/prompts/universal-agent';
import { LANGUAGES, getLanguage, matchesScript, parseLanguageTag, type Language } from '@/lib/voice/languages';

/**
 * The brain: one spoken reply per turn, sized to the question, in the locked language.
 * OpenRouter (Gemini 2.5 Flash) when its key is set, then Groq (gpt-oss), then KIE.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const KIE_URL = 'https://api.kie.ai/codex/v1/responses';
const OR_FAST = 'google/gemini-2.5-flash';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
/** Groq production models (Oct 2026). Llama 3.3 70B was retired on 16 Aug 2026. */
const GROQ_FAST = process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-120b';
const GROQ_BACKUP = 'openai/gpt-oss-20b';
const KIE_FAST = 'deepseek-v4-1-flash';
const HISTORY_TURNS = 8; // enough context for a sales call; fewer tokens per turn keeps a free-tier key under its per-minute limit
const TURN_CHARS = 1100; // keeps most of a long answer in context without resending all of it every turn

export interface Msg {
  role: 'assistant' | 'user';
  text: string;
}
export interface TurnIn {
  role: 'agent' | 'caller';
  text: string;
  interrupted?: boolean;
}

function clip(text: string, max: number): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) : t;
}

export function normaliseHistory(history: TurnIn[] | undefined): Msg[] {
  return (Array.isArray(history) ? history : [])
    .slice(-HISTORY_TURNS)
    .map((h) => {
      const isAgent = h.role === 'agent';
      let text = clip(h.text, TURN_CHARS);
      if (isAgent && h.interrupted) text = `${text} (cut off)`;
      return { role: isAgent ? ('assistant' as const) : ('user' as const), text };
    })
    .filter((h) => h.text);
}

export interface PersonaBrief {
  name: string;
  description: string;
  goal?: string;
  questions?: { key: string; prompt: string }[];
  disclosure?: boolean;
}

/** System prompt: the universal call agent on top of the persona's brief (or raw description). */
export function buildSystemPrompt(p: PersonaBrief, lang: Language): string {
  return buildAgentPrompt({
    name: clip(p.name, 40),
    brief: clip(p.description, 3000),
    goal: p.goal ? clip(p.goal, 600) : undefined,
    steps: p.questions?.map((q) => clip(q.prompt, 200)),
    languageRules: [
      `Speak ONLY ${lang.label}. ${lang.style} Every reply must be in ${lang.label}, even though these instructions are in English, and in that script even when the person's words reach you in a different script.`,
      `If the person speaks a full sentence in another language, or asks you to talk in another language, switch to it from this reply on and begin your reply with [LANG:code], using one of: ${LANGUAGES.map((l) => `${l.id} (${l.label})`).join(', ')}. Indian callers speaking English → en-IN; mixing Hindi and English → hinglish. A few English words inside a Hindi sentence are NOT a switch.`,
    ].join('\n'),
    reminder: `Remember: reply in ${lang.label}. ${lang.style} Match your length to the question, react to exactly what they said in their mood (no stock openers like "sure thing", "great", "certainly", "I hear you"), and sound like a real person on a phone call, never a script.`,
  });
}

/** One-off: turn an owner's rough description into the structured brief the call prompt runs on. */
export async function compileBrief(name: string, description: string): Promise<string | null> {
  if (!serverEnv.groqKey && !serverEnv.openrouterKey) return null;
  try {
    const text = serverEnv.groqKey
      ? await callGroq(GROQ_FAST, BRIEF_BUILDER_PROMPT, [], briefBuilderInput(name, description), 1800, 20000)
      : await callOpenRouter(OR_FAST, BRIEF_BUILDER_PROMPT, [], briefBuilderInput(name, description));
    const brief = text.trim();
    // A usable brief has the headings; anything else falls back to the raw description.
    return /GOAL:/.test(brief) && /FLOW:/.test(brief) ? brief.slice(0, 3000) : null;
  } catch (error) {
    console.warn(`[brain] brief builder failed: ${(error as Error).message}`);
    return null;
  }
}

async function callGroq(model: string, system: string, history: Msg[], text: string, maxTokens = 1400, timeoutMs = 12000) {
  const key = serverEnv.groqKey;
  if (!key) throw new Error('GROQ_API_KEY not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        // gpt-oss reasons before answering; keep that short for a live call and leave room for it.
        reasoning_effort: 'low',
        include_reasoning: false,
        // Room for low-effort reasoning plus up to ten spoken sentences (Devanagari is token-heavy).
        max_completion_tokens: maxTokens,
        temperature: 0.6,
        messages: [
          { role: 'system', content: system },
          ...history.map((h) => ({ role: h.role, content: h.text })),
          { role: 'user', content: text },
        ],
      }),
    });
    if (!res.ok) throw new Error(`groq ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return String(data.choices?.[0]?.message?.content || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenRouter(model: string, system: string, history: Msg[], text: string) {
  const key = serverEnv.openrouterKey;
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
        'X-Title': 'VaniDial',
        'HTTP-Referer': 'https://vanidial-one.vercel.app',
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
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

async function callKieOnce(model: string, system: string, history: Msg[], text: string) {
  const key = serverEnv.kieKey;
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
        max_output_tokens: 220,
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

async function callKie(model: string, system: string, history: Msg[], text: string) {
  // KIE intermittently returns an empty or 5xx body: retry once.
  try {
    const out = await callKieOnce(model, system, history, text);
    if (out) return out;
  } catch {
    /* retry below */
  }
  return callKieOnce(model, system, history, text);
}


export interface BrainResult {
  reply: string;
  model: string;
  language?: string;
  ms: number;
}

/** One reply. Tries OpenRouter, then KIE; enforces the language lock with a single rewrite. */
export async function think(system: string, history: Msg[], text: string, languageId: string): Promise<BrainResult | null> {
  const routes: { provider: 'or' | 'groq' | 'kie'; model: string }[] = [];
  if (serverEnv.openrouterKey) routes.push({ provider: 'or', model: OR_FAST });
  if (serverEnv.groqKey) routes.push({ provider: 'groq', model: GROQ_FAST }, { provider: 'groq', model: GROQ_BACKUP });
  if (serverEnv.kieKey) routes.push({ provider: 'kie', model: KIE_FAST });
  const started = Date.now();
  for (const r of routes) {
    const call = (s: string, h: Msg[], t: string) =>
      r.provider === 'or' ? callOpenRouter(r.model, s, h, t) : r.provider === 'groq' ? callGroq(r.model, s, h, t) : callKie(r.model, s, h, t);
    try {
      let reply = await call(system, history, text);
      if (!reply) continue;
      const switched = parseLanguageTag(reply);
      const target = switched || getLanguage(languageId);
      reply = reply.replace(/\[LANG:[^\]]*\]/gi, '').trim();
      reply = humanizeReply(capReply(reply));
      if (reply && !matchesScript(reply, target.id)) {
        try {
          const fixed = await call(
            `Rewrite the user's line as natural spoken ${target.label}. ${target.style} Keep the meaning and the length, keep any [END] token. Output only the rewritten line.`,
            [],
            reply,
          );
          if (fixed && matchesScript(fixed, target.id)) reply = fixed.trim();
        } catch {
          /* keep the original */
        }
      }
      // Never hang up on a question: [END] only counts after a goodbye, not while waiting for an answer.
      if (/\[END\]/i.test(reply) && /\?/.test(reply.replace(/\[END\]/gi, ''))) reply = reply.replace(/\s*\[END\]/gi, '').trim();
      return { reply, model: `${r.provider}:${r.model}`, language: switched?.id, ms: Date.now() - started };
    } catch (error) {
      console.warn(`[brain] ${r.provider} failed: ${(error as Error).message}`);
    }
  }
  return null;
}

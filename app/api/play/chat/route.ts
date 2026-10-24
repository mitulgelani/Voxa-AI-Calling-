import { z } from 'zod';
import { anonDb, jsonError, PlayError, SESSION_RE, tick } from '@/lib/server/play';
import { personaForCall } from '@/lib/server/playstore';
import { serverEnv } from '@/lib/server-env';
import { buildSystemPrompt, normaliseHistory, think } from '@/lib/server/brain';
import { getLanguage } from '@/lib/voice/languages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const Body = z.object({
  session: z.string().regex(SESSION_RE),
  text: z.string().max(1200).default(''),
  event: z.enum(['reply', 'silence', 'start']).default('reply'),
  language: z.string().max(16).optional(),
  callerLanguage: z.string().max(30).optional(),
  // agent turns can now be up to ten sentences, so allow long lines; the brain clips what it sends the model
  history: z.array(z.object({ role: z.enum(['agent', 'caller']), text: z.string().max(4000), interrupted: z.boolean().optional() })).max(40).default([]),
});

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new PlayError('Bad request.', 400);
    const b = parsed.data;
    const t = await tick(b.session, 'chat');
    let persona = await personaForCall(t.persona_id);
    if (!persona) {
      const { data } = await anonDb().rpc('play_persona_for_session', { p_token: serverEnv.playToken, p_session: b.session });
      persona = Array.isArray(data) ? data[0] : data;
    }
    if (!persona) throw new PlayError('This call has ended.', 410);

    const lang = getLanguage(b.language || persona.language);
    const system = buildSystemPrompt({ name: persona.name, description: persona.brief || persona.description }, lang);
    const reminder = `\n(Reply in ${lang.label}.${b.callerLanguage ? ` The caller's words look like ${b.callerLanguage}.` : ''})`;
    const text =
      b.event === 'start'
        ? `[The call just connected. Open the call in ${lang.label} as your brief and rules say: who you are, who you are calling from, that you are an AI assistant, and the reason for the call, then one easy question. Keep the opening to two or three sentences.]`
        : b.event === 'silence'
          ? `[The caller has gone quiet. Check in briefly in ${lang.label}, like "Hello, are you still there?". If you already checked in, say a short goodbye and end with [END].]`
          : (b.text.trim() || '[unintelligible]') + reminder;

    const out = await think(system, normaliseHistory(b.history), text, lang.id);
    if (!out) throw new PlayError('The AI did not answer. Try again in a moment.', 502);
    return Response.json(out);
  } catch (e) {
    return jsonError(e);
  }
}

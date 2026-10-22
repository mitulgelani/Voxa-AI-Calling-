import { z } from 'zod';
import { anonDb, jsonError, PlayError, tick } from '@/lib/server/play';
import { serverEnv } from '@/lib/server-env';
import { buildSystemPrompt, normaliseHistory, think } from '@/lib/server/brain';
import { getLanguage } from '@/lib/voice/languages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const Body = z.object({
  session: z.string().regex(/^[0-9a-f-]{36}$/),
  text: z.string().max(1200).default(''),
  event: z.enum(['reply', 'silence', 'start']).default('reply'),
  language: z.string().max(16).optional(),
  callerLanguage: z.string().max(30).optional(),
  history: z.array(z.object({ role: z.enum(['agent', 'caller']), text: z.string().max(1200), interrupted: z.boolean().optional() })).max(40).default([]),
});

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new PlayError('Bad request.', 400);
    const b = parsed.data;
    await tick(b.session, 'chat');
    const { data } = await anonDb().rpc('play_persona_for_session', { p_token: serverEnv.playToken, p_session: b.session });
    const persona = Array.isArray(data) ? data[0] : data;
    if (!persona) throw new PlayError('This call has ended.', 410);

    const lang = getLanguage(b.language || persona.language);
    const system = buildSystemPrompt({ name: persona.name, description: persona.description }, lang);
    const reminder = `\n(Reply in ${lang.label}.${b.callerLanguage ? ` The caller's words look like ${b.callerLanguage}.` : ''})`;
    const text =
      b.event === 'start'
        ? `[The call just connected. Open naturally in one or two short sentences in ${lang.label}: greet them, say your name, and say briefly that you are an AI.]`
        : b.event === 'silence'
          ? `[The caller has gone quiet. Check in briefly in ${lang.label}, like "Hello, are you still there?". If you already checked in, say a short goodbye and end with [END].]`
          : (b.text.trim() || '[inaudible]') + reminder;

    const out = await think(system, normaliseHistory(b.history), text, lang.id);
    if (!out) throw new PlayError('The AI did not answer. Try again in a moment.', 502);
    return Response.json(out);
  } catch (e) {
    return jsonError(e);
  }
}

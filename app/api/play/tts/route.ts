import { z } from 'zod';
import { jsonError, PlayError, tick } from '@/lib/server/play';
import { warmTts } from '@/lib/voice/edge-tts-warm';
import { VOICE_IDS } from '@/lib/voice/voices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const Body = z.object({
  session: z.string().regex(/^[0-9a-f-]{36}$/),
  text: z.string().min(1).max(600),
  voice: z.string().max(60),
  rate: z.enum(['-8%', '+0%', '+8%']).default('+0%'),
});

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new PlayError('Bad request.', 400);
    const b = parsed.data;
    if (!VOICE_IDS.has(b.voice)) throw new PlayError('Unknown voice.', 400);
    await tick(b.session, 'tts');
    const audio = await warmTts.synthesize(b.text.replace(/\s+/g, ' ').trim(), { voice: b.voice, rate: b.rate });
    return new Response(new Uint8Array(audio), { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return jsonError(e);
  }
}

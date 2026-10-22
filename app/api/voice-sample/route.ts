import { warmTts } from '@/lib/voice/edge-tts-warm';
import { getLanguage } from '@/lib/voice/languages';
import { VOICE_IDS } from '@/lib/voice/voices';
import { ipHash, rateLimit } from '@/lib/server/play';

export const runtime = 'nodejs';

/**
 * Voice previews. Text is never taken from the client: it is the language's fixed sample
 * line, so this endpoint cannot be used as a free general-purpose TTS.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const voice = url.searchParams.get('voice') || '';
  const lang = getLanguage(url.searchParams.get('lang') || undefined);
  const name = (url.searchParams.get('name') || '').replace(/[^\p{L}\p{M} ]/gu, '').slice(0, 20);
  if (!VOICE_IDS.has(voice)) return new Response('unknown voice', { status: 400 });
  if (!(await rateLimit(`sample:${ipHash(req)}`, 40, 600))) return new Response('slow down', { status: 429 });
  const label = name || lang.voices.find((v) => v.id === voice)?.label || '';
  try {
    const audio = await warmTts.synthesize(lang.sample.replace('{name}', label), { voice });
    return new Response(new Uint8Array(audio), {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400, s-maxage=604800' },
    });
  } catch {
    return new Response('voice unavailable', { status: 502 });
  }
}

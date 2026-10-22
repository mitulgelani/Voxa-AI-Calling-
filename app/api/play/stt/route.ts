import { jsonError, PlayError, tick } from '@/lib/server/play';
import { transcribe } from '@/lib/server/stt';
import { getLanguage } from '@/lib/voice/languages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BYTES = 4 * 1024 * 1024; // one turn; ~2 minutes of opus

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    await tick(url.searchParams.get('session') || '', 'stt');
    const lang = getLanguage(url.searchParams.get('lang') || undefined);
    const len = Number(req.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new PlayError('That turn was too long.', 413);
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) throw new PlayError('No audio received.', 400);
    if (buf.byteLength > MAX_BYTES) throw new PlayError('That turn was too long.', 413);
    const type = req.headers.get('content-type') || 'audio/webm';
    // Hinglish and Indian languages may switch to English; Indian English may switch to Hindi.
    const allowed = lang.whisper === 'en' ? (lang.id === 'en-IN' ? ['en', 'hi'] : ['en']) : [lang.whisper, 'en'];
    const out = await transcribe(new Blob([buf], { type }), lang.whisper, allowed);
    return Response.json(out);
  } catch (e) {
    if (e instanceof Error && /GROQ_API_KEY|groq/.test(e.message)) {
      return Response.json({ error: 'Cloud listening is unavailable.', fallback: 'browser' }, { status: 503 });
    }
    return jsonError(e);
  }
}

import { warmTts } from '@/lib/edge-tts-warm';
import { DEFAULT_VOICE, VOICE_IDS } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_CHARS = 1200;
const RATES = new Set(['-8%', '+0%', '+8%']);

export async function POST(req: Request) {
  let body: { text?: string; voice?: string; rate?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (!text) return new Response('empty text', { status: 400 });
  const voice = VOICE_IDS.includes(String(body.voice)) ? String(body.voice) : DEFAULT_VOICE;
  const rate = RATES.has(String(body.rate)) ? String(body.rate) : '+0%';

  try {
    const audio = await warmTts.synthesize(text, { voice, rate });
    return new Response(new Uint8Array(audio), {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'Content-Length': String(audio.length) },
    });
  } catch (error) {
    console.error('[tts] failed:', (error as Error).message);
    return new Response('tts failed', { status: 502 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;

function sttUrl(): string {
  return (process.env.STT_URL || 'http://127.0.0.1:8897').replace(/\/+$/, '');
}

export async function POST(req: Request) {
  const audio = await req.arrayBuffer();
  if (!audio.byteLength) return Response.json({ error: 'empty body' }, { status: 400 });
  if (audio.byteLength > MAX_BYTES) return Response.json({ error: 'too large' }, { status: 413 });

  const params = new URL(req.url).searchParams;
  const lang = params.get('lang') || 'en';
  const safeLang = /^[a-z]{2,3}$/.test(lang) ? lang : 'en';
  const alt = (params.get('alt') || '').split(',').filter((a) => /^[a-z]{2,3}$/.test(a)).slice(0, 3).join(',');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${sttUrl()}/transcribe?lang=${safeLang}${alt ? `&alt=${alt}` : ''}`, {
      method: 'POST',
      body: audio,
      signal: controller.signal,
      headers: {
        'Content-Type': req.headers.get('content-type') || 'application/octet-stream',
        ...(process.env.STT_TOKEN ? { Authorization: `Bearer ${process.env.STT_TOKEN}` } : {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return Response.json({ error: data.error || `stt ${res.status}` }, { status: 502 });
    return Response.json({
      text: String(data.text || ''),
      language: data.language || safeLang,
      seconds: data.seconds ?? null,
      audio_seconds: data.audio_seconds ?? null,
    });
  } catch (error) {
    const aborted = (error as Error).name === 'AbortError';
    return Response.json({ error: aborted ? 'stt timeout' : 'stt unreachable' }, { status: aborted ? 504 : 503 });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${sttUrl()}/health`, { signal: controller.signal, cache: 'no-store' });
    const data = await res.json();
    return Response.json({ ok: Boolean(data.ok), model: data.model || null });
  } catch {
    return Response.json({ ok: false, model: null });
  } finally {
    clearTimeout(timer);
  }
}

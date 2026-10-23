import { endSession, jsonError } from '@/lib/server/play';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    await endSession(String(body.session || ''));
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

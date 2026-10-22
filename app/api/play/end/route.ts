import { anonDb, jsonError } from '@/lib/server/play';
import { serverEnv } from '@/lib/server-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const session = String(body.session || '');
    if (/^[0-9a-f-]{36}$/.test(session) && serverEnv.playToken) {
      await anonDb().rpc('play_session_end', { p_token: serverEnv.playToken, p_session: session });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

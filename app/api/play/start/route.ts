import { z } from 'zod';
import { anonDb, ipHash, jsonError, playError, rateLimit, requirePlayConfig, PlayError } from '@/lib/server/play';
import { serverEnv } from '@/lib/server-env';
import { readOwnerKey } from '@/lib/server/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ slug: z.string().regex(/^[a-f0-9]{14}$/) });

export async function POST(req: Request) {
  try {
    requirePlayConfig();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new PlayError('Unknown persona link.', 404);
    const ip = ipHash(req);
    if (!(await rateLimit(`start:${ip}`, 10, 600))) throw new PlayError('Too many calls started. Wait a few minutes.', 429);

    const db = anonDb();
    const { data, error } = await db.rpc('play_session_start', {
      p_token: serverEnv.playToken, p_slug: parsed.data.slug, p_ip_hash: ip, p_owner_key: await readOwnerKey(),
    });
    if (error) throw playError(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return Response.json({ sessionId: row.session_id, allowedSeconds: row.allowed_seconds });
  } catch (e) {
    return jsonError(e);
  }
}

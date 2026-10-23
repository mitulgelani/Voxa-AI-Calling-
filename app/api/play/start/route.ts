import { z } from 'zod';
import { ipHash, jsonError, rateLimit, requirePlayConfig, startSession, PlayError } from '@/lib/server/play';
import { readOwnerKey } from '@/lib/server/owner';
import { personaBySlug } from '@/lib/server/playstore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ slug: z.string().regex(/^[a-f0-9]{14}$/) });

export async function POST(req: Request) {
  try {
    const mode = requirePlayConfig();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new PlayError('Unknown persona link.', 404);
    const ip = ipHash(req);
    if (!(await rateLimit(`start:${ip}`, 10, 600))) throw new PlayError('Too many calls started. Wait a few minutes.', 429);
    const ownerKey = await readOwnerKey();
    // The database checks persona visibility itself; in blob mode we check it here.
    if (mode === 'blob' && !(await personaBySlug(parsed.data.slug, ownerKey))) {
      throw new PlayError('This persona does not exist or is private.', 404);
    }
    return Response.json(await startSession(parsed.data.slug, ip, ownerKey));
  } catch (e) {
    return jsonError(e);
  }
}

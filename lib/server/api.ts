import 'server-only';
import { anonDb, ipHash, rateLimit } from './play';

/** Shared plumbing for /api/v1: bearer key, rate limit, consistent JSON errors. */
export async function apiCall(req: Request, run: (key: string, db: ReturnType<typeof anonDb>) => Promise<Response>): Promise<Response> {
  const key = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!key) return err(401, 'missing_key', 'Send your API key as: Authorization: Bearer vd_live_…');
  if (!(await rateLimit(`api:${key.slice(0, 20)}`, 600, 60)) || !(await rateLimit(`apiip:${ipHash(req)}`, 1200, 60))) return err(429, 'rate_limited', 'Too many requests. The limit is 600 per minute per key.');
  try {
    return await run(key, anonDb());
  } catch (e) {
    return fromDb(e as { code?: string; message?: string });
  }
}

export function fromDb(e: { code?: string; message?: string } | null) {
  const code = e?.code;
  if (code === '28000') return err(401, 'invalid_key', 'The API key is invalid or revoked.');
  if (code === '42501') return err(403, 'forbidden', e?.message ?? 'This key lacks the needed permission.');
  if (code === 'P0002') return err(404, 'not_found', 'Not found.');
  if (code === '22023' || code === '22P02' || code === '22007') return err(400, 'invalid_request', e?.message ?? 'Invalid request.');
  return err(500, 'server_error', 'Something went wrong.');
}

export const err = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
export const ok = (data: unknown) => Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });

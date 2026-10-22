import 'server-only';
import { cookies } from 'next/headers';

export const OWNER_COOKIE = 'vd_owner';

/** The playground owner key from this browser's HttpOnly cookie, if it has one. */
export async function readOwnerKey(): Promise<string | null> {
  const v = (await cookies()).get(OWNER_COOKIE)?.value;
  return v && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null;
}

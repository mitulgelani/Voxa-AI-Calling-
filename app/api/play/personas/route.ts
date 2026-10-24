import crypto from 'crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { ipHash, jsonError, PlayError, rateLimit, requirePlayConfig } from '@/lib/server/play';
import { deletePersona, myPersonas, savePersona } from '@/lib/server/playstore';
import { LANGUAGES } from '@/lib/voice/languages';
import { VOICE_IDS } from '@/lib/voice/voices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // saving builds the persona's brief with the AI (a few seconds)

const COOKIE = 'vd_owner';

async function ownerKey(create: boolean): Promise<string | null> {
  const store = await cookies();
  const existing = store.get(COOKIE)?.value;
  if (existing && /^[A-Za-z0-9_-]{43}$/.test(existing)) return existing;
  if (!create) return null;
  const key = crypto.randomBytes(32).toString('base64url');
  store.set(COOKIE, key, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 400 });
  return key;
}

const Persona = z.object({
  slug: z.string().regex(/^[a-f0-9]{14}$/).optional(),
  name: z.string().trim().min(1).max(40),
  tagline: z.string().trim().max(120).default(''),
  description: z.string().trim().min(20, 'Describe the personality in at least 20 characters.').max(2000),
  greeting: z.string().trim().max(300).default(''),
  language: z.string().refine((l) => LANGUAGES.some((x) => x.id === l), 'Unknown language'),
  voice: z.string().refine((v) => VOICE_IDS.has(v), 'Unknown voice'),
  rate: z.enum(['-8%', '+0%', '+8%']).default('+0%'),
  visibility: z.enum(['unlisted', 'private']).default('unlisted'),
  accent: z.enum(['saffron', 'teal', 'violet', 'rose', 'sky', 'lime']).default('saffron'),
});

export async function GET() {
  try {
    requirePlayConfig();
    const key = await ownerKey(false);
    if (!key) return Response.json({ personas: [] });
    return Response.json({ personas: await myPersonas(key) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    requirePlayConfig();
    const parsed = Persona.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new PlayError(parsed.error.issues[0]?.message || 'Check the form.', 400);
    if (!(await rateLimit(`persona:${ipHash(req)}`, 20, 3600))) throw new PlayError('Too many saves. Try again later.', 429);
    const p = parsed.data;
    const key = await ownerKey(true);
    const slug = await savePersona(key!, p);
    return Response.json({ slug });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    requirePlayConfig();
    const slug = new URL(req.url).searchParams.get('slug') || '';
    const key = await ownerKey(false);
    if (!key || !/^[a-f0-9]{14}$/.test(slug)) throw new PlayError('Not found.', 404);
    await deletePersona(key, slug);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

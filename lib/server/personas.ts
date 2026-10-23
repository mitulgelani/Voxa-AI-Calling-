import 'server-only';
import { readOwnerKey } from './owner';
import { personaBySlug, showcase } from './playstore';

export type { PublicPersona, ShowcasePersona } from './playstore';

export async function getPersona(slug: string) {
  return personaBySlug(slug, await readOwnerKey()).catch((e) => {
    console.error('[play] persona lookup', e);
    return null;
  });
}

export async function getShowcase(limit = 8) {
  return showcase(limit).catch(() => []);
}

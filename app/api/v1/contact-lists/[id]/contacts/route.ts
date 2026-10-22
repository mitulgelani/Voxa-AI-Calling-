import { z } from 'zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { apiCall, err, fromDb, ok } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

const Body = z.object({
  contacts: z.array(z.object({
    phone: z.string().min(6).max(20),
    name: z.string().max(120).optional(),
    language: z.enum(['hinglish', 'hi-IN', 'gu-IN', 'en-IN', 'en-US']).optional(),
    consent_source: z.string().max(200).optional(),
    consent_at: z.string().datetime({ offset: true }).optional(),
    attributes: z.record(z.string().max(40), z.string().max(200)).optional(),
  })).min(1).max(1000),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return apiCall(req, async (key, db) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) return err(404, 'not_found', 'Not found.');
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return err(400, 'invalid_request', parsed.error.issues[0].path.join('.') + ': ' + parsed.error.issues[0].message);
    const invalid: number[] = [];
    const rows = parsed.data.contacts.flatMap((c, i) => {
      const p = parsePhoneNumberFromString(c.phone);
      if (!p?.isValid()) { invalid.push(i); return []; }
      return [{ ...c, phone: p.number }];
    });
    const { data, error } = await db.rpc('api_add_contacts', { p_key: key, p_list: id, p_rows: rows });
    if (error) return fromDb(error);
    return ok({ ...(data as object), invalid_indexes: invalid });
  });
}

import { apiCall, err, fromDb, ok } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return apiCall(req, async (key, db) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) return err(404, 'not_found', 'Not found.');
    const { data, error } = await db.rpc('api_get_call', { p_key: key, p_call: id });
    return error ? fromDb(error) : ok(data);
  });
}

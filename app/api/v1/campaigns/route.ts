import { apiCall, fromDb, ok } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return apiCall(req, async (key, db) => {
    const { data, error } = await db.rpc('api_list_campaigns', { p_key: key });
    return error ? fromDb(error) : ok(data);
  });
}

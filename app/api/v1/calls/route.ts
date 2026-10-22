import { apiCall, err, fromDb, ok } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return apiCall(req, async (key, db) => {
    const u = new URL(req.url);
    const campaign = u.searchParams.get('campaign_id');
    const before = u.searchParams.get('before');
    const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') ?? 50) || 50));
    if (campaign && !/^[0-9a-f-]{36}$/.test(campaign)) return err(400, 'invalid_request', 'campaign_id must be a UUID.');
    if (before && Number.isNaN(Date.parse(before))) return err(400, 'invalid_request', 'before must be an ISO timestamp.');
    const { data, error } = await db.rpc('api_list_calls', { p_key: key, p_campaign: campaign, p_after: before, p_limit: limit });
    if (error) return fromDb(error);
    const rows = (data ?? []) as { created_at: string }[];
    return Response.json({ data: rows, next_before: rows.length === limit ? rows[rows.length - 1].created_at : null }, { headers: { 'Cache-Control': 'no-store' } });
  });
}

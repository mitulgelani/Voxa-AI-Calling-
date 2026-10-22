import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { log } from './log.js';
import { carriers } from './carriers/index.js';

/** Verify caller IDs: a number is verified only when the carrier confirms it is in the account. */
export async function verifyNumbers() {
  const { data } = await db.from('phone_numbers').select('id, e164, carrier').is('verified_at', null).limit(50);
  for (const n of data ?? []) {
    const carrier = carriers[n.carrier as 'plivo' | 'telnyx'];
    if (!carrier?.configured()) continue;
    try {
      if (await carrier.owns(n.e164)) {
        await db.from('phone_numbers').update({ verified_at: new Date().toISOString() }).eq('id', n.id);
        log('info', 'caller id verified', { id: n.id });
      }
    } catch (e) { log('warn', 'verify failed', { id: n.id, err: String(e) }); }
  }
}

/** Delete recordings older than each organisation's retention period. Transcripts and answers stay. */
export async function purgeRecordings() {
  const { data: orgs } = await db.from('organizations').select('id, recording_retention_days');
  for (const o of orgs ?? []) {
    const before = new Date(Date.now() - o.recording_retention_days * 864e5).toISOString();
    for (;;) {
      const { data: calls } = await db.from('calls').select('id, recording_path').eq('org_id', o.id).not('recording_path', 'is', null).lt('ended_at', before).limit(100);
      if (!calls?.length) break;
      const { error } = await db.storage.from('recordings').remove(calls.map((c) => c.recording_path as string));
      if (error) { log('warn', 'purge failed', { org: o.id, err: error.message }); break; }
      await db.from('calls').update({ recording_path: null }).in('id', calls.map((c) => c.id));
      log('info', 'recordings purged', { org: o.id, count: calls.length });
    }
  }
}

function unseal(sealed: string): string {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1') throw new Error('unknown sealing version');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config.webhookKey, 'hex'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}

/**
 * Deliver queued webhooks. Signature: VaniDial-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">.
 * Receivers should reject timestamps older than five minutes.
 */
export async function deliverWebhooks() {
  if (!config.webhookKey) return;
  const { data } = await db.rpc('claim_webhook_deliveries', { p_limit: 20 });
  for (const d of (data ?? []) as { id: number; event: string; payload: unknown; url: string; secret_enc: string }[]) {
    let status = 0;
    try {
      const body = JSON.stringify({ id: `evt_${d.id}`, type: d.event, created_at: new Date().toISOString(), data: d.payload });
      const t = Math.floor(Date.now() / 1000);
      const sig = crypto.createHmac('sha256', unseal(d.secret_enc)).update(`${t}.${body}`).digest('hex');
      const res = await fetch(d.url, { method: 'POST', redirect: 'manual', body, headers: { 'Content-Type': 'application/json', 'User-Agent': 'VaniDial-Webhooks/1', 'VaniDial-Signature': `t=${t},v1=${sig}` }, signal: AbortSignal.timeout(10000) });
      status = res.status;
    } catch { status = 0; }
    await db.from('webhook_deliveries').update({ last_status: status, ...(status >= 200 && status < 300 ? { delivered_at: new Date().toISOString() } : {}) }).eq('id', d.id);
  }
}

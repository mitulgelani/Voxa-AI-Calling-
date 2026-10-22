import { db } from './db.js';
import { config } from './config.js';
import { log, mask } from './log.js';
import { carriers } from './carriers/index.js';
import { signCall } from './token.js';
import { live } from './session.js';
import { finishUnanswered } from './post.js';

/** Calls dialled but not yet streaming, so pacing counts them too. */
export const ringing = new Map<string, { campaignId: string; at: number }>();
const recentDials = new Map<string, number[]>();

async function release(jobId: string) {
  await db.from('call_jobs').update({ state: 'pending', claimed_at: null }).eq('id', jobId);
}

/**
 * One dialler pass. The database decides who may be called (claim_call_jobs re-checks DNC, hours,
 * budget and the 7-day frequency cap at this instant); this loop only enforces pace and capacity.
 */
export async function dialOnce() {
  for (const [id, r] of ringing) if (Date.now() - r.at > 90_000) ringing.delete(id);
  const free = config.maxLiveCalls - live.size - ringing.size;
  if (free <= 0) return;
  const { data: jobs, error } = await db.rpc('claim_call_jobs', { p_limit: Math.min(free, 10) });
  if (error) { log('warn', 'claim failed', { err: error.message }); return; }
  for (const job of (jobs ?? []) as { id: string; org_id: string; campaign_id: string; contact_id: string; attempt: number }[]) {
    try {
      const { data: c } = await db.from('campaigns').select('status, max_concurrent, dials_per_minute, phone_number_id').eq('id', job.campaign_id).maybeSingle();
      if (!c || c.status !== 'running') { await db.from('call_jobs').update({ state: 'skipped', skip_reason: 'campaign_not_running' }).eq('id', job.id); continue; }
      const active = [...live.values()].filter((s) => s.campaignId === job.campaign_id).length
        + [...ringing.values()].filter((r) => r.campaignId === job.campaign_id).length;
      const window = (recentDials.get(job.campaign_id) ?? []).filter((t) => Date.now() - t < 60_000);
      if (active >= c.max_concurrent || window.length >= c.dials_per_minute) { await release(job.id); continue; }

      const [{ data: num }, { data: contact }] = await Promise.all([
        db.from('phone_numbers').select('e164, carrier, verified_at').eq('id', c.phone_number_id).maybeSingle(),
        db.from('contacts').select('e164').eq('id', job.contact_id).maybeSingle(),
      ]);
      if (!num?.verified_at || !contact) { await db.from('call_jobs').update({ state: 'skipped', skip_reason: 'number_or_contact_missing' }).eq('id', job.id); continue; }
      const carrier = carriers[num.carrier as 'plivo' | 'telnyx'];
      if (!carrier?.configured()) { await release(job.id); log('warn', 'carrier not configured', { carrier: num.carrier }); continue; }

      // The calls table refuses numbers on the do-not-call list (trigger), as a last line of defence.
      const { data: call, error: insErr } = await db.from('calls').insert({
        org_id: job.org_id, campaign_id: job.campaign_id, contact_id: job.contact_id, job_id: job.id,
        to_e164: contact.e164, from_e164: num.e164, carrier: num.carrier, status: 'dialing', started_at: new Date().toISOString(),
      }).select('id').single();
      if (insErr || !call) { await db.from('call_jobs').update({ state: 'skipped', skip_reason: insErr?.message.includes('do-not-call') ? 'dnc' : 'insert_failed' }).eq('id', job.id); continue; }

      window.push(Date.now());
      recentDials.set(job.campaign_id, window);
      ringing.set(call.id, { campaignId: job.campaign_id, at: Date.now() });
      try {
        const carrierCallId = await carrier.dial({ callId: call.id, token: signCall(call.id), from: num.e164, to: contact.e164 });
        await db.from('calls').update({ carrier_call_id: carrierCallId, status: 'ringing' }).eq('id', call.id);
        await db.from('call_jobs').update({ state: 'done' }).eq('id', job.id);
        log('info', 'dialled', { call: call.id, to: mask(contact.e164), carrier: carrier.name });
      } catch (e) {
        ringing.delete(call.id);
        await db.from('call_jobs').update({ state: 'done' }).eq('id', job.id);
        await finishUnanswered(call.id, 'failed');
        log('warn', 'dial failed', { call: call.id, err: String(e) });
      }
    } catch (e) {
      log('error', 'job failed', { job: job.id, err: String(e) });
      await release(job.id).catch(() => undefined);
    }
  }
}

/** Running campaigns with nothing left to do become completed. */
export async function completeFinished() {
  const { data: running } = await db.from('campaigns').select('id, org_id').eq('status', 'running');
  for (const c of running ?? []) {
    const { count } = await db.from('call_jobs').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).in('state', ['pending', 'claimed']);
    const busy = [...ringing.values()].some((r) => r.campaignId === c.id);
    if (!count && !busy) {
      await db.from('campaigns').update({ status: 'completed' }).eq('id', c.id).eq('status', 'running');
      await db.rpc('enqueue_webhook', { p_org: c.org_id, p_event: 'campaign.finished', p_payload: { campaign_id: c.id } });
    }
  }
}

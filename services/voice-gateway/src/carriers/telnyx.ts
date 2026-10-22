import crypto from 'node:crypto';
import { config } from '../config.js';
import type { Carrier, DialRequest, MediaLink } from './types.js';

const H = () => ({ Authorization: `Bearer ${config.telnyx.apiKey}`, 'Content-Type': 'application/json' });

export const telnyx: Carrier = {
  name: 'telnyx',
  configured: () => Boolean(config.telnyx.apiKey && config.telnyx.connectionId),
  async dial({ callId, token, from, to }: DialRequest) {
    const q = `c=${encodeURIComponent(token)}`;
    const res = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST', headers: H(),
      body: JSON.stringify({
        connection_id: config.telnyx.connectionId, to, from, timeout_secs: 30, time_limit_secs: config.maxCallSeconds + 30,
        webhook_url: `${config.publicUrl}/telnyx/webhook?${q}`, webhook_url_method: 'POST',
        client_state: Buffer.from(callId).toString('base64'),
        answering_machine_detection: 'detect',
        stream_url: `${config.publicUrl.replace(/^http/, 'ws')}/media/telnyx?${q}`, stream_track: 'inbound_track',
        stream_bidirectional_mode: 'rtp', stream_bidirectional_codec: 'PCMU',
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: { call_control_id?: string }; errors?: { detail?: string }[] };
    if (!res.ok || !body.data?.call_control_id) throw new Error(`telnyx dial ${res.status}: ${body.errors?.[0]?.detail ?? 'no call id'}`);
    return body.data.call_control_id;
  },
  async hangup(id: string) {
    await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(id)}/actions/hangup`, { method: 'POST', headers: H(), body: '{}', signal: AbortSignal.timeout(8000) }).catch(() => undefined);
  },
  async owns(e164: string) {
    const res = await fetch(`https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(e164)}`, { headers: H(), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const d = (await res.json()) as { data?: unknown[] };
    return (d.data?.length ?? 0) > 0;
  },
};

/** Telnyx signs webhooks with Ed25519 over "<timestamp>|<raw body>". Reject stale or forged events. */
export function verifyTelnyx(raw: string, signature: string | undefined, timestamp: string | undefined): boolean {
  if (!config.telnyx.publicKey) return true; // per-call HMAC token in the URL still authenticates the request
  if (!signature || !timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  try {
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(config.telnyx.publicKey, 'base64')]);
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(`${timestamp}|${raw}`), key, Buffer.from(signature, 'base64'));
  } catch { return false; }
}

export function telnyxLink(): MediaLink {
  return {
    parse(msg: string) {
      const m = JSON.parse(msg) as { event: string; start?: { call_control_id?: string }; media?: { payload?: string; track?: string } };
      if (m.event === 'start') return { kind: 'start', carrierCallId: m.start?.call_control_id };
      if (m.event === 'media' && m.media?.payload && (m.media.track ?? 'inbound') === 'inbound') return { kind: 'media', audio: Buffer.from(m.media.payload, 'base64') };
      if (m.event === 'stop') return { kind: 'stop' };
      return { kind: 'other' };
    },
    play(mulaw: Buffer) {
      const out: string[] = [];
      for (let i = 0; i < mulaw.length; i += 8000 * 2) out.push(JSON.stringify({ event: 'media', media: { payload: mulaw.subarray(i, i + 16000).toString('base64') } }));
      return out;
    },
    clear() { return JSON.stringify({ event: 'clear' }); },
  };
}

export function telnyxOutcome(cause: string, amd?: string): 'no_answer' | 'busy' | 'failed' | 'voicemail' | null {
  if (amd === 'machine') return 'voicemail';
  if (cause === 'user_busy') return 'busy';
  if (cause === 'timeout' || cause === 'no_answer' || cause === 'originator_cancel') return 'no_answer';
  if (cause === 'call_rejected' || cause === 'unallocated_number' || cause === 'destination_out_of_order') return 'failed';
  return null;
}

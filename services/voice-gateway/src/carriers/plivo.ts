import { config } from '../config.js';
import type { Carrier, DialRequest, MediaLink } from './types.js';

const api = (path: string) => `https://api.plivo.com/v1/Account/${config.plivo.authId}${path}`;
const auth = () => 'Basic ' + Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');

export const plivo: Carrier = {
  name: 'plivo',
  configured: () => Boolean(config.plivo.authId && config.plivo.authToken),
  async dial({ token, from, to }: DialRequest) {
    const q = `c=${encodeURIComponent(token)}`;
    const res = await fetch(api('/Call/'), {
      method: 'POST',
      headers: { Authorization: auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: from.replace('+', ''), to: to.replace('+', ''),
        answer_url: `${config.publicUrl}/plivo/answer?${q}`, answer_method: 'POST',
        hangup_url: `${config.publicUrl}/plivo/hangup?${q}`, hangup_method: 'POST',
        ring_timeout: 30, time_limit: config.maxCallSeconds + 30,
        machine_detection: 'true', machine_detection_url: `${config.publicUrl}/plivo/machine?${q}`, machine_detection_method: 'POST',
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = (await res.json().catch(() => ({}))) as { request_uuid?: string; error?: string };
    if (!res.ok || !body.request_uuid) throw new Error(`plivo dial ${res.status}: ${body.error ?? 'no request id'}`);
    return body.request_uuid;
  },
  async hangup(id: string) {
    await fetch(api(`/Call/${encodeURIComponent(id)}/`), { method: 'DELETE', headers: { Authorization: auth() }, signal: AbortSignal.timeout(8000) }).catch(() => undefined);
  },
  async owns(e164: string) {
    const res = await fetch(api(`/Number/${e164.replace('+', '')}/`), { headers: { Authorization: auth() }, signal: AbortSignal.timeout(8000) });
    return res.ok;
  },
};

/** XML returned to the answer URL: open a two-way µ-law stream to our media socket. */
export function plivoAnswerXml(token: string): string {
  const url = `${config.publicUrl.replace(/^http/, 'ws')}/media/plivo?c=${encodeURIComponent(token)}`.replace(/&/g, '&amp;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">${url}</Stream></Response>`;
}

export function plivoLink(): MediaLink & { streamId: string } {
  const link = {
    streamId: '',
    parse(msg: string) {
      const m = JSON.parse(msg) as { event: string; streamId?: string; start?: { callId?: string; streamId?: string }; media?: { payload?: string; track?: string } };
      if (m.event === 'start') { link.streamId = m.start?.streamId ?? m.streamId ?? ''; return { kind: 'start' as const, carrierCallId: m.start?.callId }; }
      if (m.event === 'media' && m.media?.payload && (m.media.track ?? 'inbound') === 'inbound') return { kind: 'media' as const, audio: Buffer.from(m.media.payload, 'base64') };
      if (m.event === 'stop') return { kind: 'stop' as const };
      return { kind: 'other' as const };
    },
    play(mulaw: Buffer) {
      const out: string[] = [];
      for (let i = 0; i < mulaw.length; i += 8000 * 2) {
        out.push(JSON.stringify({ event: 'playAudio', media: { contentType: 'audio/x-mulaw', sampleRate: 8000, payload: mulaw.subarray(i, i + 16000).toString('base64') } }));
      }
      return out;
    },
    clear() { return JSON.stringify({ event: 'clearAudio', streamId: link.streamId }); },
  };
  return link;
}

/** Plivo hangup causes → our outcomes, for calls that never reached the media stream. */
export function plivoOutcome(form: URLSearchParams): 'no_answer' | 'busy' | 'failed' | 'voicemail' | null {
  const cause = (form.get('HangupCause') ?? form.get('HangupCauseName') ?? '').toLowerCase();
  const status = (form.get('CallStatus') ?? '').toLowerCase();
  if (status === 'busy' || cause.includes('busy')) return 'busy';
  if (status === 'no-answer' || cause.includes('no answer') || cause.includes('timeout')) return 'no_answer';
  if (cause.includes('machine')) return 'voicemail';
  if (status === 'failed' || cause.includes('invalid') || cause.includes('unallocated')) return 'failed';
  return null;
}

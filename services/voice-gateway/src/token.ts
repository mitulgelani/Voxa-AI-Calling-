import crypto from 'node:crypto';
import { config } from './config.js';

/** Short-lived HMAC token naming one call; carriers present it on answer URLs and media sockets. */
export function signCall(callId: string, ttlSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = `${callId}.${exp}`;
  const mac = crypto.createHmac('sha256', config.gatewaySecret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyCall(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [callId, exp, mac] = parts;
  if (!/^[0-9a-f-]{36}$/.test(callId) || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return null;
  const want = crypto.createHmac('sha256', config.gatewaySecret).update(`${callId}.${exp}`).digest();
  const got = Buffer.from(mac, 'base64url');
  return got.length === want.length && crypto.timingSafeEqual(got, want) ? callId : null;
}

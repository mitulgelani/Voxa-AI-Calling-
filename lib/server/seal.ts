import 'server-only';
import crypto from 'crypto';
import { serverEnv } from '@/lib/server-env';

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, base64url parts. */
export function seal(plain: string): string {
  const key = Buffer.from(serverEnv.webhookKey, 'hex');
  if (key.length !== 32) throw new Error('WEBHOOK_KEY must be 64 hex characters');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes: number, enc: 'hex' | 'base64url' = 'base64url') => crypto.randomBytes(bytes).toString(enc);

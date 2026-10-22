import 'server-only';

function opt(name: string): string {
  return process.env[name] ?? '';
}

export const serverEnv = {
  playToken: opt('PLAY_SERVER_TOKEN'),
  ipHashSecret: opt('IP_HASH_SECRET') || opt('PLAY_SERVER_TOKEN'),
  openrouterKey: opt('OPENROUTER_API_KEY'),
  kieKey: opt('KIE_API_KEY'),
  groqKey: opt('GROQ_API_KEY'),
  /** 32-byte hex key that encrypts webhook signing secrets at rest; the gateway holds the same key. */
  webhookKey: opt('WEBHOOK_KEY'),
  siteUrl: opt('NEXT_PUBLIC_SITE_URL') || 'http://localhost:3000',
};

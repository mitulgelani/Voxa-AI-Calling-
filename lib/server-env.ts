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
};

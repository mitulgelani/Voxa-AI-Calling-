function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}
const opt = (name: string, fallback = '') => process.env[name] ?? fallback;

export const config = {
  port: Number(opt('PORT', '8080')),
  publicUrl: need('PUBLIC_URL').replace(/\/$/, ''),
  supabaseUrl: need('SUPABASE_URL'),
  serviceKey: need('SUPABASE_SERVICE_ROLE_KEY'),
  gatewaySecret: need('GATEWAY_SECRET'),
  webhookKey: opt('WEBHOOK_KEY'),
  plivo: { authId: opt('PLIVO_AUTH_ID'), authToken: opt('PLIVO_AUTH_TOKEN') },
  telnyx: { apiKey: opt('TELNYX_API_KEY'), connectionId: opt('TELNYX_CONNECTION_ID'), publicKey: opt('TELNYX_PUBLIC_KEY') },
  sarvam: { key: opt('SARVAM_API_KEY'), ttsModel: opt('SARVAM_TTS_MODEL', 'bulbul:v4-flash'), female: opt('SARVAM_SPEAKER_FEMALE'), male: opt('SARVAM_SPEAKER_MALE') },
  groqKey: opt('GROQ_API_KEY'),
  openrouterKey: opt('OPENROUTER_API_KEY'),
  ttsProvider: (opt('TTS_PROVIDER') || (opt('SARVAM_API_KEY') ? 'sarvam' : 'edge')) as 'sarvam' | 'edge',
  maxLiveCalls: Number(opt('MAX_LIVE_CALLS', '40')),
  maxCallSeconds: 360,
};

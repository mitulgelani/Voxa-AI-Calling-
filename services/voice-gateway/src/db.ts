import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

/** Service-role client. Bypasses RLS, so every query here filters by ids it already trusts. */
export const db = createClient(config.supabaseUrl, config.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

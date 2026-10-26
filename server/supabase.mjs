import { createClient } from '@supabase/supabase-js';
import { config } from './config.mjs';

// Service-role client: bypasses RLS. Only ever used server-side, after the caller is verified.
export const admin = config.supabaseUrl && config.supabaseServiceKey
  ? createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// Resolves the signed-in user from the `Authorization: Bearer <access token>` header.
export async function userFromRequest(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !admin) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

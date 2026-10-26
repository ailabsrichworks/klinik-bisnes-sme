// All runtime settings come from environment variables (see .env.example).
const env = process.env;

const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);

export const config = {
  port: int(env.PORT, 3000),
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  canonicalHost: env.CANONICAL_HOST || '',

  supabaseUrl: env.SUPABASE_URL || '',
  supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
  supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',

  anthropicKey: env.ANTHROPIC_API_KEY || '',
  claudeModel: env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  claudeEffort: env.CLAUDE_EFFORT || 'medium',

  // Per participant per day, and across the whole site per day (cost guard).
  // Anonymous participants are free to create, so the per-user cap is low; the global cap is the real guard.
  dailyAiLimitPerUser: int(env.DAILY_AI_LIMIT_PER_USER, 3),
  dailyAiLimitGlobal: int(env.DAILY_AI_LIMIT_GLOBAL, 400),

  // Optional Cloudflare Turnstile. The secret key goes in Supabase Auth (captcha protection), not here.
  turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',

  // Bump when the privacy notice text changes; consents are recorded against it.
  noticeVersion: env.NOTICE_VERSION || '2026-10-v2',
};

export function missingConfig() {
  const required = ['supabaseUrl', 'supabaseAnonKey', 'supabaseServiceKey', 'anthropicKey'];
  return required.filter((k) => !config[k]);
}

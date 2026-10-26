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

  // Optional daily caps per participant and across the whole site; 0 or unset = no limit.
  // With no caps, the Anthropic console spend limit is the only cost guard.
  dailyAiLimitPerUser: int(env.DAILY_AI_LIMIT_PER_USER, 0),
  dailyAiLimitGlobal: int(env.DAILY_AI_LIMIT_GLOBAL, 0),

  resendKey: env.RESEND_API_KEY || '',
  emailFrom: env.EMAIL_FROM || '',

  // Bump when the privacy notice text changes; consents are recorded against it.
  noticeVersion: env.NOTICE_VERSION || '2026-10-v2',
};

export function missingConfig() {
  const required = ['supabaseUrl', 'supabaseAnonKey', 'supabaseServiceKey', 'anthropicKey'];
  return required.filter((k) => !config[k]);
}

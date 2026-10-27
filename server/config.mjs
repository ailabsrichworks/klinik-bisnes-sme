// All runtime settings come from environment variables (see .env.example).
const env = process.env;

const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);

export const config = {
  port: int(env.PORT, 3000),
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  canonicalHost: env.CANONICAL_HOST || '',

  // Google service account key (the JSON file's text, or base64 of it), the Sheet and the Shared Drive folder.
  googleServiceAccount: env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  sheetId: env.SHEET_ID || '',
  driveFolderId: env.DRIVE_FOLDER_ID || '',

  anthropicKey: env.ANTHROPIC_API_KEY || '',
  claudeModel: env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  claudeEffort: env.CLAUDE_EFFORT || 'medium',

  // Optional daily caps (rolling 24 hours); 0 or unset = no limit.
  // With no caps, the Anthropic console spend limit is the only cost guard.
  dailyAiLimitPerUser: int(env.DAILY_AI_LIMIT_PER_USER, 0),
  dailyAiLimitPerIp: int(env.DAILY_AI_LIMIT_PER_IP, 0),
  dailyAiLimitGlobal: int(env.DAILY_AI_LIMIT_GLOBAL, 0),

  // Bump when the privacy notice text changes; participants are asked to accept again.
  noticeVersion: env.NOTICE_VERSION || '2026-10-v3',
};

export const googleReady = () => Boolean(config.googleServiceAccount && config.sheetId && config.driveFolderId);

export function missingConfig() {
  const required = ['googleServiceAccount', 'sheetId', 'driveFolderId', 'anthropicKey'];
  return required.filter((k) => !config[k]);
}

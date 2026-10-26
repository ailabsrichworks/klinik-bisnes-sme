import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, missingConfig } from './config.mjs';
import { admin, userFromRequest } from './supabase.mjs';
import { diagnose, limitReached, DiagnoseError } from './diagnose.mjs';
import { startReminderLoop } from './reminders.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const missing = missingConfig();
if (missing.length) console.warn(`[config] missing: ${missing.join(', ')} — sign-in and AI will not work until these are set.`);

// ─── security headers ───
const supabaseOrigin = config.supabaseUrl ? new URL(config.supabaseUrl).origin : '';
const csp = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace('https://', 'wss://')}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

app.use((req, res, next) => {
  if (config.canonicalHost && req.hostname !== config.canonicalHost && req.path !== '/healthz') {
    return res.redirect(301, `https://${config.canonicalHost}${req.originalUrl}`);
  }
  res.set({
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// ─── small in-memory per-IP limiter for the API (blunts scripted abuse) ───
const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();
function ipLimit(max) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > max) return res.status(429).json({ error: 'Terlalu banyak permintaan. Cuba semula sebentar lagi.' });
    next();
  };
}

// Reject cross-site API calls. Tokens are sent as a header (no cookies), so this is defence in depth.
function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();
  const allowed = new Set([config.publicUrl, `${req.protocol}://${req.get('host')}`].filter(Boolean));
  if (!allowed.has(origin)) return res.status(403).json({ error: 'Origin tidak dibenarkan.' });
  next();
}

async function requireUser(req, res, next) {
  const user = await userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sila log masuk semula.' });
  req.user = user;
  next();
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Public values the browser needs to start Supabase Auth. The anon key is designed to be public;
// RLS policies in supabase/migrations protect the data.
app.get('/api/config', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    noticeVersion: config.noticeVersion,
    aiReady: Boolean(config.anthropicKey),
  });
});

app.post('/api/diagnose', sameOrigin, ipLimit(20), express.json({ limit: '64kb' }), requireUser, async (req, res) => {
  try {
    const limit = await limitReached(req.user.id);
    if (limit) return res.status(429).json({ error: limit });
    const result = await diagnose({ userId: req.user.id, body: req.body || {} });
    res.json(result);
  } catch (err) {
    if (err instanceof DiagnoseError) return res.status(err.status).json({ error: err.message });
    console.error('[diagnose] unexpected', err);
    res.status(500).json({ error: 'Ralat server. Cuba semula.' });
  }
});

// "Delete my data": removes uploaded files, then the auth user (rows cascade from profiles).
app.delete('/api/me', sameOrigin, ipLimit(5), requireUser, async (req, res) => {
  const uid = req.user.id;
  try {
    const { data: files } = await admin.storage.from('evidence').list(uid, { limit: 1000 });
    if (files?.length) await admin.storage.from('evidence').remove(files.map((f) => `${uid}/${f.name}`));
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    console.error('[delete-me]', err);
    res.status(500).json({ error: 'Data gagal dipadam. Hubungi penganjur.' });
  }
});

app.use(express.static(publicDir, { extensions: ['html'], maxAge: '1h' }));
app.use((_req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));

app.listen(config.port, () => {
  console.log(`KBSME Quick Fix listening on :${config.port}`);
  startReminderLoop();
});

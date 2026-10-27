import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { diagnose, limitReached, countIp, DiagnoseError } from './diagnose.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const MAX_FILE = 4 * 1024 * 1024;
const STATE_MAX = 60_000; // characters of JSON; the sheet cell limit is 50,000 and evidence text is capped at 9,500

// Checks the file's first bytes, not just the name the browser sent.
function sniff(bytes, name) {
  const head = bytes.subarray(0, 12);
  if (head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (head.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  if (/\.(txt|csv)$/i.test(name) && !bytes.includes(0)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
    return /\.csv$/i.test(name) ? 'text/csv' : 'text/plain';
  }
  return null;
}

// What the browser gets back: its own state and consent, never the token hash or the Drive link.
const view = (j, store) => ({
  id: j.id,
  state: j.state,
  step: j.step,
  consent: { privacyVersion: j.consent.privacyVersion || null, marketing: !!j.consent.marketing },
  evidenceFile: j.evidence ? { name: j.evidence.name, size: j.evidence.size, at: j.evidence.at } : null,
  session: j.sessionCode ? store.sessionByCode(j.sessionCode) || { code: j.sessionCode, name: j.sessionCode } : null,
  createdAt: j.createdAt,
});

export function createApp({ store }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

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

  // ─── small in-memory per-IP limiter (blunts scripted abuse). Limits allow a whole class on one venue Wi-Fi. ───
  const hits = new Map();
  setInterval(() => hits.clear(), 60_000).unref();
  const ipLimit = (max) => (req, res, next) => {
    const key = `${req.ip}:${req.method}:${req.path}`;
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > max) return res.status(429).json({ error: 'Terlalu banyak permintaan. Cuba semula sebentar lagi.' });
    next();
  };

  // Reject cross-site API calls (the participant key travels in headers, so this is defence in depth).
  const sameOrigin = (req, res, next) => {
    const origin = req.get('origin');
    if (!origin) return next();
    const allowed = new Set([config.publicUrl, `${req.protocol}://${req.get('host')}`].filter(Boolean));
    if (!allowed.has(origin)) return res.status(403).json({ error: 'Origin tidak dibenarkan.' });
    next();
  };

  // Participant identity: a random journey id + secret token kept in the browser. No login.
  const requireJourney = (req, res, next) => {
    const j = store.verify(req.get('x-journey-id'), req.get('x-journey-token'));
    if (!j) return res.status(401).json({ error: 'Sesi anda tidak dijumpai. Muat semula halaman untuk mula semula.' });
    req.journey = j;
    next();
  };

  const json = express.json({ limit: '128kb' });
  const api = express.Router();
  api.use(sameOrigin);

  api.get('/config', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ noticeVersion: config.noticeVersion, aiReady: Boolean(config.anthropicKey) });
  });

  // Session code lookup for facilitator links (/?c=CODE). The code is optional.
  api.get('/session/:code', ipLimit(30), (req, res) => {
    const s = store.sessionByCode(req.params.code);
    if (!s) return res.status(404).json({ error: 'Kod sesi ini tidak sah.' });
    res.json(s);
  });

  // Starts a journey once the participant accepts the privacy notice.
  api.post('/journey', ipLimit(60), json, (req, res) => {
    const { code, acceptNotice } = req.body || {};
    if (acceptNotice !== config.noticeVersion) return res.status(400).json({ error: 'Sila terima notis privasi terlebih dahulu.' });
    let sessionCode = '';
    if (code) {
      const s = store.sessionByCode(code);
      if (!s) return res.status(404).json({ error: 'Kod sesi ini tidak sah.' });
      sessionCode = s.code;
    }
    const { journey, token } = store.create({ sessionCode, privacyVersion: config.noticeVersion });
    res.status(201).json({ ...view(journey, store), token });
  });

  api.get('/journey', ipLimit(300), requireJourney, (req, res) => res.set('Cache-Control', 'no-store').json(view(req.journey, store)));

  api.put('/journey', ipLimit(600), json, requireJourney, (req, res) => {
    const { state, step } = req.body || {};
    if (!state || typeof state !== 'object' || Array.isArray(state)) return res.status(400).json({ error: 'Data tidak sah.' });
    if (JSON.stringify(state).length > STATE_MAX) return res.status(413).json({ error: 'Data terlalu besar. Ringkaskan teks bukti atau Quick Fix.' });
    store.update(req.journey, { state, step: Number.isInteger(step) && step >= 0 && step <= 4 ? step : req.journey.step });
    res.json({ saved: true });
  });

  api.post('/consent', ipLimit(30), json, requireJourney, (req, res) => {
    const { kind, granted } = req.body || {};
    if (!['privacy', 'marketing', 'ai_processing'].includes(kind)) return res.status(400).json({ error: 'Jenis persetujuan tidak sah.' });
    store.setConsent(req.journey, kind, granted !== false, config.noticeVersion);
    res.json({ consent: view(req.journey, store).consent });
  });

  // Raw file body; the name comes in a header. Stored in the Shared Drive folder.
  api.post('/upload', ipLimit(60), requireJourney, express.raw({ type: () => true, limit: MAX_FILE }), async (req, res) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!bytes.length) return res.status(400).json({ error: 'Fail kosong.' });
    let name = 'bukti';
    try { name = decodeURIComponent(req.get('x-file-name') || 'bukti').slice(0, 180); } catch {}
    const mime = sniff(bytes, name);
    if (!mime) return res.status(415).json({ error: 'Format fail tidak disokong. Guna PNG, JPG, WEBP, PDF, TXT atau CSV.' });
    try {
      const f = await store.saveFile(req.journey, { name, mime, bytes });
      res.status(201).json({ evidenceFile: { name: f.name, size: f.size, at: f.at } });
    } catch (err) {
      console.error('[upload]', err?.code || err?.status, err?.message);
      res.status(502).json({ error: 'Lampiran gagal dimuat naik. Cuba lagi.' });
    }
  });

  api.post('/diagnose', ipLimit(60), json, requireJourney, async (req, res) => {
    try {
      const limit = limitReached(store, req.journey, req.ip);
      if (limit) return res.status(429).json({ error: limit });
      countIp(req.ip);
      res.json(await diagnose({ store, journey: req.journey, body: req.body || {} }));
    } catch (err) {
      if (err instanceof DiagnoseError) return res.status(err.status).json({ error: err.message });
      console.error('[diagnose] unexpected', err);
      res.status(500).json({ error: 'Ralat server. Cuba semula.' });
    }
  });

  // "Delete my data": clears the participant's row and deletes their Drive file.
  api.delete('/me', ipLimit(30), requireJourney, async (req, res) => {
    try {
      await store.remove(req.journey);
      res.json({ deleted: true });
    } catch (err) {
      console.error('[delete-me]', err?.message);
      res.status(500).json({ error: 'Data gagal dipadam. Hubungi penganjur.' });
    }
  });

  api.use((err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Fail melebihi 4 MB.' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Data tidak sah.' });
    console.error('[api]', err);
    res.status(500).json({ error: 'Ralat server. Cuba semula.' });
  });
  api.use((_req, res) => res.status(404).json({ error: 'Tidak dijumpai.' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use('/api', api);
  // Revalidate every load (ETag → 304) so a deploy never mixes old scripts with new pages.
  app.use(express.static(publicDir, { extensions: ['html'], maxAge: 0 }));
  app.use((_req, res) => res.status(404).sendFile('404.html', { root: publicDir }));
  return app;
}

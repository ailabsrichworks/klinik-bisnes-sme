// API routes against the in-process fake Google store and a stand-in AI (no credentials, no AI cost).
process.env.SHEETS_FLUSH_MS = '3600000';
delete process.env.ANTHROPIC_API_KEY;
process.env.REPORT_DELAY_MS = '30';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGoogle } from '../server/google-fake.mjs';
import { Store, PESERTA, HEADER } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { reportSaver } from '../server/reports.mjs';
import { config } from '../server/config.mjs';
import { PILLARS } from '../public/js/content.mjs';
import { setClientForTests } from '../server/coach.mjs';

// A stand-in for Claude that answers with a real earlier answer.
const sample = JSON.parse(readFileSync(new URL('./fixtures/coach-response.json', import.meta.url), 'utf8'));
const aiCalls = [];
setClientForTests({ beta: { messages: { create: async (req) => { aiCalls.push(req); return { model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage: { input_tokens: 4200, output_tokens: 2000 }, content: [{ type: 'text', text: JSON.stringify(sample) }] }; } } } });

let g, store, server, base;
before(async () => {
  g = createFakeGoogle();
  store = new Store({ sheets: g.sheets, drive: g.drive, sheetId: 's', folderId: 'f' });
  await store.init();
  g.setCell('Sesi', 1, 0, 'KL-NOV26'); g.setCell('Sesi', 1, 1, 'Sesi KL');
  g.setCell('Sesi', 2, 0, 'TAMAT'); g.setCell('Sesi', 2, 3, '2020-01-01');
  await store.loadSessions();
  server = createApp({ store, reports: reportSaver(store) }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await store.stop(); });

const call = async (path, { method = 'GET', body, key, raw, headers = {} } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(key ? { 'x-journey-id': key.id, 'x-journey-token': key.token } : {}), ...headers },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const start = async (code) => {
  const r = await call('/api/journey', { method: 'POST', body: { code, acceptNotice: config.noticeVersion } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.id, token: r.body.token };
};

const profile = { name: 'Nur Aina', business: 'Kuih Siti & Anak', industry: 'F&B / Makanan & Minuman', businessModel: 'Jual produk fizikal', businessAge: '5 tahun ke atas', monthlySales: 'Bawah RM5,000' };
const reportState = (pillar = 'marketing') => ({ profile, pillar, byPillar: { [pillar]: { selected: [1, 5, 8], calc: {}, workOutput: 'Hook: Content ada setiap hari?', plan: { startDate: '2026-11-03' } } } });
// Saves the answers, then asks the coach (as the browser does).
const diagnose = async (k, state = reportState()) => {
  await call('/api/journey', { method: 'PUT', key: k, body: { state, step: 2 } });
  return call('/api/coach', { method: 'POST', key: k, body: {} });
};

test('a journey needs the current privacy notice accepted', async () => {
  assert.equal((await call('/api/journey', { method: 'POST', body: {} })).status, 400);
  assert.equal((await call('/api/journey', { method: 'POST', body: { acceptNotice: 'old' } })).status, 400);
});

test('the AI coach writes the report from the saved answers and stores it on the row', async () => {
  assert.equal((await call('/api/config')).body.aiReady, true);
  const k = await start();
  assert.equal((await call('/api/coach', { method: 'POST', key: k, body: {} })).status, 409, 'needs 3 situations');
  const before = aiCalls.length;
  const r = await diagnose(k);
  assert.equal(r.status, 200);
  assert.equal(aiCalls.length, before + 1);
  assert.ok(!aiCalls.at(-1).messages[0].content.includes('Kuih Siti'), 'no business name sent');
  assert.equal(r.body.ai.source, 'ai');
  assert.equal(r.body.ai.result.diagnosis_title, sample.diagnosis_title);
  const back = (await call('/api/journey', { key: k })).body;
  assert.equal(back.step, 3);
  assert.equal(back.state.byPillar.marketing.ai.result.plan.length, 5);
  await store.flush();
  const row = g.rows('Peserta').find((x) => x[0] === k.id);
  assert.equal(row[PESERTA.indexOf(HEADER.diag_title)], sample.diagnosis_title);
  assert.equal(row[PESERTA.indexOf(HEADER.plan_done)], '0/5');
  const log = g.rows('Log AI'), head = log[0], last = log.at(-1);
  assert.equal(last[head.indexOf('journey_id')], k.id);
  assert.equal(last[head.indexOf('status')], 'ok');
  assert.equal(last[head.indexOf('pillar')], 'Marketing');
  assert.equal(JSON.parse(last[head.indexOf('response')]).diagnosis_title, sample.diagnosis_title);
});

test('a save from the browser never replaces the AI result with an older one', async () => {
  const k = await start();
  await diagnose(k);
  const stale = reportState(); stale.byPillar.marketing.workOutput = 'ditulis semasa AI berjalan';
  await call('/api/journey', { method: 'PUT', key: k, body: { state: stale, step: 3 } }); // no ai in this save
  const back = (await call('/api/journey', { key: k })).body.state.byPillar.marketing;
  assert.equal(back.ai.result.diagnosis_title, sample.diagnosis_title);
  assert.equal(back.workOutput, 'ditulis semasa AI berjalan');
});

test('the optional daily cap per participant is enforced', async () => {
  const k = await start();
  config.dailyAiLimitPerUser = 1;
  try {
    assert.equal((await diagnose(k)).status, 200);
    const r = await call('/api/coach', { method: 'POST', key: k, body: {} });
    assert.equal(r.status, 429);
    assert.match(r.body.error, /Had 1 diagnosis AI sehari/);
  } finally { config.dailyAiLimitPerUser = 0; }
});

test('session codes are optional, but an unknown or expired one is refused', async () => {
  const k = await start();
  assert.equal((await call('/api/journey', { key: k })).body.session, null);
  const s = await start('kl-nov26');
  assert.equal((await call('/api/journey', { key: s })).body.session.name, 'Sesi KL');
  assert.equal((await call('/api/journey', { method: 'POST', body: { code: 'NOPE', acceptNotice: config.noticeVersion } })).status, 404);
  assert.equal((await call('/api/session/TAMAT')).status, 404);
});

test('only the right key can read or change a journey', async () => {
  const k = await start();
  assert.equal((await call('/api/journey')).status, 401);
  assert.equal((await call('/api/journey', { key: { id: k.id, token: 'x' } })).status, 401);
  const other = await start();
  assert.equal((await call('/api/journey', { method: 'PUT', key: { id: k.id, token: other.token }, body: { state: {} } })).status, 401);
});

test('saves reach the sheet; bad or oversized saves are refused', async () => {
  const k = await start('KL-NOV26');
  assert.equal((await call('/api/journey', { method: 'PUT', key: k, body: { state: reportState(), step: 3 } })).status, 200);
  assert.equal((await call('/api/journey', { method: 'PUT', key: k, body: { state: 'x' } })).status, 400);
  assert.equal((await call('/api/journey', { method: 'PUT', key: k, body: { state: { evidenceText: 'x'.repeat(9600) } } })).status, 413);
  assert.equal((await call('/api/journey', { method: 'PUT', key: k, body: { state: { profile: { name: 'x'.repeat(46_000) } } } })).status, 413);
  await store.flush();
  const row = g.rows('Peserta').find((r) => r[0] === k.id);
  const at = (c) => row[PESERTA.indexOf(HEADER[c])];
  assert.equal(at('session_code'), 'KL-NOV26');
  assert.equal(at('pillar'), 'Marketing');
  assert.equal(at('situation_1'), PILLARS.marketing.issues[1]);
  assert.match(at('calc_result'), /Masa content semasa: 6 jam seminggu/);
  const back = (await call('/api/journey', { key: k })).body;
  assert.equal(back.step, 3);
  assert.equal(back.state.byPillar.marketing.workOutput, 'Hook: Content ada setiap hari?');
  assert.equal(back.token, undefined);
});

test('accepting a newer notice is recorded', async () => {
  const k = await start();
  assert.equal((await call('/api/consent', { method: 'POST', key: k, body: { acceptNotice: 'old' } })).status, 400);
  assert.equal((await call('/api/consent', { method: 'POST', key: k, body: { acceptNotice: config.noticeVersion } })).body.consent.privacyVersion, config.noticeVersion);
});

test('optional evidence: type checked from the bytes, 4 MB cap, stored in Drive, can be removed', async () => {
  const k = await start();
  const png = readFileSync(new URL('./fixtures/whatsapp-chat.png', import.meta.url));
  const up = (raw, name) => call('/api/upload', { method: 'POST', key: k, raw, headers: { 'x-file-name': encodeURIComponent(name), 'content-type': 'application/octet-stream' } });
  assert.equal((await up(Buffer.from('MZ fake exe'), 'bukti.png')).status, 415);
  assert.equal((await up(Buffer.from([0, 1, 2]), 'nota.txt')).status, 415);
  assert.equal((await up(Buffer.alloc(4 * 1024 * 1024 + 1, 65), 'besar.txt')).status, 413);
  const ok = await up(png, 'chat whatsapp.png');
  assert.equal(ok.status, 201);
  const f = [...g.files.values()].find((x) => x.name.startsWith(k.id));
  assert.equal(f.mimeType, 'image/png');
  assert.equal((await call('/api/journey', { key: k })).body.evidenceFile.name, 'chat whatsapp.png');
  assert.equal((await call('/api/upload', { method: 'DELETE', key: k })).status, 200);
  assert.equal((await call('/api/journey', { key: k })).body.evidenceFile, null);
  assert.ok(![...g.files.values()].some((x) => x.name.startsWith(k.id)));
});

test('the report PDF downloads once there is a diagnosis, and the download time is recorded', async () => {
  const k = await start();
  assert.equal((await call('/api/report.pdf', { key: k })).status, 409);
  assert.equal((await fetch(base + '/api/report.pdf')).status, 401);
  await call('/api/journey', { method: 'PUT', key: k, body: { state: reportState('money'), step: 2 } });
  assert.equal((await call('/api/report.pdf', { key: k })).status, 409, 'no diagnosis yet');
  await call('/api/coach', { method: 'POST', key: k, body: {} });
  const res = await fetch(base + '/api/report.pdf', { headers: { 'x-journey-id': k.id, 'x-journey-token': k.token } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /filename="Laporan-Quick-Fix-Kuih-Siti-Anak\.pdf"/);
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  await store.flush();
  assert.match(g.rows('Peserta').find((r) => r[0] === k.id)[PESERTA.indexOf(HEADER.report_downloaded_at)], /^\d{4}-\d\d-\d\dT/);
});

test('the report PDF is saved to Drive at the report step, one per participant, and deleted with the data', async () => {
  const k = await start('KL-NOV26');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // PDFs take a moment to build (fonts, logos): poll instead of guessing a fixed wait.
  const until = async (ok, ms = 5000) => { for (const t0 = Date.now(); !ok() && Date.now() - t0 < ms;) await sleep(50); };
  const reports = () => [...g.files.values()].filter((f) => f.name.startsWith('Laporan') && f.name.includes(k.id));
  const put = (st, step) => call('/api/journey', { method: 'PUT', key: k, body: { state: st, step } });

  await put(reportState('sales'), 2); // numbers & evidence step: no diagnosis, no report
  await sleep(150);
  assert.equal(reports().length, 0);

  await call('/api/coach', { method: 'POST', key: k, body: {} }); // the diagnosis saves a report
  await until(() => reports().length === 1);
  const state = (await call('/api/journey', { key: k })).body.state;
  assert.equal(reports().length, 1);
  const [first] = reports();
  assert.equal(first.bytes.subarray(0, 5).toString(), '%PDF-');

  await put(state, 3); // nothing changed: same file kept
  await sleep(300);
  assert.equal(reports()[0], first);

  await put({ ...state, evidenceText: 'bukti baharu' }, 3); // evidence is not in the report: still the same file
  await sleep(300);
  assert.equal(reports()[0], first);

  const changed = structuredClone(state); changed.byPillar.sales.workOutput = 'Versi baharu';
  await put(changed, 3);
  await until(() => reports().length === 1 && reports()[0] !== first);
  assert.equal(reports().length, 1);
  assert.notEqual(reports()[0], first);

  assert.equal((await call('/api/me', { method: 'DELETE', key: k })).status, 200);
  assert.equal(reports().length, 0);
  assert.equal((await call('/api/journey', { key: k })).status, 401);
});

test('the saved step survives a restart', async () => {
  const k = await start();
  await call('/api/journey', { method: 'PUT', key: k, body: { state: { profile }, step: 2 } });
  await store.flush();
  const again = new Store({ sheets: g.sheets, drive: g.drive, sheetId: 's', folderId: 'f' });
  await again.init(); await again.stop();
  assert.equal(again.journeys.get(k.id).step, 2);
});

test('cross-site calls are refused', async () => {
  const r = await fetch(base + '/api/journey', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ acceptNotice: config.noticeVersion }) });
  assert.equal(r.status, 403);
});

// API routes against the in-process fake Google store (no credentials, no AI calls).
process.env.SHEETS_FLUSH_MS = '3600000';
process.env.REPORT_DELAY_MS = '30';
delete process.env.ANTHROPIC_API_KEY;
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGoogle } from '../server/google-fake.mjs';
import { Store, PESERTA } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { reportSaver } from '../server/reports.mjs';
import { config } from '../server/config.mjs';

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

test('a journey needs the current privacy notice accepted', async () => {
  assert.equal((await call('/api/journey', { method: 'POST', body: {} })).status, 400);
  assert.equal((await call('/api/journey', { method: 'POST', body: { acceptNotice: 'old' } })).status, 400);
});

test('session codes are optional, but an unknown or expired one is refused', async () => {
  const k = await start();
  assert.equal((await call('/api/journey', { key: k })).body.session, null);
  const s = await start('kl-nov26');
  assert.equal((await call('/api/journey', { key: s })).body.session.name, 'Sesi KL');
  assert.equal((await call('/api/journey', { method: 'POST', body: { code: 'NOPE', acceptNotice: config.noticeVersion } })).status, 404);
  assert.equal((await call('/api/session/TAMAT')).status, 404);
  assert.equal((await call('/api/session/kl-nov26')).body.code, 'KL-NOV26');
});

test('only the right key can read or change a journey', async () => {
  const k = await start();
  assert.equal((await call('/api/journey')).status, 401);
  assert.equal((await call('/api/journey', { key: { id: k.id, token: 'x' } })).status, 401);
  const other = await start();
  assert.equal((await call('/api/journey', { method: 'PUT', key: { id: k.id, token: other.token }, body: { state: {} } })).status, 401);
});

test('saves reach the sheet as a readable row', async () => {
  const k = await start('KL-NOV26');
  const state = { profile: { business: 'Ain Tudung', product: 'Tudung bawal', pain: 'cost', participant: 'Ain' }, costs: { sellingPrice: '25', materialCost: '12' }, evidenceText: 'Supplier RM12.', tasks: [{ title: 'Buka penyata', proof: 'Screenshot', status: 'selesai' }] };
  assert.equal((await call('/api/journey', { method: 'PUT', key: k, body: { state, step: 1 } })).status, 200);
  assert.equal((await call('/api/journey', { method: 'PUT', key: k, body: { state: 'x' } })).status, 400);
  assert.equal((await call('/api/journey', { method: 'PUT', key: k, body: { state: { evidenceText: 'x'.repeat(70_000) } } })).status, 413);
  await call('/api/consent', { method: 'POST', key: k, body: { kind: 'marketing', granted: true } });
  await store.flush();
  const row = g.rows('Peserta').find((r) => r[0] === k.id);
  const at = (c) => row[PESERTA.indexOf(c)];
  assert.equal(at('session_code'), 'KL-NOV26');
  assert.equal(at('business'), 'Ain Tudung');
  assert.equal(at('provisional_balance'), '13.00');
  assert.equal(at('tasks_done'), '1');
  assert.match(at('tasks'), /1\. \[selesai\] Buka penyata/);
  assert.equal(at('marketing_consent'), 'ya');
  assert.equal(at('privacy_notice_version'), config.noticeVersion);
  const back = (await call('/api/journey', { key: k })).body;
  assert.equal(back.state.profile.business, 'Ain Tudung');
  assert.equal(back.step, 1);
  assert.equal(back.consent.marketing, true);
  assert.equal(back.token, undefined);
});

test('uploads: type is checked from the bytes, size is capped, file goes to Drive', async () => {
  const k = await start();
  const png = readFileSync(new URL('./fixtures/whatsapp-chat.png', import.meta.url));
  const up = (raw, name) => call('/api/upload', { method: 'POST', key: k, raw, headers: { 'x-file-name': encodeURIComponent(name), 'content-type': 'application/octet-stream' } });
  assert.equal((await up(Buffer.from('MZ fake exe'), 'bukti.png')).status, 415);
  assert.equal((await up(Buffer.from([0, 1, 2]), 'nota.txt')).status, 415);
  assert.equal((await up(Buffer.alloc(4 * 1024 * 1024 + 1, 65), 'besar.txt')).status, 413);
  const ok = await up(png, 'chat whatsapp.png');
  assert.equal(ok.status, 201);
  assert.equal(ok.body.evidenceFile.name, 'chat whatsapp.png');
  const f = [...g.files.values()].find((x) => x.name.startsWith(k.id));
  assert.equal(f.mimeType, 'image/png');
  assert.deepEqual(f.parents, ['f']);
  assert.equal((await call('/api/journey', { key: k })).body.evidenceFile.name, 'chat whatsapp.png');
});

test('diagnosis without an AI key says so; without evidence it asks for some', async () => {
  const k = await start();
  assert.equal((await call('/api/diagnose', { method: 'POST', key: k, body: { pain: 'cost' } })).status, 422);
  assert.equal((await call('/api/diagnose', { method: 'POST', key: k, body: { pain: 'cost', evidence_text: 'Harga RM25' } })).status, 503);
  assert.equal((await call('/api/diagnose', { method: 'POST', body: { evidence_text: 'x' } })).status, 401);
});

test('delete my data clears the row and the Drive file, and the key stops working', async () => {
  const k = await start();
  await call('/api/journey', { method: 'PUT', key: k, body: { state: { profile: { business: 'Padam Saya' } } } });
  await call('/api/upload', { method: 'POST', key: k, raw: Buffer.from('%PDF-1.4 test'), headers: { 'x-file-name': 'kos.pdf' } });
  await store.flush();
  assert.ok(g.rows('Peserta').some((r) => r[0] === k.id));
  assert.equal((await call('/api/me', { method: 'DELETE', key: k })).status, 200);
  assert.ok(!g.rows('Peserta').some((r) => r.includes('Padam Saya')));
  assert.ok(![...g.files.values()].some((x) => x.name.startsWith(k.id)));
  assert.equal((await call('/api/journey', { key: k })).status, 401);
});

test('cross-site calls are refused', async () => {
  const r = await fetch(base + '/api/journey', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ acceptNotice: config.noticeVersion }) });
  assert.equal(r.status, 403);
});

test('the report PDF is saved to Drive at Langkah 5, one per participant, and deleted with the data', async () => {
  const k = await start('KL-NOV26');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reports = () => [...g.files.values()].filter((f) => f.name.startsWith('Laporan') && f.name.includes(k.id));
  const diagnosis = { origin: 'ai', pathway: 'cost', title: 'Fee belum disahkan', reason: 'Sebab.', observations: ['a'], unknowns: ['b'], strength: 'Bukti terhad', quickFix: 'QF', tasks: [{ title: 'T1', proof: 'P1' }], tasksSource: 'ai' };
  const state = { profile: { business: 'Ain Tudung', product: 'Tudung' }, diagnosis, pathway: 'cost', quickFix: 'QF', tasks: [{ day: 1, title: 'T1', proof: 'P1', status: 'belum', note: '' }] };
  const put = (st, step) => call('/api/journey', { method: 'PUT', key: k, body: { state: st, step } });

  await put(state, 3); // Langkah 4: no report yet
  await sleep(150);
  assert.equal(reports().length, 0);

  await put(state, 4); await put(state, 4); // reaching Langkah 5, twice in a row
  await sleep(500);
  assert.equal(reports().length, 1);
  const [first] = reports();
  assert.equal(first.mimeType, 'application/pdf');
  assert.equal(first.bytes.subarray(0, 5).toString(), '%PDF-');
  assert.deepEqual(first.parents, ['f']);

  await put(state, 4); // nothing changed: same file kept
  await sleep(300);
  assert.equal(reports()[0], first);

  await put({ ...state, tasks: [{ ...state.tasks[0], status: 'selesai' }] }, 4); // tracker updated: replaced
  await sleep(500);
  assert.equal(reports().length, 1);
  assert.notEqual(reports()[0], first);

  await store.flush();
  const row = g.rows('Peserta').find((r) => r[0] === k.id);
  assert.match(row[PESERTA.indexOf('report_link')], /^https:\/\/drive/);
  assert.equal(row[PESERTA.indexOf('step')], '5');

  assert.equal((await call('/api/me', { method: 'DELETE', key: k })).status, 200);
  assert.equal(reports().length, 0);
});

test('the saved step survives a restart', async () => {
  const k = await start();
  await call('/api/journey', { method: 'PUT', key: k, body: { state: { profile: { business: 'X' } }, step: 2 } });
  await store.flush();
  const again = new Store({ sheets: g.sheets, drive: g.drive, sheetId: 's', folderId: 'f' });
  await again.init(); await again.stop();
  assert.equal(again.journeys.get(k.id).step, 2);
});

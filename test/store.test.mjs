// Store logic against the in-process fake Google APIs (no credentials needed).
process.env.SHEETS_FLUSH_MS = '3600000'; // flush by hand in tests
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGoogle } from '../server/google-fake.mjs';
import { Store, PESERTA, HEADER, COLUMNS, SECTIONS } from '../server/store.mjs';
import { PILLARS } from '../public/js/content.mjs';

const open = async (g) => {
  const s = new Store({ sheets: g.sheets, drive: g.drive, sheetId: 'sheet', folderId: 'folder' });
  await s.init();
  clearInterval(s.timer); clearInterval(s.sesiTimer);
  return s;
};
const rowFor = (g, id, tab = 'Peserta') => g.rows(tab).find((r) => r?.[0] === id);
const col = (key) => PESERTA.indexOf(HEADER[key]);
const profile = { name: 'Nur Aina', business: 'Aina Frozen Food', industry: 'F&B / Makanan & Minuman', businessModel: 'Jual produk fizikal', businessAge: '1 hingga kurang 3 tahun', monthlySales: 'RM5,000–RM10,000' };

test('first run creates the tabs; each header names its section and field', async () => {
  const g = createFakeGoogle();
  await open(g);
  const head = g.rows('Peserta')[0];
  assert.deepEqual(head, PESERTA);
  assert.equal(head[col('full_name')], 'LANGKAH 1 · MAKLUMAT BISNES\nNama penuh');
  assert.equal(head[col('situation_2')], 'LANGKAH 2 · PILIH CABARAN\nSituasi 2');
  assert.equal(head[col('calc_1')], 'LAPORAN 04 · KIRA / SEMAK IMPAK\nInput 1');
  assert.equal(head[col('plan_start_date')], 'LAPORAN 06 · PELAN TINDAKAN 7 HARI\nTarikh mula');
  assert.equal(new Set(PESERTA).size, PESERTA.length, 'every header is unique');
  // sections are contiguous, so each colour band reads as one block
  const order = COLUMNS.map((c) => c.s).filter((x, i, a) => a.indexOf(x) === i);
  assert.deepEqual(order, Object.keys(SECTIONS));
  assert.equal(g.rows('Sesi')[0][0], 'code');
  assert.match(g.rows('README')[0][0], /KBSME/);
  assert.equal(g.rows('Log AI').length, 0);
  await open(g); // a second start adds nothing
  assert.deepEqual(g.rows('Peserta')[0], PESERTA);
});

test('a tab in the earlier v4 layout is upgraded in place, rows kept', async () => {
  const g = createFakeGoogle();
  await g.sheets.spreadsheets.batchUpdate({ requestBody: { requests: [{ addSheet: { properties: { title: 'Peserta' } } }] } });
  // the earlier v4 layout: plain keys as headers
  const old = ['id', 'session_code', 'created_at', 'updated_at', 'step', 'full_name', 'business', 'pillar', 'token_hash', 'state_json'];
  const state = { profile, pillar: 'sales', byPillar: { sales: { selected: [0, 2, 4], calc: { viewers: '200' } } } };
  await g.sheets.spreadsheets.values.batchUpdate({ requestBody: { valueInputOption: 'RAW', data: [{ range: "'Peserta'!A1", values: [old, ['abc', '', '2026-10-27T07:21:56Z', '2026-10-27T07:22:00Z', '4 · Laporan', 'Nur Aina', 'Aina Frozen Food', 'Sales (LIVE Sales)', 'f'.repeat(64), JSON.stringify({ state, consent: { privacyVersion: 'v4' } })]] }] } });
  const s = await open(g);
  assert.equal(s.tab, 'Peserta');
  assert.deepEqual(g.rows('Peserta')[0], PESERTA);
  const r = rowFor(g, 'abc');
  assert.equal(r[col('full_name')], 'Nur Aina');
  assert.equal(r[col('situation_3')], PILLARS.sales.issues[4]);
  assert.equal(r[col('calc_1')], 'Purata viewers yang relevan: 200');
  assert.equal(r[col('created_at')], '2026-10-27T07:21:56Z');
  assert.equal(r[col('token_hash')], 'f'.repeat(64));
  assert.equal(s.journeys.get('abc').step, 3);
  assert.equal(g.rows('Peserta').filter((x) => x?.[0]).length, 2, 'no duplicate rows');
});

test('an empty tab in an older layout gets the new header; one with rows is left alone', async () => {
  const g = createFakeGoogle();
  for (const t of ['Peserta', 'Peserta v4']) await g.sheets.spreadsheets.batchUpdate({ requestBody: { requests: [{ addSheet: { properties: { title: t } } }] } });
  // the real AI-era header also has id, token_hash and state_json: it must still be left alone
  ['id', 'session_code', 'diagnosis_pathway', 'token_hash', 'state_json'].forEach((h, i) => g.setCell('Peserta', 0, i, h)); g.setCell('Peserta', 1, 0, 'old-row');
  ['id', 'session_code', 'created_at', 'full_name'].forEach((h, i) => g.setCell('Peserta v4', 0, i, h)); // earlier v4 keys, no rows
  const s = await open(g);
  assert.equal(s.tab, 'Peserta v4');
  assert.deepEqual(g.rows('Peserta v4')[0], PESERTA);
  assert.deepEqual(g.rows('Peserta')[1], ['old-row']);
});

test('a Peserta tab from the AI version is left alone; rows go to "Peserta v4"', async () => {
  const g = createFakeGoogle();
  await g.sheets.spreadsheets.batchUpdate({ requestBody: { requests: [{ addSheet: { properties: { title: 'Peserta' } } }] } });
  ['id', 'diagnosis_pathway', 'token_hash', 'state_json'].forEach((h, i) => g.setCell('Peserta', 0, i, h)); ['old-row', '', 'cost', 'x'].forEach((v, i) => g.setCell('Peserta', 1, i, v));
  const s = await open(g);
  assert.equal(s.tab, 'Peserta v4');
  const { journey } = s.create({ privacyVersion: 'v4' });
  await s.flush();
  assert.ok(rowFor(g, journey.id, 'Peserta v4'));
  assert.deepEqual(g.rows('Peserta')[1], ['old-row', '', 'cost', 'x'], 'old data untouched');
  assert.deepEqual(g.rows('Peserta')[0], ['id', 'diagnosis_pathway', 'token_hash', 'state_json'], 'old header untouched');
});

test('every answer has its own readable column; the token is checked', async () => {
  const g = createFakeGoogle();
  const s = await open(g);
  const { journey, token } = s.create({ sessionCode: 'KL-NOV26', privacyVersion: 'v4' });
  s.update(journey, { step: 3, state: {
    profile, pillar: 'money', evidenceText: '=HYPERLINK("http://x")',
    byPillar: { money: { selected: [0, 3, 6], calc: { productCost: '22' }, workOutput: 'Kos produk RM22', plan: { action: 'Lengkapkan kos', measure: 'Ada sumber', startDate: '2026-11-03', proof: 'Invois' } }, sales: { selected: [1] } },
  } });
  await s.flush();
  const r = rowFor(g, journey.id);
  const at = (c) => r[col(c)];
  assert.equal(at('step'), '4 · Laporan');
  assert.equal(at('full_name'), 'Nur Aina');
  assert.equal(at('years_running'), '1 hingga kurang 3 tahun');
  assert.equal(at('pillar'), 'Urus Duit');
  assert.equal(at('situation_1'), PILLARS.money.issues[0]);
  assert.equal(at('situation_3'), PILLARS.money.issues[6]);
  assert.equal(at('evidence_text'), '=HYPERLINK("http://x")');
  assert.equal(at('calc_1'), 'Harga jualan seunit (RM): 50');
  assert.equal(at('calc_2'), 'Kos produk seunit (RM): 22');
  assert.equal(at('calc_4'), 'Caj platform / transaksi seunit (RM): 2');
  assert.match(at('calc_result'), /^Jumlah kos yang disenaraikan: RM27\.00 seunit\nBaki selepas kos yang disenaraikan: RM23\.00 seunit/);
  assert.equal(at('workshop_output'), 'Kos produk RM22');
  assert.equal(at('plan_start_date'), '2026-11-03');
  assert.equal(at('privacy_notice_version'), 'v4');
  assert.ok(g.calls.every((c) => !c.includes(':USER_ENTERED')), 'participant text must be written RAW');
  assert.ok(!r.includes(token), 'the token itself is never stored');

  const s2 = await open(g);
  const back = s2.verify(journey.id, token);
  assert.equal(back.state.byPillar.money.calc.productCost, '22');
  assert.equal(back.step, 3);
  assert.equal(s2.verify(journey.id, 'wrong'), null);
});

test('the report columns stay empty until the participant reaches the report', async () => {
  const g = createFakeGoogle();
  const s = await open(g);
  const { journey } = s.create({ privacyVersion: 'v4' });
  s.update(journey, { step: 1, state: { profile, pillar: 'sales', byPillar: { sales: { selected: [0, 1, 2] } } } });
  await s.flush();
  const r = rowFor(g, journey.id);
  assert.equal(r[col('step')], '2 · Pilih cabaran');
  assert.equal(r[col('situation_2')], PILLARS.sales.issues[1]);
  assert.equal(r[col('calc_result')], '');
  assert.equal(r[col('plan_action')], '');
});

test('rows moved by hand are still updated in the right place', async () => {
  const g = createFakeGoogle();
  const s = await open(g);
  const a = s.create({ privacyVersion: 'v4' }).journey;
  const b = s.create({ privacyVersion: 'v4' }).journey;
  await s.flush();
  g.swapRows('Peserta', 1, 2);
  s.update(a, { state: { profile: { ...profile, business: 'A baru' } } });
  await s.flush();
  assert.equal(rowFor(g, a.id)[col('business')], 'A baru');
  assert.equal(rowFor(g, b.id)[col('business')], '');
  assert.equal(g.rows('Peserta').filter((r) => r?.[0]).length, 3);
});

test('quota errors are retried; a failed flush keeps the changes', async () => {
  const g = createFakeGoogle();
  const s = await open(g);
  const { journey } = s.create({ privacyVersion: 'v4' });
  g.failNext('values.append', 429);
  await s.flush();
  assert.ok(rowFor(g, journey.id));
  const two = s.create({ privacyVersion: 'v4' }).journey;
  g.failNext('values.get', 400);
  await assert.rejects(s.flush());
  await s.flush();
  assert.ok(rowFor(g, two.id));
});

test('evidence and report files go to Drive and are deleted with the participant', async () => {
  const g = createFakeGoogle();
  const s = await open(g);
  const { journey, token } = s.create({ privacyVersion: 'v4' });
  await s.saveFile(journey, { name: 'kos.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4 a') });
  const first = journey.evidence.fileId;
  await s.saveFile(journey, { name: 'kos2.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4 b') });
  assert.ok(!g.files.has(first), 'replacing a file deletes the old one');
  await s.saveReport(journey, Buffer.from('%PDF-report'), 'h1');
  assert.equal(g.files.size, 2);
  await s.flush();
  assert.match(rowFor(g, journey.id)[col('evidence_link')], /^https:\/\/drive/);
  assert.match(rowFor(g, journey.id)[col('report_link')], /^https:\/\/drive/);
  await s.removeEvidenceFile(journey);
  assert.equal(g.files.size, 1);
  await s.remove(journey);
  assert.equal(g.files.size, 0);
  assert.equal(rowFor(g, journey.id), undefined);
  assert.equal((await open(g)).verify(journey.id, token), null);
});

test('session codes: case-insensitive, expiry honoured, blank = never expires', async () => {
  const g = createFakeGoogle();
  const s = await open(g);
  g.setCell('Sesi', 1, 0, 'KL-NOV26'); g.setCell('Sesi', 1, 1, 'Sesi KL');
  g.setCell('Sesi', 2, 0, 'OLD'); g.setCell('Sesi', 2, 3, '2020-01-01');
  await s.loadSessions();
  assert.equal(s.sessionByCode(' kl-nov26 ')?.name, 'Sesi KL');
  assert.equal(s.sessionByCode('OLD'), null);
  assert.equal(s.sessionByCode(''), null);
});

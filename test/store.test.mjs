// Store logic against the in-process fake Google APIs (no credentials needed).
process.env.SHEETS_FLUSH_MS = '3600000'; // flush by hand in tests
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGoogle } from '../server/google-fake.mjs';
import { Store, PESERTA } from '../server/store.mjs';
import { PILLARS } from '../public/js/content.mjs';

const open = async (g) => {
  const s = new Store({ sheets: g.sheets, drive: g.drive, sheetId: 'sheet', folderId: 'folder' });
  await s.init();
  clearInterval(s.timer); clearInterval(s.sesiTimer);
  return s;
};
const rowFor = (g, id, tab = 'Peserta') => g.rows(tab).find((r) => r?.[0] === id);
const col = (name) => PESERTA.indexOf(name);
const profile = { name: 'Nur Aina', business: 'Aina Frozen Food', industry: 'F&B / Makanan & Minuman', businessModel: 'Jual produk fizikal', businessAge: '1 hingga kurang 3 tahun', monthlySales: 'RM5,000–RM10,000' };

test('first run creates the tabs and header rows (no AI log)', async () => {
  const g = createFakeGoogle();
  await open(g);
  assert.deepEqual(g.rows('Peserta')[0], PESERTA);
  assert.equal(g.rows('Sesi')[0][0], 'code');
  assert.match(g.rows('README')[0][0], /KBSME/);
  assert.equal(g.rows('Log AI').length, 0);
  const before = g.calls.length;
  await open(g);
  assert.ok(!g.calls.slice(before).some((c) => c.startsWith('values.batchUpdate')), 'a second start rewrites nothing');
});

test('a Peserta tab from the AI version is left alone; rows go to "Peserta v4"', async () => {
  const g = createFakeGoogle();
  await g.sheets.spreadsheets.batchUpdate({ requestBody: { requests: [{ addSheet: { properties: { title: 'Peserta' } } }] } });
  g.setCell('Peserta', 0, 0, 'id'); g.setCell('Peserta', 0, 1, 'diagnosis_pathway'); g.setCell('Peserta', 1, 0, 'old-row');
  const s = await open(g);
  assert.equal(s.tab, 'Peserta v4');
  const { journey } = s.create({ privacyVersion: 'v4' });
  await s.flush();
  assert.ok(rowFor(g, journey.id, 'Peserta v4'));
  assert.deepEqual(g.rows('Peserta')[1], ['old-row'], 'old data untouched');
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
  assert.match(at('calc_inputs'), /Kos produk seunit \(RM\): 22/);
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

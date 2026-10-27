// Store logic against the in-process fake Google APIs (no credentials needed).
process.env.SHEETS_FLUSH_MS = '3600000'; // flush by hand in tests
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGoogle } from '../server/google-fake.mjs';
import { Store, PESERTA } from '../server/store.mjs';

const open = async (g) => {
  const s = new Store({ sheets: g.sheets, drive: g.drive, sheetId: 'sheet', folderId: 'folder' });
  await s.init();
  clearInterval(s.timer); clearInterval(s.sesiTimer);
  return s;
};
const rowFor = (g, id) => g.rows('Peserta').find((r) => r?.[0] === id);
const col = (name) => PESERTA.indexOf(name);

test('first run creates the tabs and header rows', async () => {
  const g = createFakeGoogle();
  await open(g);
  assert.deepEqual(g.rows('Peserta')[0], PESERTA);
  assert.equal(g.rows('Sesi')[0][0], 'code');
  assert.equal(g.rows('Log AI')[0][0], 'time');
  assert.match(g.rows('README')[0][0], /KBSME/);
  // A second start does not rewrite anything.
  const before = g.calls.length;
  await open(g);
  assert.ok(!g.calls.slice(before).some((c) => c.startsWith('values.batchUpdate')));
});

test('journeys survive a restart, and the token is checked', async () => {
  const g = createFakeGoogle();
  const s = await open(g);
  const { journey, token } = s.create({ sessionCode: '', privacyVersion: 'v1' });
  s.update(journey, { step: 1, state: { profile: { business: 'Ain Tudung', pain: 'cost' }, costs: { sellingPrice: '25', materialCost: '12' }, evidenceText: '=HYPERLINK("http://x")' } });
  await s.flush();
  const row = rowFor(g, journey.id);
  assert.equal(row[col('business')], 'Ain Tudung');
  assert.equal(row[col('provisional_balance')], '13.00');
  assert.equal(row[col('evidence_text')], '=HYPERLINK("http://x")');
  assert.ok(g.calls.every((c) => !c.includes(':USER_ENTERED')), 'participant text must be written RAW');
  assert.ok(!row.includes(token), 'the token itself is never stored');

  const s2 = await open(g);
  assert.equal(s2.verify(journey.id, token)?.state.profile.business, 'Ain Tudung');
  assert.equal(s2.verify(journey.id, 'wrong'), null);
  assert.equal(s2.verify('nope', token), null);
});

test('rows moved by hand are still updated in the right place', async () => {
  const g = createFakeGoogle();
  const s = await open(g);
  const a = s.create({ privacyVersion: 'v1' }).journey;
  const b = s.create({ privacyVersion: 'v1' }).journey;
  await s.flush();
  g.swapRows('Peserta', 1, 2); // a trainer sorts the sheet
  s.update(a, { state: { profile: { business: 'A baru' } } });
  await s.flush();
  assert.equal(rowFor(g, a.id)[col('business')], 'A baru');
  assert.equal(rowFor(g, b.id)[col('business')], '');
  assert.equal(g.rows('Peserta').filter((r) => r?.[0]).length, 3); // header + 2, no duplicate
});

test('quota errors are retried and nothing is lost', async () => {
  const g = createFakeGoogle();
  const s = await open(g);
  const { journey } = s.create({ privacyVersion: 'v1' });
  g.failNext('values.append', 429);
  await s.flush();
  assert.ok(rowFor(g, journey.id));
});

test('a failed flush keeps the changes for next time', async () => {
  const g = createFakeGoogle();
  const s = await open(g);
  const { journey } = s.create({ privacyVersion: 'v1' });
  g.failNext('values.get', 400); // not retryable
  await assert.rejects(s.flush());
  assert.equal(rowFor(g, journey.id), undefined);
  await s.flush();
  assert.ok(rowFor(g, journey.id));
});

test('evidence goes to Drive; deleting clears the row and the file', async () => {
  const g = createFakeGoogle();
  const s = await open(g);
  const { journey, token } = s.create({ privacyVersion: 'v1' });
  await s.saveFile(journey, { name: 'kos.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4 a') });
  const first = journey.evidence.fileId;
  await s.saveFile(journey, { name: 'kos2.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4 b') });
  assert.equal(g.files.size, 1, 'replacing a file deletes the old one');
  assert.ok(!g.files.has(first));
  const [f] = g.files.values();
  assert.deepEqual(f.parents, ['folder']);
  await s.flush();
  assert.match(rowFor(g, journey.id)[col('evidence_link')], /^https:\/\/drive/);

  s.fileCache.clear();
  assert.equal((await s.readFile(journey)).bytes.toString(), '%PDF-1.4 b');

  await s.remove(journey);
  assert.equal(g.files.size, 0);
  assert.equal(rowFor(g, journey.id), undefined);
  assert.ok(g.rows('Peserta').slice(1).every((r) => r.every((v) => v === '')), 'row is cleared');
  assert.equal((await open(g)).verify(journey.id, token), null);
});

test('session codes: case-insensitive, expiry honoured, blank = never expires', async () => {
  const g = createFakeGoogle();
  const s = await open(g);
  g.setCell('Sesi', 1, 0, 'KL-NOV26'); g.setCell('Sesi', 1, 1, 'Sesi KL'); g.setCell('Sesi', 1, 2, '2026-11-20');
  g.setCell('Sesi', 2, 0, 'OLD'); g.setCell('Sesi', 2, 3, '2020-01-01');
  g.setCell('Sesi', 3, 0, 'SOON'); g.setCell('Sesi', 3, 3, new Date(Date.now() + 3600e3).toISOString());
  await s.loadSessions();
  assert.equal(s.sessionByCode(' kl-nov26 ')?.name, 'Sesi KL');
  assert.equal(s.sessionByCode('OLD'), null);
  assert.equal(s.sessionByCode('SOON')?.code, 'SOON');
  assert.equal(s.sessionByCode('NOPE'), null);
  assert.equal(s.sessionByCode(''), null);
});

test('AI calls are logged and counted, also after a restart', async () => {
  const g = createFakeGoogle();
  const s = await open(g);
  s.logAi({ journeyId: 'j1', model: 'm', status: 'ok', input: 10, output: 20 });
  s.logAi({ journeyId: 'j2', model: 'm', status: 'error' });
  assert.deepEqual(s.aiCount('j1'), { mine: 1, all: 2 });
  await s.flush();
  assert.equal(g.rows('Log AI').length, 3);
  assert.deepEqual((await open(g)).aiCount('j1'), { mine: 1, all: 2 });
});

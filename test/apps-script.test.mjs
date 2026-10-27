// Runs apps-script/Code.gs inside Node against a stand-in for Google's SpreadsheetApp / DriveApp,
// then drives it through the server's Apps Script client and the real Store.
process.env.SHEETS_FLUSH_MS = '3600000';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { appsScriptClients } from '../server/apps-script.mjs';
import { Store, PESERTA } from '../server/store.mjs';

const colIndex = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0); // 1-based

// ─── a minimal SpreadsheetApp / DriveApp ───
function fakeAppsScript() {
  const sheets = [];
  const files = new Map();
  let nextId = 100;
  const range = (sh, r, c, nr, nc) => { const rg = {
    getSheet: () => sh, getRow: () => r, getColumn: () => c,
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sh.cells[r - 1 + i]?.[c - 1 + j] ?? '')),
    // Behaves like the real Sheet: a leading apostrophe forces text (and is not stored); otherwise
    // "=..." becomes a formula, and in cells not formatted as text, numbers and TRUE/FALSE convert.
    setNumberFormat: (f) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.formats[`${r + i},${c + j}`] = f; return rg; },
    setValues: (vals) => {
      assert.equal(vals.length, nr); vals.forEach((row) => assert.equal(row.length, nc));
      assert.ok(r - 1 + nr <= sh.maxRows && c - 1 + nc <= sh.maxCols, 'write outside the grid');
      vals.forEach((row, i) => row.forEach((v, j) => {
        const text = sh.formats[`${r + i},${c + j}`] === '@';
        let out = v;
        if (typeof v === 'string' && v.startsWith("'")) out = v.slice(1);
        else if (typeof v === 'string' && v.startsWith('=')) out = `FORMULA(${v})`;
        else if (!text && typeof v === 'string' && /^[+-]?\d+(\.\d+)?$/.test(v)) out = Number(v);
        else if (!text && /^(TRUE|FALSE)$/.test(v)) out = v === 'TRUE';
        (sh.cells[r - 1 + i] ||= [])[c - 1 + j] = out;
      }));
      return rg;
    },
    clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (sh.cells[r - 1 + i]) sh.cells[r - 1 + i][c - 1 + j] = ''; return rg; },
    protect: () => { sh.protected = true; const p = { setDescription: () => p, setWarningOnly: (w) => { sh.warningOnly = w; return p; } }; return p; },
    setFontWeight: (w) => { sh.bold = w; },
  }; return rg; };
  const makeSheet = (name) => {
    const sh = {
      name, id: nextId++, cells: [], formats: {}, maxRows: 1000, maxCols: 26, frozen: 0, hidden: [],
      getName: () => sh.name, getSheetId: () => sh.id,
      getMaxRows: () => sh.maxRows, getMaxColumns: () => sh.maxCols,
      insertRowsAfter: (_a, n) => { sh.maxRows += n; }, insertColumnsAfter: (_a, n) => { sh.maxCols += n; },
      setFrozenRows: (n) => { sh.frozen = n; },
      hideColumns: (c) => sh.hidden.push(c),
      getLastRow: () => { for (let i = sh.cells.length - 1; i >= 0; i--) if ((sh.cells[i] || []).some((v) => v !== '' && v != null)) return i + 1; return 0; },
      getRange: (r, c, nr = 1, nc = 1) => range(sh, r, c, nr, nc),
    };
    sheets.push(sh);
    return sh;
  };
  const ss = {
    getSheets: () => sheets,
    getSpreadsheetTimeZone: () => 'Asia/Kuala_Lumpur',
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => makeSheet(n),
    // A1 with a tab: 'Tab'!A2:AR, 'Tab'!1:1, 'Tab'!A:A, 'Tab'!A1
    getRange: (a1) => {
      const m = /^'(.+)'!([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/.exec(a1);
      if (!m) throw new Error(`Range not found: ${a1}`);
      const sh = ss.getSheetByName(m[1]);
      if (!sh) throw new Error(`Range not found: ${a1}`);
      const [, , ca, ra, cb, rb] = m;
      const single = m[4] === undefined;
      const c0 = ca ? colIndex(ca) : 1, r0 = ra ? Number(ra) : 1;
      const c1 = single ? c0 : cb ? colIndex(cb) : sh.maxCols;
      const r1 = single ? r0 : rb ? Number(rb) : sh.maxRows;
      return range(sh, r0, c0, r1 - r0 + 1, c1 - c0 + 1);
    },
  };
  const props = new Map();
  const blob = (bytes, mime, name) => ({ bytes: Buffer.from(bytes), mime, name, getBytes: () => [...Buffer.from(bytes)] });
  const g = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      newRichTextValue: () => { const b = { text: '', setText: (t) => { b.text = t; return b; }, build: () => ({ text: b.text }) }; return b; },
    },
    DriveApp: {
      createFolder: (name) => ({ id: 'folder-1', name, getId: () => 'folder-1', createFile: (bl) => { const id = `file-${nextId++}`; files.set(id, { ...bl, trashed: false, parent: 'folder-1' }); return { getId: () => id, getUrl: () => `https://drive.google.com/file/d/${id}/view` }; } }),
      getFolderById: (id) => { if (id !== 'folder-1') throw new Error('No item with the given ID could be found'); return g.DriveApp.createFolder(); },
      getFileById: (id) => {
        const f = files.get(id);
        // Like Drive: a binned file can still be opened by id until the bin is emptied.
        if (!f) throw new Error('No item with the given ID could be found, or you do not have permission to access it.');
        return { getBlob: () => f, isTrashed: () => f.trashed, setTrashed: (t) => { f.trashed = t; } };
      },
    },
    Utilities: {
      // enough of formatDate for the two patterns Code.gs uses (the sheet's zone is UTC+8)
      formatDate: (d, _tz, pattern) => { const s = new Date(d.getTime() + 8 * 3600e3).toISOString(); return pattern === 'yyyy-MM-dd' ? s.slice(0, 10) : s.slice(11, 19); },
      newBlob: (bytes, mime, name) => blob(bytes, mime, name),
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
  };
  return { globals: g, sheets, files, ss };
}

function loadScript(secret = 's3cret') {
  const fake = fakeAppsScript();
  const ctx = vm.createContext({ ...fake.globals, Date, JSON, String, Math, Error });
  const src = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8').replace("const SECRET = 'CHANGE-ME';", `const SECRET = '${secret}';`);
  vm.runInContext(src, ctx);
  // fetch → doPost, the way the web app would answer
  const fetchImpl = async (_url, init) => {
    const out = ctx.doPost({ postData: { contents: init.body } });
    return new Response(out.text, { status: 200 });
  };
  return { fake, ctx, fetchImpl };
}

const open = async (fetchImpl, secret = 's3cret') => {
  const c = appsScriptClients({ url: 'https://script.example/exec', secret, fetchImpl });
  const s = new Store({ sheets: c.sheets, drive: c.drive, sheetId: 'x', folderId: 'x' });
  await s.init();
  clearInterval(s.timer); clearInterval(s.sesiTimer);
  return s;
};
const tab = (fake, name) => fake.sheets.find((s) => s.name === name);
const rowFor = (fake, id) => tab(fake, 'Peserta').cells.find((r) => r?.[0] === id);
const col = (n) => PESERTA.indexOf(n);

test('the script refuses a wrong or unset secret', async () => {
  const { fetchImpl } = loadScript();
  await assert.rejects(open(fetchImpl, 'wrong'), (e) => e.code === 401);
  const unset = fakeAppsScript();
  const ctx = vm.createContext({ ...unset.globals, Date, JSON, String, Math, Error });
  vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  assert.equal(JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ secret: 'CHANGE-ME', op: 'tabs' }) } }).text).code, 401);
  assert.equal(JSON.parse(ctx.doGet().text).secretSet, false);
});

test('first start creates the tabs, headers, protection and hidden columns', async () => {
  const { fake, fetchImpl } = loadScript();
  await open(fetchImpl);
  const p = tab(fake, 'Peserta');
  assert.deepEqual(p.cells[0], PESERTA);
  assert.ok(p.maxCols >= PESERTA.length, 'grid grew to fit the header');
  assert.equal(p.frozen, 1);
  assert.equal(p.warningOnly, true);
  assert.equal(p.bold, 'bold');
  assert.deepEqual(p.hidden, [col('token_hash') + 1, col('state_json') + 1]);
  assert.match(tab(fake, 'README').cells[0][0], /KBSME/);
  await open(fetchImpl); // a second start changes nothing
  assert.equal(fake.sheets.length, 4);
});

test('journeys save as text, survive a restart, and follow a sorted sheet', async () => {
  const { fake, fetchImpl } = loadScript();
  const s = await open(fetchImpl);
  const a = s.create({ privacyVersion: 'v3' });
  const b = s.create({ privacyVersion: 'v3' });
  s.update(a.journey, { state: { profile: { business: 'Ain Tudung' }, costs: { sellingPrice: '25', materialCost: '12' }, evidenceText: '=IMPORTXML("http://x")' } });
  await s.flush();
  let row = rowFor(fake, a.journey.id);
  assert.equal(row[col('evidence_text')], '=IMPORTXML("http://x")');
  assert.equal(row[col('provisional_balance')], '13.00');
  const p = tab(fake, 'Peserta');
  [p.cells[1], p.cells[2]] = [p.cells[2], p.cells[1]]; // a trainer sorts the sheet
  s.update(a.journey, { state: { profile: { business: 'Ain Tudung Baru' } } });
  await s.flush();
  assert.equal(rowFor(fake, a.journey.id)[col('business')], 'Ain Tudung Baru');
  assert.equal(rowFor(fake, b.journey.id)[col('business')], '');
  const s2 = await open(fetchImpl);
  assert.equal(s2.verify(a.journey.id, a.token)?.state.profile.business, 'Ain Tudung Baru');
});

test('participant text is stored exactly as typed, never as a formula', async () => {
  const { fake, fetchImpl } = loadScript();
  const c = appsScriptClients({ url: 'u', secret: 's3cret', fetchImpl });
  const s = await open(fetchImpl);
  assert.deepEqual(await c.selfTest(), []);
  const { journey } = s.create({ privacyVersion: 'v3' });
  s.update(journey, { state: { evidenceText: '=IMPORTXML("http://x")', profile: { business: '+60 Kedai', product: '0012', customer: 'TRUE' }, costs: { sellingPrice: '25.50' } } });
  await s.flush();
  const row = rowFor(fake, journey.id);
  assert.equal(row[col('evidence_text')], '=IMPORTXML("http://x")');
  assert.equal(row[col('business')], '+60 Kedai');
  assert.equal(row[col('product')], '0012');
  assert.equal(row[col('customer')], 'TRUE');
  assert.equal(row[col('cost_selling_price')], '25.50');
  assert.equal(row[col('provisional_balance')], '');
  assert.equal((await open(fetchImpl)).journeys.get(journey.id).state.profile.product, '0012');
});

test('evidence files: upload, read back, replace, delete with the participant', async () => {
  const { fake, fetchImpl } = loadScript();
  const s = await open(fetchImpl);
  const { journey, token } = s.create({ privacyVersion: 'v3' });
  const png = readFileSync(new URL('./fixtures/whatsapp-chat.png', import.meta.url));
  await s.saveFile(journey, { name: 'chat.png', mime: 'image/png', bytes: png });
  const first = journey.evidence.fileId;
  assert.match(journey.evidence.link, /^https:\/\/drive\.google\.com\/file\/d\//);
  s.fileCache.clear();
  assert.ok((await s.readFile(journey)).bytes.equals(png), 'bytes survive the base64 round trip');
  await s.saveFile(journey, { name: 'kos.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4 x') });
  assert.equal(fake.files.get(first).trashed, true, 'the replaced file is binned');
  await s.flush();
  await s.remove(journey);
  assert.ok([...fake.files.values()].every((f) => f.trashed));
  assert.equal(rowFor(fake, journey.id), undefined);
  await assert.rejects(s.readFile({ id: 'x', evidence: { fileId: first, mime: 'image/png' } }), (e) => e.code === 404);
  await s.deleteFile(first); // already in the bin: no error
  assert.equal((await open(fetchImpl)).verify(journey.id, token), null);
});

test('session codes typed by hand, including real date cells', async () => {
  const { fake, fetchImpl } = loadScript();
  const s = await open(fetchImpl);
  const sesi = tab(fake, 'Sesi');
  sesi.cells[1] = ['KL-NOV26', 'Sesi KL', new Date('2026-11-20T00:00:00+08:00'), ''];
  sesi.cells[2] = ['OLD', 'Lama', '', new Date('2020-01-01T00:00:00+08:00')];
  // "active until today" (a date cell, midnight in the sheet's zone) is valid for the whole day
  const today = new Date(new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00+08:00');
  sesi.cells[3] = ['TODAY', 'Hari ini', '', today];
  await s.loadSessions();
  assert.equal(s.sessionByCode('kl-nov26')?.name, 'Sesi KL');
  assert.equal(s.sessionByCode('kl-nov26')?.sessionDate, '2026-11-20');
  assert.equal(s.sessionByCode('OLD'), null);
  assert.equal(s.sessionByCode('TODAY')?.code, 'TODAY');
});

test('AI log rows are appended and counted after a restart', async () => {
  const { fake, fetchImpl } = loadScript();
  const s = await open(fetchImpl);
  s.logAi({ journeyId: 'j1', model: 'claude-sonnet-5-5', status: 'ok', input: 1200, output: 900 });
  await s.flush();
  assert.equal(tab(fake, 'Log AI').cells[1][1], 'j1');
  assert.deepEqual((await open(fetchImpl)).aiCount('j1'), { mine: 1, all: 1 });
});

test('a script error page or quota error becomes a retryable error', async () => {
  const html = appsScriptClients({ url: 'u', secret: 's', fetchImpl: async () => new Response('<html>Sign in</html>', { status: 200 }) });
  await assert.rejects(html.ping(), (e) => e.code === 502 && /Anyone/.test(e.message));
  const quota = appsScriptClients({ url: 'u', secret: 's', fetchImpl: async () => new Response(JSON.stringify({ ok: false, code: 429, error: 'Service invoked too many times' })) });
  await assert.rejects(quota.ping(), (e) => e.code === 429);
});

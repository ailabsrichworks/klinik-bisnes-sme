// KBSME Business Quick Fix — bridge between the app's server and this Google Sheet.
//
// Setup (once): in the Sheet, Extensions → Apps Script → replace everything with this file →
// set SECRET below to the same value as APPS_SCRIPT_SECRET in the server's .env → Save →
// Deploy → New deployment → type "Web app", Execute as "Me", Who has access "Anyone" →
// Deploy → allow access → copy the Web app URL into APPS_SCRIPT_URL.
// After changing this file: Deploy → Manage deployments → edit → Version "New version".
//
// The server sends every request with SECRET; without it the script refuses. Uploaded
// evidence goes to a Drive folder "KBSME Bukti peserta" that the script creates in your Drive.

const SECRET = 'CHANGE-ME';
const FOLDER_NAME = 'KBSME Bukti peserta';

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    if (SECRET === 'CHANGE-ME' || req.secret !== SECRET) return reply({ ok: false, code: 401, error: 'Secret salah atau belum ditetapkan dalam Code.gs.' });
    out = { ok: true, result: handle(req) };
  } catch (err) {
    const m = String((err && err.message) || err);
    const code = /too many times|rate limit|quota/i.test(m) ? 429
      : /lock|timed out|maximum execution|try again/i.test(m) ? 503
      : /not found|no item with the given id|access denied/i.test(m) ? 404 : 400;
    out = { ok: false, code: code, error: m };
  }
  return reply(out);
}

// Open the Web app URL in a browser to check the deployment works.
function doGet() {
  return reply({ ok: true, app: 'kbsme-quick-fix', secretSet: SECRET !== 'CHANGE-ME' });
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function handle(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  switch (req.op) {
    case 'tabs':
      return tabs(ss);
    case 'addTabs':
      return withLock(function () {
        req.tabs.forEach(function (t) {
          if (ss.getSheetByName(t.title)) return;
          const sh = ss.insertSheet(t.title);
          if (t.frozen) sh.setFrozenRows(t.frozen);
        });
        return tabs(ss);
      });
    case 'format':
      return withLock(function () { req.items.forEach(function (f) { format(ss, f); }); return true; });
    case 'read':
      return read(ss.getRange(req.range), ss.getSpreadsheetTimeZone());
    case 'write':
      return withLock(function () { req.data.forEach(function (d) { write(ss.getRange(d.range), d.values); }); return true; });
    case 'append':
      return withLock(function () {
        const sh = ss.getSheetByName(req.tab);
        if (!sh) throw new Error('Tab not found: ' + req.tab);
        const row = sh.getLastRow() + 1;
        write(sh.getRange(row, 1), req.values);
        return row;
      });
    case 'selfTest':
      return selfTest(ss);
    case 'fileCreate': {
      const blob = Utilities.newBlob(Utilities.base64Decode(req.base64), req.mime, req.name);
      const f = folder().createFile(blob);
      return { id: f.getId(), webViewLink: f.getUrl() };
    }
    case 'fileGet':
      return Utilities.base64Encode(DriveApp.getFileById(req.id).getBlob().getBytes());
    case 'fileDelete':
      DriveApp.getFileById(req.id).setTrashed(true); // Drive empties the bin after 30 days
      return true;
  }
  throw new Error('Unknown op: ' + req.op);
}

function tabs(ss) {
  return ss.getSheets().map(function (s) { return { title: s.getName(), sheetId: s.getSheetId() }; });
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// Values as the Sheets API returns them, trailing blank cells and rows dropped. Dates typed by hand
// come back as text: a date alone as YYYY-MM-DD (so "active until 30 Nov" means the whole day), a
// date with a time as an ISO timestamp.
function read(range, tz) {
  const rows = range.getValues().map(function (row) {
    const r = row.map(function (v) {
      if (!(v instanceof Date)) return v;
      return Utilities.formatDate(v, tz, 'HH:mm:ss') === '00:00:00' ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
    });
    while (r.length && (r[r.length - 1] === '' || r[r.length - 1] === null)) r.pop();
    return r;
  });
  while (rows.length && !rows[rows.length - 1].length) rows.pop();
  return rows;
}

// Writes values as plain text, starting at the range's top-left cell and growing the sheet if
// needed. The cells are formatted as text so "13.00" or "0012" stay as typed, and anything starting
// with = + - @ gets a leading apostrophe so participant text can never become a formula.
function write(start, values) {
  if (!values.length) return;
  const sh = start.getSheet();
  const r0 = start.getRow(), c0 = start.getColumn();
  const width = Math.max.apply(null, values.map(function (r) { return r.length; }));
  const lastRow = r0 + values.length - 1, lastCol = c0 + width - 1;
  if (sh.getMaxRows() < lastRow) sh.insertRowsAfter(sh.getMaxRows(), lastRow - sh.getMaxRows());
  if (sh.getMaxColumns() < lastCol) sh.insertColumnsAfter(sh.getMaxColumns(), lastCol - sh.getMaxColumns());
  const text = values.map(function (row) {
    const out = [];
    for (let i = 0; i < width; i++) out.push(asText(row[i]));
    return out;
  });
  sh.getRange(r0, c0, values.length, width).setNumberFormat('@').setValues(text);
}

function asText(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@']/.test(s) ? "'" + s : s;
}

// Writes tricky values to a spare cell, reads them back and clears it. The server runs this at
// start-up to confirm participant text is stored exactly as typed.
function selfTest(ss) {
  const sh = ss.getSheetByName('README') || ss.getSheets()[0];
  const probe = ['=1+1', '+5', '-3', '@x', "'q", '13.00', '0012', 'TRUE', '2026-11-30'];
  const cell = sh.getRange(1, 30, 1, probe.length);
  return withLock(function () {
    write(cell, [probe]);
    const back = cell.getValues()[0].map(function (v) { return v instanceof Date ? 'date' : v; });
    cell.clearContent();
    return probe.map(function (p, i) { return { sent: p, got: back[i] }; });
  });
}

function format(ss, f) {
  const sh = ss.getSheetByName(f.tab);
  if (!sh) return;
  if (f.kind === 'protectHeader') {
    sh.getRange(1, 1, 1, sh.getMaxColumns()).protect().setDescription('Header — app bergantung pada nama lajur ini').setWarningOnly(true);
  } else if (f.kind === 'boldHeader') {
    sh.getRange(1, 1, 1, sh.getMaxColumns()).setFontWeight('bold');
  } else if (f.kind === 'hideColumn') {
    sh.hideColumns(f.col + 1);
  }
}

// The evidence folder: created in your Drive on first upload, remembered in Script Properties.
function folder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* deleted: make a new one */ }
  }
  const f = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

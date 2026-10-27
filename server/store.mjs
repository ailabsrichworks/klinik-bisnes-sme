// Participant data in one Google Sheet, uploaded evidence and report PDFs in a Drive folder.
//
// Tabs: Peserta (one row per participant), Sesi (session codes, edited by hand), README
// (column notes). Created on first run.
//
// The server keeps every journey in memory and writes changed rows in batches every few
// seconds (one read + up to two writes per flush), well inside the Sheets quota of
// 60 requests/min. Rows are found by their id on each flush, so trainers can sort or
// filter the sheet without the app overwriting the wrong row. Run ONE server instance.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { PILLARS, calculate, calcInputs } from '../public/js/content.mjs';

// One column per participant answer, in the order of the four steps.
export const PESERTA = [
  'id', 'session_code', 'created_at', 'updated_at', 'step',
  // Langkah 1: about the business
  'full_name', 'business', 'industry', 'business_model', 'years_running', 'monthly_sales',
  // Langkah 2: the pillar and the 3 ticked situations
  'pillar', 'situation_1', 'situation_2', 'situation_3',
  // Langkah 3: optional evidence (not analysed; for trainers)
  'evidence_text', 'evidence_file', 'evidence_link',
  // Langkah 4: the report
  'calc_inputs', 'calc_result', 'workshop_output',
  'plan_action', 'plan_success_measure', 'plan_start_date', 'plan_proof',
  'report_link', 'report_at', 'report_downloaded_at',
  'consent_at', 'privacy_notice_version',
  'token_hash', 'state_json',
];
export const SESI = ['code', 'name', 'session_date', 'active_until', 'notes'];
export const STEP_NAMES = ['Maklumat bisnes', 'Pilih cabaran', 'Bukti (pilihan)', 'Laporan'];
const README = [
  ['KBSME Business Quick Fix — data peserta'],
  [''],
  ['Peserta', 'Satu baris setiap peserta. Dikemas kini oleh app; jangan edit atau padam lajur id, token_hash dan state_json.'],
  ['', 'Untuk menyusun atau menapis, guna Filter view (Data → Filter views) supaya susunan baris asal kekal.'],
  ['', 'step: langkah terakhir yang dicapai (1 Maklumat bisnes, 2 Pilih cabaran, 3 Bukti, 4 Laporan). pillar: Sales / Marketing / Urus Duit. situation_1–3: tiga situasi yang ditanda.'],
  ['', 'evidence_text / evidence_link: bukti pilihan yang ditampal atau dimuat naik (tidak dianalisis oleh app). calc_inputs / calc_result: angka kalkulator dan hasilnya.'],
  ['', 'workshop_output: hasil latihan Quick Fix. plan_*: pelan tindakan 7 hari. report_link: laporan PDF (disimpan apabila peserta sampai laporan, dikemas kini jika berubah).'],
  ['Sesi', 'Kod sesi untuk fasilitator. Isi code (huruf besar), name, session_date dan active_until (kosong = tiada tamat). Pautan: /?c=KOD'],
  [''],
  ['Padam data', 'Butang "Padam data saya" dalam app mengosongkan baris peserta dan memadam fail dalam Drive. Untuk permintaan manual, kosongkan baris dan padam fail di Drive.'],
];
// Columns that only the earlier (AI) version had: a Peserta tab with these is left alone.
const LEGACY_MARKERS = ['diagnosis_pathway', 'ai_quick_fix'];

const HIDDEN = ['token_hash', 'state_json'];
const CELL_MAX = 49000; // Sheets allows 50,000 characters per cell
const FLUSH_MS = Number(process.env.SHEETS_FLUSH_MS || 5000);
const SESI_REFRESH_MS = 60_000;
const DAY = 24 * 60 * 60 * 1000;

const letter = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
const cell = (v) => { const s = v == null ? '' : String(v); return s.length > CELL_MAX ? s.slice(0, CELL_MAX - 1) + '…' : s; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (tab) => `'${tab}'`;

// Retries quota (429) and server (5xx) errors with backoff; other errors are thrown at once.
async function withRetry(fn, label, tries = 5) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (err) {
      const code = Number(err?.code || err?.status || err?.response?.status);
      if (i >= tries - 1 || !(code === 429 || code >= 500)) throw err;
      const wait = Math.min(30_000, 1000 * 2 ** i) + Math.floor(Math.random() * 500);
      console.warn(`[store] ${label} got ${code}, retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
}

// Sheets dates come back as day serials (UNFORMATTED_VALUE) or text. Date-only = end of that day, Malaysia time.
function parseUntil(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return Date.UTC(1899, 11, 30) + v * DAY - 8 * 3600e3 + (Number.isInteger(v) ? DAY - 1 : 0);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T23:59:59+08:00`);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// The current pillar's answers (each pillar keeps its own, so switching back loses nothing).
export function pillarAnswers(state = {}) {
  const pillar = PILLARS[state.pillar] ? state.pillar : null;
  const a = (pillar && state.byPillar?.[pillar]) || {};
  return { pillar, selected: Array.isArray(a.selected) ? a.selected.filter((i) => Number.isInteger(i) && i >= 0 && i < 10).slice(0, 3) : [], calc: a.calc || {}, workOutput: a.workOutput || '', plan: a.plan || {} };
}

// One readable row for trainers; state_json keeps the full state for the participant's app.
function toRow(j) {
  const s = j.state || {};
  const p = s.profile || {};
  const { pillar, selected, calc, workOutput, plan } = pillarAnswers(s);
  const P = pillar && PILLARS[pillar];
  const reachedReport = (j.step ?? 0) >= 3 && selected.length === 3;
  const result = reachedReport ? calculate(pillar, calc) : null;
  return {
    id: j.id, session_code: j.sessionCode, created_at: j.createdAt, updated_at: j.updatedAt,
    step: j.step == null ? '' : `${j.step + 1} · ${STEP_NAMES[j.step] || ''}`,
    full_name: p.name, business: p.business, industry: p.industry, business_model: p.businessModel,
    years_running: p.businessAge, monthly_sales: p.monthlySales,
    pillar: P?.name || '',
    situation_1: P && selected[0] != null ? P.issues[selected[0]] : '',
    situation_2: P && selected[1] != null ? P.issues[selected[1]] : '',
    situation_3: P && selected[2] != null ? P.issues[selected[2]] : '',
    evidence_text: s.evidenceText, evidence_file: j.evidence?.name, evidence_link: j.evidence?.link,
    calc_inputs: reachedReport ? P.fields.map((f) => `${f.label}: ${calcInputs(pillar, calc)[f.id]}`).join('\n') : '',
    calc_result: result ? [...result.lines, result.note].join('\n') : '',
    workshop_output: reachedReport ? workOutput : '',
    plan_action: reachedReport ? plan.action : '', plan_success_measure: reachedReport ? plan.measure : '',
    plan_start_date: reachedReport ? plan.startDate : '', plan_proof: reachedReport ? plan.proof : '',
    report_link: j.report?.link, report_at: j.report?.at, report_downloaded_at: j.reportDownloadedAt,
    consent_at: j.consent.privacyAt, privacy_notice_version: j.consent.privacyVersion,
    token_hash: j.tokenHash,
    state_json: JSON.stringify({ state: s, consent: j.consent, evidence: j.evidence || null, report: j.report || null, reportDownloadedAt: j.reportDownloadedAt || null }),
  };
}

function fromRow(r) {
  if (!r.id || !r.token_hash) return null;
  let extra = {};
  try { extra = JSON.parse(r.state_json || '{}'); } catch { /* row edited by hand: start from blank state */ }
  const step = parseInt(String(r.step), 10);
  return {
    id: r.id, tokenHash: r.token_hash, sessionCode: r.session_code || '', createdAt: r.created_at, updatedAt: r.updated_at,
    step: Number.isInteger(step) ? step - 1 : null, state: extra.state || {}, consent: extra.consent || {},
    evidence: extra.evidence || null, report: extra.report || null, reportDownloadedAt: extra.reportDownloadedAt || null,
  };
}

export class Store {
  constructor({ sheets, drive, sheetId, folderId }) {
    Object.assign(this, { sheets, drive, sheetId, folderId });
    this.journeys = new Map(); // id → journey
    this.dirty = new Set();
    this.deleted = new Set();
    this.sessions = [];
    this.cols = {}; // tab → header array as it is in the sheet
    this.tab = 'Peserta'; // the participant tab (see ensureSchema)
    this.flushing = null;
  }

  // ─── startup ───
  async init() {
    await this.ensureSchema();
    await Promise.all([this.loadJourneys(), this.loadSessions()]);
    this.timer = setInterval(() => this.flush().catch((e) => console.error('[store] flush failed', e.message)), FLUSH_MS);
    this.sesiTimer = setInterval(() => this.loadSessions().catch((e) => console.error('[store] Sesi refresh failed', e.message)), SESI_REFRESH_MS);
    this.timer.unref?.(); this.sesiTimer.unref?.();
    return this;
  }

  async stop() {
    clearInterval(this.timer); clearInterval(this.sesiTimer);
    await this.flush();
  }

  // Creates missing tabs, writes header rows, freezes and protects them, hides internal columns.
  // A Peserta tab from the earlier AI version is kept as it is; new rows then go to "Peserta v4".
  async ensureSchema() {
    const { data } = await withRetry(() => this.sheets.spreadsheets.get({ spreadsheetId: this.sheetId, fields: 'sheets.properties' }), 'read tabs');
    const ids = Object.fromEntries((data.sheets || []).map((s) => [s.properties.title, s.properties.sheetId]));
    const header = async (title) => (await withRetry(() => this.sheets.spreadsheets.values.get({ spreadsheetId: this.sheetId, range: `${q(title)}!1:1` }), `read ${title} header`)).data.values?.[0] || [];
    if (ids.Peserta !== undefined && (await header('Peserta')).some((h) => LEGACY_MARKERS.includes(h))) {
      this.tab = 'Peserta v4';
      console.log('[store] the Peserta tab is from the earlier AI version; it is left as it is and new rows go to "Peserta v4"');
    }
    const want = { [this.tab]: PESERTA, Sesi: SESI, README: null };
    const missing = Object.keys(want).filter((t) => ids[t] === undefined);
    if (missing.length) {
      const res = await withRetry(() => this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: title === 'README' ? 0 : 1 } } } })) },
      }), 'add tabs');
      for (const r of res.data.replies || []) if (r.addSheet) ids[r.addSheet.properties.title] = r.addSheet.properties.sheetId;
    }
    const writes = [], format = [];
    for (const [title, cols] of Object.entries(want)) {
      if (!cols) {
        if (missing.includes(title)) writes.push({ range: `${q(title)}!A1`, values: README });
        continue;
      }
      const got = await header(title);
      const add = cols.filter((h) => !got.includes(h));
      this.cols[title] = [...got, ...add];
      if (add.length) writes.push({ range: `${q(title)}!${letter(got.length)}1`, values: [add] });
      if (missing.includes(title)) {
        format.push({ addProtectedRange: { protectedRange: { range: { sheetId: ids[title], startRowIndex: 0, endRowIndex: 1 }, description: 'Header — app bergantung pada nama lajur ini', warningOnly: true } } });
        format.push({ repeatCell: { range: { sheetId: ids[title], startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
        if (title === this.tab) {
          for (const h of HIDDEN) {
            const i = this.cols[title].indexOf(h);
            format.push({ updateDimensionProperties: { range: { sheetId: ids[title], dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });
          }
        }
      }
    }
    if (writes.length) await withRetry(() => this.sheets.spreadsheets.values.batchUpdate({ spreadsheetId: this.sheetId, requestBody: { valueInputOption: 'RAW', data: writes } }), 'write headers');
    if (format.length) await withRetry(() => this.sheets.spreadsheets.batchUpdate({ spreadsheetId: this.sheetId, requestBody: { requests: format } }), 'format headers');
  }

  async readTab(title) {
    const cols = this.cols[title];
    const { data } = await withRetry(() => this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId, range: `${q(title)}!A2:${letter(cols.length - 1)}`, valueRenderOption: 'UNFORMATTED_VALUE',
    }), `read ${title}`);
    return (data.values || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i] ?? ''])));
  }

  async loadJourneys() {
    for (const r of await this.readTab(this.tab)) {
      const j = fromRow(r);
      if (j) this.journeys.set(j.id, j);
    }
  }

  async loadSessions() {
    this.sessions = (await this.readTab('Sesi'))
      .filter((r) => String(r.code).trim())
      .map((r) => ({ code: String(r.code).trim().toUpperCase(), name: String(r.name || '').trim(), sessionDate: r.session_date, until: parseUntil(r.active_until) }));
  }

  // ─── sessions ───
  sessionByCode(code) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return null;
    const s = this.sessions.find((x) => x.code === c);
    if (!s || (s.until && s.until < Date.now())) return null;
    let date = s.sessionDate;
    if (typeof date === 'number') date = new Date(Date.UTC(1899, 11, 30) + date * DAY).toISOString().slice(0, 10);
    return { code: s.code, name: s.name || s.code, sessionDate: date ? String(date) : null };
  }

  // ─── journeys ───
  create({ sessionCode = '', privacyVersion }) {
    const id = randomBytes(9).toString('base64url');
    const token = randomBytes(24).toString('base64url');
    const t = now();
    const j = { id, tokenHash: sha(token), sessionCode, createdAt: t, updatedAt: t, step: 0, state: {}, consent: { privacyVersion, privacyAt: t }, evidence: null, report: null, reportDownloadedAt: null };
    this.journeys.set(id, j);
    this.dirty.add(id);
    return { journey: j, token };
  }

  // Constant-time token check; returns the journey or null.
  verify(id, token) {
    const j = typeof id === 'string' && this.journeys.get(id);
    if (!j || typeof token !== 'string' || !token) return null;
    const a = Buffer.from(sha(token), 'hex'), b = Buffer.from(j.tokenHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b) ? j : null;
  }

  update(j, patch) {
    Object.assign(j, patch, { updatedAt: now() });
    this.dirty.add(j.id);
  }

  setConsent(j, version) {
    Object.assign(j.consent, { privacyVersion: version, privacyAt: now() });
    this.update(j, {});
  }

  // Clears the participant's row and deletes their Drive files (evidence and report).
  async remove(j) {
    if (j.evidence?.fileId) await this.deleteFile(j.evidence.fileId);
    if (j.report?.fileId) await this.deleteFile(j.report.fileId);
    this.journeys.delete(j.id);
    this.dirty.delete(j.id);
    this.deleted.add(j.id);
    await this.flush();
  }

  // ─── evidence files (stored for trainers, not analysed) ───
  async saveFile(j, { name, mime, bytes }) {
    const old = j.evidence?.fileId;
    const safe = name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'bukti';
    const { data } = await withRetry(() => this.drive.files.create({
      requestBody: { name: `${j.id} · ${safe}`, parents: [this.folderId] },
      media: { mimeType: mime, body: Readable.from(bytes) },
      supportsAllDrives: true,
      fields: 'id, webViewLink',
    }), 'upload file');
    this.update(j, { evidence: { fileId: data.id, link: data.webViewLink || '', name: safe, mime, size: bytes.length, at: now() } });
    if (old) await this.deleteFile(old);
    return j.evidence;
  }

  async removeEvidenceFile(j) {
    if (!j.evidence?.fileId) return;
    await this.deleteFile(j.evidence.fileId);
    this.update(j, { evidence: null });
  }

  // The participant's report PDF: one file per participant, replaced when it changes.
  async saveReport(j, bytes, hash) {
    const old = j.report?.fileId;
    const name = `Laporan · ${String(j.state?.profile?.business || 'Peserta').replace(/[^\w.\- ]+/g, '').trim().slice(0, 80) || 'Peserta'} · ${j.id}.pdf`;
    const { data } = await withRetry(() => this.drive.files.create({
      requestBody: { name, parents: [this.folderId] },
      media: { mimeType: 'application/pdf', body: Readable.from(bytes) },
      supportsAllDrives: true,
      fields: 'id, webViewLink',
    }), 'upload report');
    if (!this.journeys.has(j.id)) return this.deleteFile(data.id); // deleted while the report was being made
    this.update(j, { report: { fileId: data.id, link: data.webViewLink || '', at: now(), hash } });
    if (old) await this.deleteFile(old);
    return j.report;
  }

  async deleteFile(fileId) {
    try {
      await withRetry(() => this.drive.files.delete({ fileId, supportsAllDrives: true }), 'delete file');
    } catch (err) {
      if (Number(err?.code || err?.status) !== 404) throw err;
    }
  }

  // ─── writing ───
  flush() {
    this.flushing = (this.flushing || Promise.resolve()).catch(() => {}).then(() => this.#flush());
    return this.flushing;
  }

  async #flush() {
    if (!this.dirty.size && !this.deleted.size) return;
    const tab = this.tab, cols = this.cols[tab];
    const dirty = [...this.dirty], deleted = [...this.deleted];
    this.dirty.clear(); this.deleted.clear();
    try {
      const updates = [], appends = [];
      // Find each row by id now, in case rows were sorted or moved by hand.
      const idCol = letter(cols.indexOf('id'));
      const { data } = await withRetry(() => this.sheets.spreadsheets.values.get({ spreadsheetId: this.sheetId, range: `${q(tab)}!${idCol}:${idCol}` }), 'read ids');
      const rowOf = new Map((data.values || []).map((r, i) => [r[0], i + 1]).filter(([id], i) => i > 0 && id));
      const end = letter(cols.length - 1);
      for (const id of dirty) {
        const j = this.journeys.get(id);
        if (!j) continue;
        const v = toRow(j);
        const values = [cols.map((c) => cell(v[c]))];
        if (rowOf.has(id)) updates.push({ range: `${q(tab)}!A${rowOf.get(id)}:${end}${rowOf.get(id)}`, values });
        else appends.push(values[0]);
      }
      for (const id of deleted) {
        if (rowOf.has(id)) updates.push({ range: `${q(tab)}!A${rowOf.get(id)}:${end}${rowOf.get(id)}`, values: [cols.map(() => '')] });
      }
      // RAW: participant text is stored as text, never run as a formula.
      if (updates.length) await withRetry(() => this.sheets.spreadsheets.values.batchUpdate({ spreadsheetId: this.sheetId, requestBody: { valueInputOption: 'RAW', data: updates } }), 'update rows');
      if (appends.length) await withRetry(() => this.sheets.spreadsheets.values.append({ spreadsheetId: this.sheetId, range: `${q(tab)}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: appends } }), 'add rows');
    } catch (err) {
      // Keep the changes for the next flush.
      dirty.forEach((id) => this.journeys.has(id) && this.dirty.add(id));
      deleted.forEach((id) => this.deleted.add(id));
      throw err;
    }
  }
}

// Real Google clients from a service-account key (JSON text or base64 of it).
export async function googleClients(serviceAccount) {
  const { google } = await import('googleapis');
  const text = serviceAccount.trim().startsWith('{') ? serviceAccount : Buffer.from(serviceAccount, 'base64').toString('utf8');
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(text),
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  });
  return { sheets: google.sheets({ version: 'v4', auth }), drive: google.drive({ version: 'v3', auth }) };
}

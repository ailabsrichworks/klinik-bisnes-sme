// Participant data in one Google Sheet, uploaded evidence in a Shared Drive folder.
//
// Tabs: Peserta (one row per participant), Sesi (session codes, edited by hand),
// Log AI (one row per AI call), README (column notes). Created on first run.
//
// The server keeps every journey in memory and writes changed rows in batches every few
// seconds (one read + up to three writes per flush), well inside the Sheets quota of
// 60 requests/min. Rows are found by their id on each flush, so trainers can sort or
// filter the sheet without the app overwriting the wrong row. Run ONE server instance.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { costSummary, liveMath, programmeFit, PATH_LABELS, METRIC_LABELS } from '../public/js/rules.mjs';

// One column per participant answer and per AI result, in the order of the five steps.
export const PESERTA = [
  'id', 'session_code', 'created_at', 'updated_at', 'step',
  // Langkah 1: business
  'participant', 'business', 'product', 'customer', 'channel', 'revenue', 'business_active', 'owner_authority', 'pain',
  // Langkah 2: evidence
  'evidence_text', 'evidence_file', 'evidence_link',
  'cost_selling_price', 'cost_material', 'cost_packaging', 'cost_delivery', 'cost_platform', 'cost_promotion', 'cost_other', 'provisional_balance',
  'content_posts_week', 'content_hours_week', 'content_has_plan', 'content_tracks_results',
  'live_experience', 'live_viewers', 'live_claims', 'live_paid', 'live_unpaid_rate', 'live_invoice_timing',
  // Langkah 3: AI diagnosis (as the AI returned it)
  'diagnosis_at', 'diagnosis_by', 'diagnosis_pathway', 'diagnosis_title', 'diagnosis_reason', 'diagnosis_observations', 'diagnosis_unknowns',
  'diagnosis_strength', 'diagnosis_guard', 'ai_quick_fix', 'ai_tasks_source', 'ai_tasks',
  // Langkah 3–4: the participant's choices and edits
  'pathway', 'confirmed', 'quick_fix', 'quick_fix_edited', 'quality_checks',
  // Langkah 5: tracker and Day 7
  'tasks', 'tasks_done', 'tracker_started_at', 'day7_result_1', 'day7_result_2', 'day7_result_3', 'review_notes',
  'programme', 'next_step', 'report_link', 'report_at',
  'marketing_consent', 'marketing_consent_at', 'privacy_notice_version', 'privacy_accepted_at', 'ai_consent_at',
  'token_hash', 'state_json',
];
export const SESI = ['code', 'name', 'session_date', 'active_until', 'notes'];
// One row per AI call, including reruns: what was sent (without the file's bytes) and what came back.
export const LOG_AI = ['time', 'journey_id', 'model', 'status', 'input_tokens', 'output_tokens', 'evidence_file', 'pathway', 'title', 'guard', 'tasks_source', 'error', 'request', 'response'];
const README = [
  ['KBSME Business Quick Fix — data peserta'],
  [''],
  ['Peserta', 'Satu baris setiap peserta. Dikemas kini oleh app; jangan edit atau padam lajur id, token_hash dan state_json.'],
  ['', 'Untuk menyusun atau menapis, guna Filter view (Data → Filter views) supaya susunan baris asal kekal.'],
  ['', 'evidence_link: fail bukti dalam Shared Drive. provisional_balance: baki sementara daripada kos diketahui sahaja (bukan untung).'],
  ['', 'tasks: 7 tugasan dengan status. programme: cadangan programme (ready / pending / withheld / none). report_link: laporan PDF peserta (disimpan apabila peserta sampai Langkah 5, dikemas kini jika berubah).'],
  ['Sesi', 'Kod sesi untuk fasilitator. Isi code (huruf besar), name, session_date dan active_until (kosong = tiada tamat). Pautan: /?c=KOD'],
  ['Log AI', 'Satu baris setiap panggilan AI (termasuk jana semula): masa, peserta, model, status, token, keputusan, dan input (request) serta output penuh AI (response).'],
  [''],
  ['Padam data', 'Butang "Padam data saya" dalam app mengosongkan baris peserta dan memadam fail dalam Drive. Untuk permintaan manual, kosongkan baris dan padam fail di Drive.'],
];

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

const tasksText = (tasks) => (tasks || []).map((t, i) => `${i + 1}. [${t.status || 'belum'}] ${t.title}${t.proof ? ` — bukti: ${t.proof}` : ''}${t.note ? ` — nota: ${t.note}` : ''}`).join('\n');
const aiTasksText = (tasks) => (tasks || []).map((t, i) => `${i + 1}. ${t.title}${t.proof ? ` — bukti: ${t.proof}` : ''}`).join('\n');
const bullets = (list) => (list || []).map((x) => `• ${x}`).join('\n');
const yesNo = (v) => ({ yes: 'ya', no: 'tidak' }[v] ?? v ?? '');
const INVOICE = { during: 'semasa LIVE / segera', same_day: 'hari yang sama', next_day: 'hari berikutnya / lewat' };

// One readable row for trainers; state_json keeps the full state for the participant's app.
function toRow(j) {
  const s = j.state || {};
  const p = s.profile || {}, c = s.costs || {}, ct = s.content || {}, l = s.live || {};
  const d = s.diagnosis;
  const bal = costSummary(c).provisional_balance;
  const lm = liveMath(l);
  const path = s.pathway || d?.pathway;
  const fit = d ? programmeFit({ profile: p, live: l, pathway: path, diagnosedPathway: d.pathway }) : null;
  const labels = METRIC_LABELS[path] || METRIC_LABELS.missing;
  const metric = (i) => (String(s.metrics?.[i] ?? '').trim() ? `${labels[i]}: ${s.metrics[i]}` : '');
  return {
    id: j.id, session_code: j.sessionCode, created_at: j.createdAt, updated_at: j.updatedAt, step: j.step == null ? '' : j.step + 1,
    participant: p.participant, business: p.business, product: p.product, customer: p.customer, channel: p.channel,
    revenue: p.revenue, business_active: yesNo(p.businessActive), owner_authority: yesNo(p.ownerAuthority), pain: p.pain,
    evidence_text: s.evidenceText, evidence_file: j.evidence?.name, evidence_link: j.evidence?.link,
    cost_selling_price: c.sellingPrice, cost_material: c.materialCost, cost_packaging: c.packagingCost, cost_delivery: c.deliveryCost,
    cost_platform: c.platformCost, cost_promotion: c.promotionCost, cost_other: c.otherCost,
    provisional_balance: bal == null ? '' : bal.toFixed(2),
    content_posts_week: ct.postsWeek, content_hours_week: ct.hoursWeek, content_has_plan: yesNo(ct.hasContentPlan), content_tracks_results: yesNo(ct.tracksContent),
    live_experience: yesNo(l.liveExperience), live_viewers: l.liveViewers, live_claims: l.liveClaims, live_paid: l.livePaid,
    live_unpaid_rate: lm.valid ? `${lm.unpaid} (${lm.rate.toFixed(1)}%)` : '', live_invoice_timing: INVOICE[l.invoiceTiming] ?? l.invoiceTiming,
    diagnosis_at: d?.at, diagnosis_by: d ? (d.origin === 'ai' ? 'AI' : 'rule-based (AI off)') : '',
    diagnosis_pathway: d?.pathway, diagnosis_title: d?.title, diagnosis_reason: d?.reason,
    diagnosis_observations: bullets(d?.observations), diagnosis_unknowns: bullets(d?.unknowns),
    diagnosis_strength: d?.strength, diagnosis_guard: d?.guard, ai_quick_fix: d?.quickFix,
    ai_tasks_source: d?.tasksSource, ai_tasks: aiTasksText(d?.tasks),
    pathway: path ? `${path} · ${PATH_LABELS[path] || ''}` : '', confirmed: s.confirmed ? 'ya' : '',
    quick_fix: s.quickFix, quick_fix_edited: d && s.quickFix ? (s.quickFix.trim() === String(d.quickFix || '').trim() ? 'tidak' : 'ya') : '',
    quality_checks: d ? `${(s.quality || []).filter(Boolean).length}/3` : '',
    tasks: tasksText(s.tasks), tasks_done: (s.tasks || []).filter((t) => t.status === 'selesai').length, tracker_started_at: s.trackerStartedAt,
    day7_result_1: metric(0), day7_result_2: metric(1), day7_result_3: metric(2), review_notes: s.reviewNotes,
    programme: fit && fit.status !== 'none' ? `${fit.status}${fit.key ? ` · ${fit.key}` : ''}` : '', next_step: s.nextStep,
    report_link: j.report?.link, report_at: j.report?.at,
    marketing_consent: j.consent.marketing ? 'ya' : '', marketing_consent_at: j.consent.marketingAt,
    privacy_notice_version: j.consent.privacyVersion, privacy_accepted_at: j.consent.privacyAt, ai_consent_at: j.consent.aiAt,
    token_hash: j.tokenHash,
    state_json: JSON.stringify({ state: s, consent: j.consent, evidence: j.evidence || null, report: j.report || null }),
  };
}

function fromRow(r) {
  if (!r.id || !r.token_hash) return null;
  let extra = {};
  try { extra = JSON.parse(r.state_json || '{}'); } catch { /* row edited by hand: start from blank state */ }
  return {
    id: r.id, tokenHash: r.token_hash, sessionCode: r.session_code || '', createdAt: r.created_at, updatedAt: r.updated_at,
    step: r.step === '' ? null : Number(r.step) - 1, state: extra.state || {}, consent: extra.consent || {}, evidence: extra.evidence || null, report: extra.report || null,
  };
}

export class Store {
  constructor({ sheets, drive, sheetId, folderId }) {
    Object.assign(this, { sheets, drive, sheetId, folderId });
    this.journeys = new Map(); // id → journey
    this.dirty = new Set();
    this.deleted = new Set();
    this.pendingLogs = [];
    this.aiCalls = []; // { t, journeyId } within the last 24h
    this.sessions = [];
    this.cols = {}; // tab → header array as it is in the sheet
    this.flushing = null;
    this.fileCache = new Map(); // journeyId → { bytes, mime, name, at } for the diagnosis right after upload
  }

  // ─── startup ───
  async init() {
    await this.ensureSchema();
    await Promise.all([this.loadJourneys(), this.loadSessions(), this.loadAiLog()]);
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
  async ensureSchema() {
    const want = { Peserta: PESERTA, Sesi: SESI, 'Log AI': LOG_AI, README: null };
    const { data } = await withRetry(() => this.sheets.spreadsheets.get({ spreadsheetId: this.sheetId, fields: 'sheets.properties' }), 'read tabs');
    const ids = Object.fromEntries((data.sheets || []).map((s) => [s.properties.title, s.properties.sheetId]));
    const missing = Object.keys(want).filter((t) => ids[t] === undefined);
    if (missing.length) {
      const res = await withRetry(() => this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: title === 'README' ? 0 : 1 } } } })) },
      }), 'add tabs');
      for (const r of res.data.replies || []) if (r.addSheet) ids[r.addSheet.properties.title] = r.addSheet.properties.sheetId;
    }
    const writes = [], format = [];
    for (const [title, header] of Object.entries(want)) {
      if (!header) {
        if (missing.includes(title)) writes.push({ range: `${q(title)}!A1`, values: README });
        continue;
      }
      const got = (await withRetry(() => this.sheets.spreadsheets.values.get({ spreadsheetId: this.sheetId, range: `${q(title)}!1:1` }), `read ${title} header`)).data.values?.[0] || [];
      const add = header.filter((h) => !got.includes(h));
      this.cols[title] = [...got, ...add];
      if (add.length) writes.push({ range: `${q(title)}!${letter(got.length)}1`, values: [add] });
      if (missing.includes(title)) {
        format.push({ addProtectedRange: { protectedRange: { range: { sheetId: ids[title], startRowIndex: 0, endRowIndex: 1 }, description: 'Header — app bergantung pada nama lajur ini', warningOnly: true } } });
        format.push({ repeatCell: { range: { sheetId: ids[title], startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
        if (title === 'Peserta') {
          for (const h of HIDDEN) {
            const i = this.cols.Peserta.indexOf(h);
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
    for (const r of await this.readTab('Peserta')) {
      const j = fromRow(r);
      if (j) this.journeys.set(j.id, j);
    }
  }

  async loadSessions() {
    this.sessions = (await this.readTab('Sesi'))
      .filter((r) => String(r.code).trim())
      .map((r) => ({ code: String(r.code).trim().toUpperCase(), name: String(r.name || '').trim(), sessionDate: r.session_date, until: parseUntil(r.active_until) }));
  }

  async loadAiLog() {
    const since = Date.now() - DAY;
    this.aiCalls = (await this.readTab('Log AI'))
      .map((r) => ({ t: Date.parse(r.time), journeyId: r.journey_id }))
      .filter((c) => c.t > since);
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
    const j = { id, tokenHash: sha(token), sessionCode, createdAt: t, updatedAt: t, step: 0, state: {}, consent: { privacyVersion, privacyAt: t }, evidence: null };
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

  setConsent(j, kind, granted, version) {
    const t = now();
    if (kind === 'privacy') Object.assign(j.consent, { privacyVersion: version, privacyAt: t });
    if (kind === 'marketing') Object.assign(j.consent, { marketing: !!granted, marketingAt: t });
    if (kind === 'ai_processing') j.consent.aiAt = t;
    this.update(j, {});
  }

  // Clears the participant's row and deletes their Drive files (evidence and report).
  async remove(j) {
    if (j.evidence?.fileId) await this.deleteFile(j.evidence.fileId);
    if (j.report?.fileId) await this.deleteFile(j.report.fileId);
    this.journeys.delete(j.id);
    this.fileCache.delete(j.id);
    this.dirty.delete(j.id);
    this.deleted.add(j.id);
    await this.flush();
  }

  // ─── evidence files (Shared Drive) ───
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
    this.fileCache.set(j.id, { bytes, mime, name: safe, at: Date.now() });
    for (const [k, v] of this.fileCache) if (Date.now() - v.at > 30 * 60_000) this.fileCache.delete(k);
    if (old) await this.deleteFile(old);
    return j.evidence;
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

  async readFile(j) {
    if (!j.evidence?.fileId) return null;
    const hit = this.fileCache.get(j.id);
    if (hit) return hit;
    const { data } = await withRetry(() => this.drive.files.get({ fileId: j.evidence.fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' }), 'download file');
    return { bytes: Buffer.from(data), mime: j.evidence.mime, name: j.evidence.name };
  }

  async deleteFile(fileId) {
    try {
      await withRetry(() => this.drive.files.delete({ fileId, supportsAllDrives: true }), 'delete file');
    } catch (err) {
      if (Number(err?.code || err?.status) !== 404) throw err;
    }
  }

  // ─── AI log and limits ───
  logAi({ journeyId, model, status, input, output, file, result, error, request, response }) {
    const t = now();
    this.aiCalls.push({ t: Date.parse(t), journeyId });
    this.pendingLogs.push({
      time: t, journey_id: journeyId, model, status, input_tokens: input ?? '', output_tokens: output ?? '', evidence_file: file || '',
      pathway: result?.pathway, title: result?.title, guard: result?.guard, tasks_source: result?.tasksSource, error: error || '',
      request: request ? JSON.stringify(request, null, 1) : '', response: response ? JSON.stringify(response, null, 1) : '',
    });
  }

  aiCount(journeyId) {
    const since = Date.now() - DAY;
    this.aiCalls = this.aiCalls.filter((c) => c.t > since);
    return { mine: this.aiCalls.filter((c) => c.journeyId === journeyId).length, all: this.aiCalls.length };
  }

  // ─── writing ───
  flush() {
    this.flushing = (this.flushing || Promise.resolve()).catch(() => {}).then(() => this.#flush());
    return this.flushing;
  }

  async #flush() {
    if (!this.dirty.size && !this.deleted.size && !this.pendingLogs.length) return;
    const cols = this.cols.Peserta;
    const dirty = [...this.dirty], deleted = [...this.deleted], logs = this.pendingLogs.splice(0);
    this.dirty.clear(); this.deleted.clear();
    try {
      const updates = [], appends = [];
      if (dirty.length || deleted.length) {
        // Find each row by id now, in case rows were sorted or moved by hand.
        const idCol = letter(cols.indexOf('id'));
        const { data } = await withRetry(() => this.sheets.spreadsheets.values.get({ spreadsheetId: this.sheetId, range: `${q('Peserta')}!${idCol}:${idCol}` }), 'read ids');
        const rowOf = new Map((data.values || []).map((r, i) => [r[0], i + 1]).filter(([id], i) => i > 0 && id));
        const end = letter(cols.length - 1);
        for (const id of dirty) {
          const j = this.journeys.get(id);
          if (!j) continue;
          const v = toRow(j);
          const values = [cols.map((c) => cell(v[c]))];
          if (rowOf.has(id)) updates.push({ range: `${q('Peserta')}!A${rowOf.get(id)}:${end}${rowOf.get(id)}`, values });
          else appends.push(values[0]);
        }
        for (const id of deleted) {
          if (rowOf.has(id)) updates.push({ range: `${q('Peserta')}!A${rowOf.get(id)}:${end}${rowOf.get(id)}`, values: [cols.map(() => '')] });
        }
      }
      // RAW: participant text is stored as text, never run as a formula.
      if (updates.length) await withRetry(() => this.sheets.spreadsheets.values.batchUpdate({ spreadsheetId: this.sheetId, requestBody: { valueInputOption: 'RAW', data: updates } }), 'update rows');
      if (appends.length) await withRetry(() => this.sheets.spreadsheets.values.append({ spreadsheetId: this.sheetId, range: `${q('Peserta')}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: appends } }), 'add rows');
      if (logs.length) {
        const lc = this.cols['Log AI'];
        await withRetry(() => this.sheets.spreadsheets.values.append({ spreadsheetId: this.sheetId, range: `${q('Log AI')}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: logs.map((l) => lc.map((c) => cell(l[c]))) } }), 'add AI log');
      }
    } catch (err) {
      // Keep the changes for the next flush.
      dirty.forEach((id) => this.journeys.has(id) && this.dirty.add(id));
      deleted.forEach((id) => this.deleted.add(id));
      this.pendingLogs.unshift(...logs);
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

// Participant data in one Google Sheet, uploaded evidence and report PDFs in a Drive folder.
//
// Tabs: Peserta (one row per participant), Sesi (session codes, edited by hand), Log AI (one
// row per AI call), README (column guide). Created on first run.
//
// The server keeps every journey in memory and writes changed rows in batches every few
// seconds (one read + up to two writes per flush), well inside the Sheets quota of
// 60 requests/min. Rows are found by their id on each flush, so trainers can sort or
// filter the sheet without the app overwriting the wrong row. Run ONE server instance.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { PILLARS, calculate, calcInputs, pillarAnswers, workshopQuestions } from '../public/js/content.mjs';
export { pillarAnswers };

// The Peserta tab: one column per answer, grouped by the part of the app it comes from. Each
// header shows the section on its first line and the field on the second, and every section
// has its own header colour (see ensureSchema), so trainers can tell where each value came from.
export const SECTIONS = {
  rekod: { title: 'REKOD', color: '#e8eaed' },
  l1: { title: 'LANGKAH 1 · MAKLUMAT BISNES', color: '#d9ead3' },
  l2: { title: 'LANGKAH 2 · PILIH CABARAN', color: '#fff2cc' },
  l3: { title: 'LANGKAH 3 · ANGKA & BUKTI (PILIHAN)', color: '#fce5cd' },
  diag: { title: 'LAPORAN · DIAGNOSIS AI', color: '#cfe2f3' },
  work: { title: 'LAPORAN · QUICK FIX WORKSHOP', color: '#d0e0e3' },
  plan: { title: 'LAPORAN · PELAN TINDAKAN 7 HARI', color: '#f4cccc' },
  refl: { title: 'LAPORAN · REFLEKSI', color: '#d9d2e9' },
  pdf: { title: 'LAPORAN PDF', color: '#ead1dc' },
  consent: { title: 'PERSETUJUAN', color: '#efefef' },
  sys: { title: 'SISTEM · JANGAN EDIT', color: '#d9d9d9' },
};
const PLAN_COLUMNS = [1, 2, 3, 4, 5].flatMap((n) => [
  { key: `plan_${n}_action`, s: 'plan', label: `A${n} · Tindakan` },
  { key: `plan_${n}_measure`, s: 'plan', label: `B${n} · Ukuran kejayaan` },
  { key: `plan_${n}_evidence`, s: 'plan', label: `C${n} · Bukti selepas 7 hari` },
]);
export const COLUMNS = [
  { key: 'id', s: 'rekod', label: 'ID peserta' },
  { key: 'attempt', s: 'rekod', label: 'Percubaan' },
  { key: 'session_code', s: 'rekod', label: 'Kod sesi' },
  { key: 'created_at', s: 'rekod', label: 'Mula' },
  { key: 'updated_at', s: 'rekod', label: 'Dikemas kini' },
  { key: 'step', s: 'rekod', label: 'Langkah dicapai' },
  { key: 'full_name', s: 'l1', label: 'Nama penuh' },
  { key: 'phone', s: 'l1', label: 'No. telefon' },
  { key: 'email', s: 'l1', label: 'Emel' },
  { key: 'business', s: 'l1', label: 'Nama bisnes' },
  { key: 'industry', s: 'l1', label: 'Industri' },
  { key: 'business_model', s: 'l1', label: 'Model bisnes' },
  { key: 'years_running', s: 'l1', label: 'Tempoh beroperasi' },
  { key: 'monthly_sales', s: 'l1', label: 'Purata jualan bulanan' },
  { key: 'pillar', s: 'l2', label: 'Cabaran dipilih' },
  { key: 'situation_1', s: 'l2', label: 'Situasi 1' },
  { key: 'situation_2', s: 'l2', label: 'Situasi 2' },
  { key: 'situation_3', s: 'l2', label: 'Situasi 3' },
  { key: 'calc_1', s: 'l3', label: 'Kalkulator · Input 1' },
  { key: 'calc_2', s: 'l3', label: 'Kalkulator · Input 2' },
  { key: 'calc_3', s: 'l3', label: 'Kalkulator · Input 3' },
  { key: 'calc_4', s: 'l3', label: 'Kalkulator · Input 4' },
  { key: 'calc_result', s: 'l3', label: 'Kalkulator · Hasil' },
  { key: 'plan_start_date', s: 'l3', label: 'Bila akan mula' },
  { key: 'evidence_text', s: 'l3', label: 'Contoh ditampal' },
  { key: 'evidence_file', s: 'l3', label: 'Nama fail' },
  { key: 'evidence_link', s: 'l3', label: 'Pautan fail (Drive)' },
  { key: 'diag_source', s: 'diag', label: 'Dijana oleh' },
  { key: 'diag_at', s: 'diag', label: 'Masa dijana' },
  { key: 'diag_title', s: 'diag', label: 'Tajuk diagnosis' },
  { key: 'diag_summary', s: 'diag', label: 'Ringkasan' },
  { key: 'primary_issue', s: 'diag', label: 'Isu utama' },
  { key: 'priority_reason', s: 'diag', label: 'Sebab diutamakan' },
  { key: 'other_issues', s: 'diag', label: 'Kaitan dua isu lain' },
  { key: 'likely_cause', s: 'diag', label: 'Punca berkemungkinan' },
  { key: 'impact', s: 'diag', label: 'Impak kepada bisnes' },
  { key: 'evidence_to_check', s: 'diag', label: 'Bukti untuk disemak' },
  { key: 'ws_title', s: 'work', label: 'Tajuk latihan' },
  { key: 'ws_purpose', s: 'work', label: 'Hasil yang dituju' },
  { key: 'ws_steps', s: 'work', label: 'Langkah-langkah' },
  { key: 'ws_example', s: 'work', label: 'Contoh (AI)' },
  { key: 'ws_answers', s: 'work', label: 'Soalan & jawapan peserta' },
  { key: 'workshop_output', s: 'work', label: 'Hasil latihan (disusun daripada jawapan)' },
  ...PLAN_COLUMNS,
  { key: 'plan_done', s: 'plan', label: 'Item selesai' },
  { key: 'refl_prepared', s: 'refl', label: 'Sudah difahami / disediakan' },
  { key: 'refl_validate', s: 'refl', label: 'Perlu disahkan' },
  { key: 'refl_guidance', s: 'refl', label: 'Perlu bimbingan lanjut' },
  { key: 'report_link', s: 'pdf', label: 'Pautan laporan (Drive)' },
  { key: 'report_at', s: 'pdf', label: 'Laporan disimpan' },
  { key: 'report_downloaded_at', s: 'pdf', label: 'Dimuat turun peserta' },
  { key: 'consent_at', s: 'consent', label: 'Persetujuan diberi' },
  { key: 'privacy_notice_version', s: 'consent', label: 'Versi notis privasi' },
  { key: 'token_hash', s: 'sys', label: 'token_hash' },
  { key: 'state_json', s: 'sys', label: 'state_json' },
];
const headerOf = (c) => `${SECTIONS[c.s].title}\n${c.label}`;
export const PESERTA = COLUMNS.map(headerOf);
export const HEADER = Object.fromEntries(COLUMNS.map((c) => [c.key, headerOf(c)]));
const KEY_OF = Object.fromEntries(COLUMNS.map((c) => [headerOf(c), c.key]));
export const SESI = ['code', 'name', 'session_date', 'active_until', 'notes'];
export const STEP_NAMES = ['Maklumat bisnes', 'Pilih cabaran', 'Angka & bukti', 'Laporan'];
// One row per AI call, including reruns: what was sent and what came back.
export const LOG_AI = ['time', 'journey_id', 'model', 'status', 'input_tokens', 'output_tokens', 'pillar', 'title', 'primary_issue', 'error', 'request', 'response'];
const README = [
  ['KBSME Business Quick Fix — data peserta'],
  [''],
  ['Peserta', 'Satu baris setiap peserta, dikemas kini oleh app. Baris pertama setiap lajur: bahagian app (warna sama = bahagian sama); baris kedua: medan.'],
  ['', 'Untuk menyusun atau menapis, guna Filter view (Data → Filter views) supaya susunan baris asal kekal. Jangan edit lajur SISTEM.'],
  ['Bahagian', 'REKOD: ID, percubaan, kod sesi, masa mula / dikemas kini, langkah terakhir dicapai (1 Maklumat bisnes … 4 Laporan).'],
  ['Percubaan', 'Jika peserta menukar pillar dan menetapkan semula, baris lama dikekalkan seperti asal ("1 · ditutup", ID berakhir -1) bersama pautan laporan PDFnya, dan peserta diteruskan dalam baris baharu ("2 · semasa").'],
  ['', 'LANGKAH 1 · MAKLUMAT BISNES: borang pertama. LANGKAH 2 · PILIH CABARAN: Sales / Marketing / Urus Duit dan tiga situasi yang ditanda.'],
  ['', 'LANGKAH 3 · ANGKA & BUKTI (PILIHAN): input kalkulator ("label: nilai"; "contoh, tidak diubah" = angka contoh yang peserta tidak tukar) dan hasilnya, tarikh mula, serta contoh / fail bukti (bukti tidak dihantar kepada AI).'],
  ['', 'LAPORAN · DIAGNOSIS AI: tajuk, ringkasan, isu utama dan sebabnya, kaitan dua isu lain, punca berkemungkinan, impak, bukti untuk disemak. "Dijana oleh" menunjukkan AI (dan model) atau teks tetap jika AI tidak aktif.'],
  ['', 'LAPORAN · QUICK FIX WORKSHOP: latihan yang dicadangkan AI, soalan yang dijawab peserta satu demi satu, dan hasil latihan yang AI susun daripada jawapan itu (peserta boleh ubah). LAPORAN · PELAN TINDAKAN 7 HARI: A1–A5 tindakan (dengan hari), B1–B5 ukuran kejayaan, C1–C5 bukti; nombor yang sama = aktiviti yang sama. ✓ = peserta tanda selesai.'],
  ['', 'LAPORAN · REFLEKSI: apa yang sudah difahami, perlu disahkan, dan perlu bimbingan lanjut. LAPORAN PDF: pautan laporan dalam Drive dan masa peserta memuat turun.'],
  ['Log AI', 'Satu baris setiap panggilan AI (termasuk jana semula): masa, peserta, model, status, token, cabaran, tajuk, isu utama, dan input (request) serta output penuh AI (response).'],
  ['Sesi', 'Kod sesi untuk fasilitator. Isi code (huruf besar), name, session_date dan active_until (kosong = tiada tamat). Pautan: /?c=KOD'],
  [''],
  ['Padam data', 'Permintaan peserta (melalui info@rcg.my): kosongkan baris peserta dan padam fail laporan mereka di Drive.'],
];
// Tabs the participant rows may live in, in order. A tab that already has rows in another
// layout (e.g. from the earlier AI version) is left alone and the next name is used.
const TAB_NAMES = ['Peserta', 'Peserta v4', 'Peserta v4 (2)'];
// Columns only the earlier AI version had. A tab with any of them is never touched.
const AI_COLUMNS = ['diagnosis_pathway', 'diagnosis_title', 'ai_quick_fix', 'pathway', 'tasks'];
const HIDDEN = ['token_hash', 'state_json'];
const README_ROWS = 20;
const hex = (h) => ({ red: parseInt(h.slice(1, 3), 16) / 255, green: parseInt(h.slice(3, 5), 16) / 255, blue: parseInt(h.slice(5, 7), 16) / 255 });
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

// One readable row for trainers; state_json keeps the full state for the participant's app.
const bullets = (a) => (a || []).map((x) => `• ${x}`).join('\n');
const numbered = (a) => (a || []).map((x, i) => `${i + 1}. ${x}`).join('\n');

function toRow(j) {
  const s = j.state || {};
  const p = s.profile || {};
  const { pillar, selected, calc, workOutput, workAnswers, plan, ai, planDone } = pillarAnswers(s);
  const P = pillar && PILLARS[pillar];
  const ready = selected.length === 3;
  const pastPicking = ready && (j.step ?? 0) >= 2;
  const r = ai?.result;
  const calcResult = pastPicking ? calculate(pillar, calc) : null;
  const items = r?.plan || [];
  return {
    id: j.id, attempt: `${j.attempt || 1} · semasa`, session_code: j.sessionCode, created_at: j.createdAt, updated_at: j.updatedAt,
    step: j.step == null ? '' : `${j.step + 1} · ${STEP_NAMES[j.step] || ''}`,
    full_name: p.name, phone: p.phone, email: p.email, business: p.business, industry: p.industry, business_model: p.businessModel,
    years_running: p.businessAge, monthly_sales: p.monthlySales,
    pillar: P?.name || '',
    situation_1: P && selected[0] != null ? P.issues[selected[0]] : '',
    situation_2: P && selected[1] != null ? P.issues[selected[1]] : '',
    situation_3: P && selected[2] != null ? P.issues[selected[2]] : '',
    ...Object.fromEntries([0, 1, 2, 3].map((i) => {
      const f = pastPicking && P.fields[i];
      return [`calc_${i + 1}`, f ? `${f.label}: ${calcInputs(pillar, calc)[f.id]}${String(calc[f.id] ?? '').trim() === '' ? ' (contoh, tidak diubah)' : ''}` : ''];
    })),
    calc_result: calcResult ? [...calcResult.lines, calcResult.note].join('\n') : '',
    plan_start_date: pastPicking ? plan.startDate : '',
    evidence_text: s.evidenceText, evidence_file: j.evidence?.name, evidence_link: j.evidence?.link,
    diag_source: r ? (ai.source === 'ai' ? `AI · ${ai.model || ''}`.trim() : 'Teks tetap (AI tidak aktif)') : '',
    diag_at: r ? ai.at : '',
    diag_title: r?.diagnosis_title, diag_summary: r?.diagnosis_summary,
    primary_issue: r?.primary_issue && P ? `${r.primary_issue} · ${P.issues[selected[r.primary_issue - 1]] || ''}` : '',
    priority_reason: r?.priority_reason, other_issues: r?.other_issues,
    likely_cause: r?.likely_cause, impact: r?.impact, evidence_to_check: r ? bullets(r.evidence_to_check) : '',
    ws_title: r?.workshop?.title, ws_purpose: r?.workshop?.purpose, ws_steps: r ? numbered(r.workshop?.steps) : '', ws_example: r?.workshop?.example,
    ws_answers: r ? workshopQuestions(r.workshop).map((x, i) => String(workAnswers[i] ?? '').trim() && `${i + 1}. ${x.question}\n→ ${String(workAnswers[i]).trim()}`).filter(Boolean).join('\n\n') : '',
    workshop_output: r ? workOutput : '',
    ...Object.fromEntries([0, 1, 2, 3, 4].flatMap((i) => {
      const it = items[i];
      return [[`plan_${i + 1}_action`, it ? `Hari ${it.day} · ${it.action}${planDone[i] ? ' ✓' : ''}` : ''], [`plan_${i + 1}_measure`, it?.measure], [`plan_${i + 1}_evidence`, it?.evidence]];
    })),
    plan_done: items.length ? `${items.filter((_, i) => planDone[i]).length}/${items.length}` : '',
    refl_prepared: r?.reflection?.prepared, refl_validate: r?.reflection?.to_validate, refl_guidance: r?.reflection?.further_guidance,
    report_link: j.report?.link, report_at: j.report?.at, report_downloaded_at: j.reportDownloadedAt,
    consent_at: j.consent.privacyAt, privacy_notice_version: j.consent.privacyVersion,
    token_hash: j.tokenHash,
    state_json: JSON.stringify({ state: s, consent: j.consent, evidence: j.evidence || null, report: j.report || null, reportDownloadedAt: j.reportDownloadedAt || null, attempt: j.attempt || 1, archived: j.archived || [] }),
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
    attempt: Number(extra.attempt) || 1, archived: Array.isArray(extra.archived) ? extra.archived : [],
  };
}

export class Store {
  constructor({ sheets, drive, sheetId, folderId }) {
    Object.assign(this, { sheets, drive, sheetId, folderId });
    this.journeys = new Map(); // id → journey
    this.dirty = new Set();
    this.deleted = new Set();
    this.sessions = [];
    this.pendingLogs = [];
    this.archives = [];
    this.misses = new Map(); // id → time of a sheet lookup that found nothing // rows frozen when a participant resets to another pillar: { liveId, values }
    this.aiCalls = []; // { t, journeyId } within the last 24h, for the optional daily caps
    this.cols = {}; // tab → header array as it is in the sheet
    this.tab = 'Peserta'; // the participant tab (see ensureSchema)
    this.flushing = null;
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

  // Creates missing tabs and header rows, and styles the participant tab's headers by section.
  // Picks the participant tab: the first of TAB_NAMES that is missing, already in this layout,
  // in the earlier v4 layout (plain keys as headers: upgraded in place, rows rewritten from their
  // saved state), or has no rows yet (its header is then replaced). Any other tab with rows, such
  // as one from the AI version, is left alone.
  async ensureSchema() {
    const { data } = await withRetry(() => this.sheets.spreadsheets.get({ spreadsheetId: this.sheetId, fields: 'sheets.properties' }), 'read tabs');
    const ids = Object.fromEntries((data.sheets || []).map((s) => [s.properties.title, s.properties.sheetId]));
    const get = async (range, label) => (await withRetry(() => this.sheets.spreadsheets.values.get({ spreadsheetId: this.sheetId, range }), label)).data.values || [];
    let reset = false, oldWidth = 0;
    for (const t of TAB_NAMES) {
      this.tab = t;
      if (ids[t] === undefined) break;
      const h = (await get(`${q(t)}!1:1`, `read ${t} header`))[0] || [];
      if (h.includes(HEADER.id) && h.includes(HEADER.state_json)) {
        // ours: keep it as it is if the columns are in the current order, else rewrite it in place
        if (PESERTA.every((x, i) => h[i] === x)) break;
        this.legacyCols = h; reset = true; oldWidth = h.length; break;
      }
      if (h.some((x) => AI_COLUMNS.includes(x))) { console.log(`[store] the "${t}" tab is from the AI version; it is left as it is`); continue; }
      if (['id', 'token_hash', 'state_json'].every((k) => h.includes(k))) { this.legacyCols = h; reset = true; oldWidth = h.length; break; }
      const rows = (await get(`${q(t)}!A2:A`, `read ${t} rows`)).filter((r) => r[0]);
      if (!rows.length) { reset = true; oldWidth = h.length; break; }
      console.log(`[store] the "${t}" tab has rows in an older layout; it is left as it is`);
    }
    if (this.tab !== 'Peserta') console.log(`[store] participant rows go to the "${this.tab}" tab`);
    if (this.legacyCols) {
      this.legacyRows = await this.readTab(this.tab, this.legacyCols); // read before the header changes
      console.log(`[store] upgrading "${this.tab}" to the current layout (${this.legacyRows.filter((r) => r[HEADER.id] || r.id).length} rows)`);
    }

    const missing = [this.tab, 'Sesi', 'Log AI', 'README'].filter((t) => ids[t] === undefined);
    if (missing.length) {
      const res = await withRetry(() => this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: title === 'README' ? 0 : 1 } } } })) },
      }), 'add tabs');
      for (const r of res.data.replies || []) if (r.addSheet) ids[r.addSheet.properties.title] = r.addSheet.properties.sheetId;
    }

    const writes = [], format = [];
    // Participant tab: the header in this layout (a reset tab's old header is overwritten).
    {
      const got = reset ? [] : (await get(`${q(this.tab)}!1:1`, 'read header'))[0] || [];
      const add = PESERTA.filter((h) => !got.includes(h));
      // a reset tab keeps blank header cells over any old extra columns, so rewriting rows clears them
      const pad = reset ? Array(Math.max(0, oldWidth - PESERTA.length)).fill('') : [];
      this.cols[this.tab] = [...got, ...add, ...pad];
      if (reset) writes.push({ range: `${q(this.tab)}!A1`, values: [[...PESERTA, ...pad]] });
      else if (add.length) writes.push({ range: `${q(this.tab)}!${letter(got.length)}1`, values: [add] });
    }
    // Sesi (edited by hand) and Log AI: plain headers.
    for (const [title, want] of [['Sesi', SESI], ['Log AI', LOG_AI]]) {
      const got = (await get(`${q(title)}!1:1`, `read ${title} header`))[0] || [];
      const add = want.filter((h) => !got.includes(h));
      this.cols[title] = [...got, ...add];
      if (add.length) writes.push({ range: `${q(title)}!${letter(got.length)}1`, values: [add] });
    }
    // README: rewritten at each start so the column guide stays current.
    writes.push({ range: `${q('README')}!A1`, values: [...README, ...Array(Math.max(0, README_ROWS - README.length)).fill([''])].map((r) => [r[0] ?? '', r[1] ?? '']) });

    for (const title of [this.tab, 'Sesi', 'Log AI']) {
      if (!missing.includes(title)) continue;
      format.push({ addProtectedRange: { protectedRange: { range: { sheetId: ids[title], startRowIndex: 0, endRowIndex: 1 }, description: 'Header — app bergantung pada nama lajur ini', warningOnly: true } } });
      format.push({ repeatCell: { range: { sheetId: ids[title], startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
    }
    // Participant headers: a colour per section, two wrapped lines, internal columns hidden.
    // Applied at every start (cheap and idempotent), so a later script update picks it up.
    const sid = ids[this.tab], cols = this.cols[this.tab];
    format.push({ updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
    format.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 54 }, fields: 'pixelSize' } });
    format.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: cols.length }, properties: { hiddenByUser: false, pixelSize: 190 }, fields: 'hiddenByUser,pixelSize' } });
    for (const c of COLUMNS) {
      const i = cols.indexOf(HEADER[c.key]);
      format.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 }, cell: { userEnteredFormat: { backgroundColor: hex(SECTIONS[c.s].color), textFormat: { bold: true }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(backgroundColor,textFormat.bold,wrapStrategy,verticalAlignment)' } });
    }
    for (const key of HIDDEN) {
      const i = cols.indexOf(HEADER[key]);
      format.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });
    }
    if (writes.length) await withRetry(() => this.sheets.spreadsheets.values.batchUpdate({ spreadsheetId: this.sheetId, requestBody: { valueInputOption: 'RAW', data: writes } }), 'write headers');
    await withRetry(() => this.sheets.spreadsheets.batchUpdate({ spreadsheetId: this.sheetId, requestBody: { requests: format } }), 'format headers');
  }

  async readTab(title, cols = this.cols[title]) {
    const { data } = await withRetry(() => this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId, range: `${q(title)}!A2:${letter(cols.length - 1)}`, valueRenderOption: 'UNFORMATTED_VALUE',
    }), `read ${title}`);
    return (data.values || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i] ?? ''])));
  }

  async loadJourneys() {
    const upgrading = !!this.legacyRows;
    for (const byHeader of (this.legacyRows || await this.readTab(this.tab)).filter((r) => Object.values(r).some((v) => v !== ''))) {
      const r = Object.fromEntries(Object.entries(byHeader).map(([h, v]) => [KEY_OF[h] ?? h, v]));
      const j = fromRow(r);
      if (!j) continue;
      this.journeys.set(j.id, j);
      if (upgrading) this.dirty.add(j.id); // rewrite the row in the new layout
    }
    if (upgrading) { this.legacyRows = null; await this.flush(); }
  }

  async loadSessions() {
    this.sessions = (await this.readTab('Sesi'))
      .filter((r) => String(r.code).trim())
      .map((r) => ({ code: String(r.code).trim().toUpperCase(), name: String(r.name || '').trim(), sessionDate: r.session_date, until: parseUntil(r.active_until) }));
  }

  async loadAiLog() {
    const since = Date.now() - DAY;
    this.aiCalls = (await this.readTab('Log AI')).map((r) => ({ t: Date.parse(r.time), journeyId: r.journey_id })).filter((c) => c.t > since);
  }

  // ─── AI log ───
  logAi({ journeyId, model, status, input, output, pillar, title, primary, error, request, response }) {
    const t = now();
    this.aiCalls.push({ t: Date.parse(t), journeyId });
    this.pendingLogs.push({
      time: t, journey_id: journeyId, model, status, input_tokens: input ?? '', output_tokens: output ?? '', pillar, title, primary_issue: primary ?? '',
      error: error || '', request: request ? JSON.stringify(request, null, 1) : '', response: response ? (typeof response === 'string' ? response : JSON.stringify(response, null, 1)) : '',
    });
  }

  aiCount(journeyId) {
    const since = Date.now() - DAY;
    this.aiCalls = this.aiCalls.filter((c) => c.t > since);
    return { mine: this.aiCalls.filter((c) => c.journeyId === journeyId).length, all: this.aiCalls.length };
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

  // A participant this server does not know yet: started on the other server during a deploy, or
  // added to the sheet after this server loaded it. Looks the id up in the sheet (one read shared by
  // concurrent lookups; a miss is remembered for a minute).
  async loadOne(id) {
    if (typeof id !== 'string' || !/^[\w-]{6,40}$/.test(id) || this.journeys.has(id)) return this.journeys.get(id) || null;
    const missAt = this.misses.get(id);
    if (missAt && Date.now() - missAt < 60_000) return null;
    this.lookup ||= (async () => {
      const head = (await withRetry(() => this.sheets.spreadsheets.values.get({ spreadsheetId: this.sheetId, range: `${q(this.tab)}!1:1` }), 'read header')).data.values?.[0] || [];
      return this.readTab(this.tab, head);
    })().finally(() => { this.lookup = null; });
    const rows = await this.lookup;
    for (const byHeader of rows) {
      const r = Object.fromEntries(Object.entries(byHeader).map(([h, v]) => [KEY_OF[h] ?? h, v]));
      if (r.id !== id) continue;
      const j = fromRow(r);
      if (j && !this.journeys.has(id) && !this.deleted.has(id)) this.journeys.set(id, j);
      return this.journeys.get(id) || null;
    }
    if (this.misses.size > 5000) this.misses.clear();
    this.misses.set(id, Date.now());
    return null;
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

  // A participant who switches pillar and resets starts a new attempt. Their current row is frozen
  // as it is (same place in the sheet, id "<id>-<n>", no key, "n · ditutup"), the report PDF of that
  // attempt stays in Drive, and the participant continues in a new row below.
  archive(j, reason = '') {
    const n = j.attempt || 1;
    const v = toRow(j);
    const frozen = { ...v, id: `${j.id}-${n}`, attempt: `${n} · ditutup${reason ? ` (${reason})` : ''}`, updated_at: now(), token_hash: '' };
    this.archives.push({ liveId: j.id, frozenId: frozen.id, values: frozen });
    j.archived = [...(j.archived || []), { id: frozen.id, reportFileId: j.report?.fileId || null }];
    j.attempt = n + 1;
    j.report = null; // the next report is a new file; the frozen row keeps the link to this one
    j.reportDownloadedAt = null;
    j.createdAt = now();
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
    for (const a of j.archived || []) { if (a.reportFileId) await this.deleteFile(a.reportFileId); this.deleted.add(a.id); }
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
    if (!this.dirty.size && !this.deleted.size && !this.pendingLogs.length && !this.archives.length) return;
    const tab = this.tab;
    let cols = this.cols[tab];
    const dirty = [...this.dirty], deleted = [...this.deleted], logs = this.pendingLogs.splice(0), archives = this.archives.splice(0);
    this.dirty.clear(); this.deleted.clear();
    try {
      const updates = [], appends = [];
      if (dirty.length || deleted.length || archives.length) {
        // Write by the header as it is in the sheet now: during a deploy the old and the new server
        // run side by side for a moment, and the new one may have changed the columns.
        const head = (await withRetry(() => this.sheets.spreadsheets.values.get({ spreadsheetId: this.sheetId, range: `${q(tab)}!1:1` }), 'read header')).data.values?.[0] || [];
        if (!(cols.length === head.length && cols.every((c, i) => c === head[i]))) {
          if (!head.includes(HEADER.id) || !head.includes(HEADER.state_json)) throw new Error(`the "${tab}" header is not one this app wrote`);
          console.warn(`[store] the "${tab}" columns changed in the sheet; writing by the current header`);
          cols = this.cols[tab] = head;
        }
        // Find each row by id now, in case rows were sorted or moved by hand.
        const idCol = letter(cols.indexOf(HEADER.id));
        const { data } = await withRetry(() => this.sheets.spreadsheets.values.get({ spreadsheetId: this.sheetId, range: `${q(tab)}!${idCol}:${idCol}` }), 'read ids');
        const rowOf = new Map((data.values || []).map((r, i) => [r[0], i + 1]).filter(([id], i) => i > 0 && id));
        const end = letter(cols.length - 1);
        const rowValues = (v) => [cols.map((c) => cell(v[KEY_OF[c]]))];
        // a frozen attempt takes over its live row's place; the live row is then added below
        for (const a of archives) {
          const at = rowOf.get(a.liveId);
          if (at) { updates.push({ range: `${q(tab)}!A${at}:${end}${at}`, values: rowValues(a.values) }); rowOf.delete(a.liveId); rowOf.set(a.frozenId, at); }
          else appends.push(rowValues(a.values)[0]);
        }
        for (const id of dirty) {
          const j = this.journeys.get(id);
          if (!j) continue;
          const v = toRow(j);
          const values = [cols.map((c) => cell(v[KEY_OF[c]]))];
          if (rowOf.has(id)) updates.push({ range: `${q(tab)}!A${rowOf.get(id)}:${end}${rowOf.get(id)}`, values });
          else appends.push(values[0]);
        }
        for (const id of deleted) {
          if (rowOf.has(id)) updates.push({ range: `${q(tab)}!A${rowOf.get(id)}:${end}${rowOf.get(id)}`, values: [cols.map(() => '')] });
        }
      }
      // RAW: participant text is stored as text, never run as a formula.
      if (updates.length) await withRetry(() => this.sheets.spreadsheets.values.batchUpdate({ spreadsheetId: this.sheetId, requestBody: { valueInputOption: 'RAW', data: updates } }), 'update rows');
      if (appends.length) await withRetry(() => this.sheets.spreadsheets.values.append({ spreadsheetId: this.sheetId, range: `${q(tab)}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: appends } }), 'add rows');
      if (logs.length) {
        const lc = this.cols['Log AI'];
        await withRetry(() => this.sheets.spreadsheets.values.append({ spreadsheetId: this.sheetId, range: `${q('Log AI')}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: logs.map((l) => lc.map((c) => cell(l[c]))) } }), 'add AI log');
      }
    } catch (err) {
      // Keep the changes for the next flush.
      dirty.forEach((id) => this.journeys.has(id) && this.dirty.add(id));
      deleted.forEach((id) => this.deleted.add(id));
      this.pendingLogs.unshift(...logs);
      this.archives.unshift(...archives);
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

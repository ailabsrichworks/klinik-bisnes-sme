// Business Quick Fix (v4): intake → pick a pillar and 3 situations → optional evidence → report.
// Fixed text per pillar (content.mjs), no AI. Saved through our API to the participant's row in
// the Google Sheet. No login: a random key in this browser identifies the participant; a
// facilitator's ?c=CODE files them under that session.
import { INTAKE, PILLARS, PILLAR_KEYS, PICK, CLOSING, CALC_NOTE, REPORT_NOTE, calculate, calcInputs, defaultPlan } from './content.mjs';

(async () => {
  'use strict';
  const { $, message: msg, show } = KB;
  const $$ = (q) => [...document.querySelectorAll(q)];
  const txt = (s) => String(s ?? '').trim();
  const CACHE_KEY = 'kbsme_bqf_v4_cache';
  const COHORT_KEY = 'kbsme_cohort_code';

  // step: 0 intake · 1 pick situations · 2 optional evidence · 3 report
  const blank = () => ({ profile: {}, pillar: 'sales', byPillar: {}, evidenceText: '' });
  let state = blank(), view = 0, reached = 0, journey = null, session = null;

  const params = new URLSearchParams(location.search);
  const normCode = (c) => String(c || '').trim().toUpperCase();
  if (params.get('c')) { try { localStorage.setItem(COHORT_KEY, normCode(params.get('c'))); } catch {} }
  const cohortCode = () => { try { return localStorage.getItem(COHORT_KEY) || ''; } catch { return ''; } };
  const demoMode = ['localhost', '127.0.0.1'].includes(location.hostname) || params.has('demo');

  try { await KB.init(); } catch {
    $('loadingGate').innerHTML = '<p>Data gagal dimuatkan. Semak sambungan internet dan muat semula halaman.</p>';
    return;
  }

  // ─────────────── helpers ───────────────
  const SCREENS = ['loadingGate', 'codeGate', 'intakeView', 'diagnosticLayout'];
  function showOnly(id) {
    SCREENS.forEach((x) => show(x, x === id));
    show('accountLinks', !!journey && id !== 'loadingGate' && id !== 'codeGate');
  }
  const failed = () => { showOnly('loadingGate'); $('loadingGate').innerHTML = '<p>Data gagal dimuatkan. Semak sambungan internet dan muat semula halaman.</p>'; };

  // Errors appear right below the control that caused them, scroll into view, and focus it.
  function fieldError(target, text) {
    clearFieldErrors();
    const el = typeof target === 'string' ? $(target) : target;
    const anchor = el.closest('.field, .consent, .issues, .upload, .bottomrow') || el;
    const m = document.createElement('div');
    m.className = 'message show error field-error';
    m.setAttribute('role', 'alert');
    m.textContent = text;
    anchor.after(m);
    m.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }
  function clearFieldErrors() { $$('.field-error').forEach((e) => e.remove()); }
  function notice(target, text, error = false) {
    msg(target, text, error);
    if (text) $(target).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  // Textareas grow with their content (only while visible: hidden ones have no height to measure).
  const autoGrow = (el) => { if (!el?.offsetParent) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };
  const growAll = () => $$('textarea.grow').forEach(autoGrow);
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(growAll, 150); });
  const scrollToEl = (el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 12, behavior: 'smooth' });

  // The current pillar's answers; each pillar keeps its own so switching back loses nothing.
  function answers(p = state.pillar) {
    state.byPillar[p] ||= {};
    const a = state.byPillar[p];
    a.selected ||= []; a.calc ||= {}; a.workOutput ??= ''; a.plan ||= defaultPlan(p);
    return a;
  }

  // ─────────────── saving ───────────────
  // Every change is kept in this browser at once; the server (Google Sheet) gets it on each step,
  // 20 seconds after typing stops, and when the page is hidden or closed.
  let saveTimer = null, saving = Promise.resolve(), unsaved = false;
  function safeSave() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ id: journey?.id, state })); } catch {}
    unsaved = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushRemote, 20_000);
  }
  function pushRemote({ keepalive = false } = {}) {
    clearTimeout(saveTimer); saveTimer = null;
    if (!journey || !unsaved) return saving;
    unsaved = false;
    saving = saving.then(async () => {
      try {
        await KB.api('/api/journey', { method: 'PUT', body: { state, step: reached }, keepalive });
      } catch (err) {
        unsaved = true;
        if (err.status === 401) notice('reportMessage', 'Sesi tamat — muat semula halaman.', true);
      }
    });
    return saving;
  }
  const saveNow = () => { safeSave(); return pushRemote(); };
  window.addEventListener('pagehide', () => pushRemote({ keepalive: true }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pushRemote({ keepalive: true }); });

  // ─────────────── boot ───────────────
  async function boot() {
    showOnly('loadingGate');
    const code = cohortCode();
    if (code) {
      try { session = await KB.api(`/api/session/${encodeURIComponent(code)}`); } catch (err) {
        if (err.status === 404) return askForCode('Kod sesi ini tidak sah.', true);
        console.error(err); return failed();
      }
    }
    if (KB.getKey()) {
      try {
        journey = await KB.api('/api/journey');
        session = journey.session || session;
      } catch (err) {
        if (err.status !== 401) { console.error(err); return failed(); }
        KB.setKey(null); journey = null; // the journey was deleted or the key is stale: start again
      }
    }
    if (session) { $('sessionPill').textContent = session.name; show('sessionPill', true); }
    if (journey) {
      const obj = journey.state || {};
      state = { ...blank(), ...obj, profile: obj.profile || {}, byPillar: obj.byPillar || {} };
      reached = journey.step || 0;
    }
    fillIntakeOptions();
    if (!journey || !profileComplete() || journey.consent.privacyVersion !== KB.cfg.noticeVersion) return openIntake();
    openLayout(reached >= 1 ? Math.min(reached, 3) : 1);
  }

  function askForCode(text = '', isError = false) {
    showOnly('codeGate');
    $('codeInput').value = cohortCode();
    msg('codeMessage', text, isError);
  }
  $('noCodeBtn').onclick = () => { try { localStorage.removeItem(COHORT_KEY); } catch {} session = null; boot(); };
  $('codeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = normCode($('codeInput').value);
    if (!code) return msg('codeMessage', 'Masukkan kod sesi daripada fasilitator.', true);
    try { localStorage.setItem(COHORT_KEY, code); } catch {}
    boot();
  });

  // ─────────────── Langkah 01: intake ───────────────
  const PROFILE_FIELDS = [['participantName', 'name', 'Isi nama penuh anda.'], ['businessName', 'business', 'Isi nama bisnes anda.'], ['industry', 'industry', 'Pilih industri bisnes.'], ['businessModel', 'businessModel', 'Pilih model bisnes.'], ['businessAge', 'businessAge', 'Pilih berapa lama bisnes beroperasi.'], ['monthlySales', 'monthlySales', 'Pilih purata jualan bulanan.']];
  const profileComplete = () => PROFILE_FIELDS.every(([, k]) => txt(state.profile[k]));

  function fillIntakeOptions() {
    const fill = (id, first, list) => { $(id).innerHTML = `<option value="">${first}</option>` + list.map((o) => `<option>${KB.esc(o)}</option>`).join(''); };
    fill('industry', 'Pilih industri', INTAKE.industry);
    fill('businessModel', 'Pilih model bisnes', INTAKE.businessModel);
    fill('businessAge', 'Pilih tempoh', INTAKE.businessAge);
    fill('monthlySales', 'Pilih julat jualan', INTAKE.monthlySales);
  }
  function openIntake() {
    view = 0;
    PROFILE_FIELDS.forEach(([id, k]) => { $(id).value = state.profile[k] || ''; });
    $('consentData').checked = !!journey && journey.consent.privacyVersion === KB.cfg.noticeVersion;
    $('profileBtn').textContent = journey && profileComplete() ? 'Simpan maklumat →' : 'Simpan maklumat & mula →';
    showOnly('intakeView');
    clearFieldErrors();
  }
  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(); msg('intakeMessage', '');
    const profile = {};
    for (const [id, k, err] of PROFILE_FIELDS) {
      profile[k] = txt($(id).value);
      if (!profile[k]) return fieldError(id, err);
    }
    if (!$('consentData').checked) return fieldError('consentData', 'Tandakan persetujuan ini untuk meneruskan.');
    const btn = $('profileBtn'); btn.disabled = true;
    try {
      if (!journey) {
        const j = await KB.api('/api/journey', { method: 'POST', body: { code: session?.code || undefined, acceptNotice: KB.cfg.noticeVersion } });
        KB.setKey({ id: j.id, token: j.token });
        journey = j; session = j.session || session;
      } else if (journey.consent.privacyVersion !== KB.cfg.noticeVersion) {
        const r = await KB.api('/api/consent', { method: 'POST', body: { acceptNotice: KB.cfg.noticeVersion } });
        journey.consent = r.consent;
      }
      state.profile = profile;
      reached = Math.max(reached, 1);
      await saveNow();
      openLayout(reached >= 2 ? reached : 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      notice('intakeMessage', err.status === 404 ? 'Kod sesi ini tidak sah.' : err.status === 429 ? 'Terlalu ramai cuba serentak. Tunggu seminit dan cuba lagi.' : 'Gagal menyimpan. Semak internet dan cuba lagi.', true);
    } finally {
      btn.disabled = false;
    }
  });
  $('editProfileBtn').onclick = () => { openIntake(); scrollToEl($('intakeView')); };

  // ─────────────── layout: pillars + main panel ───────────────
  function openLayout(target) {
    showOnly('diagnosticLayout');
    const p = state.profile;
    $('profileSummary').textContent = [p.name, p.business, p.industry, p.monthlySales && `Jualan: ${p.monthlySales}`].filter(Boolean).join(' · ');
    drawPillars();
    const ready = answers().selected.length === PICK;
    go(target >= 2 && ready ? target : 1);
  }
  function drawPillars() {
    $$('.category').forEach((b) => { const on = b.dataset.cat === state.pillar; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  }
  $$('.category').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.cat === state.pillar && view === 1) return;
      state.pillar = b.dataset.cat;
      drawPillars(); safeSave();
      go(1);
    };
  });

  // Shows one of the main panel's views: 1 pick · 2 evidence · 3 report.
  function go(n) {
    view = n;
    reached = Math.max(reached, n);
    show('questionView', n === 1); show('evidenceView', n === 2); show('resultView', n === 3);
    clearFieldErrors();
    if (n === 1) drawIssues();
    if (n === 2) drawEvidence();
    if (n === 3) drawReport();
    requestAnimationFrame(growAll);
    safeSave(); pushRemote();
  }

  // ─────────────── Langkah 02: three situations ───────────────
  function drawIssues() {
    const d = PILLARS[state.pillar], a = answers();
    $('categoryLabel').textContent = d.label;
    $('questionTitle').textContent = d.title;
    $('questionIntro').textContent = d.intro;
    $('issueLegend').textContent = `${d.title} Pilih tiga situasi.`;
    const list = $('issueList');
    list.querySelectorAll('.issue').forEach((x) => x.remove());
    d.issues.forEach((issue, i) => {
      const on = a.selected.includes(i), full = a.selected.length >= PICK && !on;
      const label = document.createElement('label');
      label.className = 'issue' + (on ? ' selected' : '') + (full ? ' disabled' : '');
      label.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''} ${full ? 'disabled' : ''}><span><span class="num">${String(i + 1).padStart(2, '0')}</span> ${KB.esc(issue)}</span>`;
      label.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked && a.selected.length < PICK) a.selected.push(i);
        else a.selected = a.selected.filter((x) => x !== i);
        safeSave();
        drawIssues();
        list.querySelectorAll('input')[i]?.focus();
      });
      list.append(label);
    });
    $('counter').textContent = `${a.selected.length} daripada ${PICK} dipilih`;
    $('diagnoseBtn').disabled = a.selected.length !== PICK;
    $('progressFill').style.width = `${(a.selected.length / PICK) * 100}%`;
  }
  $('diagnoseBtn').onclick = () => { if (answers().selected.length === PICK) { go(2); scrollToEl($('main')); } };

  // ─────────────── optional evidence (stored, never analysed) ───────────────
  function drawEvidence() {
    $('evidenceHint').textContent = `Contoh yang berguna: ${PILLARS[state.pillar].evidence}`;
    $('evidenceText').value = state.evidenceText || '';
    drawFile();
  }
  function drawFile() {
    const f = journey?.evidenceFile;
    $('fileStatus').textContent = f ? `Disimpan: ${f.name}` : 'Belum ada fail.';
    show('removeFileBtn', !!f);
  }
  $('evidenceText').addEventListener('input', () => { state.evidenceText = $('evidenceText').value; autoGrow($('evidenceText')); safeSave(); });
  $('fileUpload').addEventListener('change', async () => {
    const f = $('fileUpload').files?.[0];
    clearFieldErrors(); msg('evidenceMessage', '');
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { $('fileUpload').value = ''; return fieldError('fileUpload', 'Fail melebihi 4 MB. Pilih fail yang lebih kecil.'); }
    const okay = ['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv', 'application/pdf'];
    if (!okay.includes(f.type) && !/\.(csv|txt|pdf)$/i.test(f.name)) { $('fileUpload').value = ''; return fieldError('fileUpload', 'Format fail tidak disokong. Guna PNG, JPG, WEBP, PDF, TXT atau CSV.'); }
    $('fileStatus').textContent = `Memuat naik ${f.name}…`;
    try {
      const r = await KB.api('/api/upload', { method: 'POST', raw: f, headers: { 'X-File-Name': encodeURIComponent(f.name) } });
      journey.evidenceFile = r.evidenceFile;
      notice('evidenceMessage', 'Fail disimpan.');
    } catch (err) {
      fieldError('fileUpload', err.status === 413 ? 'Fail melebihi 4 MB.' : err.message || 'Fail gagal dimuat naik. Cuba lagi.');
    } finally {
      $('fileUpload').value = '';
      drawFile();
    }
  });
  $('removeFileBtn').onclick = async () => {
    try { await KB.api('/api/upload', { method: 'DELETE' }); journey.evidenceFile = null; drawFile(); notice('evidenceMessage', 'Fail dibuang.'); }
    catch (err) { notice('evidenceMessage', err.message, true); }
  };
  $('evidenceBackBtn').onclick = () => { go(1); scrollToEl($('main')); };
  $('reportBtn').onclick = () => { go(3); scrollToEl($('main')); };

  // ─────────────── the report ───────────────
  function drawReport() {
    const p = state.pillar, d = PILLARS[p], a = answers();
    $('resultCategory').textContent = `${d.label} · BUSINESS QUICK FIX REPORT`;
    $('diagnosisTitle').textContent = d.titleOut;
    $('diagnosisIntro').textContent = d.introOut;
    $('symptomList').innerHTML = a.selected.map((i) => `<li>${KB.esc(d.issues[i])}</li>`).join('');
    $('causeText').textContent = d.cause;
    $('impactText').textContent = d.impact;
    $('impactPrompt').textContent = d.impactPrompt;
    $('calculatorTitle').textContent = d.calculatorTitle;
    $('calculatorIntro').textContent = d.calculatorIntro;
    $('calcNote').textContent = CALC_NOTE;
    const values = calcInputs(p, a.calc);
    $('calculatorFields').innerHTML = d.fields.map((f) => `<div class="calcfield"><label for="calc_${f.id}">${KB.esc(f.label)}</label><input type="number" inputmode="decimal" id="calc_${f.id}" data-calc="${f.id}" min="${f.min ?? 0}" ${f.max != null ? `max="${f.max}"` : ''} step="${f.step ?? 1}" value="${KB.esc(values[f.id])}"></div>`).join('');
    $$('[data-calc]').forEach((el) => { el.oninput = () => { a.calc[el.dataset.calc] = el.value; drawCalc(); safeSave(); }; });
    drawCalc();
    $('exerciseTitle').textContent = d.exerciseTitle;
    $('exerciseBrief').textContent = d.exerciseBrief;
    $('exercisePrompt').textContent = d.exercisePrompt;
    $('exampleText').textContent = d.example;
    $('exampleBox').hidden = true; $('exampleBtn').setAttribute('aria-expanded', 'false'); $('exampleBtn').textContent = 'Lihat contoh';
    $('workOutput').value = a.workOutput;
    $('actionPlan').value = a.plan.action ?? '';
    $('successMeasure').value = a.plan.measure ?? '';
    $('actionDate').value = a.plan.startDate ?? '';
    $('proofToCheck').value = a.plan.proof ?? '';
    $('reflectionText').textContent = d.reflection;
    $('takeawayText').textContent = d.takeaway;
    $('gapText').textContent = d.gap;
    $('closingTitle').textContent = CLOSING.title;
    $('closingText').textContent = CLOSING.text;
    $('reportNote').textContent = REPORT_NOTE;
    msg('reportMessage', '');
  }
  function drawCalc() {
    const r = calculate(state.pillar, answers().calc);
    $('calculatorResult').innerHTML = `${r.lines.map(KB.esc).join('<br>')}<small>${KB.esc(r.note)}</small>`;
  }
  $('workOutput').addEventListener('input', () => { answers().workOutput = $('workOutput').value; autoGrow($('workOutput')); safeSave(); });
  [['actionPlan', 'action'], ['successMeasure', 'measure'], ['actionDate', 'startDate'], ['proofToCheck', 'proof']].forEach(([id, k]) => {
    $(id).addEventListener('input', () => { answers().plan[k] = $(id).value; if ($(id).tagName === 'TEXTAREA') autoGrow($(id)); safeSave(); });
  });
  $('exampleBtn').onclick = () => {
    const open = $('exampleBox').hidden;
    $('exampleBox').hidden = !open;
    $('exampleBtn').setAttribute('aria-expanded', String(open));
    $('exampleBtn').textContent = open ? 'Tutup contoh' : 'Lihat contoh';
  };
  $('useExampleBtn').onclick = () => {
    const el = $('workOutput');
    if (txt(el.value) && !confirm('Gantikan hasil latihan anda dengan contoh ini?')) return;
    el.value = PILLARS[state.pillar].example;
    answers().workOutput = el.value; autoGrow(el); safeSave();
    el.focus();
  };
  $('backToQuestionsBtn').onclick = () => { go(1); scrollToEl($('main')); };

  // Downloads the report PDF the server builds (the same file kept in Drive). Saves first.
  $('downloadBtn').onclick = async () => {
    const btn = $('downloadBtn'), label = btn.innerHTML;
    btn.disabled = true; btn.textContent = 'Menyediakan PDF…';
    try {
      await saveNow();
      const k = KB.getKey();
      const res = await fetch('/api/report.pdf', { headers: k ? { 'X-Journey-Id': k.id, 'X-Journey-Token': k.token } : {} });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Ralat ${res.status}`);
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'Laporan-Business-Quick-Fix.pdf';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notice('reportMessage', 'Laporan PDF dimuat turun.');
    } catch (err) {
      console.error(err);
      notice('reportMessage', `PDF gagal dimuat turun: ${err.message}. Cuba lagi.`, true);
    } finally {
      btn.disabled = false; btn.innerHTML = label;
    }
  };

  // ─────────────── account actions ───────────────
  $('exportBtn').onclick = async () => {
    await saveNow();
    const saved = await KB.api('/api/journey').catch(() => null);
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), id: journey?.id, session: saved?.session?.code || null, created: saved?.createdAt || null, consent: saved?.consent || null, evidence_file: saved?.evidenceFile || null, answers: state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'Business_Quick_Fix_data_saya.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  $('restartBtn').onclick = () => {
    if (!confirm('Kosongkan pilihan cabaran, bukti dan laporan? Maklumat bisnes anda kekal.')) return;
    state = { ...blank(), profile: state.profile };
    reached = 1;
    openLayout(1);
  };
  $('deleteBtn').onclick = async () => {
    if (!confirm('Padam semua maklumat, pilihan, bukti dan laporan anda? Tindakan ini tidak boleh dibatalkan.')) return;
    try {
      clearTimeout(saveTimer); unsaved = false;
      await KB.api('/api/me', { method: 'DELETE' });
      try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(COHORT_KEY); } catch {}
      KB.setKey(null);
      alert('Data anda telah dipadam.');
      location.href = '/';
    } catch (err) { alert(err.message); }
  };

  // ─────────────── test data (localhost or ?demo) ───────────────
  const SAMPLE = { name: 'Nur Aina binti Ahmad', business: 'Aina Frozen Food', industry: INTAKE.industry[0], businessModel: INTAKE.businessModel[0], businessAge: INTAKE.businessAge[1], monthlySales: INTAKE.monthlySales[1] };
  if (demoMode) {
    show('demoBar', true);
    $$('[data-demo]').forEach((b) => {
      b.onclick = () => {
        if (!journey || $('intakeView').hidden === false) {
          PROFILE_FIELDS.forEach(([id, k]) => { $(id).value = SAMPLE[k]; });
          $('consentData').checked = true;
          state.pillar = b.dataset.demo;
          answers().selected = [0, 3, 6];
          return;
        }
        state.pillar = b.dataset.demo;
        answers().selected = [0, 3, 6];
        drawPillars(); go(1);
      };
    });
  }

  boot();
})();

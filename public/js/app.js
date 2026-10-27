// Business Quick Fix: intake → pick a pillar and 3 situations → optional numbers and start date
// → AI coach report (server/coach.mjs; the fixed v4 text when the AI is off). Saved
// through our API to the participant's row in the Google Sheet. No login: a random key in this browser identifies the participant; a
// facilitator's ?c=CODE files them under that session.
import { INTAKE, PILLARS, PICK, NEXT_CLASS, CALC_NOTE, calculate, calcInputs, defaultPlan, coachInput, workshopQuestions } from './content.mjs';

(async () => {
  'use strict';
  const { $, message: msg, show } = KB;
  const $$ = (q) => [...document.querySelectorAll(q)];
  const txt = (s) => String(s ?? '').trim();
  const CACHE_KEY = 'kbsme_bqf_v4_cache';
  const COHORT_KEY = 'kbsme_cohort_code';

  // step: 0 intake · 1 pick situations · 2 optional numbers & start date · 3 report
  const blank = () => ({ profile: {}, pillar: 'sales', byPillar: {} });
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
  const PROFILE_FIELDS = [['participantName', 'name', 'Isi nama penuh anda.'], ['participantPhone', 'phone', 'Isi nombor telefon anda.'], ['participantEmail', 'email', 'Isi emel anda.'], ['businessName', 'business', 'Isi nama bisnes anda.'], ['industry', 'industry', 'Pilih industri bisnes.'], ['businessModel', 'businessModel', 'Pilih model bisnes.'], ['businessAge', 'businessAge', 'Pilih berapa lama bisnes beroperasi.'], ['monthlySales', 'monthlySales', 'Pilih purata jualan bulanan.']];
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
    // Phone: 9–15 digits, with an optional leading + and spaces or dashes. Email: one @ and a dot after it.
    const digits = profile.phone.replace(/[\s-]/g, '');
    if (!/^\+?\d{9,15}$/.test(digits)) return fieldError('participantPhone', 'Nombor telefon tidak sah. Contoh: 012-345 6789 atau +60 12-345 6789.');
    profile.email = profile.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(profile.email)) return fieldError('participantEmail', 'Emel tidak sah. Contoh: nama@contoh.com');
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
  // Once an analysis exists, switching challenge needs a reset of all challenge data (Langkah 1 stays).
  const hasAnalysis = () => Object.values(state.byPillar || {}).some((a) => a?.ai);
  $$('.category').forEach((b) => {
    b.onclick = () => {
      const to = b.dataset.cat;
      if (to === state.pillar) { if (view !== 1 && !answers().ai) go(1); return; }
      if (hasAnalysis()) return askToSwitch(to);
      state.pillar = to;
      drawPillars(); safeSave();
      go(1);
    };
  });
  function askToSwitch(to) {
    const dlg = $('switchDialog');
    $('switchFrom').textContent = PILLARS[state.pillar].name;
    $('switchTo').textContent = PILLARS[to].name;
    dlg.onclose = () => {
      if (dlg.returnValue !== 'reset') { drawPillars(); return; }
      // the server keeps an AI result a save does not carry; resetAt tells it this one is wiped on purpose
      state = { ...state, pillar: to, byPillar: {}, resetAt: new Date().toISOString() };
      reached = 1;
      drawPillars(); saveNow();
      go(1);
      scrollToEl($('main'));
    };
    dlg.returnValue = '';
    dlg.showModal();
    $('switchConfirmBtn').blur();
  }

  // Shows one of the main panel's views: 1 pick · 2 numbers & start date · 3 report.
  // The report needs a diagnosis; without one, the participant is sent to step 2 to make it.
  function go(n) {
    if (n === 3 && !answers().ai) n = 2;
    view = n;
    reached = Math.max(reached, n);
    show('questionView', n === 1); show('evidenceView', n === 2); show('workingView', false); show('resultView', n === 3);
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

  // ─────────────── Langkah 03: optional numbers ───────────────
  function drawEvidence() {
    const p = state.pillar, d = PILLARS[p], a = answers();
    $('calculatorTitle').textContent = d.calculatorTitle;
    $('calculatorIntro').textContent = d.calculatorIntro;
    $('calcNote').textContent = CALC_NOTE;
    const values = calcInputs(p, a.calc);
    $('calculatorFields').innerHTML = d.fields.map((f) => `<div class="calcfield"><label for="calc_${f.id}">${KB.esc(f.label)}</label><input type="number" inputmode="decimal" id="calc_${f.id}" data-calc="${f.id}" min="${f.min ?? 0}" ${f.max != null ? `max="${f.max}"` : ''} step="${f.step ?? 1}" placeholder="${KB.esc(String(f.value))}" value="${KB.esc(a.calc[f.id] ?? '')}"></div>`).join('');
    $$('[data-calc]').forEach((el) => { el.oninput = () => { a.calc[el.dataset.calc] = el.value; drawCalc(); safeSave(); }; });
    drawCalc();
    $('reportBtn').textContent = a.ai && fresh() ? 'Lihat laporan saya →' : 'Jana diagnosis AI saya →';
  }
  // Empty boxes show the prototype's example figures, which the calculator uses until the
  // participant enters their own; only their own figures are sent to the AI.
  function drawCalc() {
    const r = calculate(state.pillar, answers().calc);
    $('calculatorResult').innerHTML = `${r.lines.map(KB.esc).join('<br>')}<small>${KB.esc(r.note)}</small>`;
  }
  function drawStartDate() { $$('[data-startdate]').forEach((el) => { el.value = answers().plan.startDate || ''; }); }
  $$('[data-startdate]').forEach((el) => el.addEventListener('input', () => {
    answers().plan.startDate = el.value;
    drawStartDate(); safeSave();
    if (view === 3) drawStale();
  }));
  $('evidenceBackBtn').onclick = () => { go(1); scrollToEl($('main')); };
  $('reportBtn').onclick = () => { if (answers().ai && fresh()) { go(3); scrollToEl($('main')); } else generate(); };

  // ─────────────── the AI coach ───────────────
  // The diagnosis is current while the inputs the AI saw are unchanged (the same function the
  // server uses builds them). The start date is picked on the plan page after the analysis, so
  // choosing it does not make the analysis out of date.
  const inputKey = (input) => JSON.stringify({ ...input, action_start_date: undefined });
  const fresh = () => { try { return inputKey(JSON.parse(answers().ai.inputKey)) === inputKey(coachInput(state)); } catch { return false; } };
  let generating = false;
  async function generate() {
    if (generating) return;
    generating = true;
    clearFieldErrors(); msg('evidenceMessage', ''); msg('reportMessage', '');
    show('questionView', false); show('evidenceView', false); show('resultView', false); show('workingView', true);
    $('workingDetail').textContent = `${PILLARS[state.pillar].name} · ${answers().selected.length} situasi dipilih`;
    scrollToEl($('main'));
    try {
      await saveNow(); // the server builds the AI input from the saved answers
      const r = await KB.api('/api/coach', { method: 'POST', body: {} });
      // a new analysis brings new workshop questions, so the workshop starts again
      Object.assign(answers(), { ai: r.ai, planDone: [], page: 1, workAnswers: [], workStep: 0, workAsking: false, workOutput: '', workGenerated: '', workToCheck: [], workSource: '' });
      reached = 3;
      go(3);
      scrollToEl($('main'));
    } catch (err) {
      go(2);
      fieldError('reportBtn', err.status === 429 ? err.message : `${err.message || 'AI gagal menyediakan diagnosis.'} Tekan butang sekali lagi untuk cuba semula.`);
    } finally {
      generating = false;
    }
  }
  $$('[data-regenerate]').forEach((b) => {
    b.onclick = () => {
      if (!confirm('Jana semula diagnosis, latihan dan pelan dengan angka terkini? Jawapan dan hasil latihan Quick Fix, serta tanda selesai pada pelan, akan dikosongkan.')) return;
      generate();
    };
  });

  // ─────────────── the report ───────────────
  function drawReport() {
    const p = state.pillar, d = PILLARS[p], a = answers(), ai = a.ai, R = ai.result;
    $('resultCategory').textContent = `${d.label} · BUSINESS QUICK FIX REPORT`;
    $('sourceTag').textContent = ai.source === 'ai' ? 'DIAGNOSIS AI' : 'DIAGNOSIS + WORKSHOP';
    $('diagEyebrow').textContent = ai.source === 'ai' ? 'DIAGNOSIS AWAL · DISEDIAKAN OLEH AI' : 'DIAGNOSIS AWAL';
    $('diagnosisTitle').textContent = R.diagnosis_title;
    $('diagnosisIntro').textContent = R.diagnosis_summary;
    // One row per ticked situation with the AI's reason beside it; the main issue is highlighted.
    // (Older analyses have only the two combined reasons: the main one goes on its row.)
    const reasonOf = (n) => R.issue_analysis?.find((x) => x.number === n)?.reason || (n === R.primary_issue ? R.priority_reason : '');
    $('symptomList').innerHTML = a.selected.map((i, k) => {
      const n = k + 1, main = R.primary_issue === n, why = reasonOf(n);
      return `<div class="issuerow${main ? ' primary' : ''}" role="row"><div class="issuecell" role="cell"><span class="issuenum">${n}</span><div>${main ? '<span class="badge">Isu utama</span>' : ''}<p>${KB.esc(d.issues[i])}</p></div></div><div class="reasoncell" role="cell">${main ? '<span class="reasonlabel">Kenapa didahulukan</span>' : ''}<p>${why ? KB.esc(why) : '—'}</p></div></div>`;
    }).join('') + (!R.issue_analysis?.length && R.other_issues ? `<p class="issuenote"><b>Kaitan isu lain:</b> ${KB.esc(R.other_issues)}</p>` : '');
    $('causeText').textContent = R.likely_cause;
    $('impactText').textContent = R.impact;
    $('evidenceToCheck').innerHTML = R.evidence_to_check.length ? `<p class="mini">Bukti untuk disemak</p><ul>${R.evidence_to_check.map((x) => `<li>${KB.esc(x)}</li>`).join('')}</ul>` : '';
    // 04: the calculator figures as entered (computed by the app, not the AI)
    const values = calcInputs(p, a.calc), r = calculate(p, a.calc);
    $('calcSummaryTitle').textContent = d.calculatorTitle;
    $('calcSummary').innerHTML = d.fields.map((f) => `<li>${KB.esc(f.label)}: <b>${KB.esc(values[f.id])}</b>${txt(a.calc[f.id]) === '' ? ' <span class="muted">(contoh)</span>' : ''}</li>`).join('');
    $('calcSummaryResult').innerHTML = `${r.lines.map(KB.esc).join('<br>')}<small>${KB.esc(r.note)}</small>`;
    // 05: the workshop
    $('exampleText').textContent = R.workshop.example;
    $('exampleBtn').hidden = !R.workshop.example;
    $('exampleBox').hidden = true; $('exampleBtn').setAttribute('aria-expanded', 'false'); $('exampleBtn').textContent = 'Lihat contoh';
    drawWorkshop();
    // 06: the plan
    drawStartDate();
    $('planList').innerHTML = R.plan.map((it, i) => `<li class="planitem${a.planDone[i] ? ' done' : ''}"><label class="plancheck"><input type="checkbox" data-done="${i}" ${a.planDone[i] ? 'checked' : ''}><span class="planday">Hari ${it.day}</span><span class="sr-only"> · item ${i + 1} selesai</span></label><dl><dt>A${i + 1}</dt><dd>${KB.esc(it.action)}</dd><dt>B${i + 1}</dt><dd>${KB.esc(it.measure)}</dd><dt>C${i + 1}</dt><dd>${KB.esc(it.evidence)}</dd></dl></li>`).join('');
    $$('[data-done]').forEach((el) => { el.onchange = () => { a.planDone[+el.dataset.done] = el.checked; el.closest('.planitem').classList.toggle('done', el.checked); saveNow(); }; });
    // 07: reflection
    $('reflPrepared').textContent = R.reflection.prepared;
    $('reflValidate').textContent = R.reflection.to_validate;
    $('reflGuidance').textContent = R.reflection.further_guidance;
    // the recommended class for this challenge
    const C = NEXT_CLASS[p];
    $('nextTitle').textContent = C.title;
    $('nextLead').textContent = C.lead;
    $('nextText').textContent = C.text;
    $('className').textContent = C.name;
    $('classPrice').textContent = C.price;
    $('classMeta').textContent = C.meta;
    $('classCtaText').textContent = C.cta;
    $('classLink').href = C.url || KB.cfg.classUrl || '#';
    $$('[data-regenerate]').forEach((b) => { b.hidden = ai.source !== 'ai' && !KB.cfg.aiReady; });
    drawStale();
    drawPage();
    msg('reportMessage', '');
  }

  // ─────────────── the report, one page at a time ───────────────
  const PAGES = 8;
  const page = () => Math.min(PAGES, Math.max(1, answers().page || answers().revealed || 1));
  function drawPage() {
    const n = page();
    $$('#resultView .page').forEach((el) => { el.hidden = +el.dataset.step !== n; });
    show('reportActions', n === PAGES);
    $('revealCount').textContent = `${n} / ${PAGES}`;
    $('revealFill').style.width = `${(n / PAGES) * 100}%`;
    $('revealPrevBtn').hidden = n === 1;
    $('revealNextBtn').hidden = n === PAGES;
    $('revealDone').hidden = n !== PAGES;
    requestAnimationFrame(growAll);
  }
  // Turns to page n: the new page slides in from the side it comes from, the view goes back to the
  // top of the report, and focus moves to the page heading for screen readers.
  function turnTo(n) {
    const before = page();
    n = Math.min(PAGES, Math.max(1, n));
    if (n === before) return;
    answers().page = n;
    drawPage(); safeSave();
    const pages = $$(`#resultView .page[data-step="${n}"]`);
    pages.forEach((el) => { el.classList.remove('turn-next', 'turn-back'); void el.offsetWidth; el.classList.add(n > before ? 'turn-next' : 'turn-back'); });
    scrollToEl($('resultView'));
    const h = pages.at(-1)?.querySelector('h3, h4');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
  $('revealNextBtn').onclick = () => turnTo(page() + 1);
  $('revealPrevBtn').onclick = () => turnTo(page() - 1);
  function drawStale() { show('staleNotice', !!answers().ai && !fresh()); }
  // ─────────────── 05: Quick Fix workshop, one question at a time ───────────────
  // The participant answers the AI's questions in turn; then the AI arranges the answers into the
  // exercise output (POST /api/workshop), which they can still edit.
  const wsQuestions = () => workshopQuestions(answers().ai?.result?.workshop);
  const wsStep = () => Math.min(wsQuestions().length - 1, Math.max(0, answers().workStep || 0));
  let wsBusy = false, wsLoadingQuestions = false;
  const wsTried = new Set();
  // Reports written before the AI wrote workshop questions get them once (else the steps are used).
  async function loadQuestions() {
    const a = answers();
    wsTried.add(a.ai.at);
    wsLoadingQuestions = true; drawWorkshop();
    try {
      await saveNow();
      const r = await KB.api('/api/workshop/questions', { method: 'POST', body: {} });
      if (r.questions?.length) a.ai.result.workshop.questions = r.questions;
    } catch (err) {
      msg('wsMessage', err.message || 'Soalan latihan gagal disediakan.', true);
    } finally {
      wsLoadingQuestions = false; drawWorkshop();
    }
  }
  function drawWorkshop() {
    const a = answers(), R = a.ai.result;
    a.workAnswers ||= [];
    const started = a.workAnswers.some((x) => txt(x)) || txt(a.workOutput);
    if (a.ai.source === 'ai' && KB.cfg.aiReady && !R.workshop.questions?.length && !started && !wsTried.has(a.ai.at)) return loadQuestions();
    $('exerciseTitle').textContent = R.workshop.title;
    $('exerciseBrief').textContent = R.workshop.purpose;
    $('workOutputLabel').textContent = R.workshop.output || 'Hasil latihan anda';
    const done = !a.workAsking && txt(a.workOutput) !== '';
    const busy = wsBusy || wsLoadingQuestions;
    $('wsWorkingText').textContent = wsLoadingQuestions ? 'Menyediakan soalan latihan…' : 'AI sedang menyusun hasil latihan daripada jawapan anda…';
    show('wsWorking', busy);
    show('wsAsk', !busy && !done);
    show('wsDone', !busy && done);
    if (busy) return;
    if (done) drawWsDone(); else drawWsQuestion();
  }
  function drawWsQuestion() {
    const a = answers(), qs = wsQuestions(), i = wsStep(), last = i === qs.length - 1;
    $('wsCount').textContent = `Soalan ${i + 1} daripada ${qs.length}`;
    $('wsDots').innerHTML = qs.map((_, k) => `<i class="${k === i ? 'on' : txt(a.workAnswers[k]) ? 'answered' : ''}"></i>`).join('');
    $('wsQuestion').textContent = qs[i].question;
    $('wsHint').textContent = qs[i].hint || '';
    $('wsAnswer').value = a.workAnswers[i] || '';
    $('wsPrevBtn').hidden = i === 0;
    $('wsNextBtn').textContent = last ? (txt(a.workOutput) ? 'Susun semula hasil latihan →' : 'Susun hasil latihan saya →') : 'Seterusnya →';
    $('wsBackToOutput').hidden = !txt(a.workOutput);
    requestAnimationFrame(() => autoGrow($('wsAnswer')));
  }
  function drawWsDone() {
    const a = answers(), qs = wsQuestions();
    const answered = qs.some((_, i) => txt(a.workAnswers[i]));
    $('wsAnswersTitle').textContent = `Jawapan anda (${qs.length} soalan)`;
    $('wsAnswerList').innerHTML = qs.map((q, i) => `<li><b>${KB.esc(q.question)}</b><span>${KB.esc(txt(a.workAnswers[i]) || '—')}</span></li>`).join('');
    $('wsAnswerList').closest('details').hidden = !answered;
    $('wsSource').textContent = a.workSource === 'ai' ? 'Disusun oleh AI daripada jawapan anda. Semak, dan ubah teks ini jika perlu.' : a.workSource === 'fixed' ? 'Jawapan anda, disusun mengikut soalan. Anda boleh ubah teks ini.' : 'Anda boleh ubah teks ini.';
    $('workOutput').value = a.workOutput;
    $('wsToCheck').innerHTML = a.workToCheck?.length ? `<div class="wscheck"><p>Semak sebelum guna</p><ul>${a.workToCheck.map((x) => `<li>${KB.esc(x)}</li>`).join('')}</ul></div>` : '';
    requestAnimationFrame(() => autoGrow($('workOutput')));
  }
  function askQuestion(i) {
    answers().workStep = i;
    clearFieldErrors();
    drawWsQuestion(); safeSave();
    $('wsAnswer').focus({ preventScroll: true });
  }
  $('wsAnswer').addEventListener('input', () => {
    answers().workAnswers[wsStep()] = $('wsAnswer').value;
    autoGrow($('wsAnswer')); safeSave();
  });
  $('wsPrevBtn').onclick = () => askQuestion(wsStep() - 1);
  $('wsNextBtn').onclick = () => {
    const a = answers(), i = wsStep();
    if (!txt(a.workAnswers[i])) return fieldError('wsAnswer', 'Tulis jawapan ringkas dahulu.');
    if (i < wsQuestions().length - 1) return askQuestion(i + 1);
    buildWorkOutput();
  };
  $('wsEditBtn').onclick = () => { Object.assign(answers(), { workAsking: true, workStep: 0 }); drawWorkshop(); safeSave(); $('wsAnswer').focus({ preventScroll: true }); };
  $('wsBackToOutput').onclick = () => { answers().workAsking = false; clearFieldErrors(); drawWorkshop(); safeSave(); };
  $$('[data-ws-generate]').forEach((b) => { b.onclick = () => buildWorkOutput(); });
  async function buildWorkOutput() {
    const a = answers();
    if (wsBusy) return;
    if (txt(a.workOutput) && a.workOutput !== a.workGenerated && !confirm('Teks hasil latihan yang anda ubah akan diganti dengan versi baharu. Teruskan?')) return;
    clearFieldErrors(); msg('wsMessage', '');
    wsBusy = true; drawWorkshop();
    try {
      await saveNow(); // the server builds the output from the saved answers
      const r = await KB.api('/api/workshop', { method: 'POST', body: {} });
      Object.assign(a, { workOutput: r.output, workGenerated: r.output, workToCheck: r.toCheck || [], workSource: r.source, workAsking: false });
      saveNow();
    } catch (err) {
      msg('wsMessage', `${err.message || 'AI gagal menyusun hasil latihan.'} Tekan butang sekali lagi untuk cuba semula.`, true);
    } finally {
      wsBusy = false; drawWorkshop();
    }
  }
  $('workOutput').addEventListener('input', () => { answers().workOutput = $('workOutput').value; autoGrow($('workOutput')); safeSave(); });
  $('exampleBtn').onclick = () => {
    const open = $('exampleBox').hidden;
    $('exampleBox').hidden = !open;
    $('exampleBtn').setAttribute('aria-expanded', String(open));
    $('exampleBtn').textContent = open ? 'Tutup contoh' : 'Lihat contoh';
  };
  $('editNumbersBtn').onclick = () => { go(2); scrollToEl($('main')); };
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

  // ─────────────── test data (localhost or ?demo) ───────────────
  const SAMPLE = { name: 'Nur Aina binti Ahmad', phone: '012-345 6789', email: 'aina@contoh.com', business: 'Aina Frozen Food', industry: INTAKE.industry[0], businessModel: INTAKE.businessModel[0], businessAge: INTAKE.businessAge[1], monthlySales: INTAKE.monthlySales[1] };
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

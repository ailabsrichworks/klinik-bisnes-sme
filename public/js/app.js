// Participant app: five steps, saved through our API to the participant's row in the Google Sheet.
// No login: a random key in this browser identifies the participant. A facilitator's ?c=CODE files them under that session.
import { PATH_LABELS as pathLabels, COST_KEYS as costKeys, CONTENT_KEYS, LIVE_KEYS, costSummary, liveMath, liveBlock, hasEvidence, programmeFit, templateTasks, TASK_TITLE_MAX, TASK_PROOF_MAX, METRIC_LABELS } from './rules.mjs';

(async () => {
  'use strict';
  const { $, esc: scrub, message: msg, show } = KB;
  const $$ = (q) => [...document.querySelectorAll(q)];
  const txt = (s) => String(s ?? '').trim();
  const money = (x) => `RM${Number(x).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const CACHE_KEY = 'kbsme_quick_fix_cache_v3';
  const COHORT_KEY = 'kbsme_cohort_code';

  const stepNames = ['Kenali bisnes', 'Tunjukkan bukti', 'Diagnosis awal', 'Bina Quick Fix', 'Pelaksanaan 7 hari'];
  const blank = () => ({
    profile: { business: '', product: '', customer: '', channel: '', revenue: '', participant: '', businessActive: '', ownerAuthority: '', pain: '' },
    evidenceText: '', costs: {}, content: {}, live: {}, evidenceFile: null, programme: null, diagnosis: null, pathway: '', confirmed: false, quickFix: '',
    quality: [false, false, false], tasks: [], metrics: ['', '', ''], reviewNotes: '',
    nextStep: 'Bertindak sendiri dahulu', marketingConsent: false, trackerStartedAt: null,
  });

  let state = blank(), step = 0, file = null, fileUrl = null;
  let journey = null; // { id, consent, evidenceFile, session, createdAt } from our server

  // ─────────────── boot: saved key → journey; otherwise privacy notice → new journey ───────────────
  const params = new URLSearchParams(location.search);
  const normCode = (c) => String(c || '').trim().toUpperCase();
  if (params.get('c')) { try { localStorage.setItem(COHORT_KEY, normCode(params.get('c'))); } catch {} }
  const demoMode = ['localhost', '127.0.0.1'].includes(location.hostname) || params.has('demo');
  const cohortCode = () => { try { return localStorage.getItem(COHORT_KEY) || ''; } catch { return ''; } };

  try {
    await KB.init();
  } catch (err) {
    $('loadingGate').innerHTML = '<p>Data gagal dimuatkan. Semak sambungan internet dan muat semula halaman.</p>';
    return;
  }

  function showOnly(id) {
    ['codeGate', 'consentGate', 'loadingGate', 'app'].forEach((x) => show(x, x === id));
    document.body.classList.toggle('in-app', id === 'app');
  }
  const failed = () => { showOnly('loadingGate'); $('loadingGate').innerHTML = '<p>Data gagal dimuatkan. Semak sambungan internet dan muat semula halaman.</p>'; };

  // Shown when a code is not recognised; the participant can fix it or continue without one.
  function askForCode(text = '', isError = false) {
    showOnly('codeGate');
    $('codeInput').value = cohortCode();
    msg('codeMessage', text, isError);
  }

  async function boot() {
    showOnly('loadingGate');
    if (KB.getKey()) {
      try {
        journey = await KB.api('/api/journey');
        if (journey.consent.privacyVersion === KB.cfg.noticeVersion) return loadApp();
        return askConsent(async () => { await KB.api('/api/consent', { method: 'POST', body: { kind: 'privacy', granted: true } }); });
      } catch (err) {
        if (err.status !== 401) { console.error(err); return failed(); }
        KB.setKey(null); // the journey was deleted or the key is stale: start again
      }
    }
    const code = cohortCode();
    if (code) {
      try { await KB.api(`/api/session/${encodeURIComponent(code)}`); } catch (err) {
        if (err.status === 404) return askForCode('Kod sesi ini tidak sah.', true);
        console.error(err); return failed();
      }
    }
    askConsent(async () => {
      const j = await KB.api('/api/journey', { method: 'POST', body: { code: cohortCode() || undefined, acceptNotice: KB.cfg.noticeVersion } });
      KB.setKey({ id: j.id, token: j.token });
      journey = j;
    });
  }

  $('noCodeBtn').onclick = () => { try { localStorage.removeItem(COHORT_KEY); } catch {} boot(); };
  $('codeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = normCode($('codeInput').value);
    if (!code) return msg('codeMessage', 'Masukkan kod sesi daripada fasilitator.', true);
    try { localStorage.setItem(COHORT_KEY, code); } catch {}
    boot();
  });

  function askConsent(accept) {
    showOnly('consentGate');
    $('consentBtn').onclick = async () => {
      if (!$('noticeAccept').checked) return msg('consentMessage', 'Tandakan persetujuan untuk meneruskan.', true);
      $('consentBtn').disabled = true;
      try {
        await accept();
        loadApp();
      } catch (err) {
        msg('consentMessage', err.status === 404 ? 'Kod sesi ini tidak sah.' : err.status === 429 ? 'Terlalu ramai cuba serentak. Tunggu seminit dan cuba lagi.' : 'Gagal menyimpan. Cuba lagi.', true);
      } finally {
        $('consentBtn').disabled = false;
      }
    };
  }

  function loadApp() {
    if (!journey) return boot();
    if (journey.session) $('cohortLabel').textContent = `${journey.session.name}${journey.session.sessionDate ? ' · ' + new Date(journey.session.sessionDate).toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}`;
    const obj = journey.state || {};
    state = { ...blank(), ...obj, profile: { ...blank().profile, ...(obj.profile || {}) }, costs: obj.costs || {}, content: obj.content || {}, live: obj.live || {} };
    state.evidenceFile = journey.evidenceFile || null;
    showOnly('app');
    initFields(); toggleCosts();
    // Test mode: an empty form opens already filled (?demo=content|live|unknown picks the case; default cost).
    if (demoMode && !state.profile.business && !state.diagnosis) return fillDemo(DEMO[params.get('demo')] ? params.get('demo') : 'cost');
    const want = Number(params.get('step'));
    go(want >= 1 && want <= 5 ? want - 1 : guessStep());
  }

  function guessStep() {
    if (state.confirmed && state.quality.every(Boolean) && txt(state.quickFix)) return 4;
    if (state.confirmed) return 3;
    if (state.diagnosis) return 2;
    if (state.profile.business && state.profile.product && state.profile.pain) return 1;
    return 0;
  }

  // ─────────────── saving ───────────────
  // Every change is kept in this browser at once; the server (Google Sheet) gets it on step change,
  // diagnosis, tracker status change, after a pause in typing, and when the page is hidden or closed.
  let saveTimer = null, saving = Promise.resolve(), unsaved = false;
  function setSaveState(t) { const el = $('saveState'); if (el) el.textContent = t; }
  function safeSave() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ id: journey?.id, state })); } catch {}
    unsaved = true;
    setSaveState('Belum dihantar…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushRemote, 20_000);
  }
  function pushRemote({ keepalive = false } = {}) {
    clearTimeout(saveTimer); saveTimer = null;
    if (!journey || !unsaved) return saving;
    unsaved = false;
    const fit = currentFit();
    state.programme = state.diagnosis ? { status: fit.status, key: fit.key } : null;
    const { evidenceFile, ...body } = state; // the file record is kept by the server
    saving = saving.then(async () => {
      setSaveState('Menyimpan…');
      try {
        await KB.api('/api/journey', { method: 'PUT', body: { state: body, step }, keepalive });
        setSaveState('Disimpan.');
      } catch (err) {
        unsaved = true;
        setSaveState(err.status === 401 ? 'Sesi tamat — muat semula halaman.' : 'Belum disimpan — semak internet.');
      }
    });
    return saving;
  }
  const saveNow = () => { unsaved = true; return pushRemote(); };
  window.addEventListener('pagehide', () => pushRemote({ keepalive: true }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pushRemote({ keepalive: true }); });

  async function recordConsent(kind, granted) {
    try { await KB.api('/api/consent', { method: 'POST', body: { kind, granted } }); } catch (err) { console.error(err); }
  }

  // ─────────────── form <-> state ───────────────
  const message = (s, error = false, target = 'globalMessage') => msg(target, s, error);
  const clearMessage = (target = 'globalMessage') => msg(target, '');

  // Shows an error right below the control that caused it, scrolls it into view and focuses the control.
  function fieldError(target, text) {
    clearFieldErrors();
    const el = typeof target === 'string' ? $(target) : target;
    const anchor = el.closest('.field, .check-label, .choice-grid, .upload') || el;
    const m = document.createElement('div');
    m.className = 'message show error field-error';
    m.setAttribute('role', 'alert');
    m.textContent = text;
    anchor.after(m);
    m.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }
  function clearFieldErrors() { $$('.field-error').forEach((e) => e.remove()); }
  // Shows a status or error in a message box and makes sure it is on screen.
  function notice(target, text, error = false) {
    message(text, error, target);
    if (text) $(target).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  // Textareas grow with their content instead of scrolling inside the page.
  // (Only while visible: a hidden textarea has no height to measure.)
  const autoGrow = (el) => { if (!el?.offsetParent) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };
  const growAll = () => $$('textarea.grow').forEach(autoGrow);
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(growAll, 150); });
  const getPain = () => state.profile.pain || 'unknown';
  const currentPath = () => state.pathway || state.diagnosis?.pathway || 'missing';

  function dataFromForm() {
    ['business', 'product', 'customer', 'channel', 'revenue', 'participant', 'businessActive', 'ownerAuthority'].forEach((k) => { state.profile[k] = $(k).value.trim(); });
    state.profile.pain = document.querySelector('[name="pain"]:checked')?.value || '';
    state.evidenceText = $('evidenceText').value;
    costKeys.forEach((k) => { state.costs[k] = $(k).value; });
    CONTENT_KEYS.forEach((k) => { state.content[k] = $(k).value; });
    LIVE_KEYS.forEach((k) => { state.live[k] = $(k).value; });
    state.confirmed = $('confirmDiagnosis').checked;
    state.quickFix = $('quickFixEditor').value;
    state.quality = ['quality1', 'quality2', 'quality3'].map((k) => $(k).checked);
    state.metrics = [0, 1, 2].map((i) => $('metric' + i)?.value ?? state.metrics[i]);
    state.reviewNotes = $('reviewNotes').value;
    state.nextStep = $('nextStep').value;
    state.marketingConsent = $('marketingConsent').checked;
    safeSave();
  }

  function initFields() {
    ['business', 'product', 'customer', 'channel', 'revenue', 'participant', 'businessActive', 'ownerAuthority'].forEach((k) => { $(k).value = state.profile[k] || ''; });
    $$('input[name="pain"]').forEach((r) => { r.checked = r.value === state.profile.pain; });
    $('evidenceText').value = state.evidenceText || '';
    costKeys.forEach((k) => { $(k).value = state.costs[k] ?? ''; });
    CONTENT_KEYS.forEach((k) => { $(k).value = state.content[k] ?? ''; });
    LIVE_KEYS.forEach((k) => { $(k).value = state.live[k] ?? ''; });
    $('confirmDiagnosis').checked = !!state.confirmed;
    $('quickFixEditor').value = state.quickFix || '';
    ['quality1', 'quality2', 'quality3'].forEach((k, i) => { $(k).checked = !!state.quality[i]; });
    $('reviewNotes').value = state.reviewNotes || '';
    $('nextStep').value = state.nextStep || 'Bertindak sendiri dahulu';
    $('marketingConsent').checked = !!state.marketingConsent;
    $('fileStatus').textContent = state.evidenceFile ? `Disimpan: ${state.evidenceFile.name}. Pilih fail lain untuk menggantikan.` : 'Belum ada fail dipilih.';
    drawCosts(); drawLiveSnapshot(); drawDiagnosis(); drawBuild(); drawTracker(); drawReport();
  }

  function go(n) {
    if (n > 1 && !state.diagnosis && n !== 2) n = 1;
    step = Math.max(0, Math.min(4, n));
    $$('.panel').forEach((el, i) => el.classList.toggle('active', i === step));
    $$('.step-tab').forEach((el, i) => { el.classList.toggle('active', i === step); el.classList.toggle('done', i < step); el.setAttribute('aria-current', i === step ? 'step' : 'false'); });
    $('progressLabel').textContent = `Langkah ${step + 1} / 5`;
    $('progressDesc').textContent = stepNames[step];
    $('progressPercent').textContent = `${(step + 1) * 20}%`;
    $('progressBar').style.width = `${(step + 1) * 20}%`;
    $('prevBtn').style.visibility = step === 0 ? 'hidden' : 'visible';
    $('nextBtn').style.display = step === 1 || step === 4 ? 'none' : 'inline-flex'; // step 2's action is "Jana Diagnosis Awal"
    $('nextBtn').textContent = step === 2 ? 'Bina Quick Fix →' : 'Seterusnya →';
    if (step === 3) drawBuild();
    if (step === 4) {
      if (!state.trackerStartedAt) state.trackerStartedAt = new Date().toISOString();
      drawTracker(); drawReport();
    }
    clearMessage(); clearFieldErrors();
    requestAnimationFrame(growAll);
    safeSave(); pushRemote();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function validProfile() {
    dataFromForm();
    if (!state.profile.business) { fieldError('business', 'Isi nama bisnes anda.'); return false; }
    if (!state.profile.product) { fieldError('product', 'Isi produk atau servis utama.'); return false; }
    if (!state.profile.pain) { fieldError(document.querySelector('[name="pain"]'), 'Pilih satu isu yang paling dekat.'); return false; }
    return true;
  }
  const hasCostValues = () => costKeys.some((k) => txt(state.costs[k]) !== '');

  function validateStep() {
    dataFromForm();
    if (step === 0) return validProfile();
    if (step === 1) { fieldError('diagnoseBtn', 'Tekan “Jana Diagnosis Awal” untuk meneruskan.'); return false; }
    if (step === 2) {
      if (!state.diagnosis) { notice('globalMessage', 'Diagnosis belum dijana.', true); return false; }
      if (!$('confirmDiagnosis').checked) { fieldError('confirmDiagnosis', 'Tandakan ini dahulu: diagnosis ini bersifat awal.'); return false; }
      const chosen = $('pathwaySelect').value;
      if (chosen === 'live' && state.live.liveExperience !== 'yes') { fieldError('pathwaySelect', 'LIVE Sales hanya untuk peserta yang sudah menjual melalui LIVE. Pilih laluan lain, atau sahkan pengalaman LIVE di Langkah 2 dan jana diagnosis semula.'); return false; }
      const changed = chosen !== state.pathway || !state.tasks?.length;
      state.pathway = chosen; state.confirmed = true;
      if (changed) {
        state.quickFix = chosen === state.diagnosis.pathway ? state.diagnosis.quickFix : defaultFix(chosen);
        state.tasks = tasksFor(chosen); state.quality = [false, false, false];
      }
      safeSave(); return true;
    }
    if (step === 3) {
      if (!txt(state.quickFix)) { fieldError('quickFixEditor', 'Sediakan dan semak Quick Fix dahulu.'); return false; }
      const unchecked = state.quality.findIndex((v) => !v);
      if (unchecked >= 0) { fieldError(`quality${unchecked + 1}`, 'Tandakan ketiga-tiga semakan kualiti sebelum ke tracker.'); return false; }
      return true;
    }
    return true;
  }

  // ─────────────── structured inputs ───────────────
  function toggleCosts() {
    const p = getPain();
    $('costInputs').hidden = p !== 'cost'; $('contentInputs').hidden = p !== 'content'; $('liveInputs').hidden = p !== 'live';
    drawCosts(); drawLiveSnapshot();
  }
  const unknownCosts = (c) => c.unknown_cost_categories.join(', ');
  function drawCosts() {
    const c = costSummary(state.costs);
    $('provisionalBalance').textContent = c.provisional_balance !== null ? money(c.provisional_balance) : 'Belum boleh dikira';
    const zero = c.reported_zero_to_verify.length ? ` RM0 dilaporkan untuk ${c.reported_zero_to_verify.join(', ')} — sahkan.` : '';
    $('missingCosts').textContent = c.provisional_balance !== null
      ? (c.unknown_cost_categories.length ? `Belum diketahui: ${unknownCosts(c)}. Baki sementara bukan net profit.${zero}` : `Semua kategori diisi; semak bahawa tiada kos lain tertinggal.${zero}`)
      : c.reason;
  }
  function drawLiveSnapshot() {
    const l = state.live, m = liveMath(l);
    $('liveSnapshot').textContent = m.valid
      ? `Daripada ${m.claims} claims, ${m.unpaid} belum dibayar (${m.rate.toFixed(1)}%) — sah hanya jika kedua-dua angka dari sesi dan cutoff yang sama. Sebab belum dibayar masih belum diketahui.`
      : m.contradictory ? m.reason : 'Pastikan claims dan paid orders merujuk sesi dan tempoh pemantauan yang sama. Data belum mencukupi.';
  }

  // ─────────────── programme fit (rules only, never the AI) ───────────────
  function currentFit() {
    return programmeFit({ profile: state.profile, live: state.live, pathway: currentPath(), diagnosedPathway: state.diagnosis?.pathway });
  }
  function drawProgramme() {
    const f = currentFit();
    const show = !!state.diagnosis && f.status !== 'none';
    // Shown once, in Langkah 5, and only when the fit rules allow it.
    const el = $('programmeDetails');
    el.hidden = !show; el.dataset.status = f.status;
    el.innerHTML = `<h4>Langkah seterusnya (pilihan)</h4><p>${scrub(f.detail)}</p>${f.status === 'ready' || f.status === 'pending' ? '<p class="opt">Tiada kewajipan. Anda boleh teruskan Quick Fix dan tracker sendiri. Pilihan di bawah tidak menghantar apa-apa secara automatik.</p>' : ''}`;
  }

  // ─────────────── offline rule-based fallback (only when the server has no AI key) ───────────────
  function inferPath() {
    const p = getPain();
    if (p === 'live') return liveBlock({ live: state.live, evidenceText: state.evidenceText, hasFile: !!(file || state.evidenceFile) }) ? 'missing' : 'live';
    return ['cost', 'content'].includes(p) ? p : 'missing';
  }
  function defaultFix(p) {
    const product = state.profile.product || '[produk / servis]';
    if (p === 'cost') {
      const c = costSummary(state.costs);
      return `COST GAP SNAPSHOT — ${product}\nHarga jualan: ${c.selling_price !== null ? money(c.selling_price) : 'Belum diketahui'}\nBaki selepas kos langsung DIKETAHUI SAHAJA: ${c.provisional_balance !== null ? money(c.provisional_balance) : 'Tidak boleh dikira'} (BUKAN net profit)\nKos yang perlu disahkan: ${unknownCosts(c) || '[semak kategori kos lain]'}\nQUICK WIN: Pilih SATU kos yang belum diketahui. Semak resit / penyata seller sebenar dan catat jumlah per unit atau per pesanan serta tarikhnya.`;
    }
    if (p === 'content') {
      const c = state.content;
      return `CONTENT SYSTEM SNAPSHOT — ${product}\nPost 7 hari lepas: ${txt(c.postsWeek) || '[belum dicatat]'}\nMasa content seminggu: ${txt(c.hoursWeek) ? c.hoursWeek + ' jam' : '[belum dicatat]'}\nAda jadual: ${c.hasContentPlan === 'yes' ? 'Ya' : c.hasContentPlan === 'no' ? 'Tidak' : 'Belum diketahui'}\nQUICK WIN: Pilih SATU soalan sebenar pelanggan: [soalan]. Jawab melalui SATU post ringkas minggu ini. Catat tarikh terbit dan respons sebenar (reach / save / enquiry).`;
    }
    if (p === 'live') {
      const m = liveMath(state.live);
      return `LIVE SALES LEAKAGE SNAPSHOT — ${product}\nClaims: ${txt(state.live.liveClaims) || '[belum dicatat]'}\nPaid orders: ${txt(state.live.livePaid) || '[belum dicatat]'}\nClaims belum dibayar: ${m.valid ? `${m.unpaid} (${m.rate.toFixed(1)}%)` : 'Belum dapat dikira dengan sah'}\nQUICK WIN: Semak SATU sesi LIVE sebenar. Padankan claims vs paid orders untuk cohort / cutoff yang sama dan catat masa invoice / payment link dihantar. Jangan anggap invoice lewat sebagai punca tanpa rekod.`;
    }
    return 'FACT-FINDING ACTION\nFakta penting untuk dicari: [satu maklumat yang hilang].\nDi mana mendapatkan fakta: [seller statement / insight platform / log LIVE / rekod content].\nSiapa akan semak: [nama / peranan].\nTarikh: [dalam 7 hari].\nJangan buat keputusan tentang punca sales sebelum bukti mencukupi.';
  }
  const toTracker = (list) => list.map(({ title, proof }, i) => ({ day: i + 1, title, proof, status: 'belum', note: '' }));
  function generateTasks(p) { return toTracker(templateTasks(p)); }
  // AI tasks only for the pathway the AI diagnosed; any other pathway gets that pathway's template.
  function tasksFor(p) {
    const d = state.diagnosis;
    return d && p === d.pathway && Array.isArray(d.tasks) && d.tasks.length === 7 ? toTracker(d.tasks) : generateTasks(p);
  }
  function demoDiagnose() {
    const p = inferPath(); const ev = txt(state.evidenceText);
    const observations = [], unknowns = []; let reason = '';
    const fileNote = file || state.evidenceFile ? 'Lampiran tidak dianalisis dalam mod tanpa AI; terangkan isinya dalam teks.' : null;
    if (p === 'cost') { const c = costSummary(state.costs); reason = c.provisional_balance !== null ? `Berdasarkan kos langsung yang diketahui sahaja, baki sementara ialah ${money(c.provisional_balance)}. Ini bukan untung bersih.` : 'Maklumat harga dan kos belum cukup untuk mengira baki sementara.'; observations.push(c.provisional_balance !== null ? `Harga dan ${Object.keys(c.known_direct_cost).length} kategori kos diketahui dimasukkan.` : 'Harga atau kos langsung belum lengkap.'); unknowns.push(...c.unknown_cost_categories.map((k) => `${k}: belum diketahui`)); }
    if (p === 'content') { const c = state.content; reason = 'Rutin content perlu dilihat sebagai sistem: berapa kerap, berapa lama, ada jadual, dan sama ada hasil disemak.'; observations.push(`Post 7 hari lepas: ${txt(c.postsWeek) || 'tidak dinyatakan'}; jam seminggu: ${txt(c.hoursWeek) || 'tidak dinyatakan'}.`); unknowns.push('Respons sebenar pelanggan terhadap post belum direkod.'); }
    if (p === 'live') { const m = liveMath(state.live); reason = m.valid ? `${m.unpaid} daripada ${m.claims} claims belum dibayar (${m.rate.toFixed(1)}%). Sebabnya belum diketahui.` : 'Rekod claims dan paid orders belum cukup untuk dikira.'; observations.push('Peserta melaporkan pengalaman LIVE selling.'); unknowns.push('Sama ada claims dan paid orders dari cutoff yang sama.'); }
    if (p === 'missing') { reason = 'Bukti yang ada belum cukup untuk memilih pembetulan yang berasas. Mulakan dengan mencari satu fakta penting.'; observations.push('Isu utama belum dapat ditentukan daripada input semasa.'); if (getPain() === 'live') unknowns.push(liveBlock({ live: state.live, evidenceText: ev, hasFile: !!(file || state.evidenceFile) })); }
    if (fileNote) unknowns.push(fileNote);
    const strength = ev.length > 35 || hasCostValues() ? 'Ada input peserta, perlu pengesahan' : 'Bukti terhad';
    return { pathway: p, title: pathLabels[p], reason, observations, unknowns: unknowns.filter(Boolean), strength, quickFix: defaultFix(p), origin: 'demo' };
  }

  // ─────────────── diagnosis ───────────────
  async function uploadEvidence() {
    if (!file) return !!state.evidenceFile;
    const r = await KB.api('/api/upload', { method: 'POST', raw: file, headers: { 'X-File-Name': encodeURIComponent(file.name) } })
      .catch((err) => { throw new Error(err.status === 413 ? 'Fail melebihi 4 MB.' : err.message || 'Lampiran gagal dimuat naik.'); });
    state.evidenceFile = r.evidenceFile;
    file = null;
    $('fileStatus').textContent = `Disimpan: ${r.evidenceFile.name}. Pilih fail lain untuk menggantikan.`;
    return true;
  }

  async function createDiagnosis() {
    dataFromForm(); clearMessage('evidenceMessage'); clearFieldErrors();
    const p0 = state.profile;
    if (!p0.business || !p0.product || !p0.pain) { go(0); validProfile(); return; }
    if (!hasEvidence({ evidenceText: state.evidenceText, costs: state.costs, content: state.content, live: state.live, hasFile: !!(file || state.evidenceFile) })) { fieldError('evidenceText', 'Tampal sekurang-kurangnya satu bukti, isi angka, atau lampirkan fail terlebih dahulu. Memilih isu sahaja belum cukup.'); return; }
    if (!$('privacyConfirm').checked) { fieldError('privacyConfirm', 'Tandakan pengesahan privasi dan kebenaran ini sebelum menjana diagnosis.'); return; }
    const btn = $('diagnoseBtn'); btn.disabled = true; btn.textContent = 'Menyemak bukti… (sehingga 1 minit)';
    try {
      let result;
      if (KB.cfg.aiReady) {
        await recordConsent('ai_processing', true);
        const useFile = await uploadEvidence();
        const r = await KB.api('/api/diagnose', { method: 'POST', body: { business: state.profile, pain: state.profile.pain, evidence_text: state.evidenceText, costs: state.costs, content: state.content, live: state.live, use_file: useFile } });
        result = { ...r, origin: 'ai' };
      } else {
        result = demoDiagnose();
      }
      state.diagnosis = { ...result, at: new Date().toISOString() }; state.pathway = result.pathway; state.confirmed = false; state.quickFix = result.quickFix;
      state.quality = [false, false, false]; state.tasks = tasksFor(result.pathway); state.metrics = ['', '', ''];
      $('confirmDiagnosis').checked = false;
      drawDiagnosis(); drawBuild(); go(2);
    } catch (err) {
      notice('evidenceMessage', `Diagnosis gagal: ${err.message}`, true);
    } finally {
      btn.disabled = false; btn.textContent = 'Jana Diagnosis Awal →';
    }
  }

  function drawDiagnosis() {
    const d = state.diagnosis;
    $('diagnosticEmpty').hidden = !!d; $('diagnosticContent').hidden = !d;
    if (!d) return;
    $('diagMode').textContent = d.origin === 'ai' ? 'AI · semak semula' : 'Simulasi rule-based · bukan AI';
    $('diagMode').className = 'status' + (d.origin === 'ai' ? '' : ' warn');
    $('diagStrength').textContent = d.strength;
    $('diagTitle').textContent = d.title;
    $('diagReason').textContent = d.reason;
    $('diagObserved').innerHTML = (d.observations.length ? d.observations : ['Tiada dapatan spesifik.']).map((x) => `<li>${scrub(x)}</li>`).join('');
    $('diagUnknown').innerHTML = (d.unknowns.length ? d.unknowns : ['Semak andaian yang belum dibuktikan.']).map((x) => `<li>${scrub(x)}</li>`).join('');
    $('pathwaySelect').value = state.pathway || d.pathway;
    drawProgramme();
  }

  function drawBuild() {
    const p = currentPath();
    $('fixPath').textContent = pathLabels[p] || 'Quick Fix';
    const explanation = { cost: 'Cari SATU kos yang tiada dalam rekod. Jangan buat keputusan harga penuh daripada baki sementara.', content: 'Lihat rutin, masa dan data content. Ambil SATU tindakan kecil — bukan kalendar sebulan.', live: 'Hanya untuk yang sudah LIVE. Semak satu jurang claim → paid; jangan bina rundown penuh.', missing: 'Kumpul satu fakta kritikal dahulu sebelum diagnosis atau sebarang cadangan.' };
    $('fixExplanation').textContent = explanation[p];
    $('originalEvidence').textContent = state.evidenceText ? state.evidenceText.slice(0, 750) : (hasCostValues() ? 'Maklumat harga / kos telah dimasukkan pada Langkah 2.' : (state.evidenceFile ? `Lampiran: ${state.evidenceFile.name}` : 'Maklumat berstruktur telah direkod pada Langkah 2.'));
    $('quickFixEditor').value = state.quickFix || (state.diagnosis ? defaultFix(p) : '');
    autoGrow($('quickFixEditor')); drawPlaceholders();
  }

  // The [ ... ] slots the participant still has to fill in, with a button that jumps to the next one.
  const SLOT = /\[[^\]\n]*\]/g;
  function drawPlaceholders() {
    const n = ($('quickFixEditor').value.match(SLOT) || []).length;
    $('placeholderCount').textContent = n ? `${n} tempat kosong [ … ] perlu diisi` : 'Semua tempat kosong [ … ] sudah diisi.';
    $('placeholderCount').classList.toggle('done', !n);
    $('nextPlaceholderBtn').hidden = !n;
  }
  function nextPlaceholder() {
    const ed = $('quickFixEditor');
    const slots = [...ed.value.matchAll(SLOT)];
    if (!slots.length) return;
    const m = slots.find((x) => x.index >= ed.selectionEnd) || slots[0];
    ed.focus({ preventScroll: true });
    ed.setSelectionRange(m.index, m.index + m[0].length);
    // The editor grows with its text, so scroll the page to roughly that line.
    const line = ed.value.slice(0, m.index).split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(ed).lineHeight) || 24;
    window.scrollTo({ top: ed.getBoundingClientRect().top + window.scrollY + line * lh - window.innerHeight / 3, behavior: 'smooth' });
  }

  // ─────────────── tracker & report ───────────────
  function drawTracker() {
    if (!state.diagnosis) return;
    if (!state.tasks || state.tasks.length !== 7) state.tasks = tasksFor(currentPath());
    const root = $('tracker'); root.innerHTML = '';
    state.tasks.forEach((item, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'task' + (item.status === 'selesai' ? ' done' : '');
      wrap.innerHTML = `<div class="day">Hari ${i + 1}</div><div class="task-head"><textarea class="task-title grow" rows="1" maxlength="${TASK_TITLE_MAX}" data-title="${i}" aria-label="Tugasan Hari ${i + 1} (boleh diedit)"></textarea><select aria-label="Status Hari ${i + 1}" data-status="${i}"><option value="belum">Belum mula</option><option value="sedang">Sedang buat</option><option value="selesai">Selesai ✓</option></select></div><label class="proof"><span>Bukti cadangan (boleh diedit)</span><textarea class="task-proof grow" rows="1" maxlength="${TASK_PROOF_MAX}" data-proof="${i}" aria-label="Bukti cadangan Hari ${i + 1} (boleh diedit)"></textarea></label><textarea class="track-note grow" rows="1" maxlength="450" data-note="${i}" aria-label="Bukti atau nota Hari ${i + 1}" placeholder="Catat bukti / pautan / angka sebenar (tanpa data customer)"></textarea>`;
      root.appendChild(wrap);
      wrap.querySelector('[data-status]').value = item.status;
      wrap.querySelector('[data-title]').value = item.title || '';
      wrap.querySelector('[data-proof]').value = item.proof || '';
      wrap.querySelector('[data-note]').value = item.note || '';
    });
    $$('#tracker [data-status]').forEach((el) => { el.onchange = () => { state.tasks[+el.dataset.status].status = el.value; saveNow(); drawTracker(); drawReport(); }; });
    $$('#tracker [data-note]').forEach((el) => { el.oninput = () => { state.tasks[+el.dataset.note].note = el.value; autoGrow(el); safeSave(); drawReport(); }; });
    $$('#tracker [data-title]').forEach((el) => { el.oninput = () => { state.tasks[+el.dataset.title].title = el.value; autoGrow(el); safeSave(); drawReport(); }; });
    $$('#tracker [data-proof]').forEach((el) => { el.oninput = () => { state.tasks[+el.dataset.proof].proof = el.value; autoGrow(el); safeSave(); }; });
    $$('#tracker textarea').forEach(autoGrow);
    const done = state.tasks.filter((t) => t.status === 'selesai').length;
    $('completionText').textContent = `${done} daripada 7 selesai`;
    $('completionBar').style.width = `${(100 * done) / 7}%`;
    drawMetrics();
  }
  function metricLabels() { return METRIC_LABELS[currentPath()] || METRIC_LABELS.missing; }
  function drawMetrics() {
    $('metricsArea').innerHTML = metricLabels().map((t, i) => `<div class="field"><label for="metric${i}">${scrub(t)}</label><input type="number" inputmode="numeric" id="metric${i}" min="0" step="1" placeholder="Jika tahu"></div>`).join('');
    state.metrics.forEach((v, i) => { $('metric' + i).value = v ?? ''; });
    $$('#metricsArea input').forEach((el, i) => { el.oninput = () => { state.metrics[i] = el.value; safeSave(); drawReport(); }; });
  }
  function reportText() {
    const p = state.profile, d = state.diagnosis, done = state.tasks.filter((t) => t.status === 'selesai').length;
    return `KLINIK BISNES SME — BUSINESS QUICK FIX\nBisnes: ${p.business || '-'}\nProduk / Servis: ${p.product || '-'}\nCustomer: ${p.customer || '-'}\nPathway: ${pathLabels[currentPath()] || '-'}\nLangkah seterusnya (pilihan): ${currentFit().detail}\nDiagnosis awal: ${d?.reason || 'Belum dijana'}\nBukti diperhatikan: ${(d?.observations || []).join('; ') || '-'}\nBelum pasti: ${(d?.unknowns || []).join('; ') || '-'}\n\nQUICK FIX\n${state.quickFix || '-'}\n\nTRACKER 7 HARI (${done}/7 selesai)\n${state.tasks.map((t) => `Hari ${t.day} [${t.status}] ${t.title}\nBukti: ${t.note || '-'}`).join('\n')}\n\nHASIL HARI 7\n${metricLabels().map((l, i) => `${l}: ${state.metrics[i] || 'Belum direkod'}`).join('\n')}\nReview: ${state.reviewNotes || '-'}\n\nNota: Nota kerja peserta, bukan diagnosis muktamad atau jaminan jualan.`;
  }
  function drawReport() {
    const r = $('report'); if (!r) return;
    const p = state.profile, d = state.diagnosis, tasks = state.tasks || [];
    const done = tasks.filter((t) => t.status === 'selesai').length;
    const blocks = [
      ['Bisnes / Produk', `${p.business || '-'} · ${p.product || '-'}`],
      ['Keutamaan & diagnosis awal', `${pathLabels[currentPath()] || '-'}\n${d?.reason || 'Belum dijana'}`],
      ['Quick Fix yang disediakan', state.quickFix || 'Belum diisi'],
      ['Langkah seterusnya (pilihan)', currentFit().detail],
      ['Kemajuan 7 hari', `${done}/7 selesai · ${tasks.filter((t) => t.status === 'sedang').length} sedang dibuat`],
      ['Hasil yang direkod', metricLabels().map((l, i) => `${l}: ${state.metrics[i] || 'Belum direkod'}`).join('\n')],
    ];
    r.innerHTML = blocks.map(([title, value]) => `<div class="report-row"><b>${scrub(title)}</b><p>${scrub(value)}</p></div>`).join('');
  }
  // Downloads the report PDF the server builds (the same file kept in Drive). Saves first so it has
  // the latest answers. If the download fails, falls back to the browser's print view.
  async function downloadReport() {
    const btn = $('downloadBtn');
    dataFromForm(); unsaved = true;
    btn.disabled = true; btn.textContent = 'Menyediakan PDF…';
    try {
      await pushRemote();
      const k = KB.getKey();
      const res = await fetch('/api/report.pdf', { headers: k ? { 'X-Journey-Id': k.id, 'X-Journey-Token': k.token } : {} });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Ralat ${res.status}`);
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'Laporan-Quick-Fix.pdf';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notice('takeHomeMessage', 'PDF dimuat turun.');
    } catch (err) {
      console.error(err);
      notice('takeHomeMessage', 'PDF gagal dimuat turun. Gunakan "Save as PDF" dalam paparan cetak.', true);
      printReport();
    } finally {
      btn.disabled = false; btn.textContent = 'Muat turun PDF';
    }
  }

  function printReport() {
    dataFromForm(); drawReport();
    const p = state.profile, d = state.diagnosis;
    $('print-area').innerHTML = `<h1>Klinik Bisnes SME — Business Quick Fix</h1><div class="pr-sub">Laporan kerja peserta · ${new Date().toLocaleDateString('ms-MY')} · ${d?.origin === 'ai' ? 'Dibantu AI, disemak peserta' : 'Simulasi rule-based, bukan AI'}</div><div class="pr-item"><b>Bisnes:</b> ${scrub(p.business)}<br><b>Produk:</b> ${scrub(p.product)}<br><b>Sasaran customer:</b> ${scrub(p.customer || '-')}<br><b>Keutamaan:</b> ${scrub(pathLabels[currentPath()])}</div><h2>Diagnosis Awal</h2><div class="pr-item"><b>Langkah seterusnya (pilihan):</b> ${scrub(currentFit().detail)}</div><div class="pr-item">${scrub(d?.reason || '-')}<br><br><b>Bukti:</b> ${scrub((d?.observations || []).join(' / '))}<br><b>Belum tahu:</b> ${scrub((d?.unknowns || []).join(' / '))}</div><h2>Quick Fix</h2><div class="pr-quick">${scrub(state.quickFix || '-')}</div><h2>Tracker 7 Hari</h2><table><tr><th>Hari</th><th>Tindakan</th><th>Status</th><th>Bukti sebenar</th></tr>${state.tasks.map((t) => `<tr><td>${t.day}</td><td>${scrub(t.title)}</td><td>${scrub(t.status)}</td><td>${scrub(t.note || '-')}</td></tr>`).join('')}</table><h2>Hasil & Review</h2><div class="pr-item">${metricLabels().map((l, i) => `${scrub(l)}: ${scrub(state.metrics[i] || 'Belum direkod')}`).join('<br>')}<br><b>Review:</b> ${scrub(state.reviewNotes || '-')}</div><p class="pr-sub">Bukan diagnosis muktamad; bukan pengiraan untung penuh atau jaminan peningkatan jualan.</p>`;
    window.print();
  }

  // ─────────────── uploads ───────────────
  function handleUpload() {
    const f = $('fileUpload').files?.[0] || null;
    if (fileUrl) { URL.revokeObjectURL(fileUrl); fileUrl = null; }
    file = null; $('filePreview').style.display = 'none';
    if (!f) { $('fileStatus').textContent = state.evidenceFile ? `Disimpan: ${state.evidenceFile.name}.` : 'Belum ada fail dipilih.'; return; }
    if (f.size > 4 * 1024 * 1024) { fieldError('fileUpload', 'Fail melebihi 4 MB. Pilih fail yang lebih kecil.'); $('fileUpload').value = ''; return; }
    const okay = ['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv', 'application/pdf'];
    if (!okay.includes(f.type) && !/\.(csv|txt|pdf)$/i.test(f.name)) { fieldError('fileUpload', 'Format fail tidak disokong. Guna PNG, JPG, WEBP, PDF, TXT atau CSV.'); $('fileUpload').value = ''; return; }
    file = f; state.evidenceFile = null;
    $('fileStatus').textContent = `Dipilih: ${f.name} (${(f.size / 1024).toFixed(0)} KB). Fail dimuat naik secara peribadi apabila anda menjana diagnosis.`;
    if (f.type.startsWith('image/')) { fileUrl = URL.createObjectURL(f); $('filePreview').src = fileUrl; $('filePreview').style.display = 'block'; }
    if (/\.(txt|csv)$/i.test(f.name) || ['text/plain', 'text/csv'].includes(f.type)) {
      f.text().then((v) => { if (!txt($('evidenceText').value)) { $('evidenceText').value = v.slice(0, 9500); dataFromForm(); $('fileStatus').textContent += ' Kandungan teks disalin ke ruang bukti.'; } });
    }
  }

  // ─────────────── account actions ───────────────
  async function exportData() {
    dataFromForm();
    await pushRemote();
    const saved = await KB.api('/api/journey').catch(() => null);
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), id: journey?.id, session: saved?.session?.code || null, created: saved?.createdAt || null, consent: saved?.consent || null, evidence_file: saved?.evidenceFile || null, journey: state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'KBSME_Quick_Fix_data_saya.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  async function restart() {
    if (!confirm('Kosongkan borang, diagnosis dan tracker? Jawapan yang disimpan akan diganti.')) return;
    state = blank(); file = null; $('fileUpload').value = ''; $('privacyConfirm').checked = false;
    if (fileUrl) URL.revokeObjectURL(fileUrl); fileUrl = null; $('filePreview').style.display = 'none';
    initFields(); toggleCosts(); go(0);
  }
  async function deleteAccount() {
    if (!confirm('Padam semua jawapan, tracker dan fail yang dimuat naik? Tindakan ini tidak boleh dibatalkan.')) return;
    try {
      clearTimeout(saveTimer); unsaved = false;
      await KB.api('/api/me', { method: 'DELETE' });
      try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(COHORT_KEY); } catch {}
      KB.setKey(null);
      alert('Data anda telah dipadam.');
      location.href = '/';
    } catch (err) { notice('globalMessage', err.message, true); }
  }

  // ─────────────── wiring ───────────────
  ['business', 'product', 'customer', 'channel', 'revenue', 'participant', 'businessActive', 'ownerAuthority', 'evidenceText', ...costKeys, ...CONTENT_KEYS, ...LIVE_KEYS, 'quickFixEditor', 'reviewNotes', 'nextStep', 'confirmDiagnosis', 'quality1', 'quality2', 'quality3']
    .forEach((k) => $(k).addEventListener('input', () => {
      dataFromForm();
      if (costKeys.includes(k)) drawCosts();
      if (LIVE_KEYS.includes(k)) drawLiveSnapshot();
      if (['revenue', 'businessActive', 'ownerAuthority', 'liveExperience'].includes(k)) drawProgramme();
      if (['quickFixEditor', 'reviewNotes'].includes(k)) drawReport();
    }));
  $('marketingConsent').addEventListener('change', (e) => { dataFromForm(); recordConsent('marketing', e.target.checked); });
  $$('[name="pain"]').forEach((el) => el.addEventListener('change', () => { dataFromForm(); toggleCosts(); }));
  $('fileUpload').addEventListener('change', handleUpload);
  $('diagnoseBtn').onclick = createDiagnosis;
  $('pathwaySelect').onchange = () => {
    state.pathway = $('pathwaySelect').value;
    state.quickFix = state.pathway === state.diagnosis?.pathway ? state.diagnosis.quickFix : defaultFix(state.pathway);
    state.tasks = tasksFor(state.pathway); state.quality = [false, false, false];
    drawProgramme(); safeSave();
  };
  $('prevBtn').onclick = () => go(step - 1);
  $('nextBtn').onclick = () => { if (validateStep()) go(step + 1); };
  $$('[data-go]').forEach((b) => {
    b.onclick = () => {
      const n = Number(b.dataset.go);
      if (n <= step || (n === 1 && validProfile()) || (n === 2 && !!state.diagnosis) || (n === 3 && !!state.confirmed) || (n === 4 && state.confirmed && state.quality.every(Boolean) && !!txt(state.quickFix))) go(n);
      else notice('globalMessage', 'Lengkapkan langkah sebelumnya dahulu.', true);
    };
  });
  $('downloadBtn').onclick = downloadReport;
  $('quickFixEditor').addEventListener('input', () => { autoGrow($('quickFixEditor')); drawPlaceholders(); });
  $('reviewNotes').addEventListener('input', () => autoGrow($('reviewNotes')));
  $('nextPlaceholderBtn').onclick = nextPlaceholder;
  $('copyBtn').onclick = async () => { dataFromForm(); try { await navigator.clipboard.writeText(reportText()); notice('takeHomeMessage', 'Ringkasan disalin ke clipboard.'); } catch { notice('takeHomeMessage', 'Clipboard tidak tersedia; gunakan butang Muat turun PDF.', true); } };
  $('exportBtn').onclick = exportData;
  $('restartBtn').onclick = restart;
  $('deleteBtn').onclick = deleteAccount;

  // Test data (localhost or ?demo): fills steps 1–2 with one case per issue; matches test/fixtures/sample-responses.json.
  const owner = { businessActive: 'yes', ownerAuthority: 'yes', revenue: 'RM3,000 – bawah RM10,000', participant: 'Peserta Ujian' };
  const DEMO = {
    cost: { profile: { ...owner, business: 'Ain Tudung', product: 'Tudung bawal', customer: 'Wanita bekerja 25–40', channel: 'Shopee / Marketplace' }, evidenceText: 'Supplier RM12 sehelai, fee Shopee tak pasti.', costs: { sellingPrice: '25', materialCost: '12' } },
    content: { profile: { ...owner, business: 'Kuih Siti', product: 'Kuih lapis', customer: 'Ibu sekitar Bangi', channel: 'Facebook / Instagram' }, evidenceText: 'Post sekali seminggu bila sempat. Satu post makan masa lama, tak pernah tengok insight.', content: { postsWeek: '1', hoursWeek: '6', hasContentPlan: 'no', tracksContent: 'no' } },
    live: { profile: { ...owner, business: 'Butik Ain', product: 'Baju kurung moden', customer: 'Wanita 20–45', channel: 'TikTok / LIVE' }, evidenceText: 'LIVE Sabtu lepas, cutoff 48 jam. Invoice dihantar esoknya.', live: { liveExperience: 'yes', liveViewers: '180', liveClaims: '12', livePaid: '8', invoiceTiming: 'next_day' } },
    unknown: { profile: { ...owner, business: 'Kek Mak Long', product: 'Kek pisang loaf', customer: 'Pejabat sekitar Shah Alam', channel: 'WhatsApp' }, evidenceText: 'Customer: Berapa harga kek pisang?\nSaya: RM35 sis.\nCustomer: Ok nanti saya fikir dulu.\n(tiada reply selepas itu)' },
  };
  function fillDemo(kind) {
    const d = DEMO[kind];
    state = { ...state, costs: {}, content: {}, live: {}, ...d, profile: { ...state.profile, ...d.profile, pain: kind } };
    initFields(); toggleCosts();
    $('privacyConfirm').checked = true;
    safeSave(); go(1);
    message('Data contoh diisi. Tekan “Jana Diagnosis Awal” untuk menguji.', false, 'evidenceMessage');
  }
  if (demoMode) {
    show('demoBar', true);
    $$('[data-demo]').forEach((b) => { b.onclick = () => fillDemo(b.dataset.demo); });
  }

  boot();
})();

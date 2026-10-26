// Participant app: five steps, saved to the participant's Supabase journey row.
// No login: anyone can use it (anonymous sign-in). A facilitator's ?c=CODE files them under that session.
import { PATH_LABELS as pathLabels, COST_KEYS as costKeys, CONTENT_KEYS, LIVE_KEYS, costSummary, liveMath, liveBlock, hasEvidence, programmeFit, templateTasks, TASK_TITLE_MAX, TASK_PROOF_MAX } from './rules.mjs';

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
  let user = null, journey = null, cohort = null;

  // ─────────────── boot: session code → anonymous session ───────────────
  const params = new URLSearchParams(location.search);
  const normCode = (c) => String(c || '').trim().toUpperCase();
  if (params.get('c')) { try { localStorage.setItem(COHORT_KEY, normCode(params.get('c'))); } catch {} }
  const demoMode = ['localhost', '127.0.0.1'].includes(location.hostname) || params.has('demo');
  const cohortCode = () => { try { return localStorage.getItem(COHORT_KEY) || ''; } catch { return ''; } };

  try {
    await KB.init();
  } catch (err) {
    $('loadingGate').innerHTML = `<p>${scrub(err.message)}</p>`;
    return;
  }
  const sb = KB.sb;

  function showOnly(id) {
    ['codeGate', 'consentGate', 'loadingGate', 'app'].forEach((x) => show(x, x === id));
    document.body.classList.toggle('in-app', id === 'app');
  }

  // Participants can look up one code; they cannot list sessions.
  async function lookupCohort(code) {
    if (!code) return null;
    const { data, error } = await sb.rpc('cohort_by_code', { p_code: code });
    if (error) throw error;
    return data?.[0] || null;
  }

  // Shown when a code is not recognised; the participant can fix it or continue without one.
  function askForCode(text = '', isError = false) {
    showOnly('codeGate');
    $('codeInput').value = cohortCode();
    msg('codeMessage', text, isError);
  }

  async function boot() {
    showOnly('loadingGate');
    try {
      cohort = await lookupCohort(cohortCode());
    } catch (err) {
      console.error(err);
      $('loadingGate').innerHTML = '<p>Data gagal dimuatkan. Semak sambungan internet dan muat semula halaman.</p>';
      return;
    }
    if (cohortCode() && !cohort) return askForCode('Kod sesi ini tidak sah.', true);
    const s = await KB.session();
    if (s?.user) {
      // The saved login may belong to a user that was deleted; check with the server before reusing it.
      const { data: live, error: gone } = await sb.auth.getUser();
      if (live?.user && !gone) return start(live.user);
      await sb.auth.signOut({ scope: 'local' });
    }
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) {
      console.error(error);
      return askForCode(error.status === 429 ? 'Terlalu ramai cuba masuk serentak. Tunggu seminit dan cuba lagi.' : 'Tidak dapat memulakan sesi. Cuba lagi.', true);
    }
    start(data.user);
  }

  $('noCodeBtn').onclick = () => { try { localStorage.removeItem(COHORT_KEY); } catch {} boot(); };
  $('codeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = normCode($('codeInput').value);
    if (!code) return msg('codeMessage', 'Masukkan kod sesi daripada fasilitator.', true);
    try { localStorage.setItem(COHORT_KEY, code); } catch {}
    boot();
  });

  async function start(u) {
    user = u;
    showOnly('loadingGate');
    const { data: notice } = await sb.from('consents').select('id').eq('user_id', u.id)
      .eq('kind', 'privacy_notice').eq('notice_version', KB.cfg.noticeVersion).eq('granted', true).limit(1);
    if (!notice?.length) {
      showOnly('consentGate');
      $('consentBtn').onclick = async () => {
        if (!$('noticeAccept').checked) return msg('consentMessage', 'Tandakan persetujuan untuk meneruskan.', true);
        const { error } = await sb.from('consents').insert({ user_id: u.id, kind: 'privacy_notice', granted: true, notice_version: KB.cfg.noticeVersion });
        if (error?.code === '23503') { await sb.auth.signOut({ scope: 'local' }); return boot(); } // user no longer exists: start a fresh session
        if (error) return msg('consentMessage', 'Gagal menyimpan. Cuba lagi.', true);
        loadApp();
      };
      return;
    }
    loadApp();
  }

  async function loadApp() {
    showOnly('loadingGate');
    try {
      await loadJourney();
    } catch (err) {
      console.error(err);
      $('loadingGate').innerHTML = '<p>Data gagal dimuatkan. Semak sambungan internet dan muat semula halaman.</p>';
      return;
    }
    showOnly('app');
    initFields(); toggleCosts();
    // Test mode: an empty form opens already filled (?demo=content|live|unknown picks the case; default cost).
    if (demoMode && !state.profile.business && !state.diagnosis) return fillDemo(DEMO[params.get('demo')] ? params.get('demo') : 'cost');
    const want = Number(params.get('step'));
    go(want >= 1 && want <= 5 ? want - 1 : guessStep());
  }

  async function loadJourney() {
    if (cohort) $('cohortLabel').textContent = `${cohort.name}${cohort.session_date ? ' · ' + new Date(cohort.session_date).toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}`;
    let q = sb.from('journeys').select('*').eq('user_id', user.id).limit(1);
    q = cohort ? q.eq('cohort_id', cohort.id) : q.is('cohort_id', null);
    const { data: rows, error } = await q;
    if (error) throw error;
    if (rows.length) {
      journey = rows[0];
    } else {
      const { data, error: e2 } = await sb.from('journeys').insert({ user_id: user.id, cohort_id: cohort?.id ?? null, state: blank() }).select().single();
      if (e2) throw e2;
      journey = data;
    }
    const obj = journey.state || {};
    state = { ...blank(), ...obj, profile: { ...blank().profile, ...(obj.profile || {}) }, costs: obj.costs || {}, content: obj.content || {}, live: obj.live || {} };
  }

  function guessStep() {
    if (state.confirmed && state.quality.every(Boolean) && txt(state.quickFix)) return 4;
    if (state.confirmed) return 3;
    if (state.diagnosis) return 2;
    if (state.profile.business && state.profile.product && state.profile.pain) return 1;
    return 0;
  }

  // ─────────────── saving ───────────────
  let saveTimer = null, saving = Promise.resolve(), lastName = null;
  function setSaveState(t) { const el = $('saveState'); if (el) el.textContent = t; }
  function safeSave() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ id: journey?.id, state })); } catch {}
    setSaveState('Menyimpan…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushRemote, 700);
  }
  function pushRemote() {
    if (!journey) return;
    const fit = currentFit();
    state.programme = state.diagnosis ? { status: fit.status, key: fit.key } : null;
    const payload = {
      state,
      pathway: state.diagnosis ? currentPath() : null,
      step,
      tasks_done: (state.tasks || []).filter((t) => t.status === 'selesai').length,
      tracker_started_at: state.trackerStartedAt,
    };
    saving = saving.then(async () => {
      const { error } = await sb.from('journeys').update(payload).eq('id', journey.id);
      if (error) { setSaveState('Belum disimpan — semak internet.'); return; }
      setSaveState('Disimpan ke akaun anda.');
      const name = txt(state.profile.participant);
      if (name && name !== lastName) { lastName = name; await sb.from('profiles').update({ full_name: name }).eq('id', user.id); }
    });
  }
  window.addEventListener('beforeunload', () => { if (saveTimer) { clearTimeout(saveTimer); pushRemote(); } });

  async function recordConsent(kind, granted) {
    await sb.from('consents').insert({ user_id: user.id, kind, granted, notice_version: KB.cfg.noticeVersion });
  }

  // ─────────────── form <-> state ───────────────
  const message = (s, error = false, target = 'globalMessage') => msg(target, s, error);
  const clearMessage = (target = 'globalMessage') => msg(target, '');
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
    $('nextBtn').style.display = step === 4 ? 'none' : 'inline-flex';
    $('nextBtn').textContent = step === 2 ? 'Bina Quick Fix →' : 'Seterusnya →';
    if (step === 3) drawBuild();
    if (step === 4) {
      if (!state.trackerStartedAt) state.trackerStartedAt = new Date().toISOString();
      drawTracker(); drawReport();
    }
    clearMessage();
    safeSave();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function validProfile() {
    dataFromForm();
    if (!state.profile.business || !state.profile.product || !state.profile.pain) { message('Lengkapkan nama bisnes, produk utama dan pilih satu isu.', true); return false; }
    return true;
  }
  const hasCostValues = () => costKeys.some((k) => txt(state.costs[k]) !== '');

  function validateStep() {
    dataFromForm();
    if (step === 0) return validProfile();
    if (step === 1) { message('Tekan “Jana Diagnosis Awal” untuk meneruskan.', true); return false; }
    if (step === 2) {
      if (!state.diagnosis) { message('Diagnosis belum dijana.', true); return false; }
      if (!$('confirmDiagnosis').checked) { message('Sahkan bahawa diagnosis ini bersifat awal sebelum membina Quick Fix.', true); return false; }
      const chosen = $('pathwaySelect').value;
      if (chosen === 'live' && state.live.liveExperience !== 'yes') { message('LIVE Sales hanya untuk peserta yang sudah menjual melalui LIVE. Pilih laluan lain, atau sahkan pengalaman LIVE di Langkah 2 dan jana diagnosis semula.', true); return false; }
      const changed = chosen !== state.pathway || !state.tasks?.length;
      state.pathway = chosen; state.confirmed = true;
      if (changed) {
        state.quickFix = chosen === state.diagnosis.pathway ? state.diagnosis.quickFix : defaultFix(chosen);
        state.tasks = tasksFor(chosen); state.quality = [false, false, false];
      }
      safeSave(); return true;
    }
    if (step === 3) {
      if (!txt(state.quickFix)) { message('Sediakan dan semak Quick Fix dahulu.', true); return false; }
      if (state.quality.some((v) => !v)) { message('Tandakan ketiga-tiga semakan kualiti sebelum ke tracker.', true); return false; }
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
    ['programmePreview', 'programmeDetails'].forEach((id) => {
      const el = $(id); el.hidden = !show && id === 'programmePreview'; el.dataset.status = f.status;
      el.innerHTML = `<h4>Langkah seterusnya (pilihan)</h4><p>${scrub(f.detail)}</p>${f.status === 'ready' || f.status === 'pending' ? '<p class="opt">Tiada kewajipan. Anda boleh teruskan Quick Fix dan tracker sendiri. Pilihan selepas sesi (Langkah 5) tidak menghantar apa-apa secara automatik.</p>' : ''}`;
    });
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
    if (!file) return state.evidenceFile?.id || null;
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
    const type = file.type || (ext === 'csv' ? 'text/csv' : ext === 'pdf' ? 'application/pdf' : 'text/plain');
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await sb.storage.from('evidence').upload(path, file, { contentType: type, upsert: false });
    if (upErr) throw new Error('Lampiran gagal dimuat naik. Cuba fail yang lebih kecil.');
    const { data, error } = await sb.from('evidence_files').insert({ user_id: user.id, journey_id: journey.id, storage_path: path, file_name: file.name.slice(0, 180), mime_type: type, size_bytes: file.size }).select('id').single();
    if (error) throw new Error('Lampiran gagal direkod.');
    state.evidenceFile = { id: data.id, name: file.name };
    file = null;
    return data.id;
  }

  async function createDiagnosis() {
    dataFromForm(); clearMessage('evidenceMessage');
    if (!validProfile()) { go(0); return; }
    if (!hasEvidence({ evidenceText: state.evidenceText, costs: state.costs, content: state.content, live: state.live, hasFile: !!(file || state.evidenceFile) })) { message('Tampal sekurang-kurangnya satu bukti, isi angka, atau lampirkan fail terlebih dahulu. Memilih isu sahaja belum cukup.', true, 'evidenceMessage'); return; }
    if (!$('privacyConfirm').checked) { message('Sahkan privasi dan kebenaran menggunakan bahan sebelum menjana diagnosis.', true, 'evidenceMessage'); return; }
    const btn = $('diagnoseBtn'); btn.disabled = true; btn.textContent = 'Menyemak bukti… (sehingga 1 minit)';
    try {
      let result;
      if (KB.cfg.aiReady) {
        await recordConsent('ai_processing', true);
        const fileId = await uploadEvidence();
        const r = await KB.api('/api/diagnose', { method: 'POST', body: { business: state.profile, pain: state.profile.pain, evidence_text: state.evidenceText, costs: state.costs, content: state.content, live: state.live, evidence_file_id: fileId } });
        result = { ...r, origin: 'ai' };
      } else {
        result = demoDiagnose();
      }
      state.diagnosis = result; state.pathway = result.pathway; state.confirmed = false; state.quickFix = result.quickFix;
      state.quality = [false, false, false]; state.tasks = tasksFor(result.pathway); state.metrics = ['', '', ''];
      $('confirmDiagnosis').checked = false;
      drawDiagnosis(); drawBuild(); go(2);
    } catch (err) {
      message(`Diagnosis gagal: ${err.message}`, true, 'evidenceMessage');
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
  }

  // ─────────────── tracker & report ───────────────
  function drawTracker() {
    if (!state.diagnosis) return;
    if (!state.tasks || state.tasks.length !== 7) state.tasks = tasksFor(currentPath());
    const root = $('tracker'); root.innerHTML = '';
    state.tasks.forEach((item, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'task' + (item.status === 'selesai' ? ' done' : '');
      wrap.innerHTML = `<div class="day">Hari ${i + 1}</div><div class="task-head"><textarea class="task-title" rows="2" maxlength="${TASK_TITLE_MAX}" data-title="${i}" aria-label="Tugasan Hari ${i + 1} (boleh diedit)"></textarea><select aria-label="Status Hari ${i + 1}" data-status="${i}"><option value="belum">Belum mula</option><option value="sedang">Sedang buat</option><option value="selesai">Selesai ✓</option></select></div><label class="proof">Bukti cadangan: <input class="task-proof" maxlength="${TASK_PROOF_MAX}" data-proof="${i}" aria-label="Bukti cadangan Hari ${i + 1} (boleh diedit)"></label><input class="track-note" maxlength="450" data-note="${i}" aria-label="Bukti atau nota Hari ${i + 1}" placeholder="Catat bukti / pautan / angka sebenar (tanpa data customer)">`;
      root.appendChild(wrap);
      wrap.querySelector('[data-status]').value = item.status;
      wrap.querySelector('[data-title]').value = item.title || '';
      wrap.querySelector('[data-proof]').value = item.proof || '';
      wrap.querySelector('[data-note]').value = item.note || '';
    });
    $$('#tracker [data-status]').forEach((el) => { el.onchange = () => { state.tasks[+el.dataset.status].status = el.value; safeSave(); drawTracker(); drawReport(); }; });
    $$('#tracker [data-note]').forEach((el) => { el.oninput = () => { state.tasks[+el.dataset.note].note = el.value; safeSave(); drawReport(); }; });
    $$('#tracker [data-title]').forEach((el) => { el.oninput = () => { state.tasks[+el.dataset.title].title = el.value; safeSave(); drawReport(); }; });
    $$('#tracker [data-proof]').forEach((el) => { el.oninput = () => { state.tasks[+el.dataset.proof].proof = el.value; safeSave(); }; });
    const done = state.tasks.filter((t) => t.status === 'selesai').length;
    $('completionText').textContent = `${done} daripada 7 selesai`;
    $('completionBar').style.width = `${(100 * done) / 7}%`;
    drawMetrics();
  }
  function metricLabels() {
    const p = currentPath();
    return p === 'content' ? ['Post diterbitkan', 'Masa content (minit)', 'Enquiry yang jelas berkaitan']
      : p === 'live' ? ['Claims disahkan', 'Paid orders disahkan', 'Invoice timestamp direkod']
      : p === 'cost' ? ['Kos belum jelas yang disahkan', 'Dokumen kos diperiksa', 'Jurang kos yang masih belum jelas']
      : ['Fakta berjaya diperoleh', 'Dokumen sumber disahkan', 'Keputusan selepas semakan'];
  }
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
    if (f.size > 4 * 1024 * 1024) { message('Fail melebihi 4 MB. Pilih fail yang lebih kecil.', true, 'evidenceMessage'); $('fileUpload').value = ''; return; }
    const okay = ['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv', 'application/pdf'];
    if (!okay.includes(f.type) && !/\.(csv|txt|pdf)$/i.test(f.name)) { message('Format fail tidak disokong.', true, 'evidenceMessage'); $('fileUpload').value = ''; return; }
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
    const [{ data: consents }, { data: files }] = await Promise.all([
      sb.from('consents').select('kind, granted, notice_version, created_at').eq('user_id', user.id),
      sb.from('evidence_files').select('file_name, mime_type, size_bytes, created_at').eq('user_id', user.id),
    ]);
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), email: user.email, cohort: cohort?.code || null, journey: state, consents, evidence_files: files }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'KBSME_Quick_Fix_data_saya.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  async function restart() {
    if (!confirm('Kosongkan borang, diagnosis dan tracker untuk sesi ini? Akaun anda kekal.')) return;
    state = blank(); file = null; $('fileUpload').value = ''; $('privacyConfirm').checked = false;
    if (fileUrl) URL.revokeObjectURL(fileUrl); fileUrl = null; $('filePreview').style.display = 'none';
    initFields(); toggleCosts(); go(0);
  }
  async function deleteAccount() {
    if (!confirm('Padam akaun, semua jawapan, tracker dan fail yang dimuat naik? Tindakan ini tidak boleh dibatalkan.')) return;
    try {
      await KB.api('/api/me', { method: 'DELETE' });
      try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(COHORT_KEY); } catch {}
      await sb.auth.signOut();
      alert('Data anda telah dipadam.');
      location.href = '/';
    } catch (err) { message(err.message, true); }
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
      else message('Lengkapkan langkah sebelumnya dahulu.', true);
    };
  });
  $('printBtn').onclick = printReport;
  $('copyBtn').onclick = async () => { dataFromForm(); try { await navigator.clipboard.writeText(reportText()); message('Ringkasan disalin ke clipboard.'); } catch { message('Clipboard tidak tersedia; gunakan Print / Save PDF.', true); } };
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

  // If there's no session after Supabase has read the URL, show sign-in.
  boot();
})();

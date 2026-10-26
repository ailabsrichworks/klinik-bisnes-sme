// Participant app: five steps, saved to the participant's Supabase journey row.
(async () => {
  'use strict';
  const { $, esc: scrub, message: msg, show } = KB;
  const $$ = (q) => [...document.querySelectorAll(q)];
  const txt = (s) => String(s ?? '').trim();
  const money = (x) => `RM${Number(x).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const CACHE_KEY = 'kbsme_quick_fix_cache_v3';
  const COHORT_KEY = 'kbsme_cohort_code';

  const costKeys = ['sellingPrice', 'materialCost', 'packagingCost', 'deliveryCost', 'platformCost', 'promotionCost', 'otherCost'];
  const costLabels = ['Harga jualan', 'Kos bahan / produk', 'Packaging', 'Delivery ditanggung', 'Platform fee / komisen', 'Promotion per sale', 'Kos langsung lain'];
  const stepNames = ['Kenali bisnes', 'Tunjukkan bukti', 'Diagnosis awal', 'Bina Quick Fix', 'Pelaksanaan 7 hari'];
  const pathLabels = { attraction: 'Customer Attraction', follow: 'Follow Up & Closing', cost: 'Cost, Price & Profit', missing: 'Missing Information' };
  const blank = () => ({
    profile: { business: '', product: '', customer: '', channel: '', revenue: '', participant: '', pain: '' },
    evidenceText: '', costs: {}, evidenceFile: null, diagnosis: null, pathway: '', confirmed: false, quickFix: '',
    quality: [false, false, false], tasks: [], metrics: ['', '', ''], reviewNotes: '',
    nextStep: 'Bertindak sendiri dahulu', marketingConsent: false, trackerStartedAt: null,
  });

  let state = blank(), step = 0, file = null, fileUrl = null;
  let user = null, journey = null, cohort = null, booted = false;

  // ─────────────── boot & auth ───────────────
  const params = new URLSearchParams(location.search);
  if (params.get('c')) { try { localStorage.setItem(COHORT_KEY, params.get('c').toUpperCase()); } catch {} }
  const cohortCode = () => { try { return localStorage.getItem(COHORT_KEY) || ''; } catch { return ''; } };

  try {
    await KB.init();
  } catch (err) {
    $('loadingGate').innerHTML = `<p>${scrub(err.message)}</p>`;
    return;
  }
  const sb = KB.sb;

  KB.wireLogin({ redirectTo: () => location.origin + '/' + (cohortCode() ? `?c=${encodeURIComponent(cohortCode())}` : '') });
  $('signOutBtn').onclick = async () => { await sb.auth.signOut(); location.href = '/'; };

  sb.auth.onAuthStateChange((_event, session) => {
    if (session?.user && !booted) { booted = true; setTimeout(() => start(session.user), 0); }
    if (!session) { booted = false; showOnly('loginGate'); show('accountBar', false); }
  });

  function showOnly(id) {
    ['loginGate', 'consentGate', 'loadingGate', 'app'].forEach((x) => show(x, x === id));
    document.body.classList.toggle('in-app', id === 'app');
  }

  async function start(u) {
    user = u;
    showOnly('loadingGate');
    $('whoAmI').textContent = u.email;
    show('accountBar', true);
    if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname + location.search);

    const { data: notice } = await sb.from('consents').select('id').eq('user_id', u.id)
      .eq('kind', 'privacy_notice').eq('notice_version', KB.cfg.noticeVersion).eq('granted', true).limit(1);
    if (!notice?.length) {
      showOnly('consentGate');
      $('consentBtn').onclick = async () => {
        if (!$('noticeAccept').checked) return msg('consentMessage', 'Tandakan persetujuan untuk meneruskan.', true);
        const { error } = await sb.from('consents').insert({ user_id: u.id, kind: 'privacy_notice', granted: true, notice_version: KB.cfg.noticeVersion });
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
    const want = Number(params.get('step'));
    go(want >= 1 && want <= 5 ? want - 1 : guessStep());
  }

  async function loadJourney() {
    cohort = null;
    const code = cohortCode();
    if (code) {
      const { data } = await sb.from('cohorts').select('id, code, name, session_date').eq('code', code).maybeSingle();
      cohort = data;
      if (cohort) $('cohortLabel').textContent = `${cohort.name}${cohort.session_date ? ' · ' + new Date(cohort.session_date).toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}`;
    }
    let q = sb.from('journeys').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(1);
    if (cohort) q = q.eq('cohort_id', cohort.id);
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
    state = { ...blank(), ...obj, profile: { ...blank().profile, ...(obj.profile || {}) }, costs: obj.costs || {} };
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
    ['business', 'product', 'customer', 'channel', 'revenue', 'participant'].forEach((k) => { state.profile[k] = $(k).value.trim(); });
    state.profile.pain = document.querySelector('[name="pain"]:checked')?.value || '';
    state.evidenceText = $('evidenceText').value;
    costKeys.forEach((k) => { state.costs[k] = $(k).value; });
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
    ['business', 'product', 'customer', 'channel', 'revenue', 'participant'].forEach((k) => { $(k).value = state.profile[k] || ''; });
    $$('input[name="pain"]').forEach((r) => { r.checked = r.value === state.profile.pain; });
    $('evidenceText').value = state.evidenceText || '';
    costKeys.forEach((k) => { $(k).value = state.costs[k] ?? ''; });
    $('confirmDiagnosis').checked = !!state.confirmed;
    $('quickFixEditor').value = state.quickFix || '';
    ['quality1', 'quality2', 'quality3'].forEach((k, i) => { $(k).checked = !!state.quality[i]; });
    $('reviewNotes').value = state.reviewNotes || '';
    $('nextStep').value = state.nextStep || 'Bertindak sendiri dahulu';
    $('marketingConsent').checked = !!state.marketingConsent;
    $('fileStatus').textContent = state.evidenceFile ? `Disimpan: ${state.evidenceFile.name}. Pilih fail lain untuk menggantikan.` : 'Belum ada fail dipilih.';
    drawCosts(); drawDiagnosis(); drawBuild(); drawTracker(); drawReport();
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
      const changed = chosen !== state.pathway || !state.tasks?.length;
      state.pathway = chosen; state.confirmed = true;
      if (changed) {
        state.quickFix = chosen === state.diagnosis.pathway ? state.diagnosis.quickFix : defaultFix(chosen);
        state.tasks = generateTasks(chosen); state.quality = [false, false, false];
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

  // ─────────────── costs ───────────────
  function toggleCosts() { $('costInputs').hidden = getPain() !== 'cost'; drawCosts(); }
  function calcCosts() {
    const priceRaw = txt(state.costs.sellingPrice);
    const costs = costKeys.slice(1).filter((k) => txt(state.costs[k]) !== '');
    const unknown = costKeys.slice(1).filter((k) => txt(state.costs[k]) === '');
    const invalid = costKeys.some((k) => txt(state.costs[k]) !== '' && (!Number.isFinite(Number(state.costs[k])) || Number(state.costs[k]) < 0));
    if (!priceRaw || !costs.length || invalid) return { valid: false, unknown, reason: !priceRaw ? 'Harga jualan belum diketahui.' : !costs.length ? 'Tiada direct cost yang disahkan.' : 'Ada nombor kos yang tidak sah.' };
    const balance = Number(priceRaw) - costs.reduce((a, k) => a + Number(state.costs[k]), 0);
    return { valid: true, balance, unknown, known: costs.length };
  }
  function drawCosts() {
    const x = calcCosts();
    $('provisionalBalance').textContent = x.valid ? money(x.balance) : 'Belum boleh dikira';
    $('missingCosts').textContent = x.valid
      ? (x.unknown.length ? `Belum diketahui: ${x.unknown.map((k) => costLabels[costKeys.indexOf(k)]).join(', ')}. Baki sementara bukan net profit.` : 'Semua kategori direct cost diisi; semak bahawa tiada kos lain tertinggal.')
      : (x.reason || 'Belum boleh dikira.');
  }

  // ─────────────── offline rule-based fallback (only when the server has no AI key) ───────────────
  function inferPath() {
    const t = (state.evidenceText + ' ' + state.profile.pain).toLowerCase();
    if (['attraction', 'follow', 'cost'].includes(getPain())) return getPain();
    if (/kos|margin|modal|untung|profit|harga jual|komisen|cost/i.test(t)) return 'cost';
    if (/whatsapp|follow.?up|reply|chat|perbualan|tanya harga|conversation|mesej/i.test(t)) return 'follow';
    if (/content|caption|poster|post|view|offer|iklan|promote/i.test(t)) return 'attraction';
    return 'missing';
  }
  function defaultFix(p) {
    const b = state.profile; const product = b.product || '[produk / servis]'; const customer = b.customer || '[sasaran customer]';
    if (p === 'attraction') return `Untuk ${customer} yang [keperluan sebenar], ${product} membantu [manfaat yang boleh dibuktikan].\n\n[Terangkan offer / harga / pilihan dengan tepat].\n\nNak tahu sama ada sesuai? WhatsApp kami untuk [next step yang mudah dijawab].`;
    if (p === 'follow') return `Terima kasih kerana bertanya tentang ${product}.\n\nUntuk saya cadangkan pilihan yang sesuai, boleh saya tahu [satu soalan relevan tentang keperluan anda]?\n\nSaya boleh semak [pilihan / tarikh / stok sebenar] selepas itu.`;
    if (p === 'cost') { const x = calcCosts(); return `${product}\nHarga jualan: ${txt(state.costs.sellingPrice) ? money(state.costs.sellingPrice) : 'Belum diketahui'}\nBaki sementara selepas direct cost yang diketahui: ${x.valid ? money(x.balance) : 'Belum boleh dikira'}\nKos yang belum disahkan: ${x.unknown.map((k) => costLabels[costKeys.indexOf(k)]).join(', ') || 'Semak kos lain yang mungkin tertinggal'}\nKeputusan: Sahkan semua kos relevan sebelum membuat keputusan harga. Baki ini BUKAN net profit.`; }
    return 'Maklumat kritikal yang perlu dicari: [nyatakan satu fakta yang hilang].\nSumber fakta: [rekod asal / akaun platform / resit / laporan].\nPemilik tindakan: [nama / peranan].\nTarikh semak: [dalam 7 hari].\nKeputusan ditangguhkan sehingga maklumat yang diperlukan tersedia.';
  }
  function generateTasks(p) {
    const lists = {
      attraction: [['Semak dan sahkan revised offer / CTA', 'Simpan versi final'], ['Gunakan caption pada satu post yang relevan', 'Link / screenshot post'], ['Catat jumlah reach atau viewers jika tersedia', 'Metrik platform'], ['Semak enquiry sebenar selepas post', 'Bilangan enquiry'], ['Perbaiki satu ayat jika customer masih keliru', 'Versi dikemas kini'], ['Uji offer / CTA sekali lagi apabila sesuai', 'Contoh post kedua'], ['Rumusan respons dan langkah seterusnya', 'Nota review 7 hari']],
      follow: [['Semak dan simpan mesej follow-up', 'Mesej final'], ['Hantar kepada satu enquiry yang masih relevan', 'Log mesej dihantar'], ['Rekod sama ada customer reply', 'Respons / tiada respons'], ['Perbaiki satu soalan jika perlu', 'Mesej versi 2'], ['Uji kepada enquiry relevan lain (tanpa spam)', 'Log penggunaan'], ['Kira reply dan next step yang disahkan', 'Bilangan sebenar'], ['Semak keberkesanan dan pilih tindakan seterusnya', 'Nota review']],
      cost: [['Semak harga jualan dan kos yang sudah diketahui', 'Rekod harga dan kos'], ['Cari satu kos yang belum diketahui', 'Resit / seller statement'], ['Semak fee, delivery, packaging atau promo', 'Rekod direct cost'], ['Kemas kini kos per unit yang sudah disahkan', 'Worksheet ringkas'], ['Kira semula baki selepas direct cost', 'Pengiraan bertarikh'], ['Banding harga dengan semua kos relevan', 'Nota keputusan harga'], ['Rekod keputusan dan maklumat yang masih kurang', 'Review kos 7 hari']],
      missing: [['Senaraikan satu maklumat paling kritikal', 'Soalan fakta'], ['Kenal pasti rekod atau sumber asal', 'Nama sumber'], ['Tentukan siapa yang bertanggungjawab', 'Pemilik tindakan'], ['Dapatkan rekod / data yang dibenarkan', 'Bukti sumber'], ['Semak ketepatan dan tarikh data', 'Nota pengesahan'], ['Lengkapkan jurang maklumat atau tandakan masih belum tahu', 'Status fakta'], ['Tentukan langkah seterusnya berdasarkan fakta', 'Rumusan keputusan']],
    };
    return lists[p].map(([title, proof], i) => ({ day: i + 1, title, proof, status: 'belum', note: '' }));
  }
  function demoDiagnose() {
    const p = inferPath(); const ev = txt(state.evidenceText);
    const observations = []; let unknowns = []; let reason = ''; let strength = 'Bukti terhad';
    if (p === 'attraction') { reason = 'Contoh promosi menunjukkan perkara yang wajar disemak: siapa customer, manfaat, offer dan tindakan seterusnya.'; if (ev) observations.push('Anda menyediakan contoh content / offer untuk disemak.'); else unknowns.push('Teks poster / caption sebenar belum tersedia.'); observations.push('Semak sama ada pelanggan tahu tindakan yang patut dibuat selepas membaca offer.'); unknowns.push('Respons pelanggan sebenar dan jumlah enquiry masih belum dibuktikan.'); }
    if (p === 'follow') { reason = 'Perbualan yang terhenti mungkin memerlukan konteks, satu soalan relevan dan next step yang mudah dijawab.'; observations.push(ev ? 'Anda berkongsi contoh customer conversation.' : 'Tiada perbualan spesifik untuk diperiksa.'); if (/berminat\??/i.test(ev)) observations.push('Terdapat soalan umum “berminat?” yang mungkin terlalu mudah ditamatkan.'); unknowns.push('Sebab pelanggan tidak membalas tidak boleh disahkan melalui satu chat.'); }
    if (p === 'cost') { const c = calcCosts(); reason = c.valid ? `Berdasarkan hanya direct cost yang dimasukkan, baki sementara ialah ${money(c.balance)}. Ini bukan untung bersih.` : 'Maklumat harga dan kos belum cukup untuk mengira baki satu jualan dengan bertanggungjawab.'; observations.push(c.valid ? `Harga dan ${c.known} kategori kos diketahui telah dimasukkan.` : 'Harga atau direct cost belum lengkap.'); unknowns = c.unknown.map((k) => `${costLabels[costKeys.indexOf(k)]}: belum diketahui`); if (!unknowns.length) unknowns.push('Kos lain, pemulangan, pembaziran atau overhead mungkin belum disenaraikan.'); }
    if (p === 'missing') { reason = 'Bukti yang tersedia belum cukup untuk memilih pembetulan yang berasas. Hasil terbaik ialah pelan mencari satu fakta penting.'; unknowns.push('Contoh promosi, conversation atau rekod kos yang boleh diperiksa.'); observations.push('Isu utama masih belum dapat ditentukan daripada input semasa.'); }
    if (ev.length > 35 && p !== 'cost') strength = 'Ada input, perlu disahkan';
    return { pathway: p, title: pathLabels[p], reason, observations, unknowns, strength, quickFix: defaultFix(p), origin: 'demo' };
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
    if (!txt(state.evidenceText) && !hasCostValues() && !file && !state.evidenceFile) { message('Tampal sekurang-kurangnya satu bukti, isi angka kos, atau lampirkan fail terlebih dahulu.', true, 'evidenceMessage'); return; }
    if (!$('privacyConfirm').checked) { message('Sahkan privasi dan kebenaran menggunakan bahan sebelum menjana diagnosis.', true, 'evidenceMessage'); return; }
    const btn = $('diagnoseBtn'); btn.disabled = true; btn.textContent = 'Menyemak bukti… (sehingga 1 minit)';
    try {
      let result;
      if (KB.cfg.aiReady) {
        await recordConsent('ai_processing', true);
        const fileId = await uploadEvidence();
        const r = await KB.api('/api/diagnose', { method: 'POST', body: { business: state.profile, pain: state.profile.pain, evidence_text: state.evidenceText, costs: state.costs, evidence_file_id: fileId } });
        result = { ...r, origin: 'ai' };
      } else {
        result = demoDiagnose();
      }
      state.diagnosis = result; state.pathway = result.pathway; state.confirmed = false; state.quickFix = result.quickFix;
      state.quality = [false, false, false]; state.tasks = generateTasks(result.pathway); state.metrics = ['', '', ''];
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
  }

  function drawBuild() {
    const p = currentPath();
    $('fixPath').textContent = pathLabels[p] || 'Quick Fix';
    const explanation = { attraction: 'Offer perlu jelas tentang customer, keperluan, tawaran dan next step yang boleh dijawab.', follow: 'Sambung konteks perbualan, tanya satu soalan berkaitan dan beri langkah yang tidak mendesak.', cost: 'Gunakan hanya angka yang diketahui. Senaraikan kos yang belum diketahui. Baki sementara bukan net profit.', missing: 'Dapatkan fakta kritikal sebelum membuat keputusan atau menjanjikan hasil.' };
    $('fixExplanation').textContent = explanation[p];
    $('originalEvidence').textContent = state.evidenceText ? state.evidenceText.slice(0, 750) : (hasCostValues() ? 'Maklumat harga / kos telah dimasukkan pada Langkah 2.' : (state.evidenceFile ? `Lampiran: ${state.evidenceFile.name}` : 'Bukti belum diterangkan.'));
    $('quickFixEditor').value = state.quickFix || (state.diagnosis ? defaultFix(p) : '');
  }

  // ─────────────── tracker & report ───────────────
  function drawTracker() {
    if (!state.diagnosis) return;
    if (!state.tasks || state.tasks.length !== 7) state.tasks = generateTasks(currentPath());
    const root = $('tracker'); root.innerHTML = '';
    state.tasks.forEach((item, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'task' + (item.status === 'selesai' ? ' done' : '');
      wrap.innerHTML = `<div class="day">Hari ${i + 1}</div><div class="task-head"><strong>${scrub(item.title)}</strong><select aria-label="Status Hari ${i + 1}" data-status="${i}"><option value="belum">Belum mula</option><option value="sedang">Sedang buat</option><option value="selesai">Selesai ✓</option></select></div><div class="proof">Bukti cadangan: ${scrub(item.proof)}</div><input class="track-note" maxlength="450" data-note="${i}" aria-label="Bukti atau nota Hari ${i + 1}" placeholder="Catat bukti / pautan / angka sebenar (tanpa data customer)">`;
      root.appendChild(wrap);
      wrap.querySelector('[data-status]').value = item.status;
      wrap.querySelector('[data-note]').value = item.note || '';
    });
    $$('#tracker [data-status]').forEach((el) => { el.onchange = () => { state.tasks[+el.dataset.status].status = el.value; safeSave(); drawTracker(); drawReport(); }; });
    $$('#tracker [data-note]').forEach((el) => { el.oninput = () => { state.tasks[+el.dataset.note].note = el.value; safeSave(); drawReport(); }; });
    const done = state.tasks.filter((t) => t.status === 'selesai').length;
    $('completionText').textContent = `${done} daripada 7 selesai`;
    $('completionBar').style.width = `${(100 * done) / 7}%`;
    drawMetrics();
  }
  function metricLabels() {
    const p = currentPath();
    return p === 'attraction' ? ['Posting / tindakan dibuat', 'Enquiry sebenar direkod', 'Order berkaitan (jika disahkan)']
      : p === 'follow' ? ['Follow-up dihantar', 'Customer reply', 'Next step dipersetujui']
      : p === 'cost' ? ['Kategori kos disahkan', 'Keputusan harga direkod', 'Keputusan dilaksanakan']
      : ['Fakta berjaya diperoleh', 'Sumber disahkan', 'Keputusan direkod'];
  }
  function drawMetrics() {
    $('metricsArea').innerHTML = metricLabels().map((t, i) => `<div class="field"><label for="metric${i}">${scrub(t)}</label><input type="number" inputmode="numeric" id="metric${i}" min="0" step="1" placeholder="Jika tahu"></div>`).join('');
    state.metrics.forEach((v, i) => { $('metric' + i).value = v ?? ''; });
    $$('#metricsArea input').forEach((el, i) => { el.oninput = () => { state.metrics[i] = el.value; safeSave(); drawReport(); }; });
  }
  function reportText() {
    const p = state.profile, d = state.diagnosis, done = state.tasks.filter((t) => t.status === 'selesai').length;
    return `KLINIK BISNES SME — BUSINESS QUICK FIX\nBisnes: ${p.business || '-'}\nProduk / Servis: ${p.product || '-'}\nCustomer: ${p.customer || '-'}\nPathway: ${pathLabels[currentPath()] || '-'}\nDiagnosis awal: ${d?.reason || 'Belum dijana'}\nBukti diperhatikan: ${(d?.observations || []).join('; ') || '-'}\nBelum pasti: ${(d?.unknowns || []).join('; ') || '-'}\n\nQUICK FIX\n${state.quickFix || '-'}\n\nTRACKER 7 HARI (${done}/7 selesai)\n${state.tasks.map((t) => `Hari ${t.day} [${t.status}] ${t.title}\nBukti: ${t.note || '-'}`).join('\n')}\n\nHASIL HARI 7\n${metricLabels().map((l, i) => `${l}: ${state.metrics[i] || 'Belum direkod'}`).join('\n')}\nReview: ${state.reviewNotes || '-'}\n\nNota: Nota kerja peserta, bukan diagnosis muktamad atau jaminan jualan.`;
  }
  function drawReport() {
    const r = $('report'); if (!r) return;
    const p = state.profile, d = state.diagnosis, tasks = state.tasks || [];
    const done = tasks.filter((t) => t.status === 'selesai').length;
    const blocks = [
      ['Bisnes / Produk', `${p.business || '-'} · ${p.product || '-'}`],
      ['Keutamaan & diagnosis awal', `${pathLabels[currentPath()] || '-'}\n${d?.reason || 'Belum dijana'}`],
      ['Quick Fix yang disediakan', state.quickFix || 'Belum diisi'],
      ['Kemajuan 7 hari', `${done}/7 selesai · ${tasks.filter((t) => t.status === 'sedang').length} sedang dibuat`],
      ['Hasil yang direkod', metricLabels().map((l, i) => `${l}: ${state.metrics[i] || 'Belum direkod'}`).join('\n')],
    ];
    r.innerHTML = blocks.map(([title, value]) => `<div class="report-row"><b>${scrub(title)}</b><p>${scrub(value)}</p></div>`).join('');
  }
  function printReport() {
    dataFromForm(); drawReport();
    const p = state.profile, d = state.diagnosis;
    $('print-area').innerHTML = `<h1>Klinik Bisnes SME — Business Quick Fix</h1><div class="pr-sub">Laporan kerja peserta · ${new Date().toLocaleDateString('ms-MY')} · ${d?.origin === 'ai' ? 'Dibantu AI, disemak peserta' : 'Simulasi rule-based, bukan AI'}</div><div class="pr-item"><b>Bisnes:</b> ${scrub(p.business)}<br><b>Produk:</b> ${scrub(p.product)}<br><b>Sasaran customer:</b> ${scrub(p.customer || '-')}<br><b>Keutamaan:</b> ${scrub(pathLabels[currentPath()])}</div><h2>Diagnosis Awal</h2><div class="pr-item">${scrub(d?.reason || '-')}<br><br><b>Bukti:</b> ${scrub((d?.observations || []).join(' / '))}<br><b>Belum tahu:</b> ${scrub((d?.unknowns || []).join(' / '))}</div><h2>Quick Fix</h2><div class="pr-quick">${scrub(state.quickFix || '-')}</div><h2>Tracker 7 Hari</h2><table><tr><th>Hari</th><th>Tindakan</th><th>Status</th><th>Bukti sebenar</th></tr>${state.tasks.map((t) => `<tr><td>${t.day}</td><td>${scrub(t.title)}</td><td>${scrub(t.status)}</td><td>${scrub(t.note || '-')}</td></tr>`).join('')}</table><h2>Hasil & Review</h2><div class="pr-item">${metricLabels().map((l, i) => `${scrub(l)}: ${scrub(state.metrics[i] || 'Belum direkod')}`).join('<br>')}<br><b>Review:</b> ${scrub(state.reviewNotes || '-')}</div><p class="pr-sub">Bukan diagnosis muktamad; bukan pengiraan untung penuh atau jaminan peningkatan jualan.</p>`;
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
      try { localStorage.removeItem(CACHE_KEY); } catch {}
      await sb.auth.signOut();
      alert('Akaun dan data anda telah dipadam.');
      location.href = '/';
    } catch (err) { message(err.message, true); }
  }

  // ─────────────── wiring ───────────────
  ['business', 'product', 'customer', 'channel', 'revenue', 'participant', 'evidenceText', ...costKeys, 'quickFixEditor', 'reviewNotes', 'nextStep', 'confirmDiagnosis', 'quality1', 'quality2', 'quality3']
    .forEach((k) => $(k).addEventListener('input', () => { dataFromForm(); if (costKeys.includes(k)) drawCosts(); if (['quickFixEditor', 'reviewNotes'].includes(k)) drawReport(); }));
  $('marketingConsent').addEventListener('change', (e) => { dataFromForm(); recordConsent('marketing', e.target.checked); });
  $$('[name="pain"]').forEach((el) => el.addEventListener('change', () => { dataFromForm(); toggleCosts(); }));
  $('fileUpload').addEventListener('change', handleUpload);
  $('diagnoseBtn').onclick = createDiagnosis;
  $('pathwaySelect').onchange = () => {
    state.pathway = $('pathwaySelect').value;
    state.quickFix = state.pathway === state.diagnosis?.pathway ? state.diagnosis.quickFix : defaultFix(state.pathway);
    state.tasks = generateTasks(state.pathway); state.quality = [false, false, false];
    safeSave();
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

  // If there's no session after Supabase has read the URL, show sign-in.
  const s = await KB.session();
  if (!s) showOnly('loginGate');
})();

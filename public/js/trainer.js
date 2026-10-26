// Trainer dashboard: reads all journeys for a cohort (RLS allows staff read-only access).
(async () => {
  'use strict';
  const { $, esc, message, show } = KB;
  const pathLabels = { cost: 'Kos & Harga', content: 'Content', live: 'LIVE', missing: 'Missing Info' };
  const fitLabels = { ready: ['Layak, bersyarat', 'teal'], pending: ['Perlu sahkan', ''], withheld: ['Tidak ditawarkan', 'brick'] };
  const progLabels = { cost: 'Kira Cost', content: 'Content Sebulan', live: 'Live Laris' };
  const interested = (r) => r.course_interest === 'Maklumat programme berkaitan' || r.course_interest === 'Waitlist';
  const stepNames = ['Bisnes', 'Bukti', 'Diagnosis', 'Quick Fix', 'Pelan 7 Hari'];
  let rows = [], cohorts = [], booted = false;

  try { await KB.init(); } catch (err) { $('loadingGate').innerHTML = `<p>${esc(err.message)}</p>`; return; }
  const sb = KB.sb;
  KB.wireLogin({ redirectTo: () => location.origin + '/trainer' });
  $('signOutBtn').onclick = async () => { await sb.auth.signOut(); location.reload(); };

  const only = (id) => ['loginGate', 'deniedGate', 'loadingGate', 'dash'].forEach((x) => show(x, x === id));

  sb.auth.onAuthStateChange((_e, session) => {
    if (session?.user && !booted) { booted = true; setTimeout(() => start(session.user), 0); }
    if (!session) { booted = false; only('loginGate'); }
  });

  async function start(user) {
    $('whoAmI').textContent = user.email; show('accountBar', true);
    if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname);
    const { data: me } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (!me || !['trainer', 'admin'].includes(me.role)) return only('deniedGate');
    only('dash');
    await loadCohorts();
  }

  async function loadCohorts(selectId) {
    const { data, error } = await sb.from('cohorts').select('*').order('session_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
    if (error) return message('dashMessage', 'Senarai sesi gagal dimuatkan.', true);
    cohorts = data;
    const sel = $('cohortSelect');
    sel.innerHTML = cohorts.map((c) => `<option value="${c.id}">${esc(c.name)} (${esc(c.code)})</option>`).join('') + '<option value="">Tanpa sesi</option>';
    if (selectId) sel.value = selectId;
    await loadRows();
  }

  async function loadRows() {
    const cohortId = $('cohortSelect').value;
    const c = cohorts.find((x) => x.id === cohortId);
    $('dashTitle').textContent = c ? c.name : 'Peserta tanpa sesi';
    $('joinLink').textContent = c ? `${location.origin}/?c=${c.code}` : '—';
    drawExpiry(c);
    let q = sb.from('journeys').select('id, state, business_name, pathway, programme, programme_status, course_interest, marketing_opt_in, step, pdf_downloaded_at, updated_at, profiles(email, full_name)').order('updated_at', { ascending: false });
    q = cohortId ? q.eq('cohort_id', cohortId) : q.is('cohort_id', null);
    const { data, error } = await q;
    if (error) return message('dashMessage', 'Data peserta gagal dimuatkan.', true);
    message('dashMessage', '');
    rows = data;
    drawCounts(); drawRows(); show('detail', false);
  }

  const when = (t) => new Date(t).toLocaleString('ms-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const toLocalInput = (t) => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

  // Session codes stop working after active_until (checked in the database and the API).
  function drawExpiry(c) {
    show('expiryForm', !!c);
    if (!c) return;
    const expired = new Date(c.active_until) <= new Date();
    $('expiryState').innerHTML = expired ? '<span class="pill brick">Kod tamat</span>' : '<span class="pill teal">Kod aktif</span>';
    $('activeUntil').value = toLocalInput(c.active_until);
  }
  $('expiryForm').onsubmit = async (e) => {
    e.preventDefault();
    const c = cohorts.find((x) => x.id === $('cohortSelect').value);
    if (!c || !$('activeUntil').value) return;
    const { error } = await sb.from('cohorts').update({ active_until: new Date($('activeUntil').value).toISOString() }).eq('id', c.id);
    if (error) return message('dashMessage', 'Tarikh tamat gagal disimpan.', true);
    await loadCohorts(c.id);
    message('dashMessage', 'Tarikh tamat kod dikemas kini.');
  };

  function drawCounts() {
    const n = rows.length;
    const diag = rows.filter((r) => r.state?.diagnosis).length;
    const fix = rows.filter((r) => r.step >= 4).length;
    const pdf = rows.filter((r) => r.pdf_downloaded_at).length;
    const byPath = ['cost', 'content', 'live', 'missing'].map((p) => `${pathLabels[p]} ${rows.filter((r) => r.pathway === p).length}`).join(' · ');
    const ready = rows.filter((r) => r.programme_status === 'ready').length;
    const qualifiedInterest = rows.filter((r) => r.programme_status === 'ready' && interested(r)).length;
    $('counts').innerHTML = [[n, 'peserta'], [diag, 'ada diagnosis'], [fix, 'Quick Fix siap'], [pdf, 'muat turun PDF'], [ready, 'layak programme (bersyarat)'], [qualifiedInterest, 'layak + berminat']]
      .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    $('pathCounts').textContent = diag ? `Pathway: ${byPath}` : '';
  }

  function drawRows() {
    if (!rows.length) { $('rows').innerHTML = '<tr><td colspan="7">Belum ada peserta. Kongsi pautan sesi di atas.</td></tr>'; return; }
    $('rows').innerHTML = rows.map((r, i) => `<tr data-i="${i}" tabindex="0">
      <td>${esc(r.profiles?.full_name || r.state?.profile?.participant || '—')}<br><span class="subtle">${esc(r.profiles?.email || '')}</span></td>
      <td>${esc(r.business_name || '—')}<br><span class="subtle">${esc(r.state?.profile?.product || '')}</span></td>
      <td>${r.step + 1}. ${stepNames[r.step]}</td>
      <td>${r.pathway ? `<span class="pill teal">${esc(pathLabels[r.pathway] || r.pathway)}</span>` : '—'}</td>
      <td>${fitCell(r)}</td>
      <td>${r.pdf_downloaded_at ? `<span class="pill teal">Ya</span><br><span class="subtle">${when(r.pdf_downloaded_at)}</span>` : '—'}</td>
      <td class="subtle">${when(r.updated_at)}</td></tr>`).join('');
    document.querySelectorAll('#rows tr[data-i]').forEach((tr) => {
      const open = () => drawDetail(rows[+tr.dataset.i]);
      tr.onclick = open;
      tr.onkeydown = (e) => { if (e.key === 'Enter') open(); };
    });
  }

  function fitCell(r) {
    const f = fitLabels[r.programme_status];
    if (!f) return '—';
    const interest = interested(r) ? '<br><span class="subtle">Berminat</span>' : '';
    return `<span class="pill ${f[1]}">${esc(f[0])}</span>${r.programme ? `<br><span class="subtle">${esc(progLabels[r.programme] || r.programme)}</span>` : ''}${interest}`;
  }

  function drawDetail(r) {
    const s = r.state || {}, d = s.diagnosis;
    const tasks = (s.tasks || []).map((t, i) => `<li><b>Hari ${i + 1}</b> ${esc(t.title)}${t.proof ? ` — <i>${esc(t.proof)}</i>` : ''}</li>`).join('');
    $('detail').innerHTML = `<div class="kicker">${esc(r.profiles?.email || '')}</div>
      <h2>${esc(r.business_name || 'Tanpa nama bisnes')}</h2>
      <div class="two-col">
        <div class="surface"><h4>Bukti</h4><p>${esc((s.evidenceText || '').slice(0, 1200) || (s.evidenceFile ? 'Lampiran: ' + s.evidenceFile.name : '—'))}</p></div>
        <div class="surface"><h4>Diagnosis ${d?.origin === 'ai' ? '(AI)' : ''}</h4><p>${d ? esc(`${d.title}\n${d.reason}`) : '—'}</p></div>
      </div>
      <p class="subtle">Bisnes aktif: ${esc(s.profile?.businessActive || '—')} · Owner: ${esc(s.profile?.ownerAuthority || '—')} · Revenue: ${esc(s.profile?.revenue || '—')} · LIVE: ${esc(s.live?.liveExperience || '—')}</p>
      <p class="subtle">Pilihan selepas sesi: ${esc(r.course_interest || '—')} · Consent marketing: ${r.marketing_opt_in ? 'Ya' : 'Tidak'}</p>
      <h3>Quick Fix</h3><div class="surface"><p>${esc(s.quickFix || '—')}</p></div>
      <h3>Pelan 7 hari</h3><ul class="subtle">${tasks || '<li>Belum ada</li>'}</ul>
      <p class="subtle">PDF: ${r.pdf_downloaded_at ? when(r.pdf_downloaded_at) : 'belum dimuat turun'}</p>`;
    show('detail', true);
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function csv() {
    const head = ['email', 'nama', 'bisnes', 'produk', 'isu', 'pathway', 'programme', 'status_programme', 'bisnes_aktif', 'owner', 'revenue', 'pengalaman_live', 'langkah', 'pdf_dimuat_turun', 'pilihan_seterusnya', 'consent_marketing', 'kemas_kini'];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) => {
      const s = r.state || {};
      return [r.profiles?.email, r.profiles?.full_name || s.profile?.participant, r.business_name, s.profile?.product, s.profile?.pain, r.pathway, r.programme, r.programme_status, s.profile?.businessActive, s.profile?.ownerAuthority, s.profile?.revenue, s.live?.liveExperience, r.step + 1, r.pdf_downloaded_at || '', r.course_interest, r.marketing_opt_in ? 'ya' : 'tidak', r.updated_at].map(cell).join(',');
    });
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `kbsme_${$('cohortSelect').selectedOptions[0]?.text || 'peserta'}.csv`; a.click();
  }

  $('cohortSelect').onchange = loadRows;
  $('refreshBtn').onclick = loadRows;
  $('csvBtn').onclick = csv;
  $('cohortForm').onsubmit = async (e) => {
    e.preventDefault();
    const code = $('cCode').value.trim().toUpperCase();
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb.from('cohorts').insert({ code, name: $('cName').value.trim(), session_date: $('cDate').value || null, created_by: user.id }).select().single();  // active_until: database default
    if (error) return message('dashMessage', error.code === '23505' ? 'Kod itu sudah digunakan.' : 'Sesi gagal dicipta. Kod: 3–24 huruf besar, nombor atau "-".', true);
    e.target.reset(); e.target.closest('details').open = false;
    await loadCohorts(data.id);
  };

  if (!(await KB.session())) only('loginGate');
})();

// Deterministic rules shared by the browser app and the server (spec v3 §3, §5).
// Nothing here calls the AI: cost and LIVE maths, evidence checks, pathway guards and programme fit.

export const PATHWAYS = ['cost', 'content', 'live', 'missing'];
export const PAINS = ['cost', 'content', 'live', 'unknown'];

export const PATH_LABELS = {
  cost: 'Cash Flow / Profit · Kos & Harga',
  content: 'Marketing · Sistem Content',
  live: 'Sales · LIVE',
  missing: 'Missing Information',
};

export const COST_KEYS = ['sellingPrice', 'materialCost', 'packagingCost', 'deliveryCost', 'platformCost', 'promotionCost', 'otherCost'];
export const COST_LABELS = {
  sellingPrice: 'Harga jualan',
  materialCost: 'Kos bahan / produk',
  packagingCost: 'Packaging',
  deliveryCost: 'Delivery ditanggung',
  platformCost: 'Platform fee / komisen',
  promotionCost: 'Promotion per sale',
  otherCost: 'Kos langsung lain',
};
export const CONTENT_KEYS = ['postsWeek', 'hoursWeek', 'hasContentPlan', 'tracksContent'];
export const LIVE_KEYS = ['liveExperience', 'liveViewers', 'liveClaims', 'livePaid', 'invoiceTiming'];

export const REVENUE_BANDS = ['Pre-revenue', 'Bawah RM3,000', 'RM3,000 – bawah RM10,000', 'RM10,000 – bawah RM30,000', 'RM30,000 ke atas'];
const ELIGIBLE_REVENUE = REVENUE_BANDS.slice(1, 4);

export const PROGRAMMES = {
  cost: { title: 'Kira Cost Guna AI: Lepas Ni, Kira Harga Sendiri!', desc: 'senarai kos lengkap, kos tertinggal, harga minimum & sasaran' },
  content: { title: 'Content Sebulan Settle! — Guna ChatGPT', desc: 'prompt sendiri, idea terpilih, tiga post siap & jadual sebulan' },
  live: { title: 'Live Laris: Dari Viewers ke Buyers', desc: 'rundown LIVE, skrip, proses claim / invoice & tracking prestasi' },
};

const txt = (v) => String(v ?? '').trim();
const filled = (obj = {}, keys) => keys.some((k) => txt(obj[k]) !== '');

// Empty = unknown; explicit 0 = reported zero (still to be verified). Never treat blanks as RM0.
export function costSummary(costs = {}) {
  const num = (key) => {
    const raw = txt(costs[key]);
    if (!raw) return null;
    const x = Number(raw);
    return Number.isFinite(x) && x >= 0 ? x : NaN;
  };
  const price = num('sellingPrice');
  const known = {}, unknown = [], zero = [], invalid = [];
  for (const key of COST_KEYS) {
    const n = num(key);
    if (Number.isNaN(n)) invalid.push(COST_LABELS[key]);
    else if (key === 'sellingPrice') continue;
    else if (n === null) unknown.push(COST_LABELS[key]);
    else { known[COST_LABELS[key]] = n; if (n === 0) zero.push(COST_LABELS[key]); }
  }
  const knownTotal = Object.values(known).reduce((a, b) => a + b, 0);
  const calculable = price !== null && !Number.isNaN(price) && Object.keys(known).length > 0 && !invalid.length;
  return {
    selling_price: Number.isNaN(price) ? null : price,
    known_direct_cost: known,
    unknown_cost_categories: unknown,
    reported_zero_to_verify: zero,
    invalid_inputs: invalid,
    provisional_balance: calculable ? Math.round((price - knownTotal) * 100) / 100 : null,
    reason: calculable ? null : invalid.length ? 'Ada nombor kos yang tidak sah.' : price === null ? 'Harga jualan belum diketahui.' : 'Tiada kos langsung yang diketahui.',
    warning: 'Baki sementara daripada kos DIKETAHUI sahaja. BUKAN net profit. Kos kosong = belum diketahui, bukan RM0.',
  };
}

// Valid only when claims > 0 and 0 ≤ paid ≤ claims (both whole numbers). Otherwise "not calculable".
export function liveMath(live = {}) {
  const c = txt(live.liveClaims), p = txt(live.livePaid);
  if (c === '' || p === '') return { valid: false, reason: 'Claims atau paid orders belum direkod.' };
  const claims = Number(c), paid = Number(p);
  if (!Number.isInteger(claims) || !Number.isInteger(paid)) return { valid: false, contradictory: true, reason: 'Angka claims / paid mesti nombor bulat. Semak sumber.' };
  if (claims <= 0) return { valid: false, contradictory: true, reason: 'Claims mesti lebih daripada 0. Tidak boleh dikira — semak sumber.' };
  if (paid < 0 || paid > claims) return { valid: false, contradictory: true, reason: 'Paid orders melebihi claims (atau negatif). Tidak boleh dikira — semak sumber dan cutoff yang sama.' };
  const unpaid = claims - paid;
  return { valid: true, claims, paid, unpaid, rate: Math.round((unpaid / claims) * 1000) / 10 };
}

export function liveSummary(live = {}) {
  const m = liveMath(live);
  return {
    live_experience: live.liveExperience === 'yes' ? 'ya' : live.liveExperience === 'no' ? 'tidak' : 'tidak dinyatakan',
    unique_viewers: txt(live.liveViewers) || null,
    claims: txt(live.liveClaims) || null,
    paid_orders: txt(live.livePaid) || null,
    invoice_timing_reported: { during: 'semasa LIVE / segera', same_day: 'hari yang sama', next_day: 'hari berikutnya / lewat' }[live.invoiceTiming] || null,
    unpaid_claims: m.valid ? m.unpaid : null,
    unpaid_rate_percent: m.valid ? m.rate : null,
    calculation_note: m.valid ? 'Sah hanya jika claims dan paid dari sesi, cohort dan cutoff yang sama. Sebab tidak dibayar belum diketahui.' : `Tidak boleh dikira: ${m.reason}`,
  };
}

export function contentSummary(content = {}) {
  const yn = (v) => (v === 'yes' ? 'ya' : v === 'no' ? 'tidak' : 'tidak dinyatakan');
  return {
    posts_past_7_days: txt(content.postsWeek) || null,
    hours_per_week: txt(content.hoursWeek) || null,
    has_content_calendar: yn(content.hasContentPlan),
    reviews_reach_saves_enquiries: yn(content.tracksContent),
  };
}

// Spec §5 step 1: some business evidence beyond the chosen label. liveExperience alone is not evidence.
export function hasEvidence({ evidenceText, costs, content, live, hasFile } = {}) {
  return !!txt(evidenceText) || !!hasFile || filled(costs, COST_KEYS) || filled(content, CONTENT_KEYS)
    || filled(live, ['liveViewers', 'liveClaims', 'livePaid', 'invoiceTiming']);
}

// Spec §5 step 3 and T06/T07/T08: `live` needs LIVE experience, actual LIVE evidence and consistent numbers.
// Returns null when `live` is allowed, otherwise why it is not.
export function liveBlock({ live = {}, evidenceText, hasFile } = {}) {
  if (live.liveExperience !== 'yes') return 'Pengalaman LIVE selling belum disahkan. Chat WhatsApp atau soalan cara mula LIVE bukan bukti LIVE.';
  const m = liveMath(live);
  if (m.contradictory) return m.reason;
  const liveNumbers = filled(live, ['liveViewers', 'liveClaims', 'livePaid', 'invoiceTiming']);
  if (!liveNumbers && !txt(evidenceText) && !hasFile) return 'Tiada rekod LIVE sebenar (claims, paid orders, viewers atau log LIVE).';
  return null;
}

// Spec §1, §5 steps 4–6. The UI shows this; the model never decides it.
// status: ready (conditional, optional) | pending (confirm eligibility) | withheld | none
export function programmeFit({ profile = {}, live = {}, pathway, diagnosedPathway } = {}) {
  if (!pathway || !diagnosedPathway) return { status: 'none', key: null, detail: 'Belum ada diagnosis.' };
  if (pathway !== diagnosedPathway) return { status: 'none', key: null, detail: 'Anda menukar laluan selepas diagnosis. Masukkan bukti yang sesuai dan jana diagnosis semula sebelum cadangan programme.' };
  const prog = PROGRAMMES[pathway];
  if (!prog) return { status: 'none', key: null, detail: 'Tiada cadangan programme: fakta atau business gap belum jelas. Lengkapkan tindakan mencari fakta dahulu.' };
  const base = { key: pathway, title: prog.title };
  if (pathway === 'live' && live.liveExperience !== 'yes') return { ...base, status: 'withheld', detail: 'Live Laris hanya untuk pemilik bisnes yang sudah menjalankan LIVE selling. Pengalaman LIVE belum disahkan.' };
  if (profile.revenue === 'RM30,000 ke atas') return { ...base, status: 'withheld', detail: 'Programme RM198 Klinik Bisnes SME direka untuk bisnes dengan revenue bawah RM30K sebulan, jadi tiada cadangan automatik. Quick Fix dan tracker ini tetap boleh anda gunakan.' };
  if (profile.businessActive === 'no' || profile.revenue === 'Pre-revenue') return { ...base, status: 'withheld', detail: 'Bisnes belum aktif / belum ada jualan. Utamakan tindakan asas dahulu; tiada cadangan kelas RM198 automatik.' };
  if (profile.ownerAuthority === 'no') return { ...base, status: 'withheld', detail: 'Programme ini untuk pemilik atau pembuat keputusan bisnes. Kongsi laporan ini dengan pembuat keputusan jika berkaitan.' };
  if (profile.businessActive !== 'yes' || profile.ownerAuthority !== 'yes' || !ELIGIBLE_REVENUE.includes(profile.revenue)) {
    return { ...base, status: 'pending', detail: `Mungkin berkaitan: ${prog.title} (RM198). Sebelum sebarang cadangan, sahkan bisnes aktif, anda pemilik / pembuat keputusan, dan revenue bawah RM30K sebulan.` };
  }
  return { ...base, status: 'ready', detail: `Cadangan bersyarat, pilihan sahaja: ${prog.title} (RM198) — ${prog.desc}. Hanya jika anda berminat dan perlukan pelaksanaan yang lebih mendalam.` };
}

// ─────────────── 7-day tracker tasks ───────────────
// Fallback checklists (v3 prototype). Used when AI is off, when AI tasks fail validation,
// and whenever the pathway differs from the one the AI wrote tasks for.
export const TASK_TEMPLATES = {
  cost: [['Catat harga jual dan kos yang benar-benar diketahui', 'Rekod ringkas satu produk'], ['Pilih SATU kategori kos yang belum jelas', 'Nama kos untuk disemak'], ['Dapatkan dokumen asal kos itu', 'Resit / seller statement'], ['Catat nilai, unit dan tarikh kos', 'Bukti kos yang disahkan'], ['Semak sama ada kos itu berubah', 'Perbezaan / status semakan'], ['Kemas kini Cost Gap Snapshot', 'Snapshot baharu'], ['Catat jurang selebihnya & pilihan langkah seterusnya', 'Ringkasan tujuh hari']],
  content: [['Catat jumlah post dan masa content minggu lepas', 'Baseline seminggu'], ['Senaraikan tiga soalan pelanggan yang pernah diterima', 'Senarai soalan sebenar'], ['Pilih SATU soalan untuk satu post', 'Topik & sasaran post'], ['Sediakan rangka ringkas tanpa mereka fakta', 'Draf ringkas'], ['Terbitkan satu post apabila siap dan sesuai', 'Pautan / tarikh post'], ['Catat reach / saves / enquiry jika tersedia', 'Data dari platform'], ['Semak sama ada tindakan boleh diulang', 'Ulasan tujuh hari']],
  live: [['Pilih satu LIVE terakhir yang ada rekod', 'Tarikh & platform LIVE'], ['Semak jumlah claim untuk sesi itu', 'Claim log tanpa data customer'], ['Padankan paid orders kepada cohort yang sama', 'Jumlah paid disahkan'], ['Catat bila invoice / link bayaran dihantar', 'Timestamp invoice'], ['Kira jurang claim → paid yang sah', 'Bilangan dan kadar sebenar'], ['Pilih SATU proses untuk diperiksa lagi', 'Jurang dan tindakan pilihan'], ['Catat keputusan awal & data yang masih hilang', 'Ringkasan tujuh hari']],
  missing: [['Nyatakan satu soalan yang paling penting', 'Soalan spesifik'], ['Kenal pasti rekod / sumber asal', 'Senarai sumber'], ['Tentukan siapa akan menyemak', 'Pemilik tindakan'], ['Cari dokumen berkaitan', 'Bukti sumber'], ['Tentukan sama ada data lengkap / belum lengkap', 'Status data'], ['Kemaskan profil / bukti yang diperoleh', 'Ringkasan bukti'], ['Tentukan sama ada sesuai untuk diagnosis semula', 'Keputusan berdasarkan fakta']],
};
export const TASK_TITLE_MAX = 120;
export const TASK_PROOF_MAX = 100;

export function templateTasks(pathway) {
  return (TASK_TEMPLATES[pathway] || TASK_TEMPLATES.missing).map(([title, proof]) => ({ title, proof }));
}

// Shortens at a word boundary instead of rejecting slightly long text.
export function clipWords(value, max) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, '') + '…';
}

// AI tasks → exactly 7 {title, proof}, or null (caller falls back to templateTasks).
export function normalizeTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length !== 7) return null;
  const out = tasks.map((t) => ({ title: clipWords(t?.title, TASK_TITLE_MAX), proof: clipWords(t?.proof, TASK_PROOF_MAX) }));
  return out.every((t) => t.title && t.proof) ? out : null;
}

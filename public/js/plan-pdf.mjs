// Builds the participant's take-home "Pelan 7 Hari" as a real PDF in the browser (jsPDF + embedded IBM Plex Sans).
const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
const FONTS = { normal: '/fonts/IBMPlexSans-Regular.ttf', bold: '/fonts/IBMPlexSans-SemiBold.ttf' };
const C = { navy: '#102f4a', teal: '#087f79', ink: '#172b3a', muted: '#5b6c78', line: '#c9d7db', wash: '#f3f7f9' };
const MM_PER_PT = 0.3528;

let ready = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = resolve; s.onerror = () => reject(new Error('PDF library failed to load'));
    document.head.appendChild(s);
  });
}
async function fontBase64(url) {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
function prepare() {
  ready ||= Promise.all([
    window.jspdf ? null : loadScript(JSPDF_URL),
    fontBase64(FONTS.normal),
    fontBase64(FONTS.bold),
  ]).catch((err) => { ready = null; throw err; });
  return ready;
}

// Emoji and other symbols outside the embedded font would print as junk.
const clean = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\r/g, '')
  .replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();

export async function downloadPlanPdf({ state, pathLabel, programme, cohortName }) {
  const [, regular, bold] = await prepare();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.addFileToVFS('Plex-Regular.ttf', regular); doc.addFont('Plex-Regular.ttf', 'Plex', 'normal');
  doc.addFileToVFS('Plex-SemiBold.ttf', bold); doc.addFont('Plex-SemiBold.ttf', 'Plex', 'bold');

  const W = 210, H = 297, M = 18, BOTTOM = H - 18, width = W - 2 * M;
  let y = M;

  const set = (size, weight = 'normal', color = C.ink) => { doc.setFont('Plex', weight); doc.setFontSize(size); doc.setTextColor(color); };
  const lh = (size, k = 1.45) => size * MM_PER_PT * k;
  const room = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = M; } };
  // Writes wrapped text, breaking pages line by line so long Quick Fix text flows naturally.
  function para(text, { size = 10, weight = 'normal', color = C.ink, indent = 0, gap = 2 } = {}) {
    set(size, weight, color);
    const lines = doc.splitTextToSize(clean(text) || '—', width - indent);
    for (const line of lines) { room(lh(size)); doc.text(line, M + indent, y + size * MM_PER_PT); y += lh(size); }
    y += gap;
  }
  function bullets(items, opts = {}) {
    const list = (items || []).map(clean).filter(Boolean);
    if (!list.length) return para('—', opts);
    for (const item of list) {
      set(opts.size || 10);
      const lines = doc.splitTextToSize(item, width - 6);
      room(lh(10));
      doc.text('•', M + 1, y + 10 * MM_PER_PT);
      for (const line of lines) { room(lh(10)); doc.text(line, M + 6, y + 10 * MM_PER_PT); y += lh(10); }
      y += 1;
    }
    y += 1.5;
  }
  function heading(text) {
    room(16);
    y += 3;
    set(8.5, 'bold', C.teal); doc.text(clean(text).toUpperCase(), M, y + 8.5 * MM_PER_PT, { charSpace: 0.4 });
    y += lh(8.5) + 1;
    doc.setDrawColor(C.line); doc.setLineWidth(0.3); doc.line(M, y, W - M, y);
    y += 4;
  }
  function labelled(label, value) {
    set(9, 'bold', C.muted);
    const labelW = 34;
    const lines = doc.splitTextToSize(clean(value) || '—', width - labelW);
    room(lh(10) * lines.length);
    doc.text(label, M, y + 10 * MM_PER_PT);
    set(10);
    lines.forEach((line, i) => doc.text(line, M + labelW, y + 10 * MM_PER_PT + i * lh(10)));
    y += lh(10) * lines.length + 1.5;
  }

  const p = state.profile || {}, d = state.diagnosis || {};
  const date = new Date().toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' });

  // ─── title ───
  set(9, 'bold', C.teal); doc.text('KLINIK BISNES SME · BUSINESS QUICK FIX', M, y + 9 * MM_PER_PT, { charSpace: 0.4 }); y += lh(9) + 2;
  para(`Pelan 7 Hari — ${p.business || 'Bisnes saya'}`, { size: 20, weight: 'bold', color: C.navy, gap: 1 });
  para([p.product, cohortName, date].filter(Boolean).join(' · '), { size: 9.5, color: C.muted, gap: 3 });

  heading('Ringkasan bisnes');
  labelled('Produk / servis', p.product);
  labelled('Customer utama', p.customer);
  labelled('Channel jualan', p.channel);
  labelled('Keutamaan', pathLabel);

  heading('Diagnosis awal — bukan muktamad');
  para(d.title, { size: 12, weight: 'bold', color: C.navy, gap: 1 });
  para(d.reason, { gap: 2 });
  para('Perkara yang diperhatikan', { size: 9, weight: 'bold', color: C.muted, gap: 1 });
  bullets(d.observations);
  para('Belum tahu / perlu disahkan', { size: 9, weight: 'bold', color: C.muted, gap: 1 });
  bullets(d.unknowns);
  para(`Kekuatan bukti: ${d.strength || '—'}. ${d.origin === 'ai' ? 'Dijana dengan bantuan AI dan disemak oleh peserta.' : 'Simulasi rule-based, bukan AI.'}`, { size: 8.5, color: C.muted });

  heading('Quick Fix anda');
  para(state.quickFix, { size: 10.5 });

  // ─── checklist: its own printable page (all 7 days fit); each day stays together ───
  doc.addPage(); y = M;
  heading('Senarai semak 7 hari');
  para('Tandakan kotak apabila selesai dan tulis bukti sebenar di garisan. Jangan catat nama atau nombor customer.', { size: 9, color: C.muted, gap: 3 });
  (state.tasks || []).forEach((t, i) => {
    set(10.5, 'bold');
    const titleLines = doc.splitTextToSize(clean(t.title) || '—', width - 30);
    set(9);
    const proofLines = doc.splitTextToSize(`Bukti: ${clean(t.proof) || '—'}`, width - 30);
    const blockH = titleLines.length * lh(10.5) + proofLines.length * lh(9) + 2 * 7 + 6;
    room(blockH);
    const top = y;
    doc.setDrawColor(C.navy); doc.setLineWidth(0.4); doc.rect(M, top + 0.6, 4.6, 4.6);
    set(8.5, 'bold', C.teal); doc.text(`HARI ${i + 1}`, M + 8, top + 4.2);
    set(10.5, 'bold', C.ink);
    titleLines.forEach((line, k) => doc.text(line, M + 30, top + 10.5 * MM_PER_PT + k * lh(10.5)));
    y = top + titleLines.length * lh(10.5) + 0.5;
    set(9, 'normal', C.muted);
    proofLines.forEach((line) => { doc.text(line, M + 30, y + 9 * MM_PER_PT); y += lh(9); });
    doc.setDrawColor(C.line); doc.setLineWidth(0.25);
    for (let k = 0; k < 2; k++) { y += 7; doc.line(M + 30, y, W - M, y); }
    y += 6;
  });

  if (programme?.status === 'ready') {
    heading('Langkah seterusnya (pilihan)');
    para(programme.detail, { size: 9.5 });
  }

  // ─── footer on every page ───
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    set(7.5, 'normal', C.muted);
    doc.text('Nota kerja peserta: diagnosis awal, bukan diagnosis muktamad atau jaminan jualan.', M, H - 10);
    doc.text(`${i} / ${pages}`, W - M, H - 10, { align: 'right' });
  }

  const slug = clean(p.business || 'bisnes').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'bisnes';
  const filename = `Pelan-7-Hari-${slug}.pdf`;
  doc.save(filename);
  return filename;
}

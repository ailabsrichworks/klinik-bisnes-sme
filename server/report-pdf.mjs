// The participant's report as a PDF (A4), built on the server so a copy can be kept in Drive.
// Same content as the on-screen report in Langkah 5. Fonts: IBM Plex Sans (OFL, server/fonts).
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATH_LABELS, METRIC_LABELS, programmeFit } from '../public/js/rules.mjs';

const fonts = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');
const C = { navy: '#102f4a', teal: '#087f79', ink: '#172b3a', muted: '#5b6c78', line: '#c9d7db', wash: '#f3f7f9' };
const STATUS = { belum: 'Belum', sedang: 'Sedang', selesai: 'Selesai' };

// Emoji and other symbols outside the font would print as boxes.
const clean = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\r/g, '')
  .replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();

export function reportPdf({ state = {}, sessionName = '', date = new Date() }) {
  const p = state.profile || {};
  const d = state.diagnosis;
  const path_ = state.pathway || d?.pathway || 'missing';
  const fit = programmeFit({ profile: p, live: state.live || {}, pathway: path_, diagnosedPathway: d?.pathway });
  const labels = METRIC_LABELS[path_] || METRIC_LABELS.missing;

  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 52, right: 52 }, info: { Title: `Business Quick Fix — ${clean(p.business) || 'Peserta'}`, Author: 'Klinik Bisnes SME' } });
  doc.registerFont('Plex', path.join(fonts, 'IBMPlexSans-Regular.ttf'));
  doc.registerFont('Plex-Bold', path.join(fonts, 'IBMPlexSans-SemiBold.ttf'));
  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const finished = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const text = (s, { size = 10, bold = false, color = C.ink, gap = 4, indent = 0 } = {}) => {
    doc.font(bold ? 'Plex-Bold' : 'Plex').fontSize(size).fillColor(color)
      .text(clean(s) || '—', doc.page.margins.left + indent, doc.y, { width: W - indent, lineGap: 1.5 });
    doc.y += gap;
  };
  const heading = (s) => {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.y += 8;
    doc.font('Plex-Bold').fontSize(12.5).fillColor(C.navy).text(s, doc.page.margins.left, doc.y, { width: W });
    const y = doc.y + 3;
    doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + W, y).lineWidth(0.7).strokeColor(C.line).stroke();
    doc.y = y + 7;
  };
  const field = (label, value) => {
    if (!clean(value)) return;
    doc.font('Plex-Bold').fontSize(9.5).fillColor(C.muted).text(`${label}: `, doc.page.margins.left, doc.y, { continued: true, width: W });
    doc.font('Plex').fillColor(C.ink).text(clean(value), { lineGap: 1.5 });
    doc.y += 2;
  };
  const bullets = (items) => {
    const list = (items || []).map(clean).filter(Boolean);
    if (!list.length) return text('—');
    for (const item of list) text(`•  ${item}`, { indent: 4, gap: 2 });
    doc.y += 2;
  };

  // Header band
  doc.rect(0, 0, doc.page.width, 92).fill(C.navy);
  doc.font('Plex-Bold').fontSize(9).fillColor('#9fd8d2').text('KLINIK BISNES SME · BUSINESS QUICK FIX', 52, 26, { characterSpacing: 0.8 });
  doc.font('Plex-Bold').fontSize(19).fillColor('#ffffff').text(clean(p.business) || 'Laporan peserta', 52, 42, { width: W });
  doc.font('Plex').fontSize(9).fillColor('#d7e3ea')
    .text([date.toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }), clean(sessionName), clean(p.participant)].filter(Boolean).join('  ·  '), 52, 68, { width: W });
  doc.y = 112;

  heading('Bisnes');
  field('Produk / servis', p.product);
  field('Customer utama', p.customer);
  field('Channel', p.channel);
  field('Revenue sebulan', p.revenue);

  heading('Diagnosis awal');
  if (d) {
    text(d.title, { size: 11.5, bold: true, gap: 2 });
    text(`${PATH_LABELS[path_] || path_}  ·  ${d.strength || ''}  ·  ${d.origin === 'ai' ? 'Dibantu AI, disemak peserta' : 'Simulasi rule-based'}`, { size: 8.5, color: C.teal, gap: 6 });
    text(d.reason);
    text('Perkara yang diperhatikan', { size: 9.5, bold: true, color: C.muted, gap: 2 });
    bullets(d.observations);
    text('Belum tahu / perlu disahkan', { size: 9.5, bold: true, color: C.muted, gap: 2 });
    bullets(d.unknowns);
  } else {
    text('Belum dijana.');
  }

  heading('Quick Fix');
  const qf = clean(state.quickFix);
  const qfTop = doc.y;
  doc.font('Plex').fontSize(10);
  const qfHeight = doc.heightOfString(qf || '—', { width: W - 20, lineGap: 1.5 });
  if (qfTop + qfHeight + 16 < doc.page.height - doc.page.margins.bottom) {
    doc.rect(doc.page.margins.left, qfTop, W, qfHeight + 16).fill(C.wash);
    doc.fillColor(C.ink).text(qf || '—', doc.page.margins.left + 10, qfTop + 8, { width: W - 20, lineGap: 1.5 });
    doc.y = qfTop + qfHeight + 22;
  } else {
    text(qf); // too long for one box: let it flow across pages
  }

  heading('Pelan 7 hari');
  const tasks = state.tasks || [];
  const done = tasks.filter((t) => t.status === 'selesai').length;
  text(`${done} daripada ${tasks.length || 7} selesai`, { size: 9, color: C.muted, gap: 6 });
  tasks.forEach((t, i) => {
    if (doc.y > doc.page.height - 110) doc.addPage();
    const status = STATUS[t.status] || 'Belum';
    doc.font('Plex-Bold').fontSize(10).fillColor(t.status === 'selesai' ? C.teal : C.ink)
      .text(`Hari ${t.day || i + 1}  ·  ${status}`, doc.page.margins.left, doc.y, { width: W });
    text(t.title, { gap: 1 });
    if (clean(t.proof)) text(`Bukti untuk direkod: ${t.proof}`, { size: 9, color: C.muted, gap: 1 });
    if (clean(t.note)) text(`Bukti sebenar: ${t.note}`, { size: 9, gap: 1 });
    doc.y += 5;
  });

  heading('Hasil Hari 7');
  labels.forEach((l, i) => field(l, state.metrics?.[i] || 'Belum direkod'));
  if (clean(state.reviewNotes)) { doc.y += 2; field('Review', state.reviewNotes); }

  heading('Langkah seterusnya (pilihan)');
  text(fit.detail);

  doc.y += 10;
  text('Nota kerja peserta. Bukan diagnosis muktamad, bukan pengiraan untung penuh dan bukan jaminan peningkatan jualan.', { size: 8.5, color: C.muted });
  doc.end();
  return finished;
}

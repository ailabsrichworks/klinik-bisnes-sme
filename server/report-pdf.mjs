// The participant's Business Quick Fix report as a PDF (A4): the same seven sections as the
// report page, with the AI coach's diagnosis, workshop, plan and reflection (or the fixed text when
// the AI is off). Fonts: Inter + Bricolage Grotesque (OFL).
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PILLARS, CLOSING, CALC_NOTE, AI_NOTE, REPORT_NOTE, calculate, calcInputs, workshopQuestions } from '../public/js/content.mjs';
import { pillarAnswers } from './store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fonts = path.join(here, 'fonts');
// The same logo files as the web header (dark artwork, so they sit on the white strip above the band).
const LOGOS = { klinik: path.join(here, '..', 'public', 'img', 'klinik-bisnes-sme.png'), rcg: path.join(here, '..', 'public', 'img', 'rcg.png') };
// Brand: nude, red, black, white (as the web page); the rest are tints of them.
const C = { nude: '#f7eee1', red: '#c02026', ink: '#000000', text: '#2e2924', muted: '#5c534a', line: '#ebe1d3', soft: '#fcf8f2', cream: '#fcf8f2', fix: '#fcf8f2', warm: '#fff9ed', warmLine: '#f0dfbd' };

// Emoji and other symbols outside the fonts would print as boxes.
const clean = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\r/g, '')
  .replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
const dateMY = (d) => d.toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });

export function reportPdf({ state = {}, sessionName = '', date = new Date() }) {
  const p = state.profile || {};
  const { pillar, selected, calc, workOutput, workAnswers, plan, ai, planDone } = pillarAnswers(state);
  if (!pillar || selected.length !== 3 || !ai) throw new Error('report needs a pillar, 3 situations and a diagnosis');
  const P = PILLARS[pillar];
  const R = ai.result;
  const result = calculate(pillar, calc);
  const inputs = calcInputs(pillar, calc);

  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 52, right: 52 }, info: { Title: `Business Quick Fix — ${clean(p.business) || 'Peserta'}`, Author: 'Klinik Bisnes SME' } });
  doc.registerFont('Body', path.join(fonts, 'Inter-Regular.woff'));
  doc.registerFont('Bold', path.join(fonts, 'Inter-Bold.woff'));
  doc.registerFont('Display', path.join(fonts, 'BricolageGrotesque-Bold.woff'));
  const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const finished = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const text = (s, { size = 10, font = 'Body', color = C.ink, gap = 4, indent = 0, width = W - indent } = {}) => {
    doc.font(font).fontSize(size).fillColor(color).text(clean(s) || '—', L + indent, doc.y, { width, lineGap: 1.6 });
    doc.y += gap;
  };
  const room = (h) => { if (doc.y + h > bottom()) doc.addPage(); };
  const section = (label, title) => {
    room(90);
    doc.y += 10;
    doc.font('Bold').fontSize(7.5).fillColor(C.muted).text(label.toUpperCase(), L, doc.y, { characterSpacing: 1.2, width: W });
    doc.y += 3;
    doc.font('Display').fontSize(14).fillColor(C.ink).text(clean(title), L, doc.y, { width: W });
    doc.y += 6;
  };
  // A tinted box around a block of text (falls back to plain text if it would not fit on the page).
  const box = (s, { fill = C.cream, border = null, size = 10, font = 'Body', color = C.ink, bar = null, title = '' } = {}) => {
    const t = clean(s) || '—', pad = 11, inner = W - 2 * pad - (bar ? 4 : 0);
    doc.font('Display').fontSize(11);
    const th = title ? doc.heightOfString(title, { width: inner }) + 4 : 0;
    doc.font(font).fontSize(size);
    const h = th + doc.heightOfString(t, { width: inner, lineGap: 1.6 }) + 2 * pad;
    room(Math.min(h, 200));
    if (doc.y + h > bottom()) return text(t, { size, font, color });
    const y = doc.y;
    doc.roundedRect(L, y, W, h, 8).fill(fill);
    if (border) doc.roundedRect(L, y, W, h, 8).lineWidth(0.8).strokeColor(border).stroke();
    if (bar) doc.rect(L, y, 4, h).fill(bar);
    if (title) doc.font('Display').fontSize(11).fillColor(C.ink).text(title, L + pad + (bar ? 4 : 0), y + pad, { width: inner });
    doc.font(font).fontSize(size).fillColor(color).text(t, L + pad + (bar ? 4 : 0), y + pad + th, { width: inner, lineGap: 1.6 });
    doc.y = y + h + 8;
  };
  const field = (label, value) => {
    room(34);
    text(label, { size: 8.5, font: 'Bold', color: C.muted, gap: 1 });
    text(value || 'Belum diisi', { color: value ? C.ink : C.muted, gap: 6 });
  };

  // Logos on a white strip: Klinik Bisnes SME left, RCG right (as on the web page)
  doc.image(LOGOS.klinik, L, 18, { height: 44 });
  doc.image(LOGOS.rcg, L + W - 55, 18, { fit: [55, 44], align: 'right' });
  // Title band
  const B = 82;
  doc.rect(0, B, doc.page.width, 98).fill(C.nude);
  doc.font('Bold').fontSize(8).fillColor(C.red).text(`BUSINESS QUICK FIX · ${P.name.toUpperCase()}`, L, B + 20, { characterSpacing: 1.4, width: W });
  doc.font('Display').fontSize(22).fillColor(C.ink).text(clean(p.business) || 'Laporan peserta', L, B + 35, { width: W });
  doc.font('Body').fontSize(9).fillColor(C.text)
    .text([clean(p.name), dateMY(date), clean(sessionName)].filter(Boolean).join('  ·  '), L, B + 67, { width: W });
  doc.y = B + 116;
  text([p.industry, p.businessModel, p.businessAge, p.monthlySales && `Jualan: ${p.monthlySales}`].filter(Boolean).join('  ·  '), { size: 8.5, color: C.muted, gap: 10 });

  // Diagnosis banner
  {
    const pad = 14;
    doc.font('Display').fontSize(13);
    const h1 = doc.heightOfString(clean(R.diagnosis_title), { width: W - 2 * pad });
    doc.font('Body').fontSize(9.5);
    const h2 = doc.heightOfString(clean(R.diagnosis_summary), { width: W - 2 * pad, lineGap: 1.6 });
    const y = doc.y, h = pad + 12 + h1 + 6 + h2 + pad;
    doc.roundedRect(L, y, W, h, 10).fill(C.nude);
    doc.font('Bold').fontSize(7.5).fillColor(C.red).text(ai.source === 'ai' ? 'DIAGNOSIS AWAL · DISEDIAKAN OLEH AI' : 'DIAGNOSIS AWAL', L + pad, y + pad, { characterSpacing: 1.2 });
    doc.font('Display').fontSize(13).fillColor(C.ink).text(clean(R.diagnosis_title), L + pad, y + pad + 12, { width: W - 2 * pad });
    doc.font('Body').fontSize(9.5).fillColor(C.text).text(clean(R.diagnosis_summary), L + pad, doc.y + 6, { width: W - 2 * pad, lineGap: 1.6 });
    doc.y = y + h + 4;
  }

  section('01 · Simptom', 'Apa yang sedang berlaku?');
  // each ticked situation with the AI's reason for it; the main issue highlighted
  const reasonOf = (n) => R.issue_analysis?.find((x) => x.number === n)?.reason || (n === R.primary_issue ? R.priority_reason : '');
  selected.forEach((i, k) => {
    const n = k + 1, primary = R.primary_issue === n, why = reasonOf(n);
    room(60);
    text(`${primary ? 'ISU UTAMA  ·  ' : ''}${n}. ${P.issues[i]}`, { gap: 2, font: 'Bold', color: primary ? C.red : C.ink });
    if (why) text(`${primary ? 'Kenapa didahulukan: ' : ''}${why}`, { indent: 14, gap: 8, size: 9.5, color: primary ? C.ink : C.muted });
  });
  if (!R.issue_analysis?.length && R.other_issues) field('Kaitan dua isu lain', R.other_issues);

  section('02 · Punca berkemungkinan', 'Apa yang mungkin menjadi punca?');
  text(R.likely_cause);

  section('03 · Impak kepada bisnes', 'Kenapa masalah ini patut diberi perhatian?');
  text(R.impact, { gap: 6 });
  if (R.evidence_to_check?.length) {
    text('Bukti untuk disemak', { size: 8.5, font: 'Bold', color: C.muted, gap: 2 });
    for (const e of R.evidence_to_check) text(`•  ${e}`, { indent: 2, gap: 2 });
  }

  section('04 · Kira / semak impak', P.calculatorTitle);
  const own = P.fields.some((f) => String(calc[f.id] ?? '').trim() !== '');
  text(own ? P.calculatorIntro : 'Angka contoh — peserta tidak memasukkan angka sendiri.', { size: 9, color: C.muted, gap: 6 });
  for (const f of P.fields) text(`${f.label}: ${inputs[f.id]}`, { size: 9.5, gap: 2 });
  doc.y += 4;
  box(`${result.lines.join('\n')}\n${result.note}`, { fill: C.nude, color: C.ink, font: 'Bold', size: 10 });
  text(CALC_NOTE, { size: 8, color: C.muted });

  section('05 · Quick Fix workshop', R.workshop.title);
  if (R.workshop.purpose) text(R.workshop.purpose, { gap: 6 });
  // the questions the participant answered, with their answers (else the exercise steps)
  const qa = workshopQuestions(R.workshop).map((x, i) => ({ q: x.question, a: String(workAnswers[i] ?? '').trim() }));
  if (qa.some((x) => x.a)) {
    qa.forEach((x, i) => {
      room(40);
      text(`${i + 1}. ${x.q}`, { gap: 1, font: 'Bold', size: 9.5, color: C.ink });
      text(clean(x.a) || '—', { indent: 14, gap: 6, size: 9.5 });
    });
  } else box(R.workshop.steps.map((x, i) => `${i + 1}. ${x}`).join('\n'), { bar: C.ink, size: 9.5 });
  if (R.workshop.example) box(R.workshop.example, { title: 'Contoh', fill: C.fix, size: 9.5 });
  field(R.workshop.output || 'Hasil latihan anda', clean(workOutput));

  section('06 · Pelan tindakan 7 hari', 'Jangan berhenti setakat faham. Uji dalam bisnes.');
  field('Bila anda akan mula?', plan.startDate ? dateMY(new Date(`${plan.startDate}T00:00:00+08:00`)) : '');
  R.plan.forEach((it, i) => {
    room(70);
    const y = doc.y;
    doc.rect(L, y + 2, 9, 9).lineWidth(0.8).strokeColor(C.ink).stroke();
    if (planDone[i]) doc.moveTo(L + 2, y + 6.5).lineTo(L + 4, y + 9).lineTo(L + 8, y + 3.5).lineWidth(1.2).strokeColor(C.red).stroke();
    doc.font('Bold').fontSize(9.5).fillColor(C.ink).text(`Hari ${it.day}  ·  Item ${i + 1}${planDone[i] ? '  ·  Selesai' : ''}`, L + 16, y, { width: W - 16 });
    doc.y += 2;
    text(`A. ${it.action}`, { indent: 16, gap: 1 });
    text(`B. ${it.measure}`, { indent: 16, gap: 1, size: 9.5 });
    text(`C. ${it.evidence}`, { indent: 16, gap: 7, size: 9.5, color: C.muted });
  });

  section('07 · Reflection', 'Di mana execution gap anda?');
  field('Apa yang sudah anda faham / sediakan', R.reflection.prepared);
  field('Apa yang masih perlu disahkan', R.reflection.to_validate);
  field('Apa yang mungkin perlukan bimbingan lanjut', R.reflection.further_guidance);
  box(CLOSING.text, { title: CLOSING.title, fill: C.warm, border: C.warmLine, size: 9.5 });

  doc.y += 4;
  text(ai.source === 'ai' ? AI_NOTE : REPORT_NOTE, { size: 8, color: C.muted });
  doc.end();
  return finished;
}

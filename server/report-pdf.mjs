// The participant's Business Quick Fix report as a PDF (A4): the same seven sections as the
// report page, with the fixed text for their pillar. Fonts: Inter + Bricolage Grotesque (OFL).
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PILLARS, CLOSING, CALC_NOTE, REPORT_NOTE, calculate, calcInputs } from '../public/js/content.mjs';
import { pillarAnswers } from './store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fonts = path.join(here, 'fonts');
// The same logo files as the web header (dark artwork, so they sit on the white strip above the band).
const LOGOS = { klinik: path.join(here, '..', 'public', 'img', 'klinik-bisnes-sme.png'), rcg: path.join(here, '..', 'public', 'img', 'rcg.png') };
const C = { green: '#174b3b', lime: '#d7f36b', ink: '#17211d', muted: '#64716b', line: '#e1e6df', soft: '#edf4ef', cream: '#f7f8f2', fix: '#f1f7e4', warm: '#fff9ed', warmLine: '#f0dfbd' };

// Emoji and other symbols outside the fonts would print as boxes.
const clean = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\r/g, '')
  .replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
const dateMY = (d) => d.toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });

export function reportPdf({ state = {}, sessionName = '', date = new Date() }) {
  const p = state.profile || {};
  const { pillar, selected, calc, workOutput, plan } = pillarAnswers(state);
  if (!pillar || selected.length !== 3) throw new Error('report needs a pillar and 3 situations');
  const P = PILLARS[pillar];
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
    doc.font('Bold').fontSize(7.5).fillColor('#738078').text(label.toUpperCase(), L, doc.y, { characterSpacing: 1.2, width: W });
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
  doc.image(LOGOS.klinik, L, 18, { height: 50 });
  doc.image(LOGOS.rcg, L + W - 60, 24, { fit: [60, 38], align: 'right' });
  // Title band
  const B = 82;
  doc.rect(0, B, doc.page.width, 98).fill(C.green);
  doc.font('Bold').fontSize(8).fillColor(C.lime).text(`BUSINESS QUICK FIX · ${P.name.toUpperCase()}`, L, B + 20, { characterSpacing: 1.4, width: W });
  doc.font('Display').fontSize(22).fillColor('#ffffff').text(clean(p.business) || 'Laporan peserta', L, B + 35, { width: W });
  doc.font('Body').fontSize(9).fillColor('#d9e7df')
    .text([clean(p.name), dateMY(date), clean(sessionName)].filter(Boolean).join('  ·  '), L, B + 67, { width: W });
  doc.y = B + 116;
  text([p.industry, p.businessModel, p.businessAge, p.monthlySales && `Jualan: ${p.monthlySales}`].filter(Boolean).join('  ·  '), { size: 8.5, color: C.muted, gap: 10 });

  // Diagnosis banner
  {
    const pad = 14;
    doc.font('Display').fontSize(13);
    const h1 = doc.heightOfString(P.titleOut, { width: W - 2 * pad });
    doc.font('Body').fontSize(9.5);
    const h2 = doc.heightOfString(P.introOut, { width: W - 2 * pad, lineGap: 1.6 });
    const y = doc.y, h = pad + 12 + h1 + 6 + h2 + pad;
    doc.roundedRect(L, y, W, h, 10).fill(C.green);
    doc.font('Bold').fontSize(7.5).fillColor(C.lime).text('DIAGNOSIS AWAL', L + pad, y + pad, { characterSpacing: 1.2 });
    doc.font('Display').fontSize(13).fillColor('#ffffff').text(P.titleOut, L + pad, y + pad + 12, { width: W - 2 * pad });
    doc.font('Body').fontSize(9.5).fillColor('#dce9e0').text(P.introOut, L + pad, doc.y + 6, { width: W - 2 * pad, lineGap: 1.6 });
    doc.y = y + h + 4;
  }

  section('01 · Simptom', 'Apa yang sedang berlaku?');
  for (const i of selected) text(`•  ${P.issues[i]}`, { indent: 2, gap: 3 });

  section('02 · Punca berkemungkinan', 'Apa yang mungkin menjadi punca?');
  text(P.cause);

  section('03 · Impak kepada bisnes', 'Kenapa masalah ini patut diberi perhatian?');
  text(P.impact);
  text(P.impactPrompt, { size: 9, color: C.muted });

  section('04 · Kira / semak impak', P.calculatorTitle);
  text(P.calculatorIntro, { size: 9, color: C.muted, gap: 6 });
  for (const f of P.fields) text(`${f.label}: ${inputs[f.id]}`, { size: 9.5, gap: 2 });
  doc.y += 4;
  box(`${result.lines.join('\n')}\n${result.note}`, { fill: C.soft, color: C.green, font: 'Bold', size: 10 });
  text(CALC_NOTE, { size: 8, color: C.muted });

  section('05 · Quick Fix workshop', P.exerciseTitle);
  text(P.exerciseBrief, { gap: 6 });
  box(P.exercisePrompt, { bar: C.green, size: 9.5 });
  field('Hasil latihan anda', clean(workOutput));

  section('06 · Pelan tindakan 7 hari', 'Jangan berhenti setakat faham. Uji dalam bisnes.');
  field('Apa tindakan yang akan dibuat?', clean(plan.action));
  field('Apa ukuran kejayaan?', clean(plan.measure));
  field('Bila anda akan mula?', plan.startDate ? dateMY(new Date(`${plan.startDate}T00:00:00+08:00`)) : '');
  field('Bukti apa yang akan disemak selepas 7 hari?', clean(plan.proof));

  section('07 · Reflection', 'Di mana execution gap anda?');
  text(P.reflection, { gap: 6 });
  field('Apa yang sudah anda dapat hari ini', P.takeaway);
  field('Apa yang masih perlu dikuasai', P.gap);
  box(CLOSING.text, { title: CLOSING.title, fill: C.warm, border: C.warmLine, size: 9.5 });

  doc.y += 4;
  text(REPORT_NOTE, { size: 8, color: C.muted });
  doc.end();
  return finished;
}

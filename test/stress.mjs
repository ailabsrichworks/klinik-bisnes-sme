// Stress test: N diagnoses fired at the same time through the public (anonymous) flow.
// Measures wall-clock per request; exact token usage comes from the Sheet's "Log AI" tab
// when Google is configured (otherwise timings only).
//   node --env-file=.env test/stress.mjs [--json out.json]
// Costs real money (~10 Claude calls). Test journeys are deleted afterwards.
import { readFileSync, writeFileSync } from 'node:fs';
import { googleClients } from '../server/store.mjs';

const BASE = process.env.PUBLIC_URL || 'http://localhost:3000';
const FIX = new URL('./fixtures/', import.meta.url);
// Claude Sonnet 5.5, USD per million tokens (thinking is billed as output). Update if pricing changes.
const PRICE = { 'claude-sonnet-5-5': { in: 2, out: 10 }, 'claude-opus-5-5': { in: 4, out: 20 } };
const USD_TO_MYR = Number(process.env.USD_TO_MYR || 4.7);

const owner = { businessActive: 'yes', ownerAuthority: 'yes', revenue: 'RM3,000 – bawah RM10,000' };
const CASES = [
  { name: 'Kos: tudung, fee tak tahu', body: { business: { ...owner, business: 'Ain Tudung', product: 'Tudung bawal', channel: 'Shopee / Marketplace' }, pain: 'cost', costs: { sellingPrice: '25', materialCost: '12' }, evidence_text: 'Supplier RM12 sehelai, fee Shopee tak pasti.' } },
  { name: 'Kos: kek, banyak kos', body: { business: { ...owner, business: 'Kek Mak Long', product: 'Kek pisang loaf', channel: 'WhatsApp' }, pain: 'cost', costs: { sellingPrice: '35', materialCost: '11.5', packagingCost: '2.2', deliveryCost: '6' } } },
  { name: 'Kos: PDF kos', file: ['cost-sheet.pdf', 'application/pdf'], body: { business: { ...owner, business: 'Kek Mak Long', product: 'Kek pisang loaf', channel: 'Shopee / Marketplace' }, pain: 'cost', costs: {} } },
  { name: 'Content: tiada rutin', body: { business: { ...owner, business: 'Kuih Siti', product: 'Kuih lapis', channel: 'Facebook / Instagram' }, pain: 'content', content: { postsWeek: '1', hoursWeek: '6', hasContentPlan: 'no', tracksContent: 'no' } } },
  { name: 'Content: rutin ada, sales rendah', body: { business: { ...owner, business: 'Batik Kamal', product: 'Kemeja batik', channel: 'Facebook / Instagram' }, pain: 'content', content: { postsWeek: '5', hoursWeek: '4', hasContentPlan: 'yes', tracksContent: 'yes' }, evidence_text: 'Post 5 kali seminggu ikut jadual, semak insight, tapi sales masih rendah.' } },
  { name: 'Content: caption panjang', body: { business: { ...owner, business: 'Madu Hutan Pak Abu', product: 'Madu tualang 500g', channel: 'TikTok / LIVE' }, pain: 'content', content: { postsWeek: '3', hoursWeek: '8', hasContentPlan: 'no', tracksContent: 'no' }, evidence_text: 'Caption TikTok minggu lepas: "Madu tualang asli dari hutan Pahang! Sesuai untuk seisi keluarga, tingkatkan tenaga, bagus untuk kesihatan. Stok terhad! Order sekarang di beg kuning. Free postage Semenanjung untuk 3 botol ke atas. Tag kawan yang perlukan madu asli!" Dapat 2,100 views, 45 likes, 3 komen tanya harga, 0 order.' } },
  { name: 'LIVE: 12 claim, 8 bayar', body: { business: { ...owner, business: 'Butik Ain', product: 'Baju kurung moden', channel: 'TikTok / LIVE' }, pain: 'live', live: { liveExperience: 'yes', liveViewers: '180', liveClaims: '12', livePaid: '8', invoiceTiming: 'next_day' }, evidence_text: 'LIVE Sabtu lepas, cutoff 48 jam.' } },
  { name: 'LIVE: belum pernah LIVE', body: { business: { ...owner, business: 'Kerepek Zah', product: 'Kerepek pisang', channel: 'WhatsApp' }, pain: 'live', live: { liveExperience: 'no' }, evidence_text: 'Macam mana nak mula LIVE jual kerepek?' } },
  { name: 'Screenshot WhatsApp', file: ['whatsapp-chat.png', 'image/png'], body: { business: { ...owner, business: 'Kek Mak Long', product: 'Kek pisang loaf', channel: 'WhatsApp' }, pain: 'unknown' } },
  { name: 'Belum pasti, teks bebas', body: { business: { business: 'Servis Cuci Aircond Ali', product: 'Cuci aircond rumah', channel: 'Referral', revenue: 'RM10,000 – bawah RM30,000', businessActive: 'yes', ownerAuthority: 'yes' }, pain: 'unknown', evidence_text: 'Bulan ni customer kurang. Dulu ramai repeat, sekarang senyap. Harga saya RM80 satu unit, kawan-kawan lain caj RM70. Saya tak pasti sebab apa.' } },
];

const { noticeVersion } = await fetch(BASE + '/api/config').then((r) => r.json());
const call = (path, key, init = {}) => fetch(BASE + path, { ...init, headers: { origin: BASE, 'x-journey-id': key.id, 'x-journey-token': key.token, ...init.headers } });

async function runCase(c, i) {
  const start = await fetch(BASE + '/api/journey', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ acceptNotice: noticeVersion }) });
  if (!start.ok) throw new Error(`journey HTTP ${start.status}`);
  const key = await start.json();
  if (c.file) {
    const up = await call('/api/upload', key, { method: 'POST', headers: { 'x-file-name': c.file[0] }, body: readFileSync(new URL(c.file[0], FIX)) });
    if (!up.ok) throw new Error(`upload HTTP ${up.status}`);
  }
  const t0 = performance.now();
  const res = await call('/api/diagnose', key, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...c.body, use_file: !!c.file }) });
  const ms = performance.now() - t0;
  const out = await res.json();
  return { i: i + 1, name: c.name, key, status: res.status, seconds: ms / 1000, pathway: out.pathway, tasksSource: out.tasksSource, error: out.error };
}

const wall0 = performance.now();
const results = await Promise.all(CASES.map((c, i) => runCase(c, i).catch((e) => ({ i: i + 1, name: c.name, status: 0, error: e.message }))));
const wall = (performance.now() - wall0) / 1000;

// Exact usage per call from the Sheet's "Log AI" tab (the server writes it every few seconds).
const { GOOGLE_SERVICE_ACCOUNT_JSON: sa, SHEET_ID: sheetId } = process.env;
if (sa && sheetId) {
  await new Promise((r) => setTimeout(r, 8000));
  const { sheets } = await googleClients(sa);
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: "'Log AI'!A1:F", valueRenderOption: 'UNFORMATTED_VALUE' });
  const [head, ...rows] = data.values || [[]];
  const calls = rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  for (const r of results) {
    const c = calls.findLast((x) => x.journey_id === r.key?.id);
    if (!c) continue;
    const p = PRICE[c.model] || PRICE['claude-sonnet-5-5'];
    Object.assign(r, { model: c.model, callStatus: c.status, input: Number(c.input_tokens), output: Number(c.output_tokens), usd: (c.input_tokens * p.in + c.output_tokens * p.out) / 1e6 });
  }
} else {
  console.log('Google not configured: token counts and cost are not available (timings only).');
}

for (const r of results) if (r.key) await call('/api/me', r.key, { method: 'DELETE' });

const ok = results.filter((r) => r.status === 200);
const sum = (k) => ok.reduce((a, r) => a + (r[k] || 0), 0);
const secs = ok.map((r) => r.seconds).sort((a, b) => a - b);
const summary = {
  requests: results.length, succeeded: ok.length, wallSeconds: wall,
  latency: { min: secs[0], median: secs[Math.floor(secs.length / 2)], max: secs.at(-1), mean: sum('seconds') / ok.length },
  tokens: { input: sum('input'), output: sum('output') },
  usd: sum('usd'), myr: sum('usd') * USD_TO_MYR, usdPerReport: sum('usd') / ok.length, usdToMyr: USD_TO_MYR,
};
console.table(results.map((r) => ({ '#': r.i, case: r.name, http: r.status, sec: r.seconds?.toFixed(1), pathway: r.pathway, tasks: r.tasksSource, in: r.input, out: r.output, usd: r.usd?.toFixed(4), err: r.error })));
console.log(JSON.stringify(summary, null, 2));
const jsonOut = process.argv.indexOf('--json');
if (jsonOut > 0) writeFileSync(process.argv[jsonOut + 1], JSON.stringify({ results: results.map(({ key, ...r }) => r), summary }, null, 2));

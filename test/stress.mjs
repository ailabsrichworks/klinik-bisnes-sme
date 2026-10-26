// Stress test: N diagnoses fired at the same time through the public (anonymous) flow.
// Measures wall-clock per request and reads exact token usage from ai_calls.
//   node --env-file=.env test/stress.mjs [--json out.json]
// Costs real money (~10 Claude calls). Test users are deleted afterwards.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.PUBLIC_URL || 'http://localhost:3000';
const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: service } = process.env;
const admin = createClient(url, service, { auth: { persistSession: false } });
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

async function anonymousUser() {
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  const { data: j, error: jErr } = await sb.from('journeys').insert({ user_id: data.user.id, state: {} }).select('id').single();
  if (jErr) throw jErr;
  return { sb, uid: data.user.id, token: data.session.access_token, journeyId: j.id };
}

async function runCase(c, i) {
  const u = await anonymousUser();
  let evidence_file_id = null;
  if (c.file) {
    const bytes = readFileSync(new URL(c.file[0], FIX));
    const path = `${u.uid}/${randomUUID()}.${c.file[0].split('.').pop()}`;
    const up = await u.sb.storage.from('evidence').upload(path, bytes, { contentType: c.file[1] });
    if (up.error) throw up.error;
    const { data } = await u.sb.from('evidence_files').insert({ user_id: u.uid, journey_id: u.journeyId, storage_path: path, file_name: c.file[0], mime_type: c.file[1], size_bytes: bytes.length }).select('id').single();
    evidence_file_id = data.id;
  }
  const t0 = performance.now();
  const res = await fetch(BASE + '/api/diagnose', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${u.token}`, origin: BASE }, body: JSON.stringify({ ...c.body, evidence_file_id }) });
  const ms = performance.now() - t0;
  const out = await res.json();
  return { i: i + 1, name: c.name, uid: u.uid, status: res.status, seconds: ms / 1000, pathway: out.pathway, tasksSource: out.tasksSource, error: out.error };
}

const wall0 = performance.now();
const results = await Promise.all(CASES.map((c, i) => runCase(c, i).catch((e) => ({ i: i + 1, name: c.name, status: 0, error: e.message }))));
const wall = (performance.now() - wall0) / 1000;

// Exact usage per call from the server's log
const uids = results.map((r) => r.uid).filter(Boolean);
const { data: calls } = await admin.from('ai_calls').select('user_id, model, status, input_tokens, output_tokens').in('user_id', uids);
for (const r of results) {
  const c = calls?.find((x) => x.user_id === r.uid);
  if (!c) continue;
  const p = PRICE[c.model] || PRICE['claude-sonnet-5-5'];
  Object.assign(r, { model: c.model, callStatus: c.status, input: c.input_tokens, output: c.output_tokens, usd: (c.input_tokens * p.in + c.output_tokens * p.out) / 1e6 });
}

for (const id of uids) {
  const { data: f } = await admin.storage.from('evidence').list(id);
  if (f?.length) await admin.storage.from('evidence').remove(f.map((x) => `${id}/${x.name}`));
  await admin.auth.admin.deleteUser(id);
}

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
if (jsonOut > 0) writeFileSync(process.argv[jsonOut + 1], JSON.stringify({ results: results.map(({ uid, ...r }) => r), summary }, null, 2));

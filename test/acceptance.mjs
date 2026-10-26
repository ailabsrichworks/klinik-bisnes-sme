// Spec v3 §7 acceptance tests against the REAL AI backend (costs ~11 Claude calls).
// Needs the dev server on PUBLIC_URL and .env loaded:  node --env-file=.env test/acceptance.mjs [T01 T05 ...]
// Each test uses a throwaway @example.com user (created via the admin API, no email sent), deleted afterwards.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { programmeFit } from '../public/js/rules.mjs';

const BASE = process.env.PUBLIC_URL || 'http://localhost:3000';
const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service, NOTICE_VERSION } = process.env;
const admin = createClient(url, service, { auth: { persistSession: false } });
const FIXTURES = new URL('./fixtures/', import.meta.url);

const owner = { business: 'Kek Pisang Mak Long', product: 'Kek pisang loaf', channel: 'Shopee / Marketplace', revenue: 'RM3,000 – bawah RM10,000', businessActive: 'yes', ownerAuthority: 'yes' };
const PROGRAMME_WORDS = /RM\s?198|Kira Cost|Content Sebulan|Live Laris|kelas berbayar|kelas.{0,40}\bjam\b|\bjam\b.{0,40}kelas/i;
const text = (r) => [r.title, r.reason, ...(r.observations || []), ...(r.unknowns || []), r.quickFix].join('\n');

const TESTS = [
  { id: 'T01', input: { business: { ...owner, product: 'Tudung bawal' }, pain: 'cost', costs: { sellingPrice: '25', materialCost: '12' }, evidence_text: 'Kos supplier RM12 sehelai. Fee platform Shopee saya tak pasti berapa.' },
    expect: (r) => [r.pathway === 'cost', /RM\s?13(\.00)?\b/.test(text(r)), /platform|fee|komisen/i.test(text(r))], fit: 'ready' },
  { id: 'T02', input: { business: owner, pain: 'cost', costs: { sellingPrice: '25', materialCost: '10', packagingCost: '2' } },
    expect: (r) => [r.pathway === 'cost', /RM\s?13(\.00)?\b/.test(text(r)), !/(?<!bukan\s)(?<!BUKAN\s)\b(net profit|untung bersih)\b(?!\s*\))/i.test(r.title + r.reason)] },
  { id: 'T03', input: { business: owner, pain: 'content', content: { postsWeek: '1', hoursWeek: '6', hasContentPlan: 'no', tracksContent: 'no' } },
    expect: (r) => [r.pathway === 'content', !/30\s?hari|sebulan|kalendar 30/i.test(r.quickFix)], fit: 'ready' },
  { id: 'T04', input: { business: owner, pain: 'content', content: { postsWeek: '5', hoursWeek: '4', hasContentPlan: 'yes', tracksContent: 'yes' }, evidence_text: 'Saya post 5 kali seminggu ikut jadual dan semak insight, tapi sales masih rendah.' },
    expect: (r) => [['content', 'missing'].includes(r.pathway)], review: 'no blanket claim that content cadence caused low sales' },
  { id: 'T05', input: { business: { ...owner, channel: 'TikTok / LIVE' }, pain: 'live', live: { liveExperience: 'yes', liveViewers: '180', liveClaims: '12', livePaid: '8', invoiceTiming: 'next_day' }, evidence_text: 'LIVE TikTok Sabtu lepas. 12 claim, 8 bayar (cutoff sama, 48 jam).' },
    expect: (r) => [r.pathway === 'live', /33[.,]3/.test(text(r)), /\b4\b/.test(text(r))], review: 'no assertion that invoice delay caused the gap', fit: 'ready' },
  { id: 'T06', input: { business: owner, pain: 'live', live: { liveExperience: 'no' }, evidence_text: 'Saya belum pernah LIVE. Macam mana nak mula LIVE jual kek?' },
    expect: (r) => [r.pathway === 'missing'], fitPath: 'live' },
  { id: 'T07', input: { business: { ...owner, channel: 'WhatsApp' }, pain: 'live', live: {}, evidence_text: '' }, file: ['whatsapp-chat.png', 'image/png'],
    expect: (r) => [r.pathway !== 'live'] },
  { id: 'T08', input: { business: owner, pain: 'live', live: { liveExperience: 'yes', liveClaims: '8', livePaid: '12' } },
    expect: (r) => [r.pathway === 'missing', !/-\s?\d+(\.\d+)?\s?%/.test(text(r))] },
  { id: 'T09', input: { business: owner, pain: 'unknown', evidence_text: '' }, file: ['whatsapp-chat.png', 'image/png'],
    expect: (r) => [!!r.pathway && r.observations.length > 0], review: 'observations only from what is visible; AI mode reads the image (offline-demo wording checked in the UI)' },
  { id: 'T10', input: { business: owner, pain: 'cost', evidence_text: '', costs: {} }, status: 422 },
  { id: 'T11', input: { business: { ...owner, revenue: 'RM30,000 ke atas' }, pain: 'content', content: { postsWeek: '1', hoursWeek: '8', hasContentPlan: 'no', tracksContent: 'no' } },
    expect: (r) => [r.pathway === 'content'], fit: 'withheld' },
  { id: 'T12', input: { business: owner, pain: 'content', content: { postsWeek: '0', hoursWeek: '5', hasContentPlan: 'no', tracksContent: 'no' }, evidence_text: 'Minggu lepas tak sempat post langsung, buat content ambil masa lama.' },
    expect: (r) => [r.pathway === 'content'], fit: 'ready', review: 'marketing opted out → no outreach; tracker continues' },
];

async function withUser(fn) {
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const email = `kbsme-accept-${randomUUID().slice(0, 8)}@example.com`;
  const { error: cuErr } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (cuErr) throw cuErr;
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const { data: sess, error } = await sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (error) throw error;
  const uid = sess.user.id, token = sess.session.access_token;
  try { return await fn({ sb, uid, token }); }
  finally {
    // The app's own delete path first; the per-IP limit (5/min) can refuse it, so fall back to the admin API.
    const res = await fetch(BASE + '/api/me', { method: 'DELETE', headers: { authorization: `Bearer ${token}`, origin: BASE } });
    if (!res.ok) {
      const { data: files } = await admin.storage.from('evidence').list(uid);
      if (files?.length) await admin.storage.from('evidence').remove(files.map((f) => `${uid}/${f.name}`));
      await admin.auth.admin.deleteUser(uid);
    }
  }
}

async function run(t) {
  return withUser(async ({ sb, uid, token }) => {
    let evidence_file_id = null;
    if (t.file) {
      const { data: j } = await sb.from('journeys').insert({ user_id: uid, state: {} }).select('id').single();
      const bytes = readFileSync(new URL(t.file[0], FIXTURES));
      const path = `${uid}/${randomUUID()}.${t.file[0].split('.').pop()}`;
      await sb.storage.from('evidence').upload(path, bytes, { contentType: t.file[1] });
      const { data } = await sb.from('evidence_files').insert({ user_id: uid, journey_id: j.id, storage_path: path, file_name: t.file[0], mime_type: t.file[1], size_bytes: bytes.length }).select('id').single();
      evidence_file_id = data.id;
    }
    const res = await fetch(BASE + '/api/diagnose', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, origin: BASE }, body: JSON.stringify({ ...t.input, evidence_file_id }) });
    const body = await res.json();
    if (t.status) return { checks: [res.status === t.status], body, httpStatus: res.status };
    if (!res.ok) return { checks: [false], body, httpStatus: res.status };
    const checks = [...t.expect(body), !PROGRAMME_WORDS.test(text(body))];
    if (t.fit || t.fitPath) {
      const p = t.fitPath || body.pathway;
      const fit = programmeFit({ profile: t.input.business, live: t.input.live || {}, pathway: p, diagnosedPathway: t.fitPath ? body.pathway : p });
      checks.push(t.fit ? fit.status === t.fit : fit.status !== 'ready');
    }
    return { checks, body, httpStatus: res.status };
  });
}

const only = process.argv.slice(2);
const results = [];
for (const t of TESTS.filter((x) => !only.length || only.includes(x.id))) {
  const t0 = Date.now();
  const r = await run(t).catch((e) => ({ checks: [false], body: { error: e.message } }));
  const pass = r.checks.every(Boolean);
  results.push({ id: t.id, pass });
  console.log(`\n${pass ? 'PASS' : 'FAIL'} ${t.id} · HTTP ${r.httpStatus} · ${((Date.now() - t0) / 1000).toFixed(1)}s · checks ${r.checks.map((c) => (c ? '✓' : '✗')).join('')}${t.review ? `\n  review: ${t.review}` : ''}`);
  console.log(JSON.stringify(r.body, null, 2).split('\n').map((l) => '  ' + l).join('\n'));
}
console.log('\nSUMMARY', results.map((r) => `${r.id}:${r.pass ? 'pass' : 'FAIL'}`).join(' '));
process.exitCode = results.every((r) => r.pass) ? 0 : 1;

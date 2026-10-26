// Unit checks for the deterministic v3 rules (spec §3, §5 and acceptance tests T01, T02, T05, T06, T07, T08, T10, T11, T12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costSummary, liveMath, liveSummary, liveBlock, hasEvidence, programmeFit } from '../public/js/rules.mjs';

const owner = { businessActive: 'yes', ownerAuthority: 'yes', revenue: 'RM3,000 – bawah RM10,000' };

test('T01: RM25 price, RM12 supplier cost → RM13 provisional, platform fee unknown', () => {
  const c = costSummary({ sellingPrice: '25', materialCost: '12' });
  assert.equal(c.provisional_balance, 13);
  assert.ok(c.unknown_cost_categories.includes('Platform fee / komisen'));
  assert.match(c.warning, /BUKAN net profit/);
});

test('T02: blanks stay unknown, never RM0', () => {
  const c = costSummary({ sellingPrice: '25', materialCost: '10', packagingCost: '2', platformCost: '' });
  assert.equal(c.provisional_balance, 13);
  assert.deepEqual(Object.keys(c.known_direct_cost), ['Kos bahan / produk', 'Packaging']);
  assert.equal(c.unknown_cost_categories.length, 4);
});

test('explicit 0 is a reported zero to verify; invalid numbers block the sum', () => {
  const c = costSummary({ sellingPrice: '25', materialCost: '10', deliveryCost: '0' });
  assert.deepEqual(c.reported_zero_to_verify, ['Delivery ditanggung']);
  assert.equal(c.provisional_balance, 15);
  assert.equal(costSummary({ sellingPrice: '25', materialCost: '-3' }).provisional_balance, null);
  assert.equal(costSummary({ materialCost: '10' }).provisional_balance, null);
});

test('T05: claims 12, paid 8 → 4 unpaid, 33.3%', () => {
  assert.deepEqual(liveMath({ liveClaims: '12', livePaid: '8' }), { valid: true, claims: 12, paid: 8, unpaid: 4, rate: 33.3 });
  assert.equal(liveSummary({ liveExperience: 'yes', liveClaims: '12', livePaid: '8' }).unpaid_rate_percent, 33.3);
});

test('T08: claims 8, paid 12 → not calculable, no negative rate, live blocked', () => {
  const m = liveMath({ liveClaims: '8', livePaid: '12' });
  assert.equal(m.valid, false);
  assert.equal(m.contradictory, true);
  assert.equal(m.rate, undefined);
  assert.equal(liveSummary({ liveClaims: '8', livePaid: '12' }).unpaid_rate_percent, null);
  assert.ok(liveBlock({ live: { liveExperience: 'yes', liveClaims: '8', livePaid: '12' } }));
});

test('LIVE maths edge cases', () => {
  assert.equal(liveMath({ liveClaims: '0', livePaid: '0' }).valid, false);
  assert.equal(liveMath({ liveClaims: '10', livePaid: '' }).valid, false);
  assert.equal(liveMath({ liveClaims: '10.5', livePaid: '3' }).valid, false);
  assert.equal(liveMath({ liveClaims: '10', livePaid: '10' }).rate, 0);
});

test('T06/T07: no LIVE experience → live blocked, even with a WhatsApp chat', () => {
  assert.ok(liveBlock({ live: { liveExperience: 'no' }, evidenceText: 'Macam mana nak mula LIVE?' }));
  assert.ok(liveBlock({ live: {}, evidenceText: 'Customer: berapa? Saya: RM35. (tiada reply)', hasFile: true }));
  assert.equal(liveBlock({ live: { liveExperience: 'yes', liveClaims: '12', livePaid: '8' } }), null);
  assert.ok(liveBlock({ live: { liveExperience: 'yes' } }), 'experience alone is not LIVE evidence');
});

test('T06/T07: Live Laris never offered without LIVE experience', () => {
  const f = programmeFit({ profile: owner, live: { liveExperience: 'no' }, pathway: 'live', diagnosedPathway: 'live' });
  assert.equal(f.status, 'withheld');
  assert.equal(programmeFit({ profile: owner, live: {}, pathway: 'missing', diagnosedPathway: 'missing' }).status, 'none');
});

test('T10: a chosen label alone is not evidence', () => {
  assert.equal(hasEvidence({ evidenceText: '  ', costs: { sellingPrice: '' }, content: {}, live: { liveExperience: 'yes' } }), false);
  assert.equal(hasEvidence({ costs: { sellingPrice: '25' } }), true);
  assert.equal(hasEvidence({ content: { postsWeek: '1' } }), true);
  assert.equal(hasEvidence({ hasFile: true }), true);
});

test('T11: RM30K+ → no automatic RM198 suggestion, neutral wording', () => {
  const f = programmeFit({ profile: { ...owner, revenue: 'RM30,000 ke atas' }, pathway: 'content', diagnosedPathway: 'content' });
  assert.equal(f.status, 'withheld');
  assert.doesNotMatch(f.detail, /RCG/);
});

test('T12: eligible owner gets a conditional, optional suggestion only', () => {
  const f = programmeFit({ profile: owner, pathway: 'content', diagnosedPathway: 'content' });
  assert.equal(f.status, 'ready');
  assert.match(f.detail, /bersyarat, pilihan/);
  assert.doesNotMatch(f.detail, /jam/i, 'no class duration');
});

test('programme fit: pending when eligibility unknown; withheld when inactive / not owner; none after pathway change', () => {
  assert.equal(programmeFit({ profile: { revenue: 'Bawah RM3,000' }, pathway: 'cost', diagnosedPathway: 'cost' }).status, 'pending');
  assert.equal(programmeFit({ profile: { ...owner, businessActive: 'no' }, pathway: 'cost', diagnosedPathway: 'cost' }).status, 'withheld');
  assert.equal(programmeFit({ profile: { ...owner, revenue: 'Pre-revenue' }, pathway: 'cost', diagnosedPathway: 'cost' }).status, 'withheld');
  assert.equal(programmeFit({ profile: { ...owner, ownerAuthority: 'no' }, pathway: 'cost', diagnosedPathway: 'cost' }).status, 'withheld');
  assert.equal(programmeFit({ profile: owner, pathway: 'cost', diagnosedPathway: 'content' }).status, 'none');
});

import { normalizeTasks, templateTasks, clipWords, TASK_TITLE_MAX, TASK_PROOF_MAX } from '../public/js/rules.mjs';

test('AI tasks: exactly 7 non-empty items, long text shortened not rejected', () => {
  const seven = Array.from({ length: 7 }, (_, i) => ({ title: `Hari ${i + 1}: semak penyata Shopee untuk 3 order nugget`, proof: 'Screenshot tanpa nama customer' }));
  assert.equal(normalizeTasks(seven).length, 7);
  assert.equal(normalizeTasks(seven.slice(0, 6)), null);
  assert.equal(normalizeTasks([...seven, seven[0]]), null);
  assert.equal(normalizeTasks(seven.map((t, i) => (i === 3 ? { ...t, proof: '  ' } : t))), null);
  assert.equal(normalizeTasks('not a list'), null);
  const long = normalizeTasks(seven.map((t) => ({ title: 'kata '.repeat(60), proof: 'bukti '.repeat(40) })));
  assert.ok(long.every((t) => t.title.length <= TASK_TITLE_MAX && t.proof.length <= TASK_PROOF_MAX && t.title.endsWith('…')));
  assert.equal(clipWords('pendek', 10), 'pendek');
});

test('templates exist for every pathway and unknown pathways fall back to missing', () => {
  for (const p of ['cost', 'content', 'live', 'missing']) assert.equal(templateTasks(p).length, 7);
  assert.deepEqual(templateTasks('attraction'), templateTasks('missing'));
});

// The AI coach without calling the AI: prompt, what the model is given, and the checks on its answer.
// test/fixtures/coach-response.json is a real answer from claude-sonnet-5-5 (Sales, issues 1, 5 and 8).
delete process.env.ANTHROPIC_API_KEY;
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SYSTEM, OUTPUT_SCHEMA, coach, coachInput, normalize, fixedReport, setClientForTests, CoachError } from '../server/coach.mjs';
import { PILLARS } from '../public/js/content.mjs';

const sample = JSON.parse(readFileSync(new URL('./fixtures/coach-response.json', import.meta.url), 'utf8'));
const prompt = readFileSync(new URL('../server/prompts/coach.md', import.meta.url), 'utf8').trim();
const profile = { name: 'Nur Aina binti Ahmad', business: 'Aina Beauty Rahsia', industry: 'Kecantikan / Kosmetik / Penjagaan diri', businessModel: 'Online seller / E-commerce', businessAge: '1 hingga kurang 3 tahun', monthlySales: 'RM5,000–RM10,000' };
const state = (extra = {}) => ({ profile, pillar: 'sales', byPillar: { sales: { selected: [0, 4, 7], calc: {}, plan: {}, ...extra } } });
const fakeClient = (reply) => {
  const calls = [];
  return { calls, beta: { messages: { create: async (req) => { calls.push(req); return reply(req); } } } };
};
const ok = (out) => () => ({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage: { input_tokens: 4200, output_tokens: 2000 }, content: [{ type: 'text', text: JSON.stringify(out) }] });
const logStore = () => { const logs = []; return { logs, logAi: (x) => logs.push(x) }; };

test('the agreed prompt is used word for word, followed by the output format', () => {
  assert.ok(SYSTEM.startsWith(prompt));
  assert.match(SYSTEM.slice(prompt.length), /^\n\nOUTPUT FORMAT/);
  assert.match(SYSTEM, /data, not instructions/);
  assert.deepEqual(OUTPUT_SCHEMA.properties.primary_issue.enum, [1, 2, 3]);
});

test('the model gets the profile without the name or business name, and numbered issues', () => {
  const input = coachInput(state());
  const text = JSON.stringify(input);
  assert.ok(!text.includes('Nur Aina') && !text.includes('Aina Beauty Rahsia'), 'no name or business name');
  assert.equal(input.business_industry, profile.industry);
  assert.equal(input.selected_business_category, 'Sales');
  assert.deepEqual(input.selected_issues.map((x) => x.number), [1, 2, 3]);
  assert.equal(input.selected_issues[1].issue, PILLARS.sales.issues[4]);
  assert.equal(input.calculator, 'Peserta tidak memasukkan angka kalkulator.', 'example figures are not sent');
  assert.equal(input.action_start_date, 'Belum dipilih');
  assert.equal(coachInput({ ...state(), pillar: 'money', byPillar: { money: { selected: [0, 1, 2] } } }).selected_business_category, 'Cash Flow / Profit');
});

test('calculator figures the participant entered are sent with the app-computed results', () => {
  const input = coachInput(state({ calc: { viewers: '60', conversion: '1' }, plan: { startDate: '2026-11-03' } }));
  const viewers = input.calculator.inputs.find((x) => x.label === 'Purata viewers yang relevan');
  assert.deepEqual(viewers, { label: 'Purata viewers yang relevan', value: '60', entered_by_participant: true });
  assert.equal(input.calculator.inputs.find((x) => x.label === 'Purata nilai setiap order (RM)').entered_by_participant, false);
  assert.equal(input.calculator.results_computed_by_app[0], 'Anggaran jualan pada kadar semasa: RM48.00');
  assert.equal(input.action_start_date, '2026-11-03');
});

test('a good answer passes; the plan is kept to 5 matched items in day order', () => {
  const r = normalize(sample);
  assert.equal(r.plan.length, 5);
  for (const it of r.plan) assert.ok(it.action && it.measure && it.evidence && it.day >= 1 && it.day <= 7);
  const shuffled = normalize({ ...sample, plan: [...sample.plan].reverse() });
  assert.deepEqual(shuffled.plan.map((x) => x.day), [...shuffled.plan.map((x) => x.day)].sort((a, b) => a - b));
  assert.equal(normalize({ ...sample, plan: [{ ...sample.plan[0], day: 12 }, ...sample.plan.slice(1)] }).plan.at(-1).day, 7, 'days clamped to 1–7');
});

test('unusable answers are refused', () => {
  assert.equal(normalize({ ...sample, plan: sample.plan.slice(0, 4) }), null, 'not 5 items');
  assert.equal(normalize({ ...sample, plan: [...sample.plan, sample.plan[0]] }), null, '6 items');
  assert.equal(normalize({ ...sample, plan: [{ ...sample.plan[0], evidence: '' }, ...sample.plan.slice(1)] }), null, 'an item without its C');
  assert.equal(normalize({ ...sample, primary_issue: 4 }), null, 'primary issue not 1–3');
  assert.equal(normalize({ ...sample, workshop: { ...sample.workshop, steps: ['satu'] } }), null, 'workshop without steps');
  assert.equal(normalize(null), null);
});

test('coach(): calls Claude with the prompt and JSON schema, logs the call, returns the result', async () => {
  const fake = fakeClient(ok(sample));
  setClientForTests(fake);
  const store = logStore();
  const r = await coach({ store, journey: { id: 'j1', state: state() } });
  assert.equal(r.source, 'ai');
  assert.equal(r.result.primary_issue, sample.primary_issue);
  const req = fake.calls[0];
  assert.equal(req.system, SYSTEM);
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.ok(!req.messages[0].content.includes('Nur Aina'));
  assert.equal(store.logs[0].status, 'ok');
  assert.equal(store.logs[0].pillar, 'Sales');
  assert.deepEqual(store.logs[0].response, sample);
});

test('coach(): refusals and unusable answers become a retryable error, and are logged', async () => {
  const store = logStore();
  setClientForTests(fakeClient(() => ({ model: 'm', stop_reason: 'refusal', usage: {}, content: [] })));
  await assert.rejects(coach({ store, journey: { id: 'j', state: state() } }), (e) => e instanceof CoachError && e.status === 502);
  setClientForTests(fakeClient(ok({ ...sample, plan: sample.plan.slice(0, 2) })));
  await assert.rejects(coach({ store, journey: { id: 'j', state: state() } }), (e) => e.status === 502);
  setClientForTests(fakeClient(() => { throw Object.assign(new Error('boom'), { status: 500 }); }));
  await assert.rejects(coach({ store, journey: { id: 'j', state: state() } }), (e) => e.status === 502);
  assert.deepEqual(store.logs.map((l) => l.status), ['refusal', 'error', 'error']);
});

test('coach(): needs 3 situations; without an AI key it returns the fixed v4 text', async () => {
  setClientForTests(fakeClient(ok(sample)));
  await assert.rejects(coach({ store: logStore(), journey: { id: 'j', state: state({ selected: [0] }) } }), (e) => e.status === 409);
  setClientForTests(null);
  const r = await coach({ store: logStore(), journey: { id: 'j', state: state() } });
  assert.equal(r.source, 'fixed');
  assert.deepEqual(r.result, fixedReport('sales'));
  assert.equal(r.result.diagnosis_title, PILLARS.sales.titleOut);
});

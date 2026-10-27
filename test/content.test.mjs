// The v4 content must match the prototype word for word, and the calculators its numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { INTAKE, PILLARS, PILLAR_KEYS, calculate, calcInputs, defaultPlan } from '../public/js/content.mjs';

const html = readFileSync(new URL('../original/v4/Business_Quick_Fix_Prototype.html', import.meta.url), 'utf8');
const proto = (() => {
  const js = html.slice(html.indexOf('const data = {'), html.indexOf('let current='));
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(js.replace('const data =', 'this.data =').replace('const workshopData=', 'this.workshopData='), ctx);
  return ctx;
})();

test('every pillar text is exactly the prototype text', () => {
  assert.deepEqual(PILLAR_KEYS, ['sales', 'marketing', 'money']);
  for (const k of PILLAR_KEYS) {
    for (const [field, value] of Object.entries({ ...proto.data[k], ...proto.workshopData[k] })) {
      if (field === 'fields' && k !== 'money') continue; // agreed changes: Sales in buyer counts, Marketing in minutes
      assert.deepEqual(PILLARS[k][field], JSON.parse(JSON.stringify(value)), `${k}.${field}`); // plain copy: vm objects have another realm's prototypes
    }
    assert.equal(PILLARS[k].issues.length, 10);
  }
});

test('intake options are the prototype options', () => {
  for (const [key, id] of [['industry', 'industry'], ['businessModel', 'businessModel'], ['businessAge', 'businessAge'], ['monthlySales', 'monthlySales']]) {
    const select = new RegExp(`<select id="${id}"[^>]*>(.*?)</select>`).exec(html)[1];
    const options = [...select.matchAll(/<option>([^<]*)<\/option>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    assert.deepEqual(INTAKE[key], options, key);
  }
});

test('the Sales calculator asks for counts of people, never percentages', () => {
  const f = PILLARS.sales.fields;
  assert.deepEqual(f.map((x) => x.id), ['viewers', 'buyers', 'orderValue', 'targetBuyers']);
  assert.ok(f.every((x) => !/%/.test(x.label)), 'no % in the labels');
  assert.match(f[1].label, /\(orang\)$/);
  assert.match(f[3].label, /\(orang\)$/);
  const r = calculate('sales');
  assert.ok(![...r.lines, r.note].some((x) => /%/.test(x)), 'no % in the result');
  assert.match(calculate('sales', { buyers: '120' }).note, /Bilangan pembeli melebihi viewers/);
});

test('calculators give the prototype numbers on its default values', () => {
  const sales = calculate('sales');
  assert.equal(sales.numbers.now, 160);
  assert.equal(sales.numbers.scenario, 320);
  assert.equal(sales.lines[0], 'Anggaran jualan dengan 2 pembeli: RM160.00');
  assert.equal(sales.lines[1], 'Senario jika 4 pembeli: RM320.00');
  assert.match(sales.note, /bukan ramalan atau jaminan/);

  const mk = calculate('marketing');
  assert.equal(mk.numbers.current, 360);
  assert.equal(mk.numbers.planned, 300);
  assert.equal(mk.lines[0], 'Masa content semasa: 360 minit seminggu');
  assert.equal(mk.lines[1], 'Senario perancangan baharu: 300 minit seminggu');
  assert.equal(mk.note.slice(0, 22), 'Perbezaan masa: 60 min');
  assert.ok(PILLARS.marketing.fields.every((x) => !/jam/i.test(x.label)), 'no hours in the labels');

  const money = calculate('money');
  assert.equal(money.numbers.total, 25);
  assert.equal(money.numbers.balance, 25);
  assert.equal(money.lines[0], 'Jumlah kos yang disenaraikan: RM25.00 seunit');
  assert.equal(money.lines[1], 'Baki selepas kos yang disenaraikan: RM25.00 seunit');
  assert.match(money.note, /^Anggaran margin atas harga jualan: 50\.0%\. Belum tentu keuntungan bersih/);
});

test('calculators use saved values, and treat blanks and negatives as 0', () => {
  assert.equal(calculate('sales', { buyers: '3' }).numbers.now, 240);
  assert.equal(calculate('money', { sellingPrice: '' }).numbers.balance, -25);
  assert.equal(calculate('money', { sellingPrice: '0' }).note.slice(0, 41), 'Anggaran margin atas harga jualan: 0.0%. ');
  assert.equal(calculate('marketing', { minutesEach: '-3' }).numbers.current, 0);
  assert.equal(calcInputs('sales', { viewers: '50' }).buyers, '2');
  assert.equal(calculate('money', { sellingPrice: '10' }).lines[1], 'Baki selepas kos yang disenaraikan: -RM15.00 seunit');
});

test('the 7-day plan starts from the pillar defaults', () => {
  assert.deepEqual(defaultPlan('money'), { action: proto.workshopData.money.defaultAction, measure: proto.workshopData.money.defaultMeasure, startDate: '', proof: proto.workshopData.money.defaultProof });
});

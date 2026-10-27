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

test('calculators give the prototype numbers on its default values', () => {
  const sales = calculate('sales');
  assert.equal(sales.numbers.now, 160);
  assert.equal(sales.numbers.scenario, 320);
  assert.equal(sales.lines[0], 'Anggaran jualan pada kadar semasa: RM160.00');
  assert.equal(sales.lines[1], 'Senario jika kadar pembelian menjadi 4%: RM320.00');
  assert.match(sales.note, /bukan ramalan atau jaminan/);

  const mk = calculate('marketing');
  assert.equal(mk.numbers.current, 6);
  assert.equal(mk.numbers.planned, 5);
  assert.equal(mk.lines[0], 'Masa content semasa: 6 jam seminggu');
  assert.equal(mk.lines[1], 'Senario perancangan baharu: 5 jam seminggu');

  const money = calculate('money');
  assert.equal(money.numbers.total, 25);
  assert.equal(money.numbers.balance, 25);
  assert.equal(money.lines[0], 'Jumlah kos yang disenaraikan: RM25.00 seunit');
  assert.equal(money.lines[1], 'Baki selepas kos yang disenaraikan: RM25.00 seunit');
  assert.match(money.note, /^Anggaran margin atas harga jualan: 50\.0%\. Belum tentu keuntungan bersih/);
});

test('calculators use saved values, and treat blanks and negatives as 0', () => {
  assert.equal(calculate('sales', { viewers: '200' }).numbers.now, 320);
  assert.equal(calculate('money', { sellingPrice: '' }).numbers.balance, -25);
  assert.equal(calculate('money', { sellingPrice: '0' }).note.slice(0, 41), 'Anggaran margin atas harga jualan: 0.0%. ');
  assert.equal(calculate('marketing', { hoursEach: '-3' }).numbers.current, 0);
  assert.equal(calcInputs('sales', { viewers: '50' }).conversion, '2');
});

test('the 7-day plan starts from the pillar defaults', () => {
  assert.deepEqual(defaultPlan('money'), { action: proto.workshopData.money.defaultAction, measure: proto.workshopData.money.defaultMeasure, startDate: '', proof: proto.workshopData.money.defaultProof });
});

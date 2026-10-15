import assert from 'node:assert/strict';
import { calculateBudget } from './budget.mjs';

const example = {
  capacity: '100', attendance: 40, ticketPrice: '10.00',
  fixedCosts: 250, minimumFee: '93', sharePercent: 35,
};
assert.deepEqual(calculateBudget(example), {
  capacity: 100, attendance: 40, ticketPricePence: 1000,
  fixedCostsPence: 25000, minimumFeePence: 9300, shareBasisPoints: 3500,
  receiptsPence: 40000, licencePence: 14000, surplusPence: 1000,
  breakEvenTickets: 39, capacitySurplusPence: 40000, feasible: true, neededTickets: 0,
});
for (const [fixedCosts, attendance, expectedTickets, expectedSurplus] of [
  [250, 40, 39, 1000], [180, 30, 28, 1500], [700, 100, 108, -5000],
]) {
  const result = calculateBudget({ ...example, fixedCosts, attendance });
  assert.equal(result.breakEvenTickets, expectedTickets);
  assert.equal(result.surplusPence, expectedSurplus);
  assert.equal(result.feasible, expectedTickets <= result.capacity);
  assert.equal(result.neededTickets, Math.max(0, expectedTickets - attendance));
  // Check the first sufficient ticket count and its immediate predecessor.
  for (const count of [expectedTickets - 1, expectedTickets]) {
    const boundary = calculateBudget({ ...example, fixedCosts, capacity: 200, attendance: count });
    assert.equal(boundary.surplusPence >= 0, count === expectedTickets);
  }
}
const lowAttendance = calculateBudget({ ...example, attendance: 35 });
assert.equal(lowAttendance.licencePence, 12250);
assert.equal(lowAttendance.surplusPence, -2250);
assert.equal(lowAttendance.neededTickets, 4);

const free = calculateBudget({
  capacity: 1, attendance: 0, ticketPrice: '.01', fixedCosts: 0, minimumFee: 0, sharePercent: 0,
});
assert.equal(free.breakEvenTickets, 0);
assert.equal(free.surplusPence, 0);
assert.equal(free.capacitySurplusPence, 1);
const pennies = {
  capacity: 10000, attendance: 5000, ticketPrice: 0.01,
  fixedCosts: 0.01, minimumFee: 0, sharePercent: '99.99',
};
const halfPenny = calculateBudget(pennies);
assert.equal(halfPenny.licencePence, 5000);
assert.equal(halfPenny.surplusPence, -1);
assert.equal(halfPenny.breakEvenTickets, 5001);
assert.equal(halfPenny.neededTickets, 1);
assert.equal(calculateBudget({ ...pennies, attendance: 5001 }).surplusPence, 0);
assert.equal(calculateBudget({
  ...pennies, fixedCosts: 1000000, minimumFee: 1000000,
}).breakEvenTickets, 999999995001);
const maximum = calculateBudget({
  ...pennies, attendance: 10000, ticketPrice: 10000, fixedCosts: 1000000, minimumFee: 1000000,
});
assert.equal(maximum.receiptsPence, 10000000000);
assert.equal(maximum.surplusPence, -99000000);
assert.equal(maximum.breakEvenTickets, 1000000);

for (const [field, value] of [
  ['capacity', 0], ['capacity', 10001], ['capacity', 1.5], ['capacity', true],
  ['attendance', -1], ['attendance', 101], ['attendance', '1.5'],
  ['ticketPrice', 0], ['ticketPrice', 10000.01], ['ticketPrice', '1.001'],
  ['ticketPrice', ''], ['ticketPrice', Infinity], ['ticketPrice', NaN],
  ['fixedCosts', -0.01], ['fixedCosts', 1000000.01], ['fixedCosts', null],
  ['minimumFee', -1], ['minimumFee', '£93'], ['minimumFee', 1000000.01],
  ['sharePercent', -1], ['sharePercent', 100], ['sharePercent', 99.999],
]) {
  assert.throws(() => calculateBudget({ ...example, [field]: value }), Error, field);
}
assert.throws(() => calculateBudget(), /Capacity/);
console.log('Budget check passed: worksheet examples, ticket limits, penny rounding and invalid inputs.');

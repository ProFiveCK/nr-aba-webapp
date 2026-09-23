import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  carryoverFor,
  isResetDue,
  resetBoundaryFor,
  resetDelta,
  seedBalanceFor,
} from './accrualRules.js';

const ANNUAL = { is_accruable: true, default_days: '20.00', reset_period: 'none' };
const SICK = { is_accruable: false, default_days: '10.00', reset_period: 'financial_year' };

describe('seedBalanceFor', () => {
  test('an accruable type starts empty and earns its days', () => {
    assert.equal(seedBalanceFor(ANNUAL), 0);
  });

  test('an upfront type starts at its full entitlement', () => {
    assert.equal(seedBalanceFor(SICK), 10);
  });

  test('reads the NUMERIC string pg returns as a number', () => {
    assert.equal(seedBalanceFor({ is_accruable: false, default_days: '7.50' }), 7.5);
  });

  test('is zero for a missing type rather than NaN', () => {
    assert.equal(seedBalanceFor(undefined), 0);
    assert.equal(seedBalanceFor(null), 0);
  });
});

describe('carryoverFor', () => {
  test('carries unused days for a type that never resets', () => {
    assert.equal(carryoverFor(ANNUAL, { balance: '12.00', pending: '0' }), 12);
  });

  test('does not carry days already held against a pending application', () => {
    // Those days belong to the application, not to the balance.
    assert.equal(carryoverFor(ANNUAL, { balance: '12.00', pending: '5.00' }), 7);
  });

  test('carries nothing for a type that resets', () => {
    assert.equal(carryoverFor(SICK, { balance: '9.00', pending: '0' }), 0);
    assert.equal(carryoverFor({ ...ANNUAL, reset_period: 'anniversary' }, { balance: '9', pending: '0' }), 0);
  });

  test('never carries a negative balance forward as a debt', () => {
    assert.equal(carryoverFor(ANNUAL, { balance: '-3.00', pending: '0' }), 0);
  });

  test('never carries more than the balance when pending exceeds it', () => {
    assert.equal(carryoverFor(ANNUAL, { balance: '2.00', pending: '5.00' }), 0);
  });

  test('carries nothing when there is no prior year', () => {
    assert.equal(carryoverFor(ANNUAL, undefined), 0);
    assert.equal(carryoverFor(ANNUAL, null), 0);
  });
});

describe('resetBoundaryFor', () => {
  const now = new Date(2026, 8, 24); // 24 Sep 2026

  test('a type that never resets has no boundary', () => {
    assert.equal(resetBoundaryFor({ join_date: '2020-03-01' }, 'none', now), null);
  });

  test("'financial_year' resets on 1 January — the CALENDAR year", () => {
    // Documents current behaviour, which does not match Naoero's July-June
    // financial year. Deliberately not changed here: moving it moves real
    // balances. See docs/HR-HARDENING-PLAN.md.
    const boundary = resetBoundaryFor({}, 'financial_year', now);
    assert.equal(boundary.getFullYear(), 2026);
    assert.equal(boundary.getMonth(), 0);
    assert.equal(boundary.getDate(), 1);
  });

  test('anniversary uses this year when it has already passed', () => {
    const boundary = resetBoundaryFor({ join_date: '2020-03-15' }, 'anniversary', now);
    assert.equal(boundary.getFullYear(), 2026);
    assert.equal(boundary.getMonth(), 2);
    assert.equal(boundary.getDate(), 15);
  });

  test('anniversary steps back a year when it has not arrived yet', () => {
    const boundary = resetBoundaryFor({ join_date: '2020-12-01' }, 'anniversary', now);
    assert.equal(boundary.getFullYear(), 2025);
    assert.equal(boundary.getMonth(), 11);
  });

  test('an employee with no join date has no anniversary boundary', () => {
    // Their balance is left alone rather than reset against a guessed date.
    assert.equal(resetBoundaryFor({ join_date: null }, 'anniversary', now), null);
    assert.equal(resetBoundaryFor({}, 'anniversary', now), null);
  });

  test('an anniversary falling today counts as passed', () => {
    const boundary = resetBoundaryFor({ join_date: '2020-09-24' }, 'anniversary', now);
    assert.equal(boundary.getFullYear(), 2026);
  });
});

describe('isResetDue', () => {
  const boundary = new Date(2026, 0, 1);

  test('a balance never reset is due', () => {
    assert.equal(isResetDue(null, boundary), true);
  });

  test('a balance last reset before the boundary is due', () => {
    assert.equal(isResetDue('2025-12-31T00:00:00Z', boundary), true);
  });

  test('a balance already reset after the boundary is not due again', () => {
    // This is what stops a catch-up run forfeiting the same days twice.
    assert.equal(isResetDue('2026-02-01T00:00:00Z', boundary), false);
  });

  test('a balance reset exactly at the boundary is not due again', () => {
    assert.equal(isResetDue(new Date(2026, 0, 1), boundary), false);
  });

  test('nothing is due where there is no boundary', () => {
    assert.equal(isResetDue(null, null), false);
    assert.equal(isResetDue('2020-01-01', null), false);
  });
});

describe('resetDelta', () => {
  test('forfeits unused days on an accruable type', () => {
    assert.equal(resetDelta(ANNUAL, '14.00'), -14);
  });

  test('regrants the full entitlement on an upfront type', () => {
    assert.equal(resetDelta(SICK, '0'), 10);
  });

  test('is the difference, not the balance, on a partly used upfront type', () => {
    assert.equal(resetDelta(SICK, '4.00'), 6);
  });

  test('is zero when the balance already equals the seed', () => {
    assert.equal(resetDelta(SICK, '10.00'), 0);
    assert.equal(resetDelta(ANNUAL, '0'), 0);
  });

  test('clears an overdrawn balance back up to the seed', () => {
    assert.equal(resetDelta(ANNUAL, '-2.00'), 2);
  });
});

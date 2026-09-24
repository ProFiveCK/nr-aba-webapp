import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  FINANCIAL_YEAR_START_MONTH,
  isResetDue,
  openingBalanceFor,
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

describe('openingBalanceFor', () => {
  const SICK_FY = { is_accruable: false, default_days: '10.00', reset_period: 'financial_year' };

  test('a first year gets the grant', () => {
    assert.equal(openingBalanceFor(ANNUAL, null), 0);
    assert.equal(openingBalanceFor(SICK, null), 10);
  });

  test('a type that never resets grants afresh on top of what carried', () => {
    assert.equal(openingBalanceFor(ANNUAL, { balance: '12.00', pending: '0' }), 12);
    assert.equal(openingBalanceFor({ ...SICK, reset_period: 'none' }, { balance: '3.00', pending: '0' }), 13);
  });

  test('a resetting type carries the balance and does NOT regrant', () => {
    // January is the middle of a July-to-June year, so the new calendar row
    // continues the old one. Granting again here would hand out a second
    // entitlement halfway through the period.
    assert.equal(openingBalanceFor(SICK_FY, { balance: '6.00', pending: '0' }), 6);
  });

  test('a resetting accruable type keeps what it has accrued across January', () => {
    // The bug this prevents: with a 1 July boundary, opening at zero each
    // January would take the leave away twice a year.
    const annualFy = { ...ANNUAL, reset_period: 'financial_year' };
    assert.equal(openingBalanceFor(annualFy, { balance: '14.00', pending: '0' }), 14);
  });

  test('days held against a pending application do not carry', () => {
    assert.equal(openingBalanceFor(ANNUAL, { balance: '12.00', pending: '5.00' }), 7);
  });

  test('an overdrawn balance does not carry forward as a debt', () => {
    assert.equal(openingBalanceFor(ANNUAL, { balance: '-3.00', pending: '0' }), 0);
    assert.equal(openingBalanceFor(ANNUAL, { balance: '2.00', pending: '5.00' }), 0);
  });
});

describe('resetBoundaryFor', () => {
  const now = new Date(2026, 8, 24); // 24 Sep 2026

  test('a type that never resets has no boundary', () => {
    assert.equal(resetBoundaryFor({ join_date: '2020-03-01' }, 'none', now), null);
  });

  test("'financial_year' resets on 1 July, Naoero's financial year", () => {
    const boundary = resetBoundaryFor({}, 'financial_year', now); // 24 Sep 2026
    assert.equal(boundary.getFullYear(), 2026);
    assert.equal(boundary.getMonth(), FINANCIAL_YEAR_START_MONTH - 1);
    assert.equal(boundary.getDate(), 1);
  });

  test("'financial_year' steps back when July has not arrived yet", () => {
    // In March the current financial year began in the previous July.
    const boundary = resetBoundaryFor({}, 'financial_year', new Date(2026, 2, 3));
    assert.equal(boundary.getFullYear(), 2025);
    assert.equal(boundary.getMonth(), FINANCIAL_YEAR_START_MONTH - 1);
  });

  test("'financial_year' on 1 July itself counts as passed", () => {
    const boundary = resetBoundaryFor({}, 'financial_year', new Date(2026, 6, 1));
    assert.equal(boundary.getFullYear(), 2026);
  });

  test('the boundary follows the date judged, not the clock', () => {
    // What makes a catch-up run apply the right period's boundary.
    const early = resetBoundaryFor({}, 'financial_year', new Date(2025, 8, 1));
    const late = resetBoundaryFor({}, 'financial_year', new Date(2026, 8, 1));
    assert.equal(early.getFullYear(), 2025);
    assert.equal(late.getFullYear(), 2026);
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
  const boundary = '2026-07-01';

  test('a balance never reset is due', () => {
    assert.equal(isResetDue(null, boundary), true);
  });

  test('a balance last reset before the boundary is due', () => {
    assert.equal(isResetDue('2025-07-01', boundary), true);
  });

  test('a balance already reset after the boundary is not due again', () => {
    // This is what stops a catch-up run forfeiting the same days twice.
    assert.equal(isResetDue('2026-08-01', boundary), false);
  });

  test('a balance reset exactly on the boundary is not due again', () => {
    assert.equal(isResetDue('2026-07-01', boundary), false);
  });

  test('compares the calendar day, not an instant', () => {
    // A timestamp late on the boundary day still counts as reset; the hour
    // must not decide whether someone loses their leave.
    assert.equal(isResetDue('2026-07-01', boundary), false);
    assert.equal(isResetDue('2026-06-30', boundary), true);
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

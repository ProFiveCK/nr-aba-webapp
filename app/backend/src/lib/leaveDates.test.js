import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { calculateWorkingDays, monthsBetween } from '../lib/leaveDates.js';

describe('monthsBetween', () => {
  test('covers both ends inclusively', () => {
    assert.deepEqual(monthsBetween('2026-02-10', '2026-05-03'), ['2026-02', '2026-03', '2026-04', '2026-05']);
  });

  test('gives a single month when the range sits inside one', () => {
    assert.deepEqual(monthsBetween('2026-02-01', '2026-02-28'), ['2026-02']);
  });

  test('rolls over the year boundary', () => {
    assert.deepEqual(monthsBetween('2025-11-15', '2026-02-01'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  test('spans a full twelve-month window', () => {
    assert.equal(monthsBetween('2025-09-25', '2026-09-24').length, 13);
  });

  test('does not depend on the server timezone', () => {
    // Built by integer arithmetic on the string, not by stepping a Date, which
    // is what put the month a day out before.
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Nauru';
      const ahead = monthsBetween('2026-01-01', '2026-03-01');
      process.env.TZ = 'Pacific/Midway';
      const behind = monthsBetween('2026-01-01', '2026-03-01');
      assert.deepEqual(ahead, behind);
      assert.deepEqual(ahead, ['2026-01', '2026-02', '2026-03']);
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('calculateWorkingDays', () => {
  test('counts Monday to Friday inclusive', () => {
    assert.equal(calculateWorkingDays('2026-02-09', '2026-02-13'), 5);
  });

  test('excludes the weekend inside a range', () => {
    // Mon 9 Feb to Mon 16 Feb spans a weekend: 5 + 1 working days.
    assert.equal(calculateWorkingDays('2026-02-09', '2026-02-16'), 6);
  });

  test('is zero for a weekend-only range', () => {
    assert.equal(calculateWorkingDays('2026-02-14', '2026-02-15'), 0);
  });

  test('is zero when the end precedes the start', () => {
    assert.equal(calculateWorkingDays('2026-02-13', '2026-02-09'), 0);
  });

  test('counts a single working day as one', () => {
    assert.equal(calculateWorkingDays('2026-02-09', '2026-02-09'), 1);
  });
});

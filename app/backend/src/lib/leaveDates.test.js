import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { calculateWorkingDays, monthsBetween, parseDateOnly, toIsoDate } from '../lib/leaveDates.js';

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

describe('calculateWorkingDays with public holidays', () => {
  // Mon 8 Jun to Fri 12 Jun 2026 is a five-day working week.
  const WEEK = ['2026-06-08', '2026-06-12'];

  test('a holiday mid-week does not come off an entitlement', () => {
    assert.equal(calculateWorkingDays(...WEEK, ['2026-06-10']), 4);
  });

  test('several holidays in one week each count once', () => {
    assert.equal(calculateWorkingDays(...WEEK, ['2026-06-09', '2026-06-11']), 3);
  });

  test('a holiday falling on a weekend changes nothing', () => {
    // 13 Jun 2026 is a Saturday; it was already not a working day.
    assert.equal(calculateWorkingDays('2026-06-08', '2026-06-14', ['2026-06-13']), 5);
  });

  test('a holiday outside the range is ignored', () => {
    assert.equal(calculateWorkingDays(...WEEK, ['2026-07-01']), 5);
  });

  test('a week that is entirely holidays costs nothing', () => {
    const everyDay = ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'];
    assert.equal(calculateWorkingDays(...WEEK, everyDay), 0);
  });

  test('accepts a Set as well as an array', () => {
    assert.equal(calculateWorkingDays(...WEEK, new Set(['2026-06-10'])), 4);
  });

  test('omitting the calendar excludes weekends only', () => {
    assert.equal(calculateWorkingDays(...WEEK), 5);
    assert.equal(calculateWorkingDays(...WEEK, null), 5);
    assert.equal(calculateWorkingDays(...WEEK, []), 5);
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

describe('parseDateOnly', () => {
  test('reads the Date object pg returns for a DATE column', () => {
    // The regression this exists for: pg parses DATE into a Date, and code
    // that split String(value) on "-" got NaN and silently did nothing, which
    // is why the fortnightly accrual scheduler never ran.
    const fromPg = new Date(2026, 7, 27);
    const parsed = parseDateOnly(fromPg);
    assert.equal(toIsoDate(parsed), '2026-08-27');
  });

  test('reads a plain YYYY-MM-DD string', () => {
    assert.equal(toIsoDate(parseDateOnly('2026-08-27')), '2026-08-27');
  });

  test('reads the date part of a timestamp without shifting it', () => {
    assert.equal(toIsoDate(parseDateOnly('2026-08-27T00:00:00.000Z')), '2026-08-27');
  });

  test('normalises to local midnight so date arithmetic is stable', () => {
    const parsed = parseDateOnly(new Date(2026, 7, 27, 23, 59, 59));
    assert.equal(parsed.getHours(), 0);
    assert.equal(toIsoDate(parsed), '2026-08-27');
  });

  test('returns null for anything unusable', () => {
    assert.equal(parseDateOnly(null), null);
    assert.equal(parseDateOnly(undefined), null);
    assert.equal(parseDateOnly(''), null);
    assert.equal(parseDateOnly('not a date'), null);
    assert.equal(parseDateOnly(new Date('nonsense')), null);
  });
});

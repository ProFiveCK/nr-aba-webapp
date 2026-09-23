/**
 * Advisory locking against a real Postgres. Skipped unless a database is
 * available — `npm run test:db` provides one.
 */

import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import { LOCK_KEYS, withAdvisoryLock } from './advisoryLock.js';
import { connectTestDatabase, skipWithoutDatabase } from '../test-support/database.js';

describe('withAdvisoryLock', { skip: skipWithoutDatabase }, () => {
  let pool;

  before(async () => { pool = await connectTestDatabase(); });
  after(async () => { await pool?.end(); });

  test('runs the work and reports that it held the lock', async () => {
    const { acquired, result } = await withAdvisoryLock(pool, LOCK_KEYS.LEAVE_ACCRUAL, async () => 'done');
    assert.equal(acquired, true);
    assert.equal(result, 'done');
  });

  test('a second caller declines while the first is working', async () => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let secondAttempt;

    const first = withAdvisoryLock(pool, LOCK_KEYS.LEAVE_ACCRUAL, async () => {
      // While this is still inside the lock, a second attempt must decline
      // rather than queue — that is what stops two API containers both
      // crediting the same fortnight.
      secondAttempt = await withAdvisoryLock(pool, LOCK_KEYS.LEAVE_ACCRUAL, async () => 'should not run');
      release();
      return 'first';
    });

    await held;
    const outcome = await first;

    assert.equal(outcome.acquired, true);
    assert.equal(secondAttempt.acquired, false);
    assert.equal(secondAttempt.result, undefined);
  });

  test('releases the lock when the work throws', async () => {
    await assert.rejects(
      () => withAdvisoryLock(pool, LOCK_KEYS.LEAVE_ACCRUAL, async () => { throw new Error('boom'); }),
      /boom/
    );

    // A failed run must not wedge the lock for every run after it.
    const { acquired } = await withAdvisoryLock(pool, LOCK_KEYS.LEAVE_ACCRUAL, async () => 'ok');
    assert.equal(acquired, true);
  });

  test('different keys do not block each other', async () => {
    const outer = await withAdvisoryLock(pool, LOCK_KEYS.LEAVE_ACCRUAL, () =>
      withAdvisoryLock(pool, LOCK_KEYS.LEAVE_ACCRUAL + 1, async () => 'inner'));
    assert.equal(outer.acquired, true);
    assert.equal(outer.result.acquired, true);
    assert.equal(outer.result.result, 'inner');
  });
});

/**
 * The accrual engine against a real Postgres. Skipped unless a database is
 * available — `npm run test:db` provides one.
 *
 * These numbers decide what staff are paid out on separation, so the cases
 * here are the ones that would be argued over: a fortnight credited twice, a
 * reset forfeiting days that were already forfeited, unused days carried into
 * a new year, and staff who should be left out entirely.
 */

import assert from 'node:assert/strict';
import test, { after, before, beforeEach, describe } from 'node:test';
import {
  connectTestDatabase,
  createEmployee,
  readBalance,
  resetLeaveTables,
  skipWithoutDatabase,
  upsertLeaveType,
} from '../test-support/database.js';

describe('leave accrual', { skip: skipWithoutDatabase }, () => {
  let pool;
  let runLeaveAccrual;
  let runDueLeaveAccruals;
  let ensureBalance;
  const YEAR = 2026;

  before(async () => {
    pool = await connectTestDatabase();
    ({ runLeaveAccrual, runDueLeaveAccruals, ensureBalance } = await import('./leaveAccrual.js'));
  });

  beforeEach(async () => {
    await resetLeaveTables(pool);
    await pool.query("DELETE FROM hr_leave_types WHERE name LIKE 'T:%'");
  });

  after(async () => {
    await pool?.end();
  });

  /** Runs one accrual period in its own transaction, as the callers do. */
  async function accrue(periodEnd) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await runLeaveAccrual(client, { periodEnd, actorId: null });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  describe('crediting a fortnight', () => {
    test('credits each active entitled employee once per run', async () => {
      const type = await upsertLeaveType(pool, { name: 'T:Annual', accruable: true, perFortnight: 3 });
      const ana = await createEmployee(pool, { name: 'Ana' });
      const ben = await createEmployee(pool, { name: 'Ben' });

      const result = await accrue(`${YEAR}-02-13`);

      assert.equal(result.credited, 2);
      assert.equal((await readBalance(pool, ana.id, type.id, YEAR)).balance, 3);
      assert.equal((await readBalance(pool, ben.id, type.id, YEAR)).balance, 3);
    });

    test('accumulates across successive fortnights', async () => {
      const type = await upsertLeaveType(pool, { name: 'T:Annual', accruable: true, perFortnight: 2.5 });
      const ana = await createEmployee(pool, { name: 'Ana' });

      await accrue(`${YEAR}-02-13`);
      await accrue(`${YEAR}-02-27`);
      await accrue(`${YEAR}-03-13`);

      assert.equal((await readBalance(pool, ana.id, type.id, YEAR)).balance, 7.5);
    });

    test('writes an adjustment for every credit, so a balance can be explained', async () => {
      await upsertLeaveType(pool, { name: 'T:Annual', accruable: true, perFortnight: 3 });
      const ana = await createEmployee(pool, { name: 'Ana' });

      await accrue(`${YEAR}-02-13`);

      const { rows } = await pool.query(
        'SELECT amount, reason FROM hr_leave_adjustments WHERE employee_id = $1', [ana.id]);
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0].amount), 3);
      assert.match(rows[0].reason, /Fortnightly accrual/);
    });

    test('leaves out staff who are not entitled to leave', async () => {
      const type = await upsertLeaveType(pool, { name: 'T:Annual', accruable: true, perFortnight: 3 });
      const casual = await createEmployee(pool, { name: 'Casual', entitled: false });

      const result = await accrue(`${YEAR}-02-13`);

      assert.equal(result.credited, 0);
      assert.equal(await readBalance(pool, casual.id, type.id, YEAR), null);
    });

    test('leaves out inactive staff', async () => {
      const type = await upsertLeaveType(pool, { name: 'T:Annual', accruable: true, perFortnight: 3 });
      const gone = await createEmployee(pool, { name: 'Gone', status: 'inactive' });

      assert.equal((await accrue(`${YEAR}-02-13`)).credited, 0);
      assert.equal(await readBalance(pool, gone.id, type.id, YEAR), null);
    });

    test('ignores an inactive leave type and one with no accrual rate', async () => {
      await upsertLeaveType(pool, { name: 'T:Retired', accruable: true, perFortnight: 3, active: false });
      await upsertLeaveType(pool, { name: 'T:Unpaid', accruable: true, perFortnight: 0 });
      await createEmployee(pool, { name: 'Ana' });

      assert.equal((await accrue(`${YEAR}-02-13`)).credited, 0);
    });

    test('does not credit an upfront type, which is granted not earned', async () => {
      await upsertLeaveType(pool, { name: 'T:Sick', accruable: false, defaultDays: 10, perFortnight: 3 });
      await createEmployee(pool, { name: 'Ana' });

      assert.equal((await accrue(`${YEAR}-02-13`)).credited, 0);
    });
  });

  describe('resets', () => {
    test('forfeits an accruable balance once the boundary has passed', async () => {
      const type = await upsertLeaveType(pool, {
        name: 'T:Annual', accruable: true, perFortnight: 3, resetPeriod: 'financial_year' });
      const ana = await createEmployee(pool, { name: 'Ana' });

      await accrue(`${YEAR}-02-13`);
      // Pretend the balance was last reset before this year's boundary.
      await pool.query(
        `UPDATE hr_leave_balances SET last_reset_at = '2020-01-01' WHERE employee_id = $1`, [ana.id]);
      const result = await accrue(`${YEAR}-02-27`);

      assert.equal(result.reset, 1);
      assert.equal((await readBalance(pool, ana.id, type.id, YEAR)).balance, 0);
    });

    test('does not reset twice for the same boundary', async () => {
      await upsertLeaveType(pool, {
        name: 'T:Annual', accruable: true, perFortnight: 3, resetPeriod: 'financial_year' });
      const ana = await createEmployee(pool, { name: 'Ana' });

      await accrue(`${YEAR}-02-13`);
      await pool.query(
        `UPDATE hr_leave_balances SET last_reset_at = '2020-01-01' WHERE employee_id = $1`, [ana.id]);
      await accrue(`${YEAR}-02-27`);
      const second = await accrue(`${YEAR}-03-13`);

      // The days were already forfeited; the second run must not take more.
      assert.equal(second.reset, 0);
    });

    test('regrants an upfront type to its full entitlement', async () => {
      const type = await upsertLeaveType(pool, {
        name: 'T:Sick', accruable: false, defaultDays: 10, resetPeriod: 'financial_year' });
      const ana = await createEmployee(pool, { name: 'Ana' });
      const client = await pool.connect();
      try {
        await ensureBalance(client, ana.id, type.id, YEAR);
      } finally {
        client.release();
      }
      await pool.query(
        `UPDATE hr_leave_balances SET balance = 2, last_reset_at = '2020-01-01' WHERE employee_id = $1`, [ana.id]);

      await accrue(`${YEAR}-02-13`);

      assert.equal((await readBalance(pool, ana.id, type.id, YEAR)).balance, 10);
    });

    test('leaves an anniversary-reset employee alone when they have no join date', async () => {
      const type = await upsertLeaveType(pool, {
        name: 'T:Annual', accruable: true, perFortnight: 3, resetPeriod: 'anniversary' });
      const ana = await createEmployee(pool, { name: 'Ana', joinDate: null });

      await accrue(`${YEAR}-02-13`);
      const result = await accrue(`${YEAR}-02-27`);

      assert.equal(result.reset, 0);
      assert.equal((await readBalance(pool, ana.id, type.id, YEAR)).balance, 6);
    });

    test('records the forfeiture as an adjustment', async () => {
      await upsertLeaveType(pool, {
        name: 'T:Annual', accruable: true, perFortnight: 4, resetPeriod: 'financial_year' });
      const ana = await createEmployee(pool, { name: 'Ana' });

      await accrue(`${YEAR}-02-13`);
      await pool.query(
        `UPDATE hr_leave_balances SET last_reset_at = '2020-01-01' WHERE employee_id = $1`, [ana.id]);
      await accrue(`${YEAR}-02-27`);

      const { rows } = await pool.query(
        `SELECT amount FROM hr_leave_adjustments WHERE employee_id = $1 AND reason LIKE 'Balance reset%'`,
        [ana.id]);
      assert.equal(rows.length, 1);
      // 4 credited, then 4 more, then forfeited back to zero.
      assert.equal(Number(rows[0].amount), -8);
    });
  });

  describe('carryover into a new year', () => {
    test('carries unused days for a type that never resets', async () => {
      const type = await upsertLeaveType(pool, { name: 'T:Annual', accruable: true, perFortnight: 3, resetPeriod: 'none' });
      const ana = await createEmployee(pool, { name: 'Ana' });
      await pool.query(
        `INSERT INTO hr_leave_balances (employee_id, leave_type_id, year, balance, pending)
         VALUES ($1, $2, $3, 12, 0)`, [ana.id, type.id, YEAR - 1]);

      const client = await pool.connect();
      try {
        await ensureBalance(client, ana.id, type.id, YEAR);
      } finally {
        client.release();
      }

      assert.equal((await readBalance(pool, ana.id, type.id, YEAR)).balance, 12);
    });

    test('does not carry days held against a pending application', async () => {
      const type = await upsertLeaveType(pool, { name: 'T:Annual', accruable: true, perFortnight: 3, resetPeriod: 'none' });
      const ana = await createEmployee(pool, { name: 'Ana' });
      await pool.query(
        `INSERT INTO hr_leave_balances (employee_id, leave_type_id, year, balance, pending)
         VALUES ($1, $2, $3, 12, 5)`, [ana.id, type.id, YEAR - 1]);

      const client = await pool.connect();
      try {
        await ensureBalance(client, ana.id, type.id, YEAR);
      } finally {
        client.release();
      }

      assert.equal((await readBalance(pool, ana.id, type.id, YEAR)).balance, 7);
    });

    test('carries nothing for a type that resets', async () => {
      const type = await upsertLeaveType(pool, {
        name: 'T:Annual', accruable: true, perFortnight: 3, resetPeriod: 'financial_year' });
      const ana = await createEmployee(pool, { name: 'Ana' });
      await pool.query(
        `INSERT INTO hr_leave_balances (employee_id, leave_type_id, year, balance, pending)
         VALUES ($1, $2, $3, 12, 0)`, [ana.id, type.id, YEAR - 1]);

      const client = await pool.connect();
      try {
        await ensureBalance(client, ana.id, type.id, YEAR);
      } finally {
        client.release();
      }

      assert.equal((await readBalance(pool, ana.id, type.id, YEAR)).balance, 0);
    });
  });

  describe('DATE columns', () => {
    test('come back as YYYY-MM-DD strings, not Date objects', async () => {
      // db.js overrides pg's DATE parser. Without it a DATE reaches the browser
      // as a UTC timestamp and can be read as the previous day, and the accrual
      // scheduler's anchor parse silently yields nothing.
      const ana = await createEmployee(pool, { name: 'Ana', joinDate: '2020-03-15' });
      const { rows } = await pool.query('SELECT join_date FROM hr_employees WHERE id = $1', [ana.id]);
      assert.equal(typeof rows[0].join_date, 'string');
      assert.equal(rows[0].join_date, '2020-03-15');
      assert.equal(JSON.parse(JSON.stringify(rows[0])).join_date, '2020-03-15');
    });

    test('the accrual anchor round-trips unchanged', async () => {
      await pool.query(
        `INSERT INTO reviewer_settings (id, accrual_anchor_date) VALUES (TRUE, '2026-08-27')
         ON CONFLICT (id) DO UPDATE SET accrual_anchor_date = EXCLUDED.accrual_anchor_date`);
      const { rows } = await pool.query('SELECT accrual_anchor_date FROM reviewer_settings WHERE id = TRUE');
      // What the settings endpoint returns, and what an <input type="date">
      // needs. It was sending a full ISO timestamp, which renders as blank.
      assert.equal(rows[0].accrual_anchor_date, '2026-08-27');
    });
  });

  describe('the fortnightly schedule', () => {
    test('does nothing until an anchor date is set', async () => {
      await upsertLeaveType(pool, { name: 'T:Annual', accruable: true, perFortnight: 3 });
      await createEmployee(pool, { name: 'Ana' });

      assert.deepEqual((await runDueLeaveAccruals(pool)).ran, []);
    });

    test('catches up every missed period, and only once', async () => {
      const type = await upsertLeaveType(pool, { name: 'T:Annual', accruable: true, perFortnight: 1 });
      const ana = await createEmployee(pool, { name: 'Ana' });
      // Three periods due: the anchor, and two fortnights after it.
      const anchor = new Date();
      anchor.setDate(anchor.getDate() - 28);
      const iso = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}-${String(anchor.getDate()).padStart(2, '0')}`;
      await pool.query(
        `INSERT INTO reviewer_settings (id, accrual_anchor_date) VALUES (TRUE, $1)
         ON CONFLICT (id) DO UPDATE SET accrual_anchor_date = EXCLUDED.accrual_anchor_date`, [iso]);

      const first = await runDueLeaveAccruals(pool);
      assert.equal(first.ran.length, 3);

      // Running again must not credit a fourth time — this is what protects a
      // restart loop from inflating everyone's balance.
      const second = await runDueLeaveAccruals(pool);
      assert.deepEqual(second.ran, []);

      const year = new Date().getFullYear();
      const balance = await readBalance(pool, ana.id, type.id, year);
      assert.equal(balance.balance, 3);
    });

    test('a period already recorded is never re-credited', async () => {
      const type = await upsertLeaveType(pool, { name: 'T:Annual', accruable: true, perFortnight: 5 });
      const ana = await createEmployee(pool, { name: 'Ana' });
      const periodEnd = `${YEAR}-02-13`;

      await accrue(periodEnd);
      await pool.query('INSERT INTO hr_accrual_runs (period_end, credited) VALUES ($1, 1)', [periodEnd]);

      await assert.rejects(
        () => pool.query('INSERT INTO hr_accrual_runs (period_end, credited) VALUES ($1, 1)', [periodEnd]),
        /duplicate key/,
        'period_end must stay unique — it is what makes accrual idempotent'
      );
      assert.equal((await readBalance(pool, ana.id, type.id, YEAR)).balance, 5);
    });
  });
});

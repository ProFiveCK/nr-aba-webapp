/**
 * The leave workflow against a real Postgres. Skipped unless a database is
 * available — `npm run test:db` provides one.
 *
 * The invariant under test throughout: a day is held against `pending` from
 * application until decision, and then either released (cancelled, rejected)
 * or taken out of `balance` (approved) — never both, never neither.
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

describe('leave service', { skip: skipWithoutDatabase }, () => {
  let pool;
  let service;
  let annual;
  let ana;
  let manager;
  const YEAR = new Date().getFullYear();
  const START = `${YEAR}-06-01`;  // a Monday-anchored week is not required;
  const END = `${YEAR}-06-05`;    // the service counts working days itself.

  const allowAll = async () => true;
  const denyAll = async () => false;

  before(async () => {
    pool = await connectTestDatabase();
    service = await import('./leaveService.js');
  });

  beforeEach(async () => {
    await resetLeaveTables(pool);
    await pool.query("DELETE FROM hr_leave_types WHERE name LIKE 'T:%'");
    annual = await upsertLeaveType(pool, { name: 'T:Annual', accruable: false, defaultDays: 20 });
    manager = await createEmployee(pool, { name: 'Manager' });
    ana = await createEmployee(pool, { name: 'Ana' });
    await pool.query('UPDATE hr_employees SET manager_id = $1 WHERE id = $2', [manager.id, ana.id]);
    ana = (await pool.query('SELECT * FROM hr_employees WHERE id = $1', [ana.id])).rows[0];
  });

  after(async () => { await pool?.end(); });

  const apply = (overrides = {}) => service.applyForLeave(pool, {
    employee: ana, leaveTypeId: annual.id, startDate: START, endDate: END, reason: 'Family', ...overrides,
  });

  describe('applying', () => {
    test('holds the days against pending without touching the balance', async () => {
      const { application } = await apply();

      const balance = await readBalance(pool, ana.id, annual.id, YEAR);
      assert.equal(Number(application.days), 5);
      assert.equal(balance.balance, 20, 'balance is untouched until approval');
      assert.equal(balance.pending, 5, 'the days are held');
    });

    test('refuses more days than are available', async () => {
      await apply();                       // holds 5 of 20
      await service.adjustBalance(pool, {  // drop the balance to 6
        employeeId: ana.id, leaveTypeId: annual.id, amount: -14, reason: 'Correction', actorId: null, year: YEAR,
      });

      // 6 on the books, 5 already held, so only 1 is really available.
      await assert.rejects(() => apply(), /Insufficient leave balance/);
    });

    test('refuses a range with no working days', async () => {
      await assert.rejects(
        () => apply({ startDate: `${YEAR}-06-06`, endDate: `${YEAR}-06-07` }),
        /no working days/
      );
    });

    test('refuses staff who are not entitled to leave', async () => {
      const casual = await createEmployee(pool, { name: 'Casual', entitled: false });
      await assert.rejects(() => apply({ employee: casual }), /not entitled to leave/);
    });

    test('refuses an unknown or inactive leave type', async () => {
      const retired = await upsertLeaveType(pool, { name: 'T:Retired', defaultDays: 5, active: false });
      await assert.rejects(() => apply({ leaveTypeId: retired.id }), /Unknown leave type/);
    });

    test('requires a reason where the type demands one', async () => {
      await pool.query('UPDATE hr_leave_types SET requires_note = TRUE WHERE id = $1', [annual.id]);
      await assert.rejects(() => apply({ reason: '   ' }), /requires a reason/);
    });

    test('leaves nothing behind when it refuses', async () => {
      await pool.query('UPDATE hr_leave_types SET requires_note = TRUE WHERE id = $1', [annual.id]);
      await assert.rejects(() => apply({ reason: '' }));

      // The transaction rolled back, so no hold and no application survive.
      const balance = await readBalance(pool, ana.id, annual.id, YEAR);
      assert.equal(balance === null || balance.pending === 0, true);
      const { rows } = await pool.query('SELECT * FROM hr_leave_applications WHERE employee_id = $1', [ana.id]);
      assert.equal(rows.length, 0);
    });
  });

  describe('cancelling', () => {
    test('releases the hold and leaves the balance whole', async () => {
      const { application } = await apply();
      await service.cancelLeave(pool, { employee: ana, applicationId: application.id });

      const balance = await readBalance(pool, ana.id, annual.id, YEAR);
      assert.equal(balance.pending, 0);
      assert.equal(balance.balance, 20);
    });

    test('refuses to cancel somebody else\'s application', async () => {
      const { application } = await apply();
      const ben = await createEmployee(pool, { name: 'Ben' });

      // Reported as missing, not forbidden, so this cannot be used to probe.
      await assert.rejects(
        () => service.cancelLeave(pool, { employee: ben, applicationId: application.id }),
        /not found/
      );
    });

    test('refuses to cancel an application already decided', async () => {
      const { application } = await apply();
      await service.decideLeave(pool, {
        applicationId: application.id, decision: 'approved', note: '', actorId: null, canAct: allowAll,
      });

      await assert.rejects(
        () => service.cancelLeave(pool, { employee: ana, applicationId: application.id }),
        /Only pending applications/
      );
    });
  });

  describe('deciding', () => {
    test('approval moves the days out of the balance and clears the hold', async () => {
      const { application } = await apply();
      await service.decideLeave(pool, {
        applicationId: application.id, decision: 'approved', note: '', actorId: null, canAct: allowAll,
      });

      const balance = await readBalance(pool, ana.id, annual.id, YEAR);
      assert.equal(balance.balance, 15, 'the days are spent');
      assert.equal(balance.pending, 0, 'and no longer held');
    });

    test('rejection gives the days back', async () => {
      const { application } = await apply();
      await service.decideLeave(pool, {
        applicationId: application.id, decision: 'rejected', note: 'Too busy', actorId: null, canAct: allowAll,
      });

      const balance = await readBalance(pool, ana.id, annual.id, YEAR);
      assert.equal(balance.balance, 20);
      assert.equal(balance.pending, 0);
    });

    test('a rejection must say why', async () => {
      const { application } = await apply();
      await assert.rejects(
        () => service.decideLeave(pool, {
          applicationId: application.id, decision: 'rejected', note: '  ', actorId: null, canAct: allowAll,
        }),
        /reason is required/
      );
    });

    test('refuses an approver who may not act on this person', async () => {
      const { application } = await apply();
      await assert.rejects(
        () => service.decideLeave(pool, {
          applicationId: application.id, decision: 'approved', note: '', actorId: null, canAct: denyAll,
        }),
        /does not report to you/
      );

      // And the refusal changed nothing.
      const balance = await readBalance(pool, ana.id, annual.id, YEAR);
      assert.equal(balance.balance, 20);
      assert.equal(balance.pending, 5);
    });

    test('cannot be decided twice', async () => {
      const { application } = await apply();
      const decide = () => service.decideLeave(pool, {
        applicationId: application.id, decision: 'approved', note: '', actorId: null, canAct: allowAll,
      });
      await decide();

      // Without this, a double-click would deduct the days twice.
      await assert.rejects(decide, /no longer pending/);
      assert.equal((await readBalance(pool, ana.id, annual.id, YEAR)).balance, 15);
    });

    test('returns the applicant so the caller can notify them', async () => {
      const { application } = await apply();
      const result = await service.decideLeave(pool, {
        applicationId: application.id, decision: 'approved', note: '', actorId: null, canAct: allowAll,
      });

      assert.equal(result.applicant.display_name, 'Ana');
      assert.equal(result.leaveTypeName, 'T:Annual');
      assert.equal(result.application.status, 'approved');
    });
  });

  describe('adjusting a balance', () => {
    test('records every adjustment with its reason', async () => {
      await service.adjustBalance(pool, {
        employeeId: ana.id, leaveTypeId: annual.id, amount: 3, reason: 'Long service', actorId: null, year: YEAR,
      });

      assert.equal((await readBalance(pool, ana.id, annual.id, YEAR)).balance, 23);
      const { rows } = await pool.query('SELECT amount, reason FROM hr_leave_adjustments WHERE employee_id = $1', [ana.id]);
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0].amount), 3);
      assert.equal(rows[0].reason, 'Long service');
    });

    test('refuses an adjustment of zero, which would assert nothing', async () => {
      await assert.rejects(
        () => service.adjustBalance(pool, {
          employeeId: ana.id, leaveTypeId: annual.id, amount: 0, reason: 'Nothing', actorId: null, year: YEAR,
        }),
        /cannot be zero/
      );
    });

    test('setOpeningBalance records the difference, not the target', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const delta = await service.setOpeningBalance(client, {
          employeeId: ana.id, leaveTypeId: annual.id, target: 12,
          reason: 'Bulk import: opening balance', actorId: null, year: YEAR,
        });
        await client.query('COMMIT');
        // Seeded at the type's 20 days, so reaching 12 is a reduction of 8.
        assert.equal(delta, -8);
      } finally {
        client.release();
      }
      assert.equal((await readBalance(pool, ana.id, annual.id, YEAR)).balance, 12);
    });

    test('setOpeningBalance does nothing when the balance already matches', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const delta = await service.setOpeningBalance(client, {
          employeeId: ana.id, leaveTypeId: annual.id, target: 20,
          reason: 'Bulk import: opening balance', actorId: null, year: YEAR,
        });
        await client.query('COMMIT');
        assert.equal(delta, 0);
      } finally {
        client.release();
      }
      const { rows } = await pool.query('SELECT * FROM hr_leave_adjustments WHERE employee_id = $1', [ana.id]);
      assert.equal(rows.length, 0, 'no adjustment row for a no-op');
    });
  });
});

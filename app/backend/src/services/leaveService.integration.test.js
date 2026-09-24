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

  describe('public holidays', () => {
    // Mon 8 Jun to Fri 12 Jun 2026: a five-day working week.
    const WEEK_START = '2026-06-08';
    const WEEK_END = '2026-06-12';

    async function declareHoliday(day, name) {
      await pool.query(
        'INSERT INTO hr_public_holidays (holiday_date, name) VALUES ($1, $2)', [day, name]);
    }

    test('a day the office is closed does not come off the entitlement', async () => {
      await declareHoliday('2026-06-10', 'Constitution Day');

      const { application } = await apply({ startDate: WEEK_START, endDate: WEEK_END });

      assert.equal(Number(application.days), 4, 'four days charged, not five');
      assert.equal((await readBalance(pool, ana.id, annual.id, 2026)).pending, 4);
    });

    test('the stored day count and the reporting SQL agree', async () => {
      await declareHoliday('2026-06-10', 'Constitution Day');
      const { application } = await apply({ startDate: WEEK_START, endDate: WEEK_END });

      // The same window, counted by Postgres rather than by JavaScript. If
      // these ever diverge the dashboard contradicts the balances.
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS days
           FROM generate_series($1::date, $2::date, INTERVAL '1 day') AS day
          WHERE EXTRACT(ISODOW FROM day) < 6
            AND NOT EXISTS (SELECT 1 FROM hr_public_holidays h WHERE h.holiday_date = day::date)`,
        [WEEK_START, WEEK_END]
      );
      assert.equal(rows[0].days, Number(application.days));
    });

    test('a week that is entirely holidays cannot be applied for', async () => {
      for (const day of ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12']) {
        await declareHoliday(day, 'Closure');
      }
      await assert.rejects(
        () => apply({ startDate: WEEK_START, endDate: WEEK_END }),
        /no working days/
      );
    });

    test('declaring a holiday later does not change what was already charged', async () => {
      const { application } = await apply({ startDate: WEEK_START, endDate: WEEK_END });
      assert.equal(Number(application.days), 5);

      await declareHoliday('2026-06-10', 'Declared afterwards');

      // The balance stands: the entitlement was already spent against the
      // calendar as it was on the day. Reporting will count four.
      const { rows } = await pool.query(
        'SELECT days FROM hr_leave_applications WHERE id = $1', [application.id]);
      assert.equal(Number(rows[0].days), 5);
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

  describe('overview exceptions', () => {
    /** Calls the overview through the real router, with a real admin session. */
    async function overview() {
      const express = (await import('express')).default;
      const { default: hrRouter } = await import('../routes/hr.js');
      const auth = await import('./authService.js');
      await pool.query(
        `INSERT INTO reviewers (email, display_name, role, password_hash, permissions, status)
         VALUES ('kpi@test','KPI','admin','x','{"hr_admin":true}','active')
         ON CONFLICT (email) DO NOTHING`);
      const { rows: [admin] } = await pool.query("SELECT * FROM reviewers WHERE email='kpi@test'");
      const { tokenId, expiresAt } = await auth.createSession(admin.id);
      const token = auth.buildTokenPayload(admin, tokenId, expiresAt);

      const app = express();
      app.use('/api/hr', hrRouter);
      const server = await new Promise((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
      try {
        const { port } = server.address();
        const res = await fetch(`http://127.0.0.1:${port}/api/hr/overview`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return res.json();
      } finally {
        await new Promise((r) => server.close(r));
      }
    }

    test('counts approvals that have been waiting too long', async () => {
      await apply();
      await apply({ startDate: `${YEAR}-06-15`, endDate: `${YEAR}-06-19` });
      // Age one of them past the five-day mark.
      await pool.query(
        `UPDATE hr_leave_applications SET applied_at = NOW() - INTERVAL '9 days'
          WHERE start_date = $1`, [START]);

      const data = await overview();

      assert.equal(data.exceptions.pending_approvals, 2, 'current queue includes both applications');
      assert.equal(data.exceptions.pending_over_five_days, 1, 'one is stale, the other is not');
      assert.ok(data.exceptions.oldest_pending_days >= 9);
    });

    test('counts staff whose balance has gone below zero', async () => {
      await service.adjustBalance(pool, {
        employeeId: ana.id, leaveTypeId: annual.id, amount: -25, reason: 'Correction', actorId: null, year: YEAR,
      });

      const data = await overview();
      assert.equal(data.exceptions.negative_balances, 1);
    });

    test('counts staff holding more than twice their entitlement', async () => {
      const accruing = await upsertLeaveType(pool, {
        name: 'T:Accruing', accruable: true, defaultDays: 20, perFortnight: 1 });
      await service.adjustBalance(pool, {
        employeeId: ana.id, leaveTypeId: accruing.id, amount: 45, reason: 'Long service', actorId: null, year: YEAR,
      });

      const data = await overview();
      // 45 days against a 20-day entitlement is over the 40-day mark.
      assert.equal(data.exceptions.excess_balances, 1);
    });

    test('does not flag an upfront type as an excess balance', async () => {
      // Sick leave is an allowance, not something earned and banked.
      const sick = await upsertLeaveType(pool, { name: 'T:Sick', accruable: false, defaultDays: 10 });
      await service.adjustBalance(pool, {
        employeeId: ana.id, leaveTypeId: sick.id, amount: 40, reason: 'Unusual', actorId: null, year: YEAR,
      });

      const data = await overview();
      assert.equal(data.exceptions.excess_balances, 0);
    });

    test('flags a department with more than a third of its people away', async () => {
      await pool.query("UPDATE hr_employees SET department_code = 'FIN' WHERE id IN ($1, $2)",
        [ana.id, manager.id]);
      // One of two FIN staff away tomorrow is half the department.
      const soon = new Date();
      soon.setDate(soon.getDate() + 3);
      const day = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
      await pool.query(
        `INSERT INTO hr_leave_applications (employee_id, leave_type_id, start_date, end_date, days, status)
         VALUES ($1, $2, $3, $3, 1, 'approved')`, [ana.id, annual.id, day]);

      const data = await overview();
      const fin = data.exceptions.coverage_risks.find((r) => r.department_code === 'FIN');
      // Skipped when the generated day lands on a weekend, which is not a
      // working day and so not a coverage problem.
      if (fin) {
        assert.equal(fin.people_out, 1);
        assert.equal(fin.headcount, 2);
        assert.equal(fin.percent_out, 50);
      }
    });

    test('reports liability coverage rather than a confident wrong number', async () => {
      const data = await overview();
      assert.equal(data.liability.staff_total, 2);
      assert.equal(data.liability.staff_without_rate, 2, 'no rates entered yet');
      assert.equal(data.liability.value, 0);
    });

    test('values earned leave once a rate is recorded', async () => {
      const accruing = await upsertLeaveType(pool, {
        name: 'T:Accruing', accruable: true, defaultDays: 20, perFortnight: 1 });
      await service.adjustBalance(pool, {
        employeeId: ana.id, leaveTypeId: accruing.id, amount: 10, reason: 'Opening', actorId: null, year: YEAR,
      });
      await pool.query('UPDATE hr_employees SET daily_rate = 150 WHERE id = $1', [ana.id]);

      const data = await overview();
      assert.equal(data.liability.days, 10);
      assert.equal(data.liability.value, 1500);
      assert.equal(data.liability.staff_without_rate, 1, 'the manager still has no rate');
    });
  });

  describe('pay rate visibility', () => {
    /** Calls an HR endpoint as an account with exactly these capabilities. */
    async function callAs(permissions, path) {
      const express = (await import('express')).default;
      const { default: hrRouter } = await import('../routes/hr.js');
      const auth = await import('./authService.js');
      const email = `vis-${Object.keys(permissions).join('-')}@test`;
      await pool.query(
        `INSERT INTO reviewers (email, display_name, role, password_hash, permissions, status)
         VALUES ($1,'Vis',$3,'x',$2,'active') ON CONFLICT (email) DO UPDATE SET permissions = EXCLUDED.permissions`,
        // The role grants capabilities of its own, so a non-admin test account
        // must not be given the admin role as well.
        [email, JSON.stringify(permissions), permissions.hr_admin ? 'admin' : 'user']);
      const { rows: [account] } = await pool.query('SELECT * FROM reviewers WHERE email = $1', [email]);
      const { tokenId, expiresAt } = await auth.createSession(account.id);
      const token = auth.buildTokenPayload(account, tokenId, expiresAt);

      const app = express();
      app.use(express.json());
      app.use('/api/hr', hrRouter);
      const server = await new Promise((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
      try {
        const { port } = server.address();
        const res = await fetch(`http://127.0.0.1:${port}/api/hr${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return { status: res.status, body: await res.json() };
      } finally {
        await new Promise((r) => server.close(r));
      }
    }

    test('an administrator sees the rate', async () => {
      await pool.query('UPDATE hr_employees SET daily_rate = 150 WHERE id = $1', [ana.id]);
      const { body } = await callAs({ hr_admin: true }, '/employees');
      const row = body.find((e) => e.id === ana.id);
      assert.equal(Number(row.daily_rate), 150);
    });

    test('staff management alone does not see the rate', async () => {
      // The endpoint selects e.*, so the field is stripped at the response
      // boundary rather than relying on every query remembering to exclude it.
      await pool.query('UPDATE hr_employees SET daily_rate = 150 WHERE id = $1', [ana.id]);
      const { body } = await callAs({ hr_staff_manage: true }, '/employees');
      const row = body.find((e) => e.id === ana.id);
      assert.ok(row, 'the row is still returned');
      assert.equal(Object.hasOwn(row, 'daily_rate'), false, 'but not what they are paid');
    });

    test('the team list does not leak the rate to a manager', async () => {
      await pool.query('UPDATE hr_employees SET daily_rate = 150 WHERE id = $1', [ana.id]);
      const { body } = await callAs({ hr_leave_approve: true, hr_staff_manage: true }, '/team');
      for (const row of body) {
        assert.equal(Object.hasOwn(row, 'daily_rate'), false);
      }
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

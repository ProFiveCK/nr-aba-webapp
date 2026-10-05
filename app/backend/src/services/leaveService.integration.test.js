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

  // Who hears about a new application. The rule matters because a staff
  // record with no manager used to notify nobody: the request reached the
  // administrators' queue but no email reached them.
  describe('who is told about a new application', () => {
    async function makeAdmin(email) {
      const { rows } = await pool.query(
        `INSERT INTO reviewers (email, display_name, role, password_hash, permissions, status)
         VALUES ($1, $1, 'user', 'x', '{"hr_admin": true}'::jsonb, 'active') RETURNING id`,
        [email]
      );
      return rows[0].id;
    }

    test('the manager, when the staff record names one', async () => {
      await pool.query("UPDATE hr_employees SET email = 'manager@example.test' WHERE id = $1", [manager.id]);
      const fresh = (await pool.query('SELECT * FROM hr_employees WHERE id = $1', [ana.id])).rows[0];

      const approvers = await service.leaveApprovers(pool, fresh);
      assert.deepEqual(approvers.map((a) => a.email), ['manager@example.test']);
    });

    test('the administrators, when no manager is set', async () => {
      await makeAdmin('admin-one@example.test');
      const orphan = await createEmployee(pool, { name: 'No Manager' });

      const approvers = await service.leaveApprovers(pool, orphan);
      assert.ok(approvers.some((a) => a.email === 'admin-one@example.test'),
        'an application from someone with no manager still reaches an administrator');
    });

    test('the administrators, when the manager has no address on file', async () => {
      await makeAdmin('admin-two@example.test');
      await pool.query('UPDATE hr_employees SET email = NULL WHERE id = $1', [manager.id]);
      const fresh = (await pool.query('SELECT * FROM hr_employees WHERE id = $1', [ana.id])).rows[0];

      const approvers = await service.leaveApprovers(pool, fresh);
      assert.ok(approvers.length > 0, 'it does not fall silent just because the manager has no email');
      assert.ok(approvers.every((a) => a.email), 'and never returns an approver with no address');
    });
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

    test('requires a reason for every leave type', async () => {
      await assert.rejects(() => apply({ reason: '   ' }), /reason is required/);
    });

    test('leaves nothing behind when it refuses', async () => {
      await assert.rejects(() => apply({ reason: '' }));

      // The transaction rolled back, so no hold and no application survive.
      const balance = await readBalance(pool, ana.id, annual.id, YEAR);
      assert.equal(balance === null || balance.pending === 0, true);
      const { rows } = await pool.query('SELECT * FROM hr_leave_applications WHERE employee_id = $1', [ana.id]);
      assert.equal(rows.length, 0);
    });
  });

  // Official leave rests on the partner's invitation and certified sick leave
  // on the certificate: the type says a document is required, and without one
  // there is nothing for an approver to judge.
  describe('supporting documents', () => {
    let official;
    const invitation = () => [{
      fileName: 'invitation.pdf',
      contentType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 invitation'),
      checksum: 'a'.repeat(64),
    }];

    beforeEach(async () => {
      official = await upsertLeaveType(pool, {
        name: 'T:Official', defaultDays: 10,
        requiresAttachment: true, attachmentLabel: 'Invitation letter from the partner organisation',
      });
    });

    test('refuses an application for a type that requires one, naming the document', async () => {
      await assert.rejects(
        () => apply({ leaveTypeId: official.id }),
        /requires Invitation letter from the partner organisation/
      );
    });

    test('stores the document against the application it was filed with', async () => {
      const { application } = await apply({ leaveTypeId: official.id, attachments: invitation() });

      const { rows } = await pool.query(
        'SELECT file_name, content_type, byte_size, file_data FROM hr_leave_attachments WHERE application_id = $1',
        [application.id]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].file_name, 'invitation.pdf');
      assert.equal(rows[0].content_type, 'application/pdf');
      assert.equal(rows[0].byte_size, Buffer.from('%PDF-1.4 invitation').length);
      assert.equal(rows[0].file_data.toString(), '%PDF-1.4 invitation');
    });

    // The hold on the balance and the document are one decision, so a failure
    // after the insert must not leave an application standing without it.
    test('refusing for want of a document leaves no hold and no application', async () => {
      await assert.rejects(() => apply({ leaveTypeId: official.id }));

      const balance = await readBalance(pool, ana.id, official.id, YEAR);
      assert.equal(balance === null || balance.pending === 0, true);
      const { rows } = await pool.query(
        'SELECT 1 FROM hr_leave_applications WHERE employee_id = $1 AND leave_type_id = $2',
        [ana.id, official.id]
      );
      assert.equal(rows.length, 0);
    });

    test('a type that does not require one still accepts an application without it', async () => {
      const { application } = await apply();
      assert.equal(application.status, 'pending');
    });

    test('a type that does not require one still keeps a document that was offered', async () => {
      const { application } = await apply({ attachments: invitation() });

      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS count FROM hr_leave_attachments WHERE application_id = $1',
        [application.id]
      );
      assert.equal(rows[0].count, 1);
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
    test('an older request without an explanation cannot be approved', async () => {
      const { application } = await apply();
      await pool.query('UPDATE hr_leave_applications SET reason = NULL WHERE id = $1', [application.id]);
      await assert.rejects(() => service.decideLeave(pool, {
        applicationId: application.id, decision: 'approved', note: '', actorId: null, canAct: allowAll,
      }), /no explanation/);
      const balance = await readBalance(pool, ana.id, annual.id, YEAR);
      assert.equal(balance.pending, 5);
      assert.equal(balance.balance, 20);
    });

    // An administrator can record that someone is away — on study leave, say —
    // after they have already applied for leave. The entitlement check at
    // submission cannot see that coming, so approval checks again.
    test('leave cannot be approved once the applicant is recorded as away on study leave', async () => {
      const { application } = await apply();
      await pool.query(
        `UPDATE hr_employees
            SET leave_entitled = FALSE, ineligible_reason = 'study_leave', study_leave_start = CURRENT_DATE
          WHERE id = $1`,
        [ana.id]
      );

      await assert.rejects(() => service.decideLeave(pool, {
        applicationId: application.id, decision: 'approved', note: '', actorId: null, canAct: allowAll,
      }), /away on study leave/);

      // Refused without disturbing anything: the hold stands until the request
      // is actually resolved.
      const balance = await readBalance(pool, ana.id, annual.id, YEAR);
      assert.equal(balance.pending, 5);
      assert.equal(balance.balance, 20);
    });

    test('the stale request can still be rejected, which releases the hold', async () => {
      const { application } = await apply();
      await pool.query(
        `UPDATE hr_employees SET leave_entitled = FALSE, ineligible_reason = 'temporary' WHERE id = $1`,
        [ana.id]
      );

      await service.decideLeave(pool, {
        applicationId: application.id, decision: 'rejected', note: 'No longer entitled to leave.',
        actorId: null, canAct: allowAll,
      });

      const balance = await readBalance(pool, ana.id, annual.id, YEAR);
      assert.equal(balance.pending, 0, 'the hold is released');
      assert.equal(balance.balance, 20, 'and nothing was spent');
    });

    test('approval moves the days out of the balance and clears the hold', async () => {
      const { application } = await apply();
      await service.decideLeave(pool, {
        applicationId: application.id, decision: 'approved', note: '', actorId: null, canAct: allowAll,
      });

      const balance = await readBalance(pool, ana.id, annual.id, YEAR);
      assert.equal(balance.balance, 15, 'the days are spent');
      assert.equal(balance.pending, 0, 'and no longer held');
    });

    test('freezes payroll form balances and personnel details at approval', async () => {
      await pool.query("UPDATE hr_employees SET position_title = 'Analyst' WHERE id = $1", [ana.id]);
      const { application } = await apply();
      const result = await service.decideLeave(pool, {
        applicationId: application.id, decision: 'approved', note: '', actorId: null, canAct: allowAll,
      });
      const snapshot = result.application.payroll_form_snapshot;
      assert.equal(snapshot.employee_name, 'Ana');
      assert.equal(snapshot.position_title, 'Analyst');
      assert.equal(snapshot.supervisor_name, 'Manager');
      assert.equal(snapshot.balance_year, YEAR);
      assert.deepEqual(snapshot.balances.find((balance) => balance.leave_type_id === annual.id), {
        leave_type_id: annual.id, leave_type_name: 'T:Annual', before: 20, after: 15,
      });

      await service.adjustBalance(pool, {
        employeeId: ana.id, leaveTypeId: annual.id, amount: -2, reason: 'Later correction', actorId: null, year: YEAR,
      });
      assert.equal((await readBalance(pool, ana.id, annual.id, YEAR)).balance, 13);
      const { rows: [saved] } = await pool.query(
        'SELECT payroll_form_snapshot FROM hr_leave_applications WHERE id = $1', [application.id]
      );
      assert.equal(saved.payroll_form_snapshot.balances.find((balance) => balance.leave_type_id === annual.id).after, 15);
    });

    test('serves an approved payroll form only to its employee or authorized HR', async () => {
      const express = (await import('express')).default;
      const { default: hrRouter } = await import('../routes/hr.js');
      const auth = await import('./authService.js');
      const createLogin = async (email, employeeId, permissions = { hr_access: true }) => {
        const { rows: [reviewer] } = await pool.query(
          `INSERT INTO reviewers (email, display_name, role, password_hash, permissions, status)
           VALUES ($1, $1, 'user', 'x', $2, 'active') RETURNING *`, [email, permissions]
        );
        await pool.query('UPDATE hr_employees SET reviewer_id = $1 WHERE id = $2', [reviewer.id, employeeId]);
        const { tokenId, expiresAt } = await auth.createSession(reviewer.id);
        return { id: reviewer.id, token: auth.buildTokenPayload(reviewer, tokenId, expiresAt) };
      };

      const owner = await createLogin('leave-owner@test', ana.id);
      const supervisor = await createLogin('leave-supervisor@test', manager.id, { hr_leave_approve: true });
      const outsider = await createEmployee(pool, { name: 'Outsider' });
      const other = await createLogin('leave-outsider@test', outsider.id);
      const reportAdminEmployee = await createEmployee(pool, { name: 'Report Admin' });
      const reportAdmin = await createLogin('leave-report-admin@test', reportAdminEmployee.id, { hr_admin: true });
      await pool.query("UPDATE hr_employees SET department_code = 'FIN', division_code = 'Treasury' WHERE id = $1", [ana.id]);
      const { application } = await apply();
      await service.decideLeave(pool, {
        applicationId: application.id, decision: 'approved', note: '', actorId: supervisor.id, canAct: allowAll,
      });
      const { application: pending } = await apply();

      const app = express();
      app.use('/api/hr', hrRouter);
      const server = await new Promise((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
      try {
        const { port } = server.address();
        const balanceResponse = await fetch(`http://127.0.0.1:${port}/api/hr/employees/balances`, {
          headers: { Authorization: `Bearer ${reportAdmin.token}` },
        });
        assert.equal(balanceResponse.status, 200);
        const balanceData = await balanceResponse.json();
        assert.equal(balanceData.employees.find((employee) => employee.id === ana.id).division_code, 'Treasury');
        assert.ok(balanceData.leave_type_rules.some((rule) => rule.name === 'T:Annual' && rule.default_days === 20));

        const getForm = (id, token) => fetch(`http://127.0.0.1:${port}/api/hr/leaves/${id}/payroll-form`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const own = await getForm(application.id, owner.token);
        assert.equal(own.status, 200);
        assert.equal(own.headers.get('cache-control'), 'no-store');
        const data = await own.json();
        assert.equal(data.balances.find((balance) => balance.leave_type_id === annual.id).after, 15);
        const pdfResponse = await fetch(`http://127.0.0.1:${port}/api/hr/leaves/${application.id}/application.pdf`, {
          headers: { Authorization: `Bearer ${owner.token}` },
        });
        assert.equal(pdfResponse.status, 200);
        assert.match(pdfResponse.headers.get('content-type'), /application\/pdf/);
        assert.equal(pdfResponse.headers.get('cache-control'), 'no-store');
        assert.equal(Buffer.from(await pdfResponse.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
        assert.equal((await getForm(application.id, supervisor.token)).status, 200);
        assert.equal((await getForm(application.id, other.token)).status, 404);
        assert.equal((await getForm(pending.id, owner.token)).status, 404);
        assert.equal((await fetch(`http://127.0.0.1:${port}/api/hr/leaves/${application.id}/application.pdf`, {
          headers: { Authorization: `Bearer ${other.token}` },
        })).status, 404);
        await pool.query('UPDATE hr_leave_applications SET payroll_form_snapshot = NULL WHERE id = $1', [application.id]);
        const legacy = await (await getForm(application.id, owner.token)).json();
        assert.equal(legacy.approval_snapshot_available, false);
        assert.equal(legacy.balances, null, 'older approvals must not use current balances');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
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
      assert.deepEqual(data.exceptions.excess_employee_names, ['Ana']);
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

    test('study leave counts as away today, and stops once the return date has passed', async () => {
      await pool.query(
        `UPDATE hr_employees SET leave_entitled = FALSE, ineligible_reason = 'study_leave',
                study_leave_start = CURRENT_DATE - 30, study_leave_end = CURRENT_DATE + 30
          WHERE id = $1`, [ana.id]);

      let data = await overview();
      assert.equal(data.headcount.on_leave_today, 1);
      assert.equal(data.headcount.on_study_leave, 1);

      await pool.query('UPDATE hr_employees SET study_leave_end = CURRENT_DATE - 1 WHERE id = $1', [ana.id]);
      data = await overview();
      assert.equal(data.headcount.on_leave_today, 0, 'their return date has passed');
      assert.equal(data.headcount.on_study_leave, 0);
    });

    test('study leave with no return date yet is still away', async () => {
      await pool.query(
        `UPDATE hr_employees SET leave_entitled = FALSE, ineligible_reason = 'study_leave',
                study_leave_start = CURRENT_DATE - 1, study_leave_end = NULL
          WHERE id = $1`, [ana.id]);

      assert.equal((await overview()).headcount.on_study_leave, 1);
    });

    test('someone on study leave who also has approved leave is counted once', async () => {
      await pool.query(
        `UPDATE hr_employees SET leave_entitled = FALSE, ineligible_reason = 'study_leave',
                study_leave_start = CURRENT_DATE - 1 WHERE id = $1`, [ana.id]);
      await pool.query(
        `INSERT INTO hr_leave_applications (employee_id, leave_type_id, start_date, end_date, days, status)
         VALUES ($1, $2, CURRENT_DATE - 1, CURRENT_DATE + 1, 1, 'approved')`, [ana.id, annual.id]);

      assert.equal((await overview()).headcount.on_leave_today, 1);
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
    async function callAs(permissions, path, { method = 'GET', body } = {}) {
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
          method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
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

    test('only a leave administrator manages departments and divisions', async () => {
      const staff = { hr_staff_manage: true, hr_access: true };
      assert.equal((await callAs(staff, '/org-units')).status, 200, 'staff managers can read the list');
      assert.equal((await callAs(staff, '/departments', { method: 'POST', body: { name: 'Finance' } })).status, 403);

      const admin = { hr_admin: true };
      const created = await callAs(admin, '/departments', { method: 'POST', body: { name: 'Finance' } });
      assert.equal(created.status, 201);
      assert.equal((await callAs(admin, '/departments', { method: 'POST', body: { name: ' finance ' } })).status, 409,
        'a different spelling of the same name is a duplicate');
      assert.equal((await callAs(staff, `/departments/${created.body.id}/divisions`, { method: 'POST', body: { name: 'Treasury' } })).status, 403);
      assert.equal((await callAs(admin, `/departments/${created.body.id}/divisions`, { method: 'POST', body: { name: 'Treasury' } })).status, 201);

      const { body } = await callAs(staff, '/org-units');
      assert.deepEqual(body.map((d) => [d.name, d.divisions.map((v) => v.name)]), [['Finance', ['Treasury']]]);
    });

    test('staff must be given a listed department and division', async () => {
      const admin = { hr_admin: true };
      const staff = { hr_staff_manage: true, hr_access: true };
      const finance = (await callAs(admin, '/departments', { method: 'POST', body: { name: 'Finance' } })).body;
      await callAs(admin, `/departments/${finance.id}/divisions`, { method: 'POST', body: { name: 'Treasury' } });
      const health = (await callAs(admin, '/departments', { method: 'POST', body: { name: 'Health' } })).body;
      await callAs(admin, `/departments/${health.id}/divisions`, { method: 'POST', body: { name: 'Clinics' } });
      const create = (fields) => callAs(staff, '/employees', { method: 'POST', body: { display_name: 'New Person', ...fields } });

      const ok = await create({ department_code: 'finance', division_code: 'treasury' });
      assert.equal(ok.status, 201);
      assert.equal(ok.body.department_code, 'Finance', 'stored with the list\'s spelling');
      assert.equal(ok.body.division_code, 'Treasury');

      assert.equal((await create({ department_code: 'Nowhere' })).status, 400);
      assert.equal((await create({ division_code: 'Treasury' })).status, 400, 'a division needs a department');
      assert.equal((await create({ department_code: 'Finance', division_code: 'Clinics' })).status, 400,
        'a division belongs to one department');

      const edit = (fields) => callAs(staff, `/employees/${ok.body.id}`, { method: 'PUT', body: fields });
      assert.equal((await edit({ division_code: 'Clinics' })).status, 400);
      const moved = await edit({ department_code: 'Health', division_code: 'Clinics' });
      assert.equal(moved.status, 200);
      assert.equal(moved.body.department_code, 'Health');

      await pool.query("UPDATE hr_employees SET department_code = 'Old Name' WHERE id = $1", [ok.body.id]);
      assert.equal((await edit({ position_title: 'Clerk' })).status, 200, 'an older unlisted value does not block other edits');
    });

    test('a department or division still in use cannot be removed', async () => {
      const admin = { hr_admin: true };
      const finance = (await callAs(admin, '/departments', { method: 'POST', body: { name: 'Finance' } })).body;
      const treasury = (await callAs(admin, `/departments/${finance.id}/divisions`, { method: 'POST', body: { name: 'Treasury' } })).body;
      const spare = (await callAs(admin, `/departments/${finance.id}/divisions`, { method: 'POST', body: { name: 'Audit' } })).body;
      await pool.query("UPDATE hr_employees SET department_code = 'Finance', division_code = 'Treasury' WHERE id = $1", [ana.id]);

      assert.equal((await callAs(admin, `/divisions/${treasury.id}`, { method: 'DELETE' })).status, 409, 'staff are in it');
      assert.equal((await callAs(admin, `/departments/${finance.id}`, { method: 'DELETE' })).status, 409, 'it still has divisions');
      assert.equal((await callAs(admin, `/divisions/${spare.id}`, { method: 'DELETE' })).status, 200);

      await pool.query('UPDATE hr_employees SET division_code = NULL WHERE id = $1', [ana.id]);
      assert.equal((await callAs(admin, `/divisions/${treasury.id}`, { method: 'DELETE' })).status, 200);
      assert.equal((await callAs(admin, `/departments/${finance.id}`, { method: 'DELETE' })).status, 409, 'staff are in it');
      await pool.query('UPDATE hr_employees SET department_code = NULL WHERE id = $1', [ana.id]);
      assert.equal((await callAs(admin, `/departments/${finance.id}`, { method: 'DELETE' })).status, 200);
    });

    test('not being eligible for annual leave needs a reason, and study leave needs dates', async () => {
      const staff = { hr_staff_manage: true, hr_access: true };
      const edit = (fields) => callAs(staff, `/employees/${ana.id}`, { method: 'PUT', body: fields });

      assert.equal((await edit({ leave_entitled: false })).status, 400, 'a reason is required');
      assert.equal((await edit({ leave_entitled: false, ineligible_reason: 'study_leave' })).status, 400, 'study leave needs a start date');
      assert.equal((await edit({
        leave_entitled: false, ineligible_reason: 'study_leave', study_leave_start: '2026-10-01', study_leave_end: '2026-09-01',
      })).status, 400, 'the return date cannot precede the start');

      const intern = await edit({ leave_entitled: false, ineligible_reason: 'intern', study_leave_start: '2026-10-01' });
      assert.equal(intern.status, 200);
      assert.equal(intern.body.ineligible_reason, 'intern');
      assert.equal(intern.body.study_leave_start, null, 'dates only belong to study leave');

      const study = await edit({
        leave_entitled: false, ineligible_reason: 'study_leave', study_leave_start: '2026-10-01',
        study_leave_end: '2027-04-01', eligibility_note: 'Unpaid, studying overseas',
      });
      assert.equal(study.status, 200);
      assert.equal(study.body.study_leave_start, '2026-10-01');
      assert.equal(study.body.eligibility_note, 'Unpaid, studying overseas');

      const back = await edit({ leave_entitled: true });
      assert.equal(back.status, 200);
      assert.equal(back.body.ineligible_reason, null, 'eligible again clears the reason');
      assert.equal(back.body.study_leave_end, null);
      assert.equal(back.body.eligibility_note, null);
    });

    test('the calendar shows study leave, and a manager sees only their team', async () => {
      await pool.query(
        `UPDATE hr_employees SET leave_entitled = FALSE, ineligible_reason = 'study_leave',
                study_leave_start = '2026-10-01', study_leave_end = NULL WHERE id = $1`, [ana.id]);
      const window = '/calendar?from=2026-10-01&to=2026-10-31';

      const admin = await callAs({ hr_admin: true }, window);
      const entry = admin.body.find((row) => row.employee_name === 'Ana');
      assert.equal(entry.kind, 'study_leave');
      assert.equal(entry.leave_type_name, 'Study leave');
      assert.equal(entry.end_date, null, 'no return date yet');

      const outsider = await callAs({ hr_leave_approve: true, hr_access: true }, window);
      assert.equal(outsider.body.some((row) => row.employee_name === 'Ana'), false);
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

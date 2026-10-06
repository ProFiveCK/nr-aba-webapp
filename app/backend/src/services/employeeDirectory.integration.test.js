import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach, describe } from 'node:test';
import { connectTestDatabase, createEmployee, resetLeaveTables, skipWithoutDatabase, upsertLeaveType } from '../test-support/database.js';

describe('employee directory and enterprise approval foundation', { skip: skipWithoutDatabase }, () => {
  let pool, directory, auth, actor, server, base;
  const reason = 'HR verified against the Payroll export and appointment record.';

  before(async () => {
    pool = await connectTestDatabase();
    directory = await import('./employeeDirectory.js');
    auth = await import('./authService.js');
    const express = (await import('express')).default;
    const errors = await import('../middleware/errors.js');
    errors.enableAsyncErrors();
    const { default: hrRouter } = await import('../routes/hr.js');
    const { default: authRouter } = await import('../routes/auth.js');
    const { createEmployeeApiLimiter } = await import('../middleware/employeeApiLimit.js');
    const limiter = createEmployeeApiLimiter(2);
    const app = express();
    app.use(express.json());
    app.use('/api/hr', hrRouter);
    app.use('/api/auth', authRouter);
    app.get('/api/batches', auth.requireAuth(), (_req, res) => res.json({ ok: true }));
    app.get('/api/hr/limited-test', auth.requireAuth(), limiter, (_req, res) => res.json({ ok: true }));
    app.use(errors.errorHandler);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool?.end();
  });
  beforeEach(async () => {
    await resetLeaveTables(pool);
    actor = await account({ role: 'admin', permissions: { hr_admin: true, hr_access: true } });
  });

  async function account({ role = 'user', type = 'staff', name = 'Employee', permissions = {} } = {}) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO reviewers (email, display_name, role, account_type, password_hash, permissions)
       VALUES ($1,$2,$3,$4,'x',$5) RETURNING *`, [`employee-test-${randomUUID()}@example.test`, name, role, type, permissions]
    );
    return row;
  }
  async function tokenFor(row) {
    const { tokenId, expiresAt } = await auth.createSession(row.id);
    return auth.buildTokenPayload(row, tokenId, expiresAt);
  }
  async function call(token, path, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  const verifyLink = (employee, login) => import('../lib/transaction.js').then(({ withTransaction }) => withTransaction(pool,
    (client) => directory.setEmployeeAccount(client, { employeeId: employee.id, reviewerId: login?.id || null, actor, reason })));
  async function organisation(name = 'Finance') {
    const { rows: [department] } = await pool.query('INSERT INTO hr_departments (name) VALUES ($1) RETURNING *', [name]);
    const { rows: [division] } = await pool.query("INSERT INTO hr_divisions (department_id, name) VALUES ($1, 'Treasury') RETURNING *", [department.id]);
    return { department, division };
  }

  test('migration can run again and preserves existing identities and links', async () => {
    const employee = await createEmployee(pool, { name: 'Existing staff', joinDate: '2020-01-01' });
    await verifyLink(employee, actor);
    const { initSchema } = await import('../db.js');
    await initSchema();
    const result = await directory.linkedEmployee(pool, actor.id);
    assert.equal(result.id, employee.id);
    assert.equal(result.join_date, '2020-01-01');
    assert.equal((await auth.lookupSession((await auth.createSession(actor.id)).tokenId)).account_type, 'staff');
  });

  test('first use cannot claim a matching name or create a staff record; inactive links fail', async () => {
    const employee = await createEmployee(pool, { name: 'Same Name' });
    const login = await account({ name: 'Same Name', permissions: { hr_access: true } });
    const response = await call(await tokenFor(login), '/api/hr/me');
    assert.equal(response.status, 403);
    assert.match(response.body.message, /not been linked/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_employees')).rows[0].n, 1);
    assert.equal((await directory.employeeProfile(pool, employee.id)).employee.reviewer_id, null);
    await verifyLink(employee, login);
    await pool.query("UPDATE hr_employees SET status = 'inactive' WHERE id = $1", [employee.id]);
    await assert.rejects(directory.linkedEmployee(pool, login.id), { status: 403 });
  });

  test('Payroll IDs retain zeros and letters; retries are safe and cross-person conflicts block', async () => {
    const first = await createEmployee(pool, { name: 'First' }), second = await createEmployee(pool, { name: 'Second' });
    const options = { employeeId: first.id, externalId: '000123-A', actor, reason };
    const identifier = await directory.addEmployeeExternalId(pool, options);
    assert.equal(identifier.external_id, '000123-A');
    assert.equal((await directory.addEmployeeExternalId(pool, options)).id, identifier.id);
    await assert.rejects(directory.addEmployeeExternalId(pool, { ...options, employeeId: second.id }), { status: 409 });
    await assert.rejects(directory.addEmployeeExternalId(pool, { ...options, externalId: 123 }), { status: 400 });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_employee_external_ids')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_leave_balances')).rows[0].n, 0);
  });

  test('verified linking is exclusive, revokes sessions and rolls back on an audit failure', async () => {
    const first = await createEmployee(pool, { name: 'First' }), second = await createEmployee(pool, { name: 'Second' });
    const login = await account();
    const session = await auth.createSession(login.id);
    const results = await Promise.allSettled([verifyLink(first, login), verifyLink(second, login)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.find((result) => result.status === 'rejected').reason.status, 409);
    assert.equal(await auth.lookupSession(session.tokenId), null);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_employee_account_links')).rows[0].n, 1);
    const winner = results.find((result) => result.status === 'fulfilled').value;
    const { withTransaction } = await import('../lib/transaction.js');
    const keepSession = await auth.createSession(login.id);
    await assert.rejects(withTransaction(pool, (client) => directory.setEmployeeAccount(client,
      { employeeId: winner.id, reviewerId: null, actor: { id: randomUUID() }, reason })), { code: '23503' });
    assert.equal((await directory.employeeProfile(pool, winner.id)).employee.reviewer_id, login.id);
    assert.ok(await auth.lookupSession(keepSession.tokenId));
  });

  test('employee-only provisioning requires a verified ID and does not grant finance access', async () => {
    const employee = await createEmployee(pool, { name: 'New Employee' });
    const options = { employeeId: employee.id, email: `provision-${randomUUID()}@example.test`, actor, reason };
    await assert.rejects(directory.provisionEmployeeAccount(pool, options), { status: 400 });
    await directory.addEmployeeExternalId(pool, { employeeId: employee.id, externalId: '000010', actor, reason });
    const result = await directory.provisionEmployeeAccount(pool, options);
    let { rows: [login] } = await pool.query('SELECT * FROM reviewers WHERE id = $1', [result.account.id]);
    assert.equal(login.account_type, 'employee');
    assert.equal(login.must_change_password, true);
    assert.deepEqual((await auth.loadCapabilities(login.id)).sort(), ['hr_access', 'hr_leave_apply']);
    const blockedToken = await tokenFor(login);
    assert.equal((await call(blockedToken, '/api/hr/me')).status, 403);
    const changed = await call(blockedToken, '/api/auth/change-password', { current_password: result.temporary_password, new_password: 'Employee-Changed-Password-42!' });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.reviewer.account_type, 'employee');
    const token = changed.body.token;
    assert.equal((await call(token, '/api/hr/me')).status, 200);
    const leaveType = await upsertLeaveType(pool, { name: 'T:EmployeeFoundation', defaultDays: 20 });
    assert.equal((await call(token, '/api/hr/leaves', { leave_type_id: leaveType.id, start_date: '2026-10-20', end_date: '2026-10-21', reason })).status, 409,
      'submission waits for the government staged workflow');
    const { rows: [application] } = await pool.query(`INSERT INTO hr_leave_applications (employee_id, leave_type_id, start_date, end_date, days, status)
      VALUES ($1,$2,'2026-10-20','2026-10-21',2,'pending') RETURNING id`, [employee.id, leaveType.id]);
    assert.equal((await call(await tokenFor(actor), `/api/hr/leaves/${application.id}/decision`, { decision: 'approved' })).status, 409,
      'the legacy final decision cannot grant government employee leave');
    assert.equal((await call(token, '/api/batches')).status, 403, 'even a legacy any-login gate cannot admit an employee-only account');
    const refreshed = await call(token, '/api/auth/refresh', {}, 'POST');
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.reviewer.account_type, 'employee');
    assert.equal(refreshed.body.reviewer.permissions.submit_aba, undefined);
    const patched = await call(refreshed.body.token, '/api/auth/me', { display_name: 'Updated Name' }, 'PATCH');
    assert.equal(patched.status, 200);
    assert.equal(patched.body.reviewer.permissions.submit_forex_tt, undefined);
    login = (await pool.query('SELECT * FROM reviewers WHERE id = $1', [login.id])).rows[0];
    assert.equal(auth.reviewerSummary({ ...login, permissions: { submit_aba: true } }, [], ['hr_access']).permissions.submit_aba, undefined);
    assert.equal(auth.reviewerSummary(actor).permissions.submit_aba, true, 'legacy staff access is preserved');
    await pool.query("UPDATE hr_employees SET status = 'inactive' WHERE id = $1", [employee.id]);
    assert.equal((await call(refreshed.body.token, '/api/hr/public-holidays')).status, 403,
      'employee deactivation blocks every authenticated endpoint without waiting for token expiry');
  });

  test('2,000 employee records use bounded, stable pages and exact Payroll ID search', async (t) => {
    await pool.query(`INSERT INTO hr_employees (display_name) SELECT 'Synthetic Employee ' || lpad(i::text, 4, '0') FROM generate_series(1,2000) i`);
    const start = performance.now();
    const first = await directory.listEmployeeDirectory(pool), second = await directory.listEmployeeDirectory(pool, { page: 2 });
    assert.equal(first.total, 2000);
    assert.equal(first.employees.length, 50);
    assert.equal(second.employees.length, 50);
    assert.equal(new Set([...first.employees, ...second.employees].map((row) => row.id)).size, 100);
    await directory.addEmployeeExternalId(pool, { employeeId: first.employees[0].id, externalId: '0002000-X', actor, reason });
    const found = await directory.listEmployeeDirectory(pool, { search: '0002000-X' });
    assert.equal(found.total, 1);
    assert.equal(found.employees[0].id, first.employees[0].id);
    const token = await tokenFor(actor);
    assert.equal((await call(token, '/api/hr/directory?page_size=101')).status, 422);
    t.diagnostic(`Synthetic 2,000-row directory checks completed in ${Math.round(performance.now() - start)} ms; this is not a concurrent-user load test.`);
  });

  test('service periods preserve temporary/intern classification and prevent concurrent overlaps', async () => {
    const employee = await createEmployee(pool, { name: 'Temporary intern' });
    const options = { employeeId: employee.id, period: { start_date: '2026-01-01', employment_category: 'temporary', is_intern: true }, actor, reason };
    await assert.rejects(directory.addServicePeriod(pool, { ...options, period: { ...options.period, end_date: '2025-12-31' } }), { status: 400 });
    const results = await Promise.allSettled([directory.addServicePeriod(pool, options), directory.addServicePeriod(pool, options)]);
    assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
    assert.equal(results.find((row) => row.status === 'rejected').reason.status, 409);
    const first = results.find((row) => row.status === 'fulfilled').value;
    assert.equal(first.counts_for_service, null, 'unknown service treatment is not guessed');
    assert.equal(first.is_intern, true);
    await directory.closeServicePeriod(pool, { employeeId: employee.id, periodId: first.id, endDate: '2026-03-31', actor, reason });
    await directory.addServicePeriod(pool, { ...options, period: { start_date: '2026-04-01', employment_category: 'permanent' } });
    assert.equal((await directory.employeeProfile(pool, employee.id)).service_periods.length, 2);
    assert.equal((await pool.query('SELECT leave_entitled FROM hr_employees WHERE id = $1', [employee.id])).rows[0].leave_entitled, true);
  });

  test('three-stage authority is scoped to a division/department, effective-dated, and fails closed', async () => {
    const { department, division } = await organisation();
    const other = await organisation('Health');
    const applicant = await createEmployee(pool, { name: 'Applicant' });
    await assert.rejects(directory.setEmployeeOrganisation(pool, { employeeId: applicant.id, departmentId: department.id,
      divisionId: other.division.id, actor, reason }), { status: 400 });
    await directory.setEmployeeOrganisation(pool, { employeeId: applicant.id, departmentId: department.id, divisionId: division.id, actor, reason });
    const heads = [];
    for (const level of directory.APPROVAL_LEVELS) {
      const employee = await createEmployee(pool, { name: level });
      const login = await account({ type: 'employee' });
      await verifyLink(employee, login);
      await pool.query("INSERT INTO reviewer_capabilities (reviewer_id, capability) VALUES ($1,'hr_leave_approve')", [login.id]);
      const assignment = { level, department_id: level === 'chief_secretary' ? null : department.id,
        division_id: level === 'division' ? division.id : null, approver_employee_id: employee.id, effective_from: '2026-01-01' };
      const created = await directory.assignLeaveApprover(pool, { assignment, actor, reason });
      heads.push({ employee, login, assignment, created });
    }
    const preview = await directory.previewApprovalChain(pool, applicant.id, '2026-10-06');
    assert.equal(preview.ready, true);
    assert.deepEqual(preview.stages.map((stage) => stage.level), ['division', 'department', 'chief_secretary']);
    assert.equal((await directory.previewApprovalChain(pool, applicant.id, '2025-12-31')).ready, false);
    const otherApplicant = await createEmployee(pool, { name: 'Health Applicant' });
    await directory.setEmployeeOrganisation(pool, { employeeId: otherApplicant.id, departmentId: other.department.id, divisionId: other.division.id, actor, reason });
    assert.equal((await directory.previewApprovalChain(pool, otherApplicant.id, '2026-10-06')).stages[1].assignment_id, null);
    await assert.rejects(directory.assignLeaveApprover(pool, { assignment: heads[1].assignment, actor, reason }), { status: 409 });
    await pool.query("DELETE FROM reviewer_capabilities WHERE reviewer_id = $1 AND capability = 'hr_leave_approve'", [heads[1].login.id]);
    assert.match((await directory.previewApprovalChain(pool, applicant.id, '2026-10-06')).stages[1].issue, /explicit/);
    await directory.closeApprovalAssignment(pool, { assignmentId: heads[1].created.id, endDate: '2026-10-05', actor, reason });
    const selfLogin = await account({ permissions: { hr_leave_approve: true } });
    await verifyLink(applicant, selfLogin);
    await directory.assignLeaveApprover(pool, { assignment: { ...heads[1].assignment, approver_employee_id: applicant.id, effective_from: '2026-10-06' }, actor, reason });
    assert.match((await directory.previewApprovalChain(pool, applicant.id, '2026-10-06')).stages[1].issue, /Self-approval/);
  });

  test('directory/identity management is central HR only and does not trust self-supplied account IDs', async () => {
    const employee = await createEmployee(pool, { name: 'Employee' });
    const staff = await account({ permissions: { hr_staff_manage: true, hr_access: true } });
    const token = await tokenFor(staff);
    assert.equal((await call(token, '/api/hr/directory')).status, 403);
    assert.equal((await call(token, `/api/hr/employees/${employee.id}`, { reviewer_id: staff.id }, 'PUT')).status, 403);
    const hr = await account({ permissions: { hr_admin: true } });
    const hrToken = await tokenFor(hr);
    assert.equal((await call(hrToken, `/api/hr/directory/${employee.id}/account`, { email: 'test@example.test', reason })).status, 403);
    assert.equal((await call(hrToken, `/api/hr/directory/${employee.id}/account-link`, { reviewer_id: staff.id }, 'PUT')).status, 422);
    const confirmed = await call(hrToken, `/api/hr/directory/${employee.id}/account-link`, { reviewer_id: staff.id, reason }, 'PUT');
    assert.equal(confirmed.status, 200);
  });

  test('shared network users get separate authenticated request budgets', async () => {
    const first = await account({ type: 'employee' }), second = await account({ type: 'employee' });
    await verifyLink(await createEmployee(pool, { name: 'First network user' }), first);
    await verifyLink(await createEmployee(pool, { name: 'Second network user' }), second);
    const firstToken = await tokenFor(first), secondToken = await tokenFor(second);
    assert.equal((await call(firstToken, '/api/hr/limited-test')).status, 200);
    assert.equal((await call(firstToken, '/api/hr/limited-test')).status, 200);
    assert.equal((await call(firstToken, '/api/hr/limited-test')).status, 429);
    assert.equal((await call(secondToken, '/api/hr/limited-test')).status, 200);
  });

  test('replacement officeholders cannot overlap during concurrent assignment', async () => {
    const first = await createEmployee(pool, { name: 'First CS' }), second = await createEmployee(pool, { name: 'Second CS' });
    await verifyLink(first, await account());
    await verifyLink(second, await account());
    const options = { actor, reason, assignment: { level: 'chief_secretary', effective_from: '2026-10-06', approver_employee_id: first.id } };
    await assert.rejects(directory.assignLeaveApprover(pool, { ...options, assignment: { ...options.assignment, effective_to: '2026-10-05' } }), { status: 400 });
    const results = await Promise.allSettled([directory.assignLeaveApprover(pool, options), directory.assignLeaveApprover(pool,
      { ...options, assignment: { ...options.assignment, approver_employee_id: second.id } })]);
    assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
    assert.equal(results.find((row) => row.status === 'rejected').reason.status, 409);
  });
});

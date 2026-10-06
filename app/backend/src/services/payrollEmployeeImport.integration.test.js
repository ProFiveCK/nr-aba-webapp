import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach, describe } from 'node:test';
import { connectTestDatabase, createEmployee, resetLeaveTables, skipWithoutDatabase, upsertLeaveType } from '../test-support/database.js';

describe('audited Payroll employee imports', { skip: skipWithoutDatabase }, () => {
  let pool, imports, directory, auth, actor, department, server, base;
  const reason = 'HR checked the Payroll export and verified this appointment.';
  const header = 'payroll_employee_id,display_name,status,department_name';
  const preview = (csv) => imports.previewPayrollImport(pool, { csv, fileName: 'synthetic.csv', exportDate: '2026-10-07', actor });
  const apply = (view, extra = {}) => imports.applyPayrollImport(pool, { batchId: view.batch.id, revision: view.batch.revision, reviewNote: reason, actor, ...extra });
  const decide = (view, rowNumber, decision, employeeId) => imports.reconcilePayrollImportRow(pool, { batchId: view.batch.id, revision: view.batch.revision, rowNumber, decision, employeeId, reason, actor });
  const count = async (table) => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  before(async () => {
    pool = await connectTestDatabase();
    imports = await import('./payrollEmployeeImport.js');
    directory = await import('./employeeDirectory.js');
    auth = await import('./authService.js');
    const express = (await import('express')).default;
    const errors = await import('../middleware/errors.js');
    errors.enableAsyncErrors();
    const { default: router } = await import('../routes/hr.js');
    const app = express();
    app.use(express.json({ limit: '3mb' }));
    app.use('/api/hr', router);
    app.use(errors.errorHandler);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}/api/hr/directory/imports`;
  });
  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool?.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE hr_employee_import_batches CASCADE');
    await resetLeaveTables(pool);
    actor = (await pool.query(`INSERT INTO reviewers (email,display_name,role,password_hash,permissions)
      VALUES ($1,'Synthetic HR','user','x','{"hr_admin":true,"hr_access":true}') RETURNING *`, [`hr-${randomUUID()}@example.test`])).rows[0];
    department = (await pool.query("INSERT INTO hr_departments(name) VALUES ('Finance') RETURNING *")).rows[0];
  });
  async function token(row = actor) {
    const session = await auth.createSession(row.id);
    return auth.buildTokenPayload(row, session.tokenId, session.expiresAt);
  }
  const call = async (access, path = '', body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text() };
  };

  test('preview does not change employees; apply and concurrent retries write once', async () => {
    const csv = `${header},employment_category,appointment_start,is_intern\n000001-X,New Intern,active,Finance,temporary,2026-01-01,true`;
    const view = await preview(csv);
    assert.equal(view.summary.ready, 1);
    for (const table of ['hr_employees', 'hr_employee_external_ids', 'hr_employee_service_periods', 'hr_leave_balances']) assert.equal(await count(table), 0);
    assert.equal((await preview(csv)).batch.id, view.batch.id);
    const results = await Promise.all([apply(view), apply(view)]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(results[0].created, 1);
    assert.equal(await count('hr_employees'), 1);
    const period = (await pool.query('SELECT * FROM hr_employee_service_periods')).rows[0];
    assert.equal(period.employment_category, 'temporary');
    assert.equal(period.is_intern, true);
    assert.equal(period.counts_for_service, null);
    assert.equal((await preview(csv)).batch.status, 'applied');
    assert.equal((await imports.readPayrollImport(pool, view.batch.id)).rows[0].applied_outcome, 'created');
    const reordered = await preview(`display_name,payroll_employee_id,status,department_name,employment_category,appointment_start,is_intern\nNew Intern,000001-X,active,Finance,temporary,2026-01-01,true`);
    assert.equal(reordered.rows[0].service_action, 'retained');
    assert.equal((await apply(reordered)).unchanged, 1);
    assert.equal(await count('hr_employee_service_periods'), 1);
  });
  test('exact ID updates preserve employee identity, accounts, balance and service history', async () => {
    const employee = await createEmployee(pool, { name: 'Existing', joinDate: '2020-01-01', entitled: false });
    await directory.addEmployeeExternalId(pool, { employeeId: employee.id, externalId: '00002', actor, reason });
    await pool.query('UPDATE hr_employees SET reviewer_id=$2,email=$3 WHERE id=$1', [employee.id, actor.id, 'verified@example.test']);
    const type = await upsertLeaveType(pool, { name: 'T:PayrollImport' });
    await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance) VALUES ($1,$2,2026,17)', [employee.id, type.id]);
    const view = await preview(`${header},email\n00002,Existing Updated,active,Finance,new@example.test`);
    assert.equal(view.rows[0].target_employee_id, employee.id);
    await apply(view);
    const saved = (await pool.query('SELECT * FROM hr_employees WHERE id=$1', [employee.id])).rows[0];
    assert.equal(saved.display_name, 'Existing Updated');
    assert.equal(saved.join_date, '2020-01-01');
    assert.equal(saved.leave_entitled, false);
    assert.equal(saved.reviewer_id, actor.id);
    assert.equal(saved.email, 'verified@example.test');
    assert.equal(Number((await pool.query('SELECT balance FROM hr_leave_balances WHERE employee_id=$1', [employee.id])).rows[0].balance), 17);
  });
  test('name collisions require explicit identity decisions; verified IDs cannot be reassigned', async () => {
    const one = await createEmployee(pool, { name: 'Same Name' }), two = await createEmployee(pool, { name: 'Other' });
    let view = await preview(`${header}\n001,Same Name,active,Finance`);
    assert.equal(view.summary.blocked, 1);
    await assert.rejects(apply(view), { status: 409 });
    view = await decide(view, 2, 'update', one.id);
    await apply(view);
    assert.equal(await count('hr_employees'), 2);
    view = await preview(`${header}\n001,Changed Name,active,Finance`);
    await assert.rejects(decide(view, 2, 'update', two.id), { status: 409 });
    view = await preview(`${header}\n002,Same Name,active,Finance`);
    view = await decide(view, 2, 'create');
    assert.equal((await apply(view)).created, 1);
  });
  test('blocked rows stop the whole batch; explicit skips retain reasons and malformed data', async () => {
    let view = await preview(`${header}\n001,Good,active,Finance\n002,Bad,ACTIVE,Finance`);
    await assert.rejects(apply(view), { status: 409 });
    assert.equal(await count('hr_employees'), 0);
    view = await decide(view, 3, 'skip');
    assert.equal((await apply(view)).skipped, 1);
    const saved = await imports.readPayrollImport(pool, view.batch.id);
    assert.equal(saved.rows[1].review_reason, reason);
    assert.equal(saved.rows[1].data.status, 'ACTIVE');
  });
  test('stale employee and organisation previews require refresh; new duplicates require HR decision', async () => {
    let view = await preview(`${header}\n001,New Person,active,Finance`);
    await pool.query("UPDATE hr_departments SET name='FINANCE' WHERE id=$1", [department.id]);
    await assert.rejects(apply(view), { status: 409 });
    view = await imports.refreshPayrollImport(pool, { batchId: view.batch.id, revision: view.batch.revision, actor });
    await createEmployee(pool, { name: 'New Person' });
    await assert.rejects(apply(view), { status: 409 });
    view = await decide(view, 2, 'create');
    await apply(view);
    view = await preview(`${header}\n001,Updated Person,active,Finance`);
    await pool.query("UPDATE hr_employees SET position_title='Manual correction' WHERE id=$1", [view.rows[0].target_employee_id]);
    await assert.rejects(apply(view), { status: 409 });
  });
  test('overlapping appointment changes cannot replace service history', async () => {
    const employee = await createEmployee(pool, { name: 'Classified' });
    await directory.addEmployeeExternalId(pool, { employeeId: employee.id, externalId: '001', actor, reason });
    await directory.addServicePeriod(pool, { employeeId: employee.id, period: { start_date: '2026-01-01', employment_category: 'temporary' }, actor, reason });
    const view = await preview(`${header},employment_category,appointment_start\n001,Classified,active,Finance,permanent,2026-02-01`);
    assert.ok(view.rows[0].errors.some((error) => error.includes('overlaps')));
    await assert.rejects(apply(view), { status: 409 });
    assert.equal(await count('hr_employee_service_periods'), 1);
  });
  test('same-batch managers are resolved after creation; cycles and multi-row targets block', async () => {
    const view = await preview(`${header},manager_payroll_id\n001,Worker,active,Finance,002\n002,Manager,active,Finance,`);
    await apply(view);
    const employees = (await pool.query('SELECT * FROM hr_employees')).rows;
    assert.equal(employees.find((e) => e.display_name === 'Worker').manager_id, employees.find((e) => e.display_name === 'Manager').id);
    const cycle = await preview(`${header},manager_payroll_id\n001,Worker,active,Finance,002\n002,Manager,active,Finance,001`);
    assert.equal(cycle.summary.blocked, 2);
    await assert.rejects(apply(cycle), { status: 409 });
    let duplicate = await preview(`${header}\n003,Worker,active,Finance\n004,Worker,active,Finance`);
    duplicate = await decide(duplicate, 2, 'update', employees.find((e) => e.display_name === 'Worker').id);
    duplicate = await decide(duplicate, 3, 'update', employees.find((e) => e.display_name === 'Worker').id);
    assert.equal(duplicate.summary.blocked, 2);
  });
  test('explicit inactivity revokes linked sessions; omissions do not deactivate people', async () => {
    const employee = await createEmployee(pool, { name: 'Leaving' }), omitted = await createEmployee(pool, { name: 'Not exported' });
    await pool.query('UPDATE hr_employees SET reviewer_id=$2 WHERE id=$1', [employee.id, actor.id]);
    await directory.addEmployeeExternalId(pool, { employeeId: employee.id, externalId: '001', actor, reason });
    const session = await auth.createSession(actor.id);
    await apply(await preview(`${header}\n001,Leaving,inactive,Finance`));
    assert.equal(await auth.lookupSession(session.tokenId), null);
    assert.equal((await pool.query('SELECT status FROM hr_employees WHERE id=$1', [omitted.id])).rows[0].status, 'active');
  });
  test('an audit failure rolls back every employee and marks no batch applied', async () => {
    const view = await preview(`${header}\n001,First,active,Finance\n002,Second,active,Finance`);
    await pool.query(`CREATE FUNCTION payroll_import_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'hr.employee.import.completed' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER payroll_import_test_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION payroll_import_test_audit_failure()`);
    try { await assert.rejects(apply(view), { code: 'P0001' }); }
    finally { await pool.query('DROP TRIGGER payroll_import_test_audit_failure ON audit_log; DROP FUNCTION payroll_import_test_audit_failure()'); }
    assert.equal(await count('hr_employees'), 0);
    assert.equal((await imports.readPayrollImport(pool, view.batch.id)).batch.status, 'preview');
  });
  test('a second HR reviewer cannot overwrite a reviewed revision', async () => {
    const initial = await preview(`${header}\n001,New,active,Finance`);
    const reviewed = await decide(initial, 2, 'skip');
    await assert.rejects(decide(initial, 2, 'create'), { status: 409 });
    await assert.rejects(apply(initial), { status: 409 });
    assert.equal(reviewed.rows[0].decision, 'skip');
  });
  test('a late service record changes the snapshot; refresh retains the identical period', async () => {
    const employee = await createEmployee(pool, { name: 'Known' });
    await directory.addEmployeeExternalId(pool, { employeeId: employee.id, externalId: '001', actor, reason });
    let view = await preview(`${header},employment_category,appointment_start\n001,Known,active,Finance,temporary,2026-01-01`);
    await directory.addServicePeriod(pool, { employeeId: employee.id, period: { start_date: '2026-01-01', employment_category: 'temporary' }, actor, reason });
    await assert.rejects(apply(view), { status: 409 });
    view = await imports.refreshPayrollImport(pool, { batchId: view.batch.id, revision: view.batch.revision, actor });
    assert.equal(view.rows[0].service_action, 'retained');
    assert.equal((await apply(view)).service_periods_added, 0);
  });
  test('HTTP restricts imports to central HR and rejects invalid revisions', async () => {
    const denied = (await pool.query(`INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES ($1,'Division','user','x','{"hr_access":true,"hr_leave_review":true}') RETURNING *`, [`division-${randomUUID()}@example.test`])).rows[0];
    assert.equal((await call(await token(denied), '/template')).status, 403);
    const access = await token();
    const template = await call(access, '/template');
    assert.equal(template.status, 200);
    assert.equal(template.body.trim().split('\n').length, 1);
    const response = await call(access, '/preview', { csv: `${header}\n001,New,active,Finance`, file_name: 'synthetic.csv', export_date: '2026-10-07' });
    assert.equal(response.status, 201);
    assert.equal((await call(access, `/${response.body.batch.id}/apply`, { revision: 0, review_note: reason })).status, 422);
    assert.equal((await call(access, `/${response.body.batch.id}/apply`, { revision: 2, review_note: reason })).status, 409);
    assert.equal(await count('hr_employees'), 0);
  });
  test('2,000 synthetic employees use bounded review pages and complete an audited import', async (t) => {
    const csv = `${header}\n${Array.from({ length: 2000 }, (_, i) => `${String(i).padStart(6, '0')},Synthetic Employee ${i},active,Finance`).join('\n')}`;
    const started = performance.now();
    const view = await preview(csv);
    assert.equal(view.total, 2000);
    assert.equal(view.rows.length, 50);
    assert.equal((await imports.readPayrollImport(pool, view.batch.id, { page: 40 })).rows.length, 50);
    assert.equal((await apply(view)).created, 2000);
    assert.equal(await count('hr_employee_external_ids'), 2000);
    t.diagnostic(`Preview, paging and atomic apply of 2,000 synthetic employees: ${Math.round(performance.now() - started)} ms. This is not a concurrent-user load test.`);
  });
});

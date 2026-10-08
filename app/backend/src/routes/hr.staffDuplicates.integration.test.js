/** Existing personnel records must be linked explicitly, without reads creating duplicates. */
import assert from 'node:assert/strict';
import test, { after, before, beforeEach, describe } from 'node:test';
import { connectTestDatabase, resetLeaveTables, createEmployee, upsertLeaveType, skipWithoutDatabase } from '../test-support/database.js';
import { createAccount, prepareRoutes, startApp } from '../test-support/http.js';

describe('explicit employee links through the retained HR routes', { skip: skipWithoutDatabase }, () => {
  let pool, app, admin;
  before(async () => {
    pool = await connectTestDatabase();
    prepareRoutes();
    const { default: hrRouter } = await import('./hr.js');
    app = await startApp({ '/api/hr': hrRouter });
    admin = await createAccount(pool, 'link-admin@example.test', { role: 'admin' });
  });
  beforeEach(() => resetLeaveTables(pool));
  after(async () => { await app?.close(); await pool?.end(); });
  const count = async () => Number((await pool.query('SELECT count(*) AS n FROM hr_employees')).rows[0].n);
  const account = async (email, name) => {
    const value = await createAccount(pool, email);
    await pool.query('UPDATE reviewers SET display_name=$2, permissions=$3 WHERE id=$1', [value.reviewer.id, name, { hr_access: true }]);
    return value;
  };
  const link = (employeeId, reviewerId) => app.call('PUT', `/api/hr/employees/${employeeId}`, { token: admin.token, body: { reviewer_id: reviewerId } });

  for (const match of ['email', 'name']) {
    test(`an unlinked login matching by ${match} stays blocked until HR verifies it`, async () => {
      const employee = await createEmployee(pool, { name: 'Recorded Person' });
      await pool.query('UPDATE hr_employees SET email=$2 WHERE id=$1', [employee.id, 'person@example.test']);
      const login = await account(match === 'email' ? 'person@example.test' : 'namesake@example.test', match === 'name' ? 'Recorded Person' : 'Different Name');
      const response = await app.call('GET', '/api/hr/me', { token: login.token });
      assert.equal(response.status, 403);
      assert.match(response.json.message, /not been linked/);
      assert.equal(await count(), 1);
      assert.equal((await pool.query('SELECT reviewer_id FROM hr_employees WHERE id=$1', [employee.id])).rows[0].reviewer_id, null);
    });
  }
  test('ambiguous matching records are preserved without provisioning another employee', async () => {
    for (const name of ['Shared One', 'Shared Two']) {
      const row = await createEmployee(pool, { name });
      await pool.query('UPDATE hr_employees SET email=$2 WHERE id=$1', [row.id, 'shared@example.test']);
    }
    const login = await account('shared@example.test', 'Someone Else');
    assert.equal((await app.call('GET', '/api/hr/me', { token: login.token })).status, 403);
    assert.equal(await count(), 2);
  });
  test('an existing verified link opens the original record with its balance and join date', async () => {
    const login = await account('retained@example.test', 'Login Name');
    const employee = await createEmployee(pool, { name: 'Original Staff', joinDate: '2020-01-06' });
    await pool.query('UPDATE hr_employees SET reviewer_id=$2 WHERE id=$1', [employee.id, login.reviewer.id]);
    const type = await upsertLeaveType(pool, { name: 'T:ExplicitLink' });
    await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance,pending) VALUES ($1,$2,2026,12,1)', [employee.id,type.id]);
    const response = await app.call('GET', '/api/hr/me', { token: login.token });
    assert.equal(response.status, 200);
    assert.equal(response.json.employee.id, employee.id);
    assert.equal(response.json.employee.display_name, 'Original Staff');
    assert.equal(await count(), 1);
    assert.equal((await pool.query('SELECT balance FROM hr_leave_balances WHERE employee_id=$1',[employee.id])).rows[0].balance, '12.00');
  });
  for (const history of [false, true]) {
    test(`HR cannot silently take a login from a record ${history ? 'with history' : 'without history'}`, async () => {
      const login = await account(`held-${history}@example.test`, 'Existing Login');
      const holder = await createEmployee(pool, { name: 'Existing Holder' });
      const target = await createEmployee(pool, { name: 'Prepared Record' });
      await pool.query('UPDATE hr_employees SET reviewer_id=$2 WHERE id=$1', [holder.id, login.reviewer.id]);
      if (history) {
        const type = await upsertLeaveType(pool, { name: 'T:ExplicitLink' });
        await pool.query("INSERT INTO hr_leave_adjustments(employee_id,leave_type_id,amount,reason) VALUES ($1,$2,5,'Retained opening')", [holder.id,type.id]);
      }
      assert.equal((await link(target.id, login.reviewer.id)).status, 409);
      assert.equal(await count(), 2);
      assert.equal((await pool.query('SELECT reviewer_id FROM hr_employees WHERE id=$1',[holder.id])).rows[0].reviewer_id, login.reviewer.id);
      assert.equal((await pool.query('SELECT reviewer_id FROM hr_employees WHERE id=$1',[target.id])).rows[0].reviewer_id, null);
    });
  }
  test('central HR can explicitly unlink then relink while retaining both records and revoking the old session', async () => {
    const login = await account('move@example.test', 'Existing Login');
    const holder = await createEmployee(pool, { name: 'Existing Holder' });
    const target = await createEmployee(pool, { name: 'Prepared Record' });
    await pool.query('UPDATE hr_employees SET reviewer_id=$2 WHERE id=$1', [holder.id, login.reviewer.id]);
    assert.equal((await link(holder.id, null)).status, 200);
    assert.equal((await link(target.id, login.reviewer.id)).status, 200);
    assert.equal(await count(), 2);
    assert.equal((await pool.query('SELECT reviewer_id FROM hr_employees WHERE id=$1',[target.id])).rows[0].reviewer_id, login.reviewer.id);
    assert.equal((await app.call('GET','/api/hr/me',{token:login.token})).status,401);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_employee_account_links WHERE employee_id=ANY($1::uuid[])',[[holder.id,target.id]])).rows[0].n,2);
  });
});

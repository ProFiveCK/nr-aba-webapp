import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, beforeEach, describe, test } from 'node:test';
import { connectTestDatabase, resetLeaveTables, skipWithoutDatabase } from '../test-support/database.js';
import { DEFAULT_RULES } from '../lib/governmentLeaveRules.js';

describe('current leave balances and movement accounts', { skip: skipWithoutDatabase }, () => {
  let pool, balances, admin, scoped, owner, department, employee, outside, legacy, policy, account;
  before(async () => { pool = await connectTestDatabase(); balances = await import('./governmentLeaveBalances.js'); });
  after(async () => { await pool?.end(); });
  const user = row => ({ ...row, permissions: row.permissions });
  async function reviewer(permissions) {
    return (await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES($1,'Balance test','user','x',$2) RETURNING *", [`${randomUUID()}@example.test`, permissions])).rows[0];
  }
  async function entitlement(id, year = '2026', asOf = `${year}-01-01`, amount = '20') {
    const opening = (await pool.query(`INSERT INTO hr_gov_openings(employee_id,code,policy_version_id,period_start,period_end,as_of,amount,source_reference,payroll_reference,snapshot_hash,historical_snapshot,status,prepared_by,reason)
      VALUES($1,'recreation',$2,$3,$4,$5,$6,'signed opening','Salary register','test','[]','certified',$7,'Verified opening test') RETURNING id`, [id, policy.id, `${year}-01-01`, `${year}-12-31`, asOf, amount, admin.id])).rows[0];
    const result = (await pool.query(`INSERT INTO hr_gov_entitlements(employee_id,code,policy_version_id,period_start,period_end,as_of,opening_id)
      VALUES($1,'recreation',$2,$3,$4,$5,$6) RETURNING *`, [id, policy.id, `${year}-01-01`, `${year}-12-31`, asOf, opening.id])).rows[0];
    await movement(result.id, 'opening', amount, '2020-01-01T00:00:00Z');
    return result;
  }
  async function movement(id, kind, amount, recordedAt = '2020-01-01T00:00:01Z') {
    return (await pool.query(`INSERT INTO hr_gov_ledger(entitlement_id,kind,amount,effective_date,event_key,source_reference,reason,recorded_at)
      VALUES($1,$2,$3,'2026-01-01',$4,'Verified register','Verified balance movement',$5) RETURNING *`, [id, kind, amount, randomUUID(), recordedAt])).rows[0];
  }
  beforeEach(async () => {
    await resetLeaveTables(pool); await pool.query('TRUNCATE hr_gov_policy_versions CASCADE');
    admin = await reviewer({ hr_admin: true }); scoped = await reviewer({ hr_balance_manage: true }); owner = await reviewer({ hr_access: true, hr_leave_apply: true });
    department = (await pool.query("INSERT INTO hr_departments(name) VALUES('Treasury balance test') RETURNING *")).rows[0];
    employee = (await pool.query("INSERT INTO hr_employees(display_name,department_id,reviewer_id,leave_policy_regime) VALUES('Current employee',$1,$2,'government') RETURNING *", [department.id, owner.id])).rows[0];
    outside = (await pool.query("INSERT INTO hr_employees(display_name,leave_policy_regime) VALUES('Outside employee','government') RETURNING *")).rows[0];
    legacy = (await pool.query("INSERT INTO hr_employees(display_name,department_id) VALUES('Setup employee',$1) RETURNING *", [department.id])).rows[0];
    await pool.query("INSERT INTO hr_access_scopes(reviewer_id,department_id,capabilities,effective_from,granted_by,reason) VALUES($1,$2,ARRAY['hr_balance_manage'],'2020-01-01',$3,'Verified balance test scope')", [scoped.id, department.id, admin.id]);
    policy = (await pool.query(`INSERT INTO hr_gov_policy_versions(label,effective_from,effective_to,rules,source_reference,status,reason)
      VALUES('Balance test policy','2020-01-01','2099-12-31',$1,'signed test','published','Verified policy test') RETURNING *`, [DEFAULT_RULES])).rows[0];
    account = await entitlement(employee.id);
  });
  test('credits and deductions reconcile, holds reduce availability, no default or retained balance is substituted', async () => {
    await movement(account.id, 'accrual', '1.123456'); await movement(account.id, 'use', '-3', '2020-01-01T00:00:02Z');
    const reservation = randomUUID();
    await pool.query("INSERT INTO hr_gov_reservation_requests(id,employee_id,payload_hash,evaluation_snapshot,status) VALUES($1,$2,'test','{}','held')", [reservation, employee.id]);
    await pool.query('INSERT INTO hr_gov_reservations(request_id,entitlement_id,amount) VALUES($1,$2,2)', [reservation, account.id]);
    const report = await balances.staffLeaveBalances(pool, { user: user(admin) });
    const row = report.employees.find(e => e.id === employee.id).balances[0];
    assert.equal(row.days_in, '21.123456'); assert.equal(row.days_out, '3.000000'); assert.equal(row.balance, '18.123456'); assert.equal(row.held, '2.000000'); assert.equal(row.available, '16.123456');
    assert.deepEqual(report.employees.find(e => e.id === legacy.id).balances, []);
    assert.equal(report.employees.find(e => e.id === legacy.id).leave_status, 'setup_required');
    assert.deepEqual(report.employees.find(e => e.id === outside.id).balances, []);
    assert.equal((await balances.employeeLeaveAccount(pool, { user: user(admin), employeeId: employee.id })).movements[0].running_balance, '18.123456');
    await pool.query('UPDATE hr_employees SET leave_entitled=FALSE WHERE id=$1', [legacy.id]);
    const excluded = (await balances.staffLeaveBalances(pool, { user: user(admin) })).employees.find(e => e.id === legacy.id);
    assert.equal(excluded.leave_status, 'not_entitled'); assert.deepEqual(excluded.balances, []);
  });
  test('list and account respect balance scopes and owner access without exposing other staff', async () => {
    assert.equal((await balances.staffLeaveBalances(pool, { user: user(scoped) })).total, 2);
    assert.equal((await balances.staffLeaveBalances(pool, { user: { ...scoped, permissions: { hr_staff_manage: true } } })).total, 0);
    assert.equal((await balances.employeeLeaveAccount(pool, { user: user(owner), employeeId: employee.id })).accounts.length, 1);
    await assert.rejects(balances.employeeLeaveAccount(pool, { user: user(scoped), employeeId: outside.id }), error => error.status === 404);
    await assert.rejects(balances.employeeLeaveAccount(pool, { user: user(owner), employeeId: outside.id }), error => error.status === 404);
    await assert.rejects(balances.employeeLeaveAccount(pool, { user: { ...scoped, permissions: { hr_staff_manage: true } }, employeeId: employee.id }), error => error.status === 404);
    assert.equal((await balances.staffLeaveBalances(pool, { user: user(scoped), search: 'Treasury' })).total, 2);
    assert.equal((await balances.staffLeaveBalances(pool, { user: user(admin), search: '%' })).total, 0);
  });
  test('future openings never become current and previous service years remain distinct', async () => {
    const older = await entitlement(employee.id, '2025', '2025-01-01', '10');
    await entitlement(employee.id, '2099', '2099-01-01', '50');
    const report = await balances.staffLeaveBalances(pool, { user: user(admin) });
    assert.equal(report.employees.find(e => e.id === employee.id).balances.length, 1);
    assert.equal(report.employees.find(e => e.id === employee.id).balances[0].id, account.id);
    const statement = await balances.employeeLeaveAccount(pool, { user: user(admin), employeeId: employee.id, entitlementId: older.id });
    assert.equal(statement.accounts.length, 3); assert.equal(statement.movements.length, 1); assert.equal(statement.movements[0].running_balance, '10.000000');
    assert.equal((await balances.employeeLeaveAccount(pool, { user: user(admin), employeeId: employee.id, entitlementId: randomUUID() })).total, 0);
  });
  test('running balances are computed across pages before slicing and include backdated corrections', async () => {
    for (let i = 1; i <= 52; i++) await movement(account.id, 'correction', '0.5', new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString());
    const first = await balances.employeeLeaveAccount(pool, { user: user(admin), employeeId: employee.id });
    const second = await balances.employeeLeaveAccount(pool, { user: user(admin), employeeId: employee.id, page: 2 });
    assert.equal(first.total, 53); assert.equal(first.movements[0].running_balance, '46.000000');
    assert.equal(second.movements.length, 3); assert.equal(second.movements[0].running_balance, '21.000000');
    assert.equal(second.movements.at(-1).running_balance, '20.000000');
    assert.equal(first.accounts[0].balance, '46.000000');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_ledger WHERE entitlement_id=$1', [account.id])).rows[0].n, 53);
  });
  test('department, division and status filters combine without exposing out-of-scope dropdown choices', async () => {
    const division = (await pool.query("INSERT INTO hr_divisions(department_id,name) VALUES($1,'Accounts') RETURNING id", [department.id])).rows[0];
    const otherDepartment = (await pool.query("INSERT INTO hr_departments(name) VALUES('Outside department') RETURNING id")).rows[0];
    await pool.query('UPDATE hr_employees SET division_id=$1 WHERE id=$2', [division.id, employee.id]);
    await pool.query('UPDATE hr_employees SET department_id=$1 WHERE id=$2', [otherDepartment.id, outside.id]);
    const filtered = await balances.staffLeaveBalances(pool, { user: user(scoped), departmentId: department.id, divisionId: division.id, status: 'activation_required', search: 'accounts' });
    assert.equal(filtered.total, 1); assert.equal(filtered.employees[0].id, employee.id);
    assert.deepEqual(filtered.departments.map(d => d.id), [department.id]);
    assert.deepEqual(filtered.divisions.map(d => d.id), [division.id]);
    assert.equal((await balances.staffLeaveBalances(pool, { user: user(scoped), departmentId: otherDepartment.id })).total, 0);
    assert.equal((await balances.staffLeaveBalances(pool, { user: user(scoped), divisionId: randomUUID() })).total, 0);
    assert.deepEqual((await balances.staffLeaveBalances(pool, { user: user(scoped), status: 'setup_required' })).employees.map(e => e.id), [legacy.id]);
    await pool.query(`INSERT INTO hr_gov_workflow_configs(employee_id,enabled_codes,medical_rule,medical_history,source_reference,legacy_resolution_reference,snapshot_hash,prepared_by,reason,status,approved_by,approved_at)
      VALUES($1,ARRAY['recreation'],'single_calendar_date_nonadjacent_scheduled_days','[]','Verified source','Verified source','test',$2,'Verified setup','published',$2,NOW())`, [employee.id, admin.id]);
    assert.equal((await balances.staffLeaveBalances(pool, { user: user(scoped), status: 'active' })).total, 1);
    await pool.query(`INSERT INTO hr_gov_workflow_configs(employee_id,enabled_codes,medical_rule,medical_history,source_reference,legacy_resolution_reference,snapshot_hash,prepared_by,reason,status,approved_by,approved_at)
      VALUES($1,'{}','single_calendar_date_nonadjacent_scheduled_days','[]','Verified pause','Verified source','pause',$2,'Verified pause','published',$2,NOW()+INTERVAL '1 second')`, [employee.id, admin.id]);
    assert.equal((await balances.staffLeaveBalances(pool, { user: user(scoped), status: 'paused' })).total, 1);
  });
  test('numeric available-balance sorting covers every page and keeps uncertified balances last', async () => {
    const ids = [];
    for (let i = 1; i <= 55; i++) {
      const { rows: [staff] } = await pool.query("INSERT INTO hr_employees(display_name,department_id,leave_policy_regime) VALUES($1,$2,'government') RETURNING id", [`Sort staff ${String(i).padStart(2,'0')}`, department.id]);
      ids.push(staff.id); await entitlement(staff.id, '2026', '2026-01-01', String(i));
    }
    // A hold affects availability and therefore ordering; a future opening
    // cannot replace the account currently shown or elevate it in the sort.
    await entitlement(employee.id, '2099', '2099-01-01', '100');
    const reservation = randomUUID();
    await pool.query("INSERT INTO hr_gov_reservation_requests(id,employee_id,payload_hash,evaluation_snapshot,status) VALUES($1,$2,'test','{}','held')", [reservation, employee.id]);
    await pool.query('INSERT INTO hr_gov_reservations(request_id,entitlement_id,amount) VALUES($1,$2,19.5)', [reservation, account.id]);
    const first = await balances.staffLeaveBalances(pool, { user: user(admin), sort: 'recreation', direction: 'desc' });
    const second = await balances.staffLeaveBalances(pool, { user: user(admin), sort: 'recreation', direction: 'desc', page: 2 });
    assert.equal(first.total, 58); assert.equal(first.employees.length, 50);
    assert.equal(first.employees[0].id, ids[54]); assert.equal(first.employees[0].balances[0].available, '55.000000');
    const combined = [...first.employees, ...second.employees];
    assert.equal(new Set(combined.map(e => e.id)).size, 58);
    assert.deepEqual(combined.slice(-2).map(e => e.id).sort(), [outside.id, legacy.id].sort());
    const ascending = await balances.staffLeaveBalances(pool, { user: user(admin), sort: 'recreation' });
    assert.equal(ascending.employees[0].id, employee.id); assert.equal(ascending.employees[1].id, ids[0]);
    assert.deepEqual((await balances.staffLeaveBalances(pool, { user: user(scoped), sort: 'medical' })).employees.map(e => e.display_name),
      (await balances.staffLeaveBalances(pool, { user: user(scoped) })).employees.map(e => e.display_name));
    const byName = await balances.staffLeaveBalances(pool, { user: user(admin), sort: 'name', direction: 'desc' });
    assert.equal(byName.employees[0].id, ids[54]);
  });
});

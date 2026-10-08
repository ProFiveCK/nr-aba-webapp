import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { connectTestDatabase, createEmployee, resetLeaveTables, skipWithoutDatabase } from '../test-support/database.js';

describe('organisation browsing across more than fifty departments', { skip: skipWithoutDatabase }, () => {
  let pool, server, base, auth, central, limited, centralToken, limitedToken, dates, beforeRows, ownerToken;
  const departments = [], officers = [], assignments = [], offices = [], singleBatches = [], logins = [];
  let multiBatch, otherBatch;
  const reason = 'Synthetic organisation browse integration authority';
  const paths = { assignments: '/directory/approval-assignments', offices: '/government/workflow/consent-offices' };
  const tables = ['hr_departments', 'hr_divisions', 'hr_employees', 'hr_approval_assignments', 'hr_gov_consent_offices',
    'hr_gov_consent_withdrawals', 'hr_leave_balances', 'hr_leave_applications', 'hr_gov_policy_versions', 'hr_gov_entitlements',
    'hr_gov_requests', 'hr_gov_service_bases', 'hr_gov_job_plans', 'hr_gov_job_posts', 'hr_onboarding_batches', 'hr_onboarding_rows', 'hr_employee_account_links', 'reviewer_capabilities', 'audit_log'];
  const snapshot = () => Promise.all(tables.map(async table => (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
  async function account(permissions) {
    return (await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES($1,'Synthetic browse officer','user','x',$2) RETURNING *", [`${randomUUID()}@example.test`, permissions])).rows[0];
  }
  async function token(user) {
    const session = await auth.createSession(user.id);
    return auth.buildTokenPayload(user, session.tokenId, session.expiresAt);
  }
  async function request(path, authorization = centralToken) {
    const response = await fetch(`${base}${path}`, { headers: authorization ? { Authorization: `Bearer ${authorization}` } : {} });
    return { status: response.status, body: await response.json() };
  }
  async function assignment(department, officer, from, to = null, level = 'department') {
    return (await pool.query(`INSERT INTO hr_approval_assignments(level,department_id,approver_employee_id,effective_from,effective_to,recorded_by,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [level, department?.id || null, officer.id, from, to, central.id, reason])).rows[0];
  }
  async function office(department, officer, from, to = null, level = 'relevant_secretary', reference = reason) {
    return (await pool.query(`INSERT INTO hr_gov_consent_offices(level,department_id,approver_employee_id,effective_from,effective_to,recorded_by,source_reference,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [level, department?.id || null, officer.id, from, to, central.id, reference, reason])).rows[0];
  }
  async function onboardingBatch(employees) {
    const batch = (await pool.query("INSERT INTO hr_onboarding_batches(login_mode,prepared_by,reason) VALUES('payroll',$1,$2) RETURNING *", [central.id, reason])).rows[0];
    for (const employee of employees) await pool.query("INSERT INTO hr_onboarding_rows(batch_id,employee_id,snapshot,decision) VALUES($1,$2,$3,'retain')", [batch.id, employee.id, { display_name: employee.display_name }]);
    return batch;
  }
  before(async () => {
    pool = await connectTestDatabase();
    await resetLeaveTables(pool);
    await pool.query('TRUNCATE hr_onboarding_batches CASCADE');
    auth = await import('../services/authService.js');
    const express = (await import('express')).default, errors = await import('../middleware/errors.js');
    errors.enableAsyncErrors();
    const app = express();
    app.use(express.json());
    app.use('/api/hr', (await import('./hr.js')).default);
    app.use(errors.errorHandler);
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    base = `http://127.0.0.1:${server.address().port}/api/hr`;
    central = await account({ hr_access: true, hr_admin: true, hr_leave_approve: true });
    limited = await account({ hr_access: true, hr_staff_manage: true });
    centralToken = await token(central); limitedToken = await token(limited);
    dates = (await pool.query(`SELECT to_char(d,'YYYY-MM-DD') AS today,to_char(d-1,'YYYY-MM-DD') AS yesterday,
      to_char(d+1,'YYYY-MM-DD') AS tomorrow,to_char(d-365,'YYYY-MM-DD') AS past
      FROM (SELECT (NOW() AT TIME ZONE 'Pacific/Nauru')::date AS d) x`)).rows[0];
    for (let index = 0; index < 60; index++) {
      const label = String(index + 1).padStart(2, '0');
      const department = (await pool.query('INSERT INTO hr_departments(name) VALUES($1) RETURNING *', [`Synthetic Department ${label}`])).rows[0];
      const employee = await createEmployee(pool, { name: `Synthetic Officer ${label}`, department: department.name });
      const login = await account({ hr_access: true });
      await pool.query('UPDATE hr_employees SET reviewer_id=$2 WHERE id=$1', [employee.id, login.id]);
      departments.push(department); officers.push(employee); logins.push(login);
      assignments.push(await assignment(department, employee, dates.today));
      offices.push(await office(department, employee, dates.today, null, 'relevant_secretary', `Synthetic appointment instrument ${label}`));
    }
    assignments.push(await assignment(null, officers[0], dates.today, null, 'chief_secretary'));
    assignments.push(await assignment(departments[59], officers[59], dates.past, dates.yesterday));
    assignments.push(await assignment(departments[59], officers[59], dates.tomorrow));
    offices.push(await office(null, officers[0], dates.today, null, 'hr_verifier'));
    offices.push(await office(departments[59], officers[59], dates.past, dates.yesterday, 'minister'));
    offices.push(await office(departments[59], officers[59], dates.tomorrow, null, 'minister'));
    const closed = await office(departments[58], officers[58], dates.past, null, 'minister');
    offices.push(closed);
    await pool.query('INSERT INTO hr_gov_consent_withdrawals(office_id,effective_to,actor_id,reason) VALUES($1,$2,$3,$4)', [closed.id, dates.yesterday, central.id, reason]);
    for (let index = 0; index < 21; index++) singleBatches.push(await onboardingBatch([officers[59]]));
    multiBatch = await onboardingBatch([officers[58], officers[59]]);
    otherBatch = await onboardingBatch([officers[0]]);
    ownerToken = await token(logins[0]);
    // Stored synthetic cases exercise list scope without triggering any leave decisions.
    for (const [index, count] of [[0, 52], [1, 2]]) {
      const divisionId = randomUUID();
      for (let row = 0; row < count; row++) await pool.query(`INSERT INTO hr_gov_requests
        (id,employee_id,code,start_date,end_date,reason,medical_mode,payload_hash,application_snapshot,department_id,division_id,charge,submitted_by,status)
        VALUES($1,$2,'official',$3,$3,$4,'not_applicable','synthetic',$5,$6,$7,0,$8,$9)`,
        [randomUUID(), officers[index].id, dates.today, reason, { employee: { name: officers[index].display_name } }, departments[index].id, divisionId, logins[index].id, row === 51 ? 'approved' : 'pending']);
      const basis = (await pool.query(`INSERT INTO hr_gov_service_bases(employee_id,effective_from,continuity_start,anniversary_method,leap_day_method,schedule_mode,source_reference,recorded_by,reason)
        VALUES($1,$2,$2,'calendar','feb28','weekly',$3,$4,$3) RETURNING id`, [officers[index].id, dates.past, reason, central.id])).rows[0];
      const plan = (await pool.query(`INSERT INTO hr_gov_job_plans(employee_id,code,service_basis_id,method,source_reference,prepared_by,reason,snapshot_hash)
        VALUES($1,'medical',$2,'service_anniversary_reset',$3,$4,$3,'synthetic') RETURNING id`, [officers[index].id, basis.id, reason, central.id])).rows[0];
      await pool.query(`INSERT INTO hr_gov_job_posts(employee_id,code,event_date,event_kind,plan_id,amount,capped)
        VALUES($1,'medical',$2,'renewal',$3,0,true),($1,'medical',$4,'renewal',$3,0,false)`, [officers[index].id, dates.today, plan.id, dates.yesterday]);
    }
    beforeRows = await snapshot();
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) {
      try {
        await resetLeaveTables(pool);
        // The shared reset removes rows through employee FKs, but retains batch parents.
        const ids = [...singleBatches, multiBatch, otherBatch].filter(Boolean).map(batch => batch.id);
        await pool.query('DELETE FROM hr_onboarding_batches WHERE id=ANY($1::uuid[])', [ids]);
      } finally { await pool.end(); }
    }
  });

  test('default reads and paged reads expose every appointment once', async () => {
    for (const [key, expected, defaultSize] of [['assignments', assignments, 50], ['offices', offices, 25]]) {
      const initial = await request(paths[key]);
      assert.equal(initial.status, 200);
      assert.equal(initial.body.total, expected.length);
      assert.equal(initial.body[key].length, defaultSize);
      const ids = [];
      for (let page = 1; page <= Math.ceil(expected.length / 10); page++) {
        const result = await request(`${paths[key]}?page=${page}&page_size=10`);
        assert.equal(result.status, 200); assert.equal(result.body.total, expected.length);
        assert.equal(result.body.page_size, 10);
        ids.push(...result.body[key].map(row => row.id));
      }
      assert.deepEqual([...ids].sort(), expected.map(row => row.id).sort());
      assert.equal(new Set(ids).size, expected.length);
    }
  });

  test('search applies before pagination and finds an officer absent from the first fifty', async () => {
    for (const key of ['assignments', 'offices']) {
      const first = await request(`${paths[key]}?page_size=50&timing=current`);
      assert.equal(first.status, 200);
      const visible = new Set(first.body[key].map(row => row.approver_employee_id));
      const target = officers.find(employee => !visible.has(employee.id));
      assert.ok(target, 'fixture must include an officer beyond the first fifty');
      const result = await request(`${paths[key]}?search=${encodeURIComponent(target.display_name)}&timing=current&page_size=10`);
      assert.equal(result.status, 200); assert.equal(result.body.total, 1);
      assert.deepEqual(result.body[key].map(row => row.approver_employee_id), [target.id]);
      const emptyPage = await request(`${paths[key]}?search=${encodeURIComponent(target.display_name)}&timing=current&page=2&page_size=10`);
      assert.equal(emptyPage.body.total, 1); assert.deepEqual(emptyPage.body[key], []);
    }
  });

  test('department, office and inclusive effective-date filters agree with totals', async () => {
    for (const key of ['assignments', 'offices']) {
      const scope = `department_id=${departments[59].id}`;
      const all = await request(`${paths[key]}?${scope}`);
      assert.equal(all.body.total, 3);
      for (const timing of ['current', 'upcoming', 'ended']) {
        const result = await request(`${paths[key]}?${scope}&timing=${timing}`);
        assert.equal(result.status, 200); assert.equal(result.body.total, 1); assert.equal(result.body[key].length, 1);
        assert.equal(result.body[key][0].department_id, departments[59].id);
      }
    }
    const closed = await request(`${paths.offices}?department_id=${departments[58].id}&level=minister&timing=ended`);
    assert.equal(closed.body.total, 1); assert.ok(closed.body.offices[0].closed_office_id);
    assert.equal(closed.body.offices[0].effective_to, dates.yesterday);
    const current = await request(`${paths.offices}?department_id=${departments[58].id}&level=minister&timing=current`);
    assert.equal(current.body.total, 0); assert.deepEqual(current.body.offices, []);
  });

  test('government-wide scopes and department scopes remain distinct', async () => {
    const chief = await request(`${paths.assignments}?level=chief_secretary&timing=current`);
    assert.equal(chief.body.total, 1); assert.equal(chief.body.assignments[0].department_id, null);
    const government = await request(`${paths.offices}?scope=government&timing=current`);
    assert.equal(government.body.total, 1); assert.equal(government.body.offices[0].level, 'hr_verifier');
    const department = await request(`${paths.offices}?scope=department&timing=current&page_size=50`);
    assert.equal(department.body.total, 60); assert.equal(department.body.offices.length, 50);
    assert.ok(department.body.offices.every(row => row.department_id));
    const contradictory = await request(`${paths.offices}?scope=government&department_id=${departments[0].id}`);
    assert.equal(contradictory.body.total, 0); assert.deepEqual(contradictory.body.offices, []);
    const reference = await request(`${paths.offices}?search=${encodeURIComponent('appointment instrument 60')}`);
    assert.equal(reference.body.total, 1); assert.equal(reference.body.offices[0].approver_employee_id, officers[59].id);
  });

  test('selected employee onboarding history and account counts stay scoped across pages', async () => {
    const selected = officers[59].id;
    const pageOne = await request(`/onboarding/batches?employee_id=${selected}`);
    const pageTwo = await request(`/onboarding/batches?employee_id=${selected}&page=2`);
    assert.equal(pageOne.status, 200); assert.equal(pageOne.body.total, 22);
    assert.equal(pageOne.body.batches.length, 20); assert.equal(pageTwo.body.total, 22); assert.equal(pageTwo.body.batches.length, 2);
    const batches = [...pageOne.body.batches, ...pageTwo.body.batches];
    assert.deepEqual(batches.map(batch => batch.id).sort(), [...singleBatches, multiBatch].map(batch => batch.id).sort());
    assert.equal(batches.find(batch => batch.id === multiBatch.id).employee_count, 2, 'keep full cohort size visible');
    assert.ok(!batches.some(batch => batch.id === otherBatch.id));
    const accountResult = await request(`/onboarding/accounts?employee_id=${selected}`);
    assert.equal(accountResult.status, 200); assert.equal(accountResult.body.total, 1);
    assert.deepEqual(accountResult.body.accounts.map(row => row.employee_id), [selected]);
    const beyond = await request(`/onboarding/accounts?employee_id=${selected}&page=2`);
    assert.equal(beyond.body.total, 1); assert.deepEqual(beyond.body.accounts, []);
    const mismatch = await request(`/onboarding/accounts?employee_id=${selected}&search=${encodeURIComponent(officers[0].display_name)}`);
    assert.equal(mismatch.body.total, 0); assert.deepEqual(mismatch.body.accounts, []);
  });

  test('selected onboarding detail cannot conceal a multi-employee cohort or another employee', async () => {
    const selected = officers[59].id, single = singleBatches[0].id;
    const one = await request(`/onboarding/batches/${single}?employee_id=${selected}`);
    assert.equal(one.status, 200); assert.equal(one.body.total, 1); assert.equal(one.body.rows[0].employee_id, selected);
    assert.equal((await request(`/onboarding/batches/${multiBatch.id}?employee_id=${selected}`)).status, 409);
    assert.equal((await request(`/onboarding/batches/${otherBatch.id}?employee_id=${selected}`)).status, 409);
    const global = await request(`/onboarding/batches/${multiBatch.id}`);
    assert.equal(global.status, 200); assert.equal(global.body.total, 2);
    for (const path of ['/onboarding/batches', '/onboarding/accounts', `/onboarding/batches/${single}`]) {
      assert.equal((await request(`${path}?employee_id=invalid`)).status, 422);
      assert.equal((await request(`${path}?employee_id=${selected}`, limitedToken)).status, 403);
    }
  });

  test('application employee filters preserve paging, status and owner authorization', async () => {
    const path = '/government/workflow/requests', selected = officers[0].id;
    const first = await request(`${path}?mode=all&employee_id=${selected}`);
    const second = await request(`${path}?mode=all&employee_id=${selected}&page=2`);
    assert.equal(first.status, 200); assert.equal(first.body.total, 51); assert.equal(first.body.requests.length, 50);
    assert.equal(second.body.total, 51); assert.equal(second.body.requests.length, 1);
    assert.ok([...first.body.requests, ...second.body.requests].every(row => row.employee_id === selected && row.status === 'pending'));
    assert.equal(new Set([...first.body.requests, ...second.body.requests].map(row => row.id)).size, 51);
    const approved = await request(`${path}?mode=all&employee_id=${selected}&status=approved`);
    assert.equal(approved.body.total, 1); assert.equal(approved.body.requests[0].status, 'approved');
    const own = await request(`${path}?mode=mine&employee_id=${selected}`, ownerToken);
    assert.equal(own.status, 200); assert.equal(own.body.total, 51);
    const other = await request(`${path}?mode=mine&employee_id=${officers[1].id}`, ownerToken);
    assert.equal(other.status, 200); assert.equal(other.body.total, 0); assert.deepEqual(other.body.requests, []);
    assert.equal((await request(`${path}?mode=all`, ownerToken)).status, 403);
    assert.equal((await request(`${path}?employee_id=invalid`)).status, 422);
  });

  test('administration caps and plans belong to the selected employee', async () => {
    const path = '/government/workflow/administration';
    const global = await request(path);
    assert.equal(global.status, 200); assert.equal(global.body.alerts.length, 2); assert.equal(global.body.plans.length, 2);
    for (const employee of officers.slice(0, 2)) {
      const scoped = await request(`${path}?employee_id=${employee.id}`);
      assert.equal(scoped.status, 200); assert.equal(scoped.body.alerts.length, 1); assert.equal(scoped.body.plans.length, 1);
      assert.equal(scoped.body.alerts[0].employee_id, employee.id); assert.equal(scoped.body.alerts[0].capped, true);
      assert.equal(scoped.body.plans[0].employee_id, employee.id);
    }
    const empty = await request(`${path}?employee_id=${officers[2].id}`);
    assert.deepEqual(empty.body.alerts, []); assert.deepEqual(empty.body.plans, []);
    assert.equal((await request(`${path}?employee_id=invalid`)).status, 422);
    assert.equal((await request(`${path}?employee_id=${officers[0].id}`, limitedToken)).status, 403);
  });

  test('invalid filters are rejected and both registers remain central-HR only', async () => {
    for (const key of ['assignments', 'offices']) {
      for (const query of ['page=0', 'page_size=51', 'department_id=not-a-uuid', 'level=unknown', 'timing=unknown', 'level=', 'timing=', 'department_id=']) {
        assert.equal((await request(`${paths[key]}?${query}`)).status, 422, `${key}: ${query}`);
      }
      assert.equal((await request(paths[key], limitedToken)).status, 403);
      assert.equal((await request(paths[key], null)).status, 401);
      const literal = await request(`${paths[key]}?search=${encodeURIComponent("' OR 1=1 --")}`);
      assert.equal(literal.status, 200); assert.equal(literal.body.total, 0);
    }
    assert.equal((await request(`${paths.offices}?scope=unknown`)).status, 422);
  });

  test('browsing and rejected requests preserve personnel, balances, policies and appointment history', async () => {
    assert.deepEqual(await snapshot(), beforeRows);
  });
});

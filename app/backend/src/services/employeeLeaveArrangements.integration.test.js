import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, beforeEach, describe, test } from 'node:test';
import { connectTestDatabase, createEmployee, resetLeaveTables, skipWithoutDatabase, upsertLeaveType } from '../test-support/database.js';

describe('read-only employee leave arrangements', { skip: skipWithoutDatabase }, () => {
  let pool, service, auth, actor, employee, department, division, server, base;
  const reason = 'Synthetic reviewed arrangements fixture';
  const fixtureTypeIds = new Set();
  async function fixtureLeaveType(data) {
    const type = await upsertLeaveType(pool, data);
    fixtureTypeIds.add(type.id);
    return type;
  }
  before(async () => {
    pool = await connectTestDatabase();
    service = await import('./employeeLeaveArrangements.js');
    auth = await import('./authService.js');
    const express = (await import('express')).default;
    const errors = await import('../middleware/errors.js');
    errors.enableAsyncErrors();
    const app = express();
    app.use('/api/hr/directory', (await import('../routes/employeeLeaveArrangements.js')).default);
    app.use(errors.errorHandler);
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    base = `http://127.0.0.1:${server.address().port}/api/hr/directory`;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (!pool) return;
    try {
      // Integration files share a serial test database. Synthetic active types
      // must not become additional accrual policies for the next suite.
      await resetLeaveTables(pool);
      await pool.query('TRUNCATE hr_gov_policy_versions CASCADE');
      await pool.query('DELETE FROM hr_leave_types WHERE id=ANY($1::uuid[])', [[...fixtureTypeIds]]);
    } finally { await pool.end(); }
  });
  async function account(permissions = {}, type = 'staff') {
    return (await pool.query(`INSERT INTO reviewers(email,display_name,role,account_type,password_hash,permissions,onboarding_state)
      VALUES($1,'Synthetic officer','user',$2,'x',$3,'ready') RETURNING *`, [`${randomUUID()}@example.test`, type, permissions])).rows[0];
  }
  const summary = (user = actor, client = pool) => service.employeeLeaveArrangements(client, { user, employeeId: employee.id });
  async function request(user, id = employee.id) {
    const session = await auth.createSession(user.id);
    const token = auth.buildTokenPayload(user, session.tokenId, session.expiresAt);
    const response = await fetch(`${base}/${id}/leave-arrangements`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  }
  beforeEach(async () => {
    await resetLeaveTables(pool);
    await pool.query('TRUNCATE hr_gov_policy_versions CASCADE');
    actor = await account({ hr_admin: true, hr_access: true });
    department = (await pool.query("INSERT INTO hr_departments(name) VALUES('Synthetic Finance') RETURNING *")).rows[0];
    division = (await pool.query("INSERT INTO hr_divisions(department_id,name) VALUES($1,'Synthetic Treasury') RETURNING *", [department.id])).rows[0];
    employee = await createEmployee(pool, { name: 'Existing Finance employee' });
    await pool.query('UPDATE hr_employees SET department_id=$2,division_id=$3 WHERE id=$1', [employee.id, department.id, division.id]);
  });
  async function configuration(enabled, approvedAt = '2026-01-01', status = 'published') {
    return (await pool.query(`INSERT INTO hr_gov_workflow_configs(employee_id,enabled_codes,medical_rule,medical_history,source_reference,
      legacy_resolution_reference,snapshot_hash,prepared_by,reason,status,approved_by,approved_at)
      VALUES($1,$2,'single_calendar_date_nonadjacent_scheduled_days',$3,'synthetic','synthetic','synthetic',$4,$5,$6,$4,$7) RETURNING *`,
      [employee.id, enabled, JSON.stringify([{ private_medical_reason: 'SECRET CLINICAL HISTORY' }]), actor.id, reason, status, approvedAt])).rows[0];
  }
  async function policy() {
    const { DEFAULT_RULES } = await import('../lib/governmentLeaveRules.js');
    return (await pool.query(`INSERT INTO hr_gov_policy_versions(label,effective_from,effective_to,rules,source_reference,status,reason)
      VALUES('Published Government policy','2020-01-01','2099-12-31',$1,'synthetic','published',$2) RETURNING *`, [DEFAULT_RULES, reason])).rows[0];
  }

  test('published Government rules never replace legacy balances, defaults, settings or history on read', async () => {
    const annual = await fixtureLeaveType({ name: 'Synthetic Annual', accruable: true, perFortnight: 0.77, maxBalance: 60 });
    const medical = await fixtureLeaveType({ name: 'Synthetic Medical', defaultDays: 7, requiresAttachment: true, attachmentLabel: 'Medical certificate' });
    await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance,pending) VALUES($1,$2,2026,47.25,2.50)', [employee.id, annual.id]);
    await pool.query("UPDATE reviewer_settings SET accrual_anchor_date='2026-01-09' WHERE id=TRUE");
    await pool.query("INSERT INTO hr_leave_applications(employee_id,leave_type_id,start_date,end_date,days,status,reason) VALUES($1,$2,'2026-01-01','2026-01-01',1,'approved','SECRET LEGACY REASON')", [employee.id, medical.id]);
    const published = await policy();
    const tables = ['hr_employees', 'hr_leave_balances', 'hr_leave_applications', 'hr_employee_account_links', 'hr_gov_entitlements', 'hr_gov_openings', 'hr_gov_ledger', 'reviewers', 'audit_log'];
    const snapshot = async () => Promise.all(tables.map(async table => (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
    const before = await snapshot();
    // Any accidental write, including lazy balance provisioning, fails before execution.
    const readOnly = { query(sql, values) { assert.match(sql.trim(), /^SELECT\b/i); return pool.query(sql, values); } };
    const data = await summary(actor, readOnly);
    assert.equal(data.regime, 'legacy');
    assert.equal(data.legacy.operational, true);
    assert.equal(data.government.policy.id, published.id);
    assert.deepEqual(data.legacy.balances.map(b => [b.balance, b.pending]), [['47.25', '2.50']]);
    assert.equal(data.legacy.policies.find(p => p.id === annual.id).accrual_days_per_fortnight, '0.77');
    assert.equal(data.legacy.policies.find(p => p.id === medical.id).default_days, '7.00');
    assert.equal(data.legacy.settings.accrual_anchor_date, '2026-01-09');
    assert.deepEqual(data.legacy.application_counts, [{ status: 'approved', count: 1 }]);
    assert.ok(!JSON.stringify(data).includes('SECRET'));
    assert.equal(data.government.activation.status, 'not_activated');
    assert.equal(data.preparation.find(i => i.key === 'enrolment').status, 'missing');
    assert.deepEqual(await snapshot(), before);
    const response = await request(actor);
    assert.equal(response.status, 200); assert.equal(response.cache, 'no-store');
  });

  test('scope and capability checks protect even minimal profiles, and scoped HR receives no central/private detail', async () => {
    const staff = await account({ hr_staff_manage: true, hr_access: true });
    assert.equal((await request(staff)).status, 404);
    assert.equal((await request(await account({ hr_access: true }))).status, 403);
    assert.equal((await request(actor, randomUUID())).status, 404);
    assert.equal((await request(actor, 'not-a-uuid')).status, 422);
    await pool.query("INSERT INTO hr_access_scopes(reviewer_id,department_id,capabilities,effective_from,granted_by,reason) VALUES($1,$2,ARRAY['hr_staff_manage'],'2020-01-01',$3,$4)", [staff.id, department.id, actor.id, reason]);
    await configuration(['medical']);
    const data = (await request(staff)).body;
    assert.equal(data.restricted, true); assert.equal(data.legacy, null); assert.equal(data.government, null); assert.deepEqual(data.preparation, []);
    assert.ok(!JSON.stringify(data).includes('SECRET'));
    await pool.query("UPDATE hr_access_scopes SET revoked_at=NOW() WHERE reviewer_id=$1", [staff.id]);
    await assert.rejects(summary(staff), { status: 404 });
  });

  test('enrolment, latest published activation, draft configuration and employee-only account remain distinct', async () => {
    const employeeLogin = await account({ hr_access: true }, 'employee');
    await pool.query('UPDATE hr_employees SET reviewer_id=$2 WHERE id=$1', [employee.id, employeeLogin.id]);
    let data = await summary();
    assert.equal(data.legacy.operational, false); assert.match(data.government.operational_status, /legacy applications are unavailable/);
    await pool.query("UPDATE hr_employees SET leave_policy_regime='government' WHERE id=$1", [employee.id]);
    data = await summary();
    assert.equal(data.government.activation.status, 'not_activated'); assert.match(data.government.operational_status, /unavailable until activation/);
    await configuration(['medical']);
    await configuration(['recreation'], '2026-01-03', 'draft');
    data = await summary();
    assert.equal(data.government.activation.status, 'active'); assert.deepEqual(data.government.activation.enabled_codes, ['medical']);
    assert.equal(data.government.applicability.find(a => a.code === 'medical').enabled, true);
    assert.equal(data.government.applicability.find(a => a.code === 'recreation').enabled, false);
    await configuration([], '2026-01-02');
    data = await summary(); assert.equal(data.government.activation.status, 'paused'); assert.deepEqual(data.government.activation.enabled_codes, []);
    assert.ok(!JSON.stringify(data).includes('SECRET'));
  });

  test('certified Government ledger balances include reservations and remain separate from retained balances', async () => {
    const published = await policy();
    const opening = (await pool.query(`INSERT INTO hr_gov_openings(employee_id,code,policy_version_id,period_start,period_end,as_of,amount,
      source_reference,payroll_reference,snapshot_hash,historical_snapshot,status,prepared_by,reason)
      VALUES($1,'medical',$2,'2026-01-01','2026-12-31','2026-01-01',8,'synthetic','synthetic','synthetic','[]','certified',$3,$4) RETURNING id`,
      [employee.id, published.id, actor.id, reason])).rows[0];
    const entitlement = (await pool.query(`INSERT INTO hr_gov_entitlements(employee_id,code,policy_version_id,period_start,period_end,as_of,opening_id)
      VALUES($1,'medical',$2,'2026-01-01','2026-12-31','2026-01-01',$3) RETURNING id`, [employee.id, published.id, opening.id])).rows[0];
    await pool.query(`INSERT INTO hr_gov_ledger(entitlement_id,kind,amount,effective_date,event_key,source_reference,actor_id,reason)
      VALUES($1,'opening',8,'2026-01-01',$2,'synthetic',$3,$4)`, [entitlement.id, randomUUID(), actor.id, reason]);
    const reservation = randomUUID();
    await pool.query("INSERT INTO hr_gov_reservation_requests(id,employee_id,payload_hash,evaluation_snapshot) VALUES($1,$2,'synthetic','{}')", [reservation, employee.id]);
    await pool.query('INSERT INTO hr_gov_reservations(request_id,entitlement_id,amount) VALUES($1,$2,2)', [reservation, entitlement.id]);
    const data = await summary();
    assert.deepEqual(data.government.entitlements.map(e => [e.balance, e.held, e.available]), [['8.000000', '2.000000', '6.000000']]);
    assert.equal(data.government.openings[0].amount, '8.000000');
    assert.deepEqual(data.legacy.balances, []);
    assert.equal(data.regime, 'legacy');
    assert.equal(data.government.applicability.find(a => a.code === 'medical').enabled, false);
  });

  test('retained legacy defaults apply only to operational legacy and pay details require a separate permission', async () => {
    const type = await fixtureLeaveType({ name: 'Unseeded legacy default', defaultDays: 7 });
    let data = await summary();
    assert.equal(data.legacy.effective_balances.find(b => b.leave_type_id === type.id).source, 'legacy_default');
    await pool.query("UPDATE hr_employees SET leave_policy_regime='government',daily_rate=123.45,eligibility_note='Retained eligibility note',join_date='2020-01-01' WHERE id=$1", [employee.id]);
    data = await summary();
    assert.deepEqual(data.legacy.effective_balances, []);
    assert.equal(Object.hasOwn(data.legacy, 'daily_rate'), false);
    assert.equal(data.legacy.eligibility_note, 'Retained eligibility note');
    assert.equal(data.legacy.join_date, '2020-01-01');
    assert.equal((await summary({ ...actor, permissions: { ...actor.permissions, hr_pay_view: true } })).legacy.daily_rate, '123.45');
    const employeeLogin = await account({ hr_access: true }, 'employee');
    await pool.query("UPDATE hr_employees SET leave_policy_regime='legacy',reviewer_id=$2 WHERE id=$1", [employee.id, employeeLogin.id]);
    data = await summary(); assert.deepEqual(data.legacy.effective_balances, []);
    await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance,pending) VALUES($1,$2,$3,4,1)', [employee.id, type.id, Number(data.as_of.slice(0, 4))]);
    data = await summary();
    assert.deepEqual(data.legacy.effective_balances.map(b => [b.balance, b.source]), [['4.00', 'stored']]);
    assert.equal(data.account_status, 'active'); assert.equal(data.onboarding_state, 'ready');
  });

  test('certified casual/probationary service is distinct from eligibility and teacher openings are evaluated per enabled type', async () => {
    await pool.query(`INSERT INTO hr_employee_service_periods(employee_id,start_date,employment_category,counts_for_service,is_teacher,reason)
      VALUES($1,'2020-01-01','casual',TRUE,TRUE,$2)`, [employee.id, reason]);
    await pool.query(`INSERT INTO hr_gov_service_bases(employee_id,effective_from,continuity_start,anniversary_method,leap_day_method,schedule_mode,source_reference,reason)
      VALUES($1,'2020-01-01','2020-01-01','calendar','feb28','weekly','synthetic',$2)`, [employee.id, reason]);
    let data = await summary();
    assert.equal(data.preparation.find(p => p.key === 'service').status, 'ready');
    assert.equal(data.preparation.find(p => p.key === 'eligibility').status, 'needs_review');
    assert.equal(data.preparation.find(p => p.key === 'openings').status, 'needs_review');
    assert.equal(data.government.opening_readiness.find(p => p.code === 'recreation').status, 'case_review');
    assert.equal(data.government.opening_readiness.find(p => p.code === 'special').status, 'not_enabled');
    await pool.query("UPDATE hr_employee_service_periods SET employment_category='probationary' WHERE employee_id=$1", [employee.id]);
    await configuration(['medical']);
    data = await summary();
    assert.equal(data.preparation.find(p => p.key === 'service').status, 'ready');
    assert.equal(data.government.opening_readiness.find(p => p.code === 'medical').status, 'missing');
    assert.equal(data.government.opening_readiness.find(p => p.code === 'special').required_for_enabled_type, false);
    assert.match(data.preparation.find(p => p.key === 'openings').detail, /medical/);
    assert.ok(!data.preparation.find(p => p.key === 'openings').detail.includes('special'));
  });

  test('policy usage reports latest published activation and dated policy without exposing employees or changing regimes', async () => {
    const original = employee;
    const { DEFAULT_RULES } = await import('../lib/governmentLeaveRules.js');
    await pool.query(`INSERT INTO hr_gov_policy_versions(label,effective_from,effective_to,rules,source_reference,status,reason,published_at)
      VALUES('Published Government policy','2020-01-01','2090-12-31',$1,'synthetic','published',$2,'2020-01-01')`, [DEFAULT_RULES, reason]);
    await pool.query(`INSERT INTO hr_gov_policy_versions(label,effective_from,effective_to,rules,source_reference,status,reason,published_at)
      SELECT 'Future published policy','2091-01-01','2099-12-31',rules,'synthetic','published',$1,'2026-01-01' FROM hr_gov_policy_versions LIMIT 1`, [reason]);
    for (const state of ['unactivated', 'active', 'paused']) {
      employee = await createEmployee(pool, { name: 'PRIVATE government employee' });
      await pool.query("UPDATE hr_employees SET leave_policy_regime='government' WHERE id=$1", [employee.id]);
      if (state === 'active') { await configuration(['medical']); await configuration([], '2026-01-03', 'draft'); }
      if (state === 'paused') { await configuration(['medical']); await configuration([], '2026-01-02'); }
    }
    const blocked = await createEmployee(pool, { name: 'PRIVATE blocked employee' });
    const login = await account({}, 'employee');
    await pool.query('UPDATE hr_employees SET reviewer_id=$2 WHERE id=$1', [blocked.id, login.id]);
    await createEmployee(pool, { name: 'PRIVATE inactive employee', status: 'inactive' });
    await createEmployee(pool, { name: 'PRIVATE ineligible employee', entitled: false });
    const readOnly = { query(sql, values) { assert.match(sql.trim(), /^SELECT\b/i); return pool.query(sql, values); } };
    const usage = await service.employeeLeavePolicyUsage(readOnly, { user: actor });
    assert.deepEqual(usage.counts, { active_employees: 6, inactive_employees: 1, legacy_operational: 1, legacy_employee_account_blocked: 1,
      legacy_not_entitled: 1, government_awaiting_activation: 1, government_active: 1, government_paused: 1 });
    assert.equal(usage.current_policy.label, 'Published Government policy');
    assert.equal(usage.latest_published_policy.label, 'Future published policy'); assert.equal(usage.latest_published_policy.timing, 'future');
    assert.equal(usage.next_policy.id, usage.latest_published_policy.id); assert.ok(!JSON.stringify(usage).includes('PRIVATE'));
    assert.equal((await pool.query('SELECT leave_policy_regime FROM hr_employees WHERE id=$1', [original.id])).rows[0].leave_policy_regime, 'legacy');
    await assert.rejects(service.employeeLeavePolicyUsage(pool, { user: await account({ hr_staff_manage: true }) }), { status: 403 });
    async function usageHttp(user) {
      const session = await auth.createSession(user.id);
      const token = auth.buildTokenPayload(user, session.tokenId, session.expiresAt);
      return fetch(`${base}/leave-policy-usage`, { headers: { Authorization: `Bearer ${token}` } });
    }
    const response = await usageHttp(actor); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await usageHttp(await account({ hr_staff_manage: true }))).status, 403);
  });

  test('central department filtering finds unplaced retained names without converting placement or expanding scoped HR', async () => {
    const { listEmployeeDirectory } = await import('./employeeDirectory.js');
    const retained = await createEmployee(pool, { name: 'Retained Finance employee', department: 'sYNTHETIC fINANCE' });
    await pool.query("UPDATE hr_employees SET division_code='Treasury retained' WHERE id=$1", [retained.id]);
    const other = (await pool.query("INSERT INTO hr_departments(name) VALUES('Different department') RETURNING id")).rows[0];
    const moved = await createEmployee(pool, { name: 'Verified elsewhere', department: 'Synthetic Finance' });
    await pool.query('UPDATE hr_employees SET department_id=$2 WHERE id=$1', [moved.id, other.id]);
    const readOnly = { query(sql, values) { assert.match(sql.trim(), /^SELECT\b/i); return pool.query(sql, values); } };
    const selected = await listEmployeeDirectory(readOnly, { user: actor, departmentId: department.id });
    assert.equal(selected.total, 2); assert.deepEqual(new Set(selected.employees.map(e => e.id)), new Set([employee.id, retained.id]));
    assert.equal(selected.employees.find(e => e.id === retained.id).department_id, null);
    const missing = await listEmployeeDirectory(pool, { user: actor, departmentId: department.id, readiness: 'missing_placement', pageSize: 1 });
    assert.equal(missing.total, 1); assert.equal(missing.employees[0].id, retained.id);
    const arrangements = await service.employeeLeaveArrangements(pool, { user: actor, employeeId: retained.id });
    assert.match(arrangements.preparation.find(p => p.key === 'placement').detail, /sYNTHETIC fINANCE.*Treasury retained.*Explicitly verify/);
    const staff = await account({ hr_staff_manage: true });
    await pool.query("INSERT INTO hr_access_scopes(reviewer_id,department_id,capabilities,effective_from,granted_by,reason) VALUES($1,$2,ARRAY['hr_staff_manage'],'2020-01-01',$3,$4)", [staff.id, department.id, actor.id, reason]);
    const scoped = await listEmployeeDirectory(pool, { user: staff, departmentId: department.id });
    assert.equal(scoped.total, 1); assert.equal(scoped.employees[0].id, employee.id);
    // The managed department registry itself rejects ambiguous case-only names.
    await assert.rejects(pool.query("INSERT INTO hr_departments(name) VALUES('SYNTHETIC FINANCE')"), { code: '23505' });
    assert.equal((await pool.query('SELECT department_id FROM hr_employees WHERE id=$1', [retained.id])).rows[0].department_id, null);
  });

  test('the Government route includes verified HR, Secretary and conditional Minister with self-approval and capability blockers', async () => {
    const subjectLogin = await account({ hr_leave_approve: true });
    await pool.query('UPDATE hr_employees SET reviewer_id=$2 WHERE id=$1', [employee.id, subjectLogin.id]);
    const officerLogin = await account({ hr_leave_approve: true, hr_admin: true });
    const officer = await createEmployee(pool, { name: 'Dated Government officer' });
    await pool.query('UPDATE hr_employees SET reviewer_id=$2 WHERE id=$1', [officer.id, officerLogin.id]);
    for (const level of ['division', 'department', 'chief_secretary']) {
      await pool.query(`INSERT INTO hr_approval_assignments(level,department_id,division_id,approver_employee_id,effective_from,recorded_by,reason)
        VALUES($1,$2,$3,$4,'2020-01-01',$5,$6)`, [level, level === 'chief_secretary' ? null : department.id, level === 'division' ? division.id : null,
        level === 'division' ? employee.id : officer.id, actor.id, reason]);
    }
    for (const level of ['hr_verifier', 'relevant_secretary', 'minister']) {
      await pool.query(`INSERT INTO hr_gov_consent_offices(level,department_id,approver_employee_id,effective_from,source_reference,recorded_by,reason)
        VALUES($1,$2,$3,'2020-01-01','synthetic',$4,$5)`, [level, level === 'hr_verifier' ? null : department.id, officer.id, actor.id, reason]);
    }
    let route = (await summary()).government.route;
    assert.deepEqual(route.stages.map(s => s.level), ['division', 'department', 'hr_verifier', 'relevant_secretary', 'minister', 'chief_secretary']);
    assert.match(route.stages[0].issue, /Self-approval/);
    assert.equal(route.stages.find(s => s.level === 'hr_verifier').issue, null);
    assert.equal(route.stages.find(s => s.level === 'relevant_secretary').approver_name, officer.display_name);
    assert.deepEqual(route.stages.find(s => s.level === 'minister').applies_to, ['extended_medical_minister']);
    assert.equal(route.routes.find(r => r.code === 'special').levels.includes('relevant_secretary'), false);
    assert.equal(route.ready, false);
    await pool.query("UPDATE reviewers SET permissions='{}' WHERE id=$1", [officerLogin.id]);
    route = (await summary()).government.route;
    assert.match(route.stages.find(s => s.level === 'hr_verifier').issue, /capability/);
  });
});

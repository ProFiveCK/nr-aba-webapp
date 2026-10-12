import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, beforeEach, describe, test } from 'node:test';
import { connectTestDatabase, createEmployee, resetLeaveTables, skipWithoutDatabase, upsertLeaveType } from '../test-support/database.js';

describe('first-time Government leave configuration adoption', { skip: skipWithoutDatabase }, () => {
  let pool, setup, auth, actor, employee, department, division, policy, server, base;
  const reason = 'Owner reviewed initial retained-data setup against existing records.';
  const previousTypes = new Map();
  async function type(data) {
    if (!previousTypes.has(data.name)) previousTypes.set(data.name, (await pool.query('SELECT * FROM hr_leave_types WHERE name=$1', [data.name])).rows[0] || null);
    return upsertLeaveType(pool, data);
  }
  async function account(permissions = { hr_admin: true, hr_access: true }) {
    return (await pool.query(`INSERT INTO reviewers(email,display_name,role,account_type,password_hash,permissions,onboarding_state)
      VALUES($1,'Synthetic setup officer','user','staff','x',$2,'ready') RETURNING *`, [`${randomUUID()}@example.test`, permissions])).rows[0];
  }
  before(async () => {
    pool = await connectTestDatabase(); setup = await import('./governmentLeaveInitialSetup.js'); auth = await import('./authService.js');
    const express = (await import('express')).default;
    const errors = await import('../middleware/errors.js'); errors.enableAsyncErrors();
    const app = express(); app.use(express.json());
    app.use('/api/hr/government/initial-setup', (await import('../routes/governmentLeaveInitialSetup.js')).default); app.use(errors.errorHandler);
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    base = `http://127.0.0.1:${server.address().port}/api/hr/government/initial-setup`;
  });
  beforeEach(async () => {
    await resetLeaveTables(pool);
    await pool.query('TRUNCATE hr_gov_initial_setups,hr_gov_initial_setup_revisions,hr_gov_policy_versions CASCADE');
    actor = await account();
    department = (await pool.query("INSERT INTO hr_departments(name) VALUES('Setup Finance') RETURNING *")).rows[0];
    division = (await pool.query("INSERT INTO hr_divisions(department_id,name) VALUES($1,'Treasury') RETURNING *", [department.id])).rows[0];
    employee = await createEmployee(pool, { name: 'Existing retained employee', department: 'sETUP fINANCE', joinDate: '2018-03-04' });
    await pool.query("UPDATE hr_employees SET division_code='tREASURY',daily_rate=123.45,eligibility_note='PRIVATE eligibility note' WHERE id=$1", [employee.id]);
    const { DEFAULT_RULES } = await import('../lib/governmentLeaveRules.js');
    policy = (await pool.query(`INSERT INTO hr_gov_policy_versions(label,effective_from,effective_to,rules,source_reference,status,reason,published_at)
      VALUES('Synthetic published policy','2020-01-01','2099-12-31',$1,'Existing signed reference','published','Pending authority note is retained',NOW()) RETURNING *`, [DEFAULT_RULES])).rows[0];
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (!pool) return;
    try {
      await resetLeaveTables(pool);
      await pool.query('TRUNCATE hr_gov_initial_setups,hr_gov_initial_setup_revisions,hr_gov_policy_versions CASCADE');
      for (const [name, old] of previousTypes) {
        if (!old) await pool.query('DELETE FROM hr_leave_types WHERE name=$1', [name]);
        else await pool.query(`UPDATE hr_leave_types SET default_days=$2,is_accruable=$3,requires_note=$4,is_active=$5,
          accrual_days_per_fortnight=$6,reset_period=$7,max_balance=$8,requires_attachment=$9,attachment_label=$10 WHERE name=$1`,
          [name, old.default_days, old.is_accruable, old.requires_note, old.is_active, old.accrual_days_per_fortnight, old.reset_period, old.max_balance, old.requires_attachment, old.attachment_label]);
      }
    } finally { await pool.end(); }
  });
  async function call(path = '', body, method = body ? 'POST' : 'GET', user = actor) {
    const session = await auth.createSession(user.id);
    const token = auth.buildTokenPayload(user, session.tokenId, session.expiresAt);
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  }
  async function plan(overrides = {}) {
    const rows = (await pool.query('SELECT id FROM hr_leave_types ORDER BY id')).rows;
    return { policy_id: policy.id, start_date: '2026-10-08', mappings: rows.map(t => ({ leave_type_id: t.id, code: 'retain_history' })), adopt_employee_ids: [employee.id], ...overrides };
  }
  const preview = data => setup.previewInitialSetup(pool, { user: actor, data });
  async function save(data = null) {
    data ||= await plan(); const result = await preview(data);
    return setup.saveInitialSetupDraft(pool, { user: actor, actor, data: { ...data, source_hash: result.source_hash, reason } });
  }
  const adopt = draft => setup.adoptInitialSetup(pool, { user: actor, actor, id: draft.id, data: { expected_revision: draft.revision, source_hash: draft.source_hash, reason } });
  const snapshot = async tables => Promise.all(tables.map(async table => (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));

  test('direct entry uses current policy before adoption and later imports preserve existing records without granting credit', async () => {
    const management = await import('./employeeManagement.js'), imports = await import('./payrollEmployeeImport.js');
    const details = { display_name: 'Synthetic new staff', external_id: 'SETUP-NEW-1', department_id: department.id, division_id: division.id };
    const before = await management.createManagedEmployee(pool, { data: { ...details, display_name: 'Synthetic pre-adoption staff', external_id: 'SETUP-BEFORE' }, actor, reason });
    assert.equal(before.leave_policy_regime, 'government');
    await adopt(await save());
    const created = await management.createManagedEmployee(pool, { data: details, actor, reason });
    assert.equal(created.leave_policy_regime, 'government');
    await pool.query("INSERT INTO hr_employee_external_ids(employee_id,source,external_id,verified_by,reason) VALUES($1,'techone_payroll','SETUP-OLD',$2,$3)", [employee.id, actor.id, reason]);
    const view = await imports.previewPayrollImport(pool, { actor, fileName: 'synthetic-new-staff.csv', exportDate: '2026-10-09', csv: 'payroll_employee_id,display_name,status,department_name\nSETUP-NEW-2,Synthetic imported new staff,active,Setup Finance\nSETUP-OLD,Existing retained employee,active,Setup Finance' });
    await imports.applyPayrollImport(pool, { batchId: view.batch.id, revision: view.batch.revision, reviewNote: reason, actor });
    const imported = (await pool.query("SELECT e.* FROM hr_employees e JOIN hr_employee_external_ids x ON x.employee_id=e.id WHERE x.external_id='SETUP-NEW-2'")).rows[0];
    assert.equal(imported.leave_policy_regime, 'government');
    assert.equal((await pool.query('SELECT leave_policy_regime FROM hr_employees WHERE id=$1', [employee.id])).rows[0].leave_policy_regime, 'legacy');
    assert.equal((await pool.query('SELECT leave_policy_regime FROM hr_employees WHERE id=$1', [before.id])).rows[0].leave_policy_regime, 'government');
    assert.equal((await pool.query('SELECT count(*)::int n FROM hr_gov_entitlements WHERE employee_id=ANY($1::uuid[])', [[created.id, imported.id]])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM hr_gov_workflow_configs WHERE employee_id=ANY($1::uuid[])', [[created.id, imported.id]])).rows[0].n, 0);
    const audit = (await pool.query("SELECT after FROM audit_log WHERE action='hr.employee.import.applied' AND entity_id=$1", [imported.id])).rows[0];
    assert.equal(audit.after.leave_policy_regime, 'government');
  });

  test('state and paged records are read-only, preserve each year and medical pool, and never expose salary or clinical notes', async () => {
    const annual = await type({ name: 'Annual', accruable: true, perFortnight: 0.77, defaultDays: 20, maxBalance: 60 });
    const oldSick = await type({ name: 'Sick', defaultDays: 10, active: false });
    const medical = await type({ name: 'Sick (with MC)', defaultDays: 7 });
    const noCertificate = await type({ name: 'Sick (without MC)', defaultDays: 3 });
    await type({ name: 'Compassionate', defaultDays: 5 });
    for (const [typeId, year, balance] of [[annual.id, 2025, 80], [annual.id, 2026, 47.25], [oldSick.id, 2026, 10], [medical.id, 2026, 7], [noCertificate.id, 2026, 3]]) {
      await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance,pending) VALUES($1,$2,$3,$4,1)', [employee.id, typeId, year, balance]);
    }
    await pool.query("INSERT INTO hr_leave_applications(employee_id,leave_type_id,start_date,end_date,days,reason,status) VALUES($1,$2,'2026-10-01','2026-10-01',1,'PRIVATE clinical reason','pending')", [employee.id, medical.id]);
    const tables = ['hr_employees', 'hr_leave_balances', 'hr_leave_applications', 'hr_gov_ledger', 'hr_gov_workflow_configs', 'hr_gov_initial_setups', 'audit_log'];
    const before = await snapshot(tables);
    const state = await setup.initialSetupState(pool, { user: actor, startDate: '2026-10-08' });
    assert.equal(state.summary.employees, 1); assert.equal(state.summary.balances, 5); assert.equal(state.summary.applications, 1);
    assert.equal(state.selected_policy_id, policy.id); assert.equal(state.policies[0].note, 'Pending authority note is retained');
    assert.equal(state.leave_types.find(t => t.id === annual.id).suggested_code, 'recreation');
    assert.equal(state.leave_types.find(t => t.id === oldSick.id).suggested_code, 'retain_history');
    assert.match(state.leave_types.find(t => t.id === medical.id).warning, /does not add, combine or convert/);
    assert.equal(state.leave_types.find(t => t.name === 'Compassionate').suggested_code, null);
    assert.ok(state.default_plan.mappings.every(m => m.code === null));
    const records = await setup.initialSetupEmployees(pool, { user: actor, search: 'retained', page: 1 });
    assert.equal(records.employees[0].balances.length, 5);
    assert.deepEqual(records.employees[0].balances.filter(b => b.leave_type_id === annual.id).map(b => [b.year, b.balance]), [[2025, '80.00'], [2026, '47.25']]);
    assert.ok(records.employees[0].balances.every(b => b.proposed_target === null));
    assert.ok(records.employees[0].missing_facts.includes('Verified Payroll ID'));
    assert.ok(!JSON.stringify([state, records]).includes('PRIVATE')); assert.ok(!JSON.stringify(records).includes('123.45'));
    assert.deepEqual(await snapshot(tables), before);
    const response = await call(); assert.equal(response.status, 200); assert.equal(response.cache, 'no-store');
  });

  test('central HR is sufficient, but current account authority is rechecked and scoped or revoked officers are denied', async () => {
    assert.equal(actor.role, 'user'); assert.equal((await call()).status, 200);
    assert.equal((await call('', undefined, 'GET', await account({ hr_staff_manage: true, hr_access: true }))).status, 403);
    await pool.query("UPDATE reviewers SET permissions='{}' WHERE id=$1", [actor.id]);
    await assert.rejects(setup.initialSetupState(pool, { user: actor }), { status: 403 });
    await assert.rejects(preview(await plan()), { status: 403 });
  });

  test('incomplete drafts can be revised and deleted by the same officer, with optimistic revision and immutable history', async () => {
    const incomplete = await plan({ policy_id: null, mappings: [], adopt_employee_ids: [] });
    const p = await preview(incomplete); assert.equal(p.ready_to_adopt, false);
    const draft = await save(incomplete); assert.equal(draft.revision, 1); assert.equal(draft.prepared_by, actor.id);
    await assert.rejects(adopt(draft), /Select a published policy/);
    const complete = await plan(); const checked = await preview(complete);
    const updated = await setup.saveInitialSetupDraft(pool, { user: actor, actor, id: draft.id, data: { ...complete, expected_revision: 1, source_hash: checked.source_hash, reason } });
    assert.equal(updated.revision, 2); assert.equal(updated.ready_to_adopt, true);
    await assert.rejects(setup.saveInitialSetupDraft(pool, { user: actor, actor, id: draft.id, data: { ...complete, expected_revision: 1, source_hash: checked.source_hash, reason } }), { status: 409 });
    const deleted = await setup.deleteInitialSetupDraft(pool, { user: actor, actor, id: draft.id, data: { expected_revision: 2, reason } });
    assert.equal(deleted.status, 'deleted'); assert.equal(deleted.revision, 3);
    assert.equal((await setup.initialSetupState(pool, { user: actor })).latest_draft, null);
    await assert.rejects(adopt(updated), { status: 409 });
    assert.deepEqual((await pool.query('SELECT action FROM hr_gov_initial_setup_revisions WHERE setup_id=$1 ORDER BY revision', [draft.id])).rows.map(r => r.action), ['created', 'updated', 'deleted']);
    await assert.rejects(pool.query("UPDATE hr_gov_initial_setup_revisions SET reason='changed' WHERE setup_id=$1", [draft.id]), /immutable/);
  });

  test('changed legacy balances or Government configuration makes a reviewed draft stale before adoption', async () => {
    const leaveType = await type({ name: 'Setup stale fixture', defaultDays: 5 });
    const data = await plan(); const original = await preview(data);
    await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance,pending) VALUES($1,$2,2026,5,0)', [employee.id, leaveType.id]);
    await assert.rejects(setup.saveInitialSetupDraft(pool, { user: actor, actor, data: { ...data, source_hash: original.source_hash, reason } }), /changed after preview/);
    const draft = await save(data);
    await pool.query('UPDATE hr_leave_balances SET pending=1 WHERE employee_id=$1', [employee.id]);
    assert.equal((await setup.initialSetupState(pool, { user: actor })).latest_draft.freshness, 'stale');
    await assert.rejects(adopt(draft), /Source records changed/);
    const refreshed = await preview(data);
    const updated = await setup.saveInitialSetupDraft(pool, { user: actor, actor, id: draft.id, data: { ...data, source_hash: refreshed.source_hash, expected_revision: draft.revision, reason } });
    await pool.query(`INSERT INTO hr_gov_workflow_configs(employee_id,enabled_codes,medical_rule,medical_history,source_reference,legacy_resolution_reference,snapshot_hash,prepared_by,reason)
      VALUES($1,'{}','single_calendar_date_nonadjacent_scheduled_days','[]','synthetic','synthetic','synthetic',$2,$3)`, [employee.id, actor.id, reason]);
    await assert.rejects(adopt(updated), /Source records changed/);
    assert.equal((await pool.query('SELECT department_id FROM hr_employees WHERE id=$1', [employee.id])).rows[0].department_id, null);
  });

  test('adoption updates only explicitly selected null placement IDs, preserves operational rows exactly and is idempotent and singleton', async () => {
    const linked = await account({ hr_access: true });
    const manager = await createEmployee(pool, { name: 'Existing nominated manager' });
    await pool.query('UPDATE hr_employees SET reviewer_id=$2,manager_id=$3 WHERE id=$1', [employee.id, linked.id, manager.id]);
    const unmatched = await createEmployee(pool, { name: 'Unmatched remains legacy', department: 'Unknown department' });
    const unselected = await createEmployee(pool, { name: 'Unselected exact employee', department: 'Setup Finance' });
    await pool.query("UPDATE hr_employees SET division_code='Treasury' WHERE id=$1", [unselected.id]);
    const data = await plan(); const draft = await save(data); const other = await save(data);
    const tables = ['hr_leave_balances', 'hr_leave_applications', 'reviewers', 'hr_employee_external_ids', 'hr_employee_service_periods', 'hr_employee_account_links', 'hr_gov_ledger', 'hr_gov_entitlements', 'hr_gov_workflow_configs'];
    const before = await snapshot(tables); const beforeEmployee = (await pool.query('SELECT * FROM hr_employees WHERE id=$1', [employee.id])).rows[0];
    const adopted = await adopt(draft);
    assert.equal(adopted.status, 'adopted'); assert.equal(adopted.adopted_by, actor.id); assert.equal(adopted.idempotent, false);
    assert.equal(adopted.adoption_result.balances_converted, false); assert.equal(adopted.adoption_result.employees_activated, false);
    const afterEmployee = (await pool.query('SELECT * FROM hr_employees WHERE id=$1', [employee.id])).rows[0];
    assert.deepEqual(afterEmployee, { ...beforeEmployee, department_id: department.id, division_id: division.id });
    assert.deepEqual(await snapshot(tables), before);
    const others = (await pool.query('SELECT department_id,leave_policy_regime FROM hr_employees WHERE id=ANY($1::uuid[])', [[unselected.id, unmatched.id]])).rows;
    assert.ok(others.every(e => e.department_id === null && e.leave_policy_regime === 'legacy'));
    const auditCount = (await pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;
    assert.equal((await adopt(draft)).idempotent, true);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n, auditCount);
    await assert.rejects(adopt(other), /already been adopted/);
    await assert.rejects(save(data), /already been adopted/);
    await assert.rejects(setup.deleteInitialSetupDraft(pool, { user: actor, actor, id: draft.id, data: { expected_revision: draft.revision, reason } }), /already been adopted/);
    await assert.rejects(pool.query("UPDATE hr_gov_initial_setups SET reason='changed' WHERE id=$1", [draft.id]), /immutable/);
    assert.equal((await setup.initialSetupState(pool, { user: actor })).adopted.id, draft.id);
  });

  test('mapping decisions and dated policy are required at adoption; unmatched selection is blocked without inferring a division', async () => {
    const missing = await plan({ mappings: [] }); assert.equal((await preview(missing)).ready_to_adopt, false);
    await assert.rejects(adopt(await save(missing)), /Decide how to retain or map/);
    const past = await plan({ start_date: '2019-12-31' }); assert.match((await preview(past)).blockers.join(' '), /does not govern/);
    const elsewhere = (await pool.query("INSERT INTO hr_departments(name) VALUES('Other setup department') RETURNING *")).rows[0];
    await pool.query("INSERT INTO hr_divisions(department_id,name) VALUES($1,'Treasury')", [elsewhere.id]);
    const records = await setup.initialSetupEmployees(pool, { user: actor }); assert.equal(records.employees[0].placement.division_id, division.id);
    await pool.query("UPDATE hr_employees SET department_code='Unmatched retained department' WHERE id=$1", [employee.id]);
    const bad = await preview(await plan()); assert.equal(bad.ready_to_adopt, false); assert.equal(bad.placements[0].can_adopt, false);
    assert.equal(bad.placements[0].department_id, null); assert.equal(bad.placements[0].division_id, null);
    await assert.rejects(adopt(await save(await plan())), /no unique exact placement/);
    const retainedOnly = await save(await plan({ adopt_employee_ids: [] }));
    assert.equal((await adopt(retainedOnly)).adoption_result.placement_changes.length, 0);
  });

  test('an audit failure rolls back adoption, placement updates and revision history atomically', async () => {
    const draft = await save();
    const tables = ['hr_employees', 'hr_gov_initial_setups', 'hr_gov_initial_setup_revisions', 'audit_log'];
    const before = await snapshot(tables);
    await pool.query(`CREATE FUNCTION setup_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='hr.gov.initial_setup.adopted' THEN RAISE EXCEPTION 'synthetic adoption audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER setup_test_reject_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION setup_test_reject_audit()`);
    try { await assert.rejects(adopt(draft), /synthetic adoption audit failure/); }
    finally { await pool.query('DROP TRIGGER setup_test_reject_audit ON audit_log; DROP FUNCTION setup_test_reject_audit()'); }
    assert.deepEqual(await snapshot(tables), before);
    assert.equal((await adopt(draft)).status, 'adopted');
  });

  test('saved setup references reuse reviewed aliases while historical medical amounts remain individual records', async () => {
    const { initialSetupReference } = await import('./governmentLeaveInitialSetupReference.js');
    const medical = await type({ name: 'Sick (with MC)', defaultDays: 7 });
    const uncertified = await type({ name: 'Sick (without MC)', defaultDays: 3 });
    for (const t of [medical, uncertified]) await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance,pending) VALUES($1,$2,2026,$3,0)', [employee.id, t.id, t.default_days]);
    const data = await plan();
    data.mappings = data.mappings.map(m => [medical.id, uncertified.id].includes(m.leave_type_id) ? { ...m, code: 'medical' } : m);
    const draft = await save(data);
    let reference = await initialSetupReference(pool);
    assert.equal(reference.id, draft.id); assert.equal(reference.status, 'draft'); assert.equal(reference.policy_label, policy.label);
    assert.equal(reference.mappings.filter(m => m.code === 'medical').length, 2);
    await adopt(draft); reference = await initialSetupReference(pool);
    assert.equal(reference.status, 'adopted'); assert.equal(reference.start_date, data.start_date);
    const records = await setup.initialSetupEmployees(pool, { user: actor });
    assert.deepEqual(records.employees[0].balances.map(b => b.balance).sort(), ['3.00', '7.00']);
    assert.ok(records.employees[0].balances.every(b => b.proposed_target === null));
    assert.equal((await pool.query('SELECT count(*)::int n FROM hr_gov_ledger')).rows[0].n, 0);
  });

  test('employee source pagination and HTTP payload validation do not create or claim records', async () => {
    for (let i = 0; i < 51; i += 1) await createEmployee(pool, { name: `Page employee ${String(i).padStart(2, '0')}` });
    const second = await call('/employees?page=2&search=Page'); assert.equal(second.status, 200); assert.equal(second.body.total, 51); assert.equal(second.body.employees.length, 1);
    assert.equal((await call('/employees?page=0')).status, 422);
    assert.equal((await call('/preview', await plan({ adopt_employee_ids: ['not-uuid'] }))).status, 422);
    const duplicate = await plan({ adopt_employee_ids: [employee.id, employee.id.toUpperCase()] }); await assert.rejects(preview(duplicate), { status: 400 });
    const duplicateType = await plan(); duplicateType.mappings.push({ ...duplicateType.mappings[0], leave_type_id: duplicateType.mappings[0].leave_type_id.toUpperCase() });
    await assert.rejects(preview(duplicateType), { status: 400 });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_employees')).rows[0].n, 52);
  });
});

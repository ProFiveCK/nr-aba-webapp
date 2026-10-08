import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, beforeEach, describe, test } from 'node:test';
import { connectTestDatabase, createEmployee, resetLeaveTables, skipWithoutDatabase } from '../test-support/database.js';

describe('read-only Government Medical tracking', { skip: skipWithoutDatabase }, () => {
  let pool, medical, ledger, arrangements, actor, employee, policy, account, config;
  const reason = 'Synthetic Medical tracking source verification';
  before(async () => {
    pool = await connectTestDatabase();
    medical = await import('./governmentLeaveMedicalSummary.js'); ledger = await import('./governmentLeave.js');
    arrangements = await import('./employeeLeaveArrangements.js');
  });
  beforeEach(async () => {
    await resetLeaveTables(pool);
    await pool.query('TRUNCATE hr_gov_initial_setups,hr_gov_initial_setup_revisions,hr_gov_policy_versions CASCADE');
    actor = (await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions,onboarding_state) VALUES($1,'Medical test HR','user','x',$2,'ready') RETURNING *", [`${randomUUID()}@example.test`, { hr_admin: true, hr_access: true }])).rows[0];
    employee = await createEmployee(pool, { name: 'Medical tracking employee' });
    await pool.query("UPDATE hr_employees SET leave_policy_regime='government' WHERE id=$1", [employee.id]);
    const { DEFAULT_RULES } = await import('../lib/governmentLeaveRules.js');
    policy = (await pool.query(`INSERT INTO hr_gov_policy_versions(label,effective_from,effective_to,rules,source_reference,status,reason)
      VALUES('Medical tracking policy','2020-01-01','2099-12-31',$1,'synthetic','published',$2) RETURNING *`, [DEFAULT_RULES, reason])).rows[0];
    account = await entitlement('2026', '2026-04-01', '7');
    config = await configuration([
      { start_date: '2026-02-02', end_date: '2026-02-03', period_start: '2026-01-01', uncertified: false, charge: '2.000000', private_reason: 'SECRET baseline clinical reason' },
      { start_date: '2026-03-02', end_date: '2026-03-02', period_start: '2026-01-01', uncertified: true, charge: '1.000000' },
    ]);
  });
  after(async () => {
    if (!pool) return;
    try { await resetLeaveTables(pool); await pool.query('TRUNCATE hr_gov_initial_setups,hr_gov_initial_setup_revisions,hr_gov_policy_versions CASCADE'); }
    finally { await pool.end(); }
  });
  async function entitlement(year, asOf, amount) {
    const opening = (await pool.query(`INSERT INTO hr_gov_openings(employee_id,code,policy_version_id,period_start,period_end,as_of,amount,source_reference,payroll_reference,snapshot_hash,historical_snapshot,status,prepared_by,reason)
      VALUES($1,'medical',$2,$3,$4,$5,$6,'synthetic','synthetic','synthetic','[]','certified',$7,$8) RETURNING id`, [employee.id, policy.id, `${year}-01-01`, `${year}-12-31`, asOf, amount, actor.id, reason])).rows[0];
    const row = (await pool.query(`INSERT INTO hr_gov_entitlements(employee_id,code,policy_version_id,period_start,period_end,as_of,opening_id)
      VALUES($1,'medical',$2,$3,$4,$5,$6) RETURNING *`, [employee.id, policy.id, `${year}-01-01`, `${year}-12-31`, asOf, opening.id])).rows[0];
    await pool.query(`INSERT INTO hr_gov_ledger(entitlement_id,kind,amount,effective_date,event_key,source_reference,actor_id,reason)
      VALUES($1,'opening',$2,$3,$4,'synthetic',$5,$6)`, [row.id, amount, asOf, randomUUID(), actor.id, reason]);
    return row;
  }
  async function configuration(history, periodStart = '2026-01-01', asOf = '2026-04-01') {
    return (await pool.query(`INSERT INTO hr_gov_workflow_configs(employee_id,enabled_codes,medical_rule,medical_history,medical_period_start,medical_as_of,
      source_reference,legacy_resolution_reference,snapshot_hash,prepared_by,reason,status,approved_by,approved_at)
      VALUES($1,ARRAY['medical'],'single_verified_shift_nonadjacent_scheduled_days',$2,$3,$4,'synthetic','synthetic','synthetic',$5,$6,'published',$5,NOW()) RETURNING *,to_char(medical_period_start,'YYYY-MM-DD') AS medical_period_start,to_char(medical_as_of,'YYYY-MM-DD') AS medical_as_of`,
      [employee.id, JSON.stringify(history), periodStart, asOf, actor.id, reason])).rows[0];
  }
  async function request({ mode = 'certificate', status = 'approved', days = [{ date: '2026-05-04', charge: '1.000000' }], entitlement: sourceAccount = account, originalEnd = null, code = 'medical', withoutSegments = false } = {}) {
    const id = randomUUID();
    const segments = days.map(day => ({ ...day, entitlement_id: sourceAccount.id, service_period_start: sourceAccount.period_start }));
    const snapshot = { ...(withoutSegments ? {} : { evaluation: { segments } }), reason: 'SECRET request reason', medical_mode: mode };
    const reservation = code === 'medical' ? randomUUID() : null;
    if (reservation) await pool.query("INSERT INTO hr_gov_reservation_requests(id,employee_id,payload_hash,evaluation_snapshot,status) VALUES($1,$2,'synthetic',$3,$4)", [reservation, employee.id, snapshot, status === 'approved' ? 'consumed' : status === 'pending' ? 'held' : 'released']);
    await pool.query(`INSERT INTO hr_gov_requests(id,employee_id,code,start_date,end_date,reason,medical_mode,payload_hash,application_snapshot,department_id,division_id,charge,submitted_by,status,grant_snapshot,config_id,reservation_id)
      VALUES($1,$2,$3,$4,$5,'SECRET request reason',$6,'synthetic',$7,$8,$9,1,$10,$11,$12,$13,$14)`,
      [id, employee.id, code, days[0].date, originalEnd || days.at(-1).date, mode, snapshot, randomUUID(), randomUUID(), actor.id, status, status === 'approved' ? snapshot : null, code === 'medical' ? config.id : null, reservation]);
    return id;
  }
  async function effect(original, action, end = '2026-05-04') {
    const amendment = await request({ code: 'amendment', mode: 'not_applicable', days: [{ date: end, charge: '0.000000' }] });
    await pool.query('INSERT INTO hr_gov_case_effects(request_id,original_request_id,effect,recorded_by,version) VALUES($1,$2,$3,$4,1)', [amendment, original, { action, effective_end: end }, actor.id]);
  }
  const tracking = (overrides = {}, client = pool) => medical.governmentLeaveMedicalSummary(client, { employeeId: employee.id, asOf: '2026-10-08', ...overrides });
  const snapshot = async () => Promise.all(['hr_employees', 'hr_gov_workflow_configs', 'hr_gov_ledger', 'hr_gov_requests', 'hr_leave_balances', 'hr_leave_applications', 'audit_log'].map(async table => (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));

  test('separates baseline, approved and pending usage while the uncertified limit counts occasions including two-day roster shifts', async () => {
    const shortened = await request({ days: [{ date: '2026-05-04', charge: '1.000000' }, { date: '2026-05-05', charge: '1.000000' }] });
    await effect(shortened, 'shorten_grant');
    await request({ mode: 'exemption', days: [{ date: '2026-06-01', charge: '1.000000' }] });
    const shift = await request({ mode: 'exemption', status: 'pending', days: [{ date: '2026-07-01', charge: '2.000000', roster_id: randomUUID(), scheduled_hours: 14 }] });
    await request({ status: 'pending', days: [{ date: '2026-08-03', charge: '1.000000' }] });
    for (const status of ['cancelled', 'rejected']) await request({ mode: 'exemption', status, days: [{ date: '2026-08-10', charge: '1.000000' }] });
    const cancelledGrant = await request({ mode: 'exemption', days: [{ date: '2026-09-01', charge: '1.000000' }] });
    await effect(cancelledGrant, 'cancel_grant', '2026-09-01');
    // A retained pre-cutover application is already represented by the baseline.
    await request({ mode: 'exemption', days: [{ date: '2026-03-02', charge: '1.000000' }] });
    await pool.query(`INSERT INTO hr_gov_ledger(entitlement_id,kind,amount,effective_date,event_key,source_reference,actor_id,reason)
      VALUES($1,'use',-2,'2026-06-01',$2,'synthetic',$3,$4)`, [account.id, randomUUID(), actor.id, reason]);
    const reservation = randomUUID();
    await pool.query("INSERT INTO hr_gov_reservation_requests(id,employee_id,payload_hash,evaluation_snapshot) VALUES($1,$2,'synthetic','{}')", [reservation, employee.id]);
    await pool.query('INSERT INTO hr_gov_reservations(request_id,entitlement_id,amount) VALUES($1,$2,3)', [reservation, account.id]);
    const before = await snapshot();
    const readOnly = { query(sql, values) { assert.match(sql.trim(), /^SELECT\b/i); return pool.query(sql, values); } };
    const result = await tracking({}, readOnly);
    assert.equal(result.configured, true); assert.equal(result.baseline_reviewed, true); assert.equal(result.annual_days, '10.000000');
    assert.deepEqual(result.shared, { balance: '5.000000', held: '3.000000', available: '2.000000' });
    assert.deepEqual(result.certified, { approved_days: '1.000000', pending_days: '1.000000', baseline_days: '2.000000' });
    assert.deepEqual(result.uncertified, { approved_days: '1.000000', pending_days: '2.000000', baseline_days: '1.000000', approved_occasions: 1, pending_occasions: 1,
      baseline_occasions: 1, limit: 3, committed_occasions: 3, remaining_occasions: 0 });
    assert.equal(result.history_total, 6); assert.equal(result.history.find(h => h.id === shortened).end_date, '2026-05-04');
    assert.ok(!result.history.some(h => h.id === cancelledGrant)); assert.ok(!JSON.stringify(result).includes('SECRET'));
    assert.deepEqual(await snapshot(), before);
    const grant = await tracking({ approveRequestId: shift });
    assert.equal(grant.uncertified.approved_days, '3.000000'); assert.equal(grant.uncertified.approved_occasions, 2);
    assert.equal(grant.uncertified.pending_occasions, 0); assert.equal(grant.uncertified.committed_occasions, 3);
  });

  test('missing or mismatched baseline remains unknown and a new service year resets only after a matching reviewed configuration', async () => {
    const noConfig = await tracking({ config: null });
    assert.equal(noConfig.configured, false); assert.equal(noConfig.baseline_reviewed, false);
    assert.equal(noConfig.uncertified.baseline_days, null); assert.equal(noConfig.uncertified.remaining_occasions, null);
    const mismatched = await tracking({ config: { ...config, medical_as_of: '2026-03-31' } });
    assert.equal(mismatched.baseline_reviewed, false); assert.equal(mismatched.certified.baseline_days, null);
    await request({ mode: 'exemption', days: [{ date: '2026-06-01', charge: '1.000000' }] });
    const next = await entitlement('2027', '2027-01-01', '10');
    const resetPending = await tracking({ asOf: '2027-02-01' });
    assert.equal(resetPending.period_start, '2027-01-01'); assert.equal(resetPending.uncertified.approved_occasions, 0);
    assert.equal(resetPending.baseline_reviewed, false); assert.equal(resetPending.uncertified.remaining_occasions, null);
    const reviewed = await configuration([], '2027-01-01', '2027-01-01');
    await request({ mode: 'exemption', status: 'pending', entitlement: next, days: [{ date: '2027-01-18', charge: '1.000000' }] });
    const reset = await tracking({ asOf: '2027-02-01', config: reviewed });
    assert.equal(reset.configured, true); assert.equal(reset.uncertified.baseline_occasions, 0);
    assert.equal(reset.uncertified.committed_occasions, 1); assert.equal(reset.uncertified.remaining_occasions, 2);
    assert.ok(reset.history.every(h => h.start_date >= '2027-01-01'));
  });

  test('malformed baseline or retained segments does not produce trustworthy zero usage', async () => {
    const malformed = await tracking({ config: { ...config, medical_history: [{ start_date: '2026-02-02', end_date: '2026-02-02', period_start: '2026-01-01', uncertified: true }] } });
    assert.equal(malformed.baseline_reviewed, false); assert.equal(malformed.uncertified.baseline_occasions, null); assert.equal(malformed.configured, false);
    await request({ status: 'pending', withoutSegments: true });
    const missing = await tracking();
    assert.equal(missing.configured, false); assert.equal(missing.certified.pending_days, null); assert.equal(missing.uncertified.remaining_occasions, null);
    assert.match(missing.issues.join(' '), /retained charge breakdown/);
  });

  test('medical details stay central-only and setup adoption metadata changes without altering employee leave rules', async () => {
    const { rows: [department] } = await pool.query("INSERT INTO hr_departments(name) VALUES('Medical department') RETURNING id");
    await pool.query('UPDATE hr_employees SET department_id=$2 WHERE id=$1', [employee.id, department.id]);
    const scoped = (await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES($1,'Scoped HR','user','x',$2) RETURNING *", [`${randomUUID()}@example.test`, { hr_staff_manage: true }])).rows[0];
    await pool.query("INSERT INTO hr_access_scopes(reviewer_id,department_id,capabilities,effective_from,granted_by,reason) VALUES($1,$2,ARRAY['hr_staff_manage'],'2020-01-01',$3,$4)", [scoped.id, department.id, actor.id, reason]);
    const limited = await arrangements.employeeLeaveArrangements(pool, { user: scoped, employeeId: employee.id });
    assert.equal(limited.government, null); assert.ok(!JSON.stringify(limited).includes('baseline'));
    const central = await arrangements.employeeLeaveArrangements(pool, { user: actor, employeeId: employee.id });
    assert.equal(central.government.medical_tracking.configured, true); assert.ok(!JSON.stringify(central.government.medical_tracking).includes('SECRET'));
    assert.deepEqual((await arrangements.employeeLeavePolicyUsage(pool, { user: actor })).initial_setup, { adopted: false, adopted_at: null });
    await pool.query(`INSERT INTO hr_gov_initial_setups(status,plan,source_hash,summary,prepared_by,updated_by,reason,adopted_by,adopted_at)
      VALUES('adopted','{}','synthetic','{}',$1,$1,$2,$1,'2026-10-08T00:00:00Z')`, [actor.id, reason]);
    const usage = await arrangements.employeeLeavePolicyUsage(pool, { user: actor });
    assert.equal(usage.initial_setup.adopted, true); assert.equal(new Date(usage.initial_setup.adopted_at).toISOString(), '2026-10-08T00:00:00.000Z');
    assert.equal((await pool.query('SELECT leave_policy_regime FROM hr_employees WHERE id=$1', [employee.id])).rows[0].leave_policy_regime, 'government');
  });

  test('legacy employees without a Government opening have unconfigured tracking and no manufactured allowance', async () => {
    const old = await createEmployee(pool, { name: 'Retained legacy employee' });
    const result = await medical.governmentLeaveMedicalSummary(pool, { employeeId: old.id, asOf: '2026-10-08' });
    assert.equal(result.configured, false); assert.equal(result.shared, null); assert.equal(result.period_start, null);
    assert.equal(result.uncertified.approved_occasions, null); assert.equal(result.uncertified.remaining_occasions, null);
    assert.deepEqual(result.history, []);
    assert.equal((await pool.query('SELECT count(*)::int n FROM hr_gov_entitlements WHERE employee_id=$1', [old.id])).rows[0].n, 0);
  });

  test('governing policy quantum is dynamic and bounded history does not truncate totals', async () => {
    const context = await ledger.loadContext(pool, employee.id);
    context.policies[0].rules = { ...context.policies[0].rules, medical_annual_days: '12', medical_uncertified_occasions: 4 };
    const emptyBaseline = { ...config, medical_history: [] };
    const records = Array.from({ length: 105 }, (_, index) => ({ id: `record-${index}`, status: 'approved', mode: 'certificate',
      start_date: '2026-05-04', end_date: '2026-05-04', segments: [{ date: '2026-05-04', charge: '0.01', entitlement_id: account.id, service_period_start: account.period_start }] }));
    const result = medical.medicalTrackingFromRecords({ context, config: emptyBaseline, records, asOf: '2026-10-08' });
    assert.equal(result.annual_days, '12.000000'); assert.equal(result.uncertified.limit, 4); assert.equal(result.certified.approved_days, '1.050000');
    assert.equal(result.history_total, 105); assert.equal(result.history.length, 100); assert.equal(result.history_truncated, true);
  });
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, beforeEach, describe, test } from 'node:test';
import { connectTestDatabase, resetLeaveTables, skipWithoutDatabase } from '../test-support/database.js';
import { DEFAULT_RULES } from '../lib/governmentLeaveRules.js';

describe('payroll continuity across administrative staff transfer', { skip: skipWithoutDatabase }, () => {
    let pool, ledger, jobs, setup, admin, certifier, employee, receipt, policy;
    const reason = 'Verified existing payroll cycle continued across administrative transfer.';
    const user = row => ({ ...row, permissions: row.permissions });
    const data = () => ({ code: 'recreation', payroll_anchor: '2026-10-07', first_post_end: '2026-10-21', previous_payroll_end: '2026-10-07', temporary_start: 'qualification', source_reference: 'Confirmed saved payroll and initial staff transfer', reason });
    before(async () => { pool = await connectTestDatabase(); ledger = await import('./governmentLeave.js'); jobs = await import('./governmentLeaveJobs.js'); setup = await import('./governmentLeaveBalanceSetup.js'); });
    after(async () => { await pool?.end(); });
    beforeEach(async () => {
        await resetLeaveTables(pool); await pool.query('TRUNCATE hr_gov_policy_versions CASCADE');
        async function actor(role) { return (await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions,onboarding_state) VALUES($1,'Payroll continuity test',$2,'x',$3,'ready') RETURNING *", [`${randomUUID()}@example.test`, role, { hr_admin: true, hr_access: true }])).rows[0]; }
        admin = await actor('admin'); certifier = await actor('user');
        employee = (await pool.query("INSERT INTO hr_employees(display_name,leave_policy_regime) VALUES('Payroll continuity staff','government') RETURNING *")).rows[0];
        const pattern = (await pool.query("INSERT INTO hr_work_patterns(name,working_weekdays,hours_per_day) VALUES($1,ARRAY[1,2,3,4,5],7) RETURNING *", [`Payroll test ${randomUUID()}`])).rows[0];
        await pool.query("INSERT INTO hr_employee_service_periods(employee_id,start_date,employment_category,counts_for_service,work_pattern_id,reason) VALUES($1,'2026-01-01','permanent',TRUE,$2,$3)", [employee.id, pattern.id, reason]);
        await ledger.addFoundationRecord(pool, { user: user(admin), actor: admin, kind: 'pattern', data: { work_pattern_id: pattern.id, source_reference: 'Verified weekly pattern for payroll continuity', reason } });
        await ledger.addFoundationRecord(pool, { user: user(admin), actor: admin, employeeId: employee.id, kind: 'basis', data: { effective_from: '2026-01-01', continuity_start: '2026-01-01', anniversary_method: 'calendar', leap_day_method: 'mar1', schedule_mode: 'weekly', source_reference: 'Verified uninterrupted credited service', reason } });
        policy = (await pool.query("INSERT INTO hr_gov_policy_versions(label,effective_from,effective_to,rules,source_reference,status,reason) VALUES('Payroll continuity policy','2026-10-09','2027-12-31',$1,'Verified policy effective at transfer','published',$2) RETURNING *", [DEFAULT_RULES, reason])).rows[0];
        const opening = await ledger.prepareOpening(pool, { user: user(admin), actor: admin, employeeId: employee.id, data: { code: 'recreation', amount: '20', policy_version_id: policy.id, period_start: '2026-01-01', period_end: '2026-12-31', as_of: '2026-10-09', source_reference: 'Administrative staff transfer on 9 October', payroll_reference: 'Existing credit last posted 7 October', reason } });
        await ledger.certifyOpening(pool, { user: user(certifier), actor: certifier, id: opening.id, reason });
        await pool.query("INSERT INTO hr_gov_workflow_configs(employee_id,enabled_codes,medical_rule,medical_history,medical_period_start,medical_as_of,source_reference,legacy_resolution_reference,snapshot_hash,prepared_by,reason,status,approved_by,approved_at) VALUES($1,ARRAY['recreation'],'single_calendar_date_nonadjacent_scheduled_days','[]','2026-01-01','2026-10-09','Verified transfer','Verified retained credit','test',$2,$3,'published',$2,NOW())", [employee.id, admin.id, reason]);
        receipt = randomUUID();
        await pool.query('INSERT INTO hr_gov_commissioning_reviews(id,plan,snapshot_hash,snapshot,prepared_by) VALUES($1,$2,\'test\',\'{}\',$3)', [receipt, { initial_admin_setup: true, employees: [{ employee_id: employee.id }] }, admin.id]);
        await pool.query('INSERT INTO hr_gov_commissioning_receipts(review_id,actor_id,reason,result) VALUES($1,$2,$3,$4)', [receipt, admin.id, reason, JSON.stringify([{ employee_id: employee.id }])]);
        await pool.query("INSERT INTO hr_accrual_runs(period_end,credited,run_by) VALUES('2026-10-07',1,$1)", [admin.id]);
    });
    async function prepare(input = data()) { const plan = await jobs.prepareJobPlan(pool, { user: user(admin), actor: admin, employeeId: employee.id, data: input }); await jobs.approveJobPlan(pool, { user: user(admin), actor: admin, id: plan.id, reason }); return plan; }
    const run = date => jobs.runEmployeeJobs(pool, { user: user(admin), actor: admin, employeeId: employee.id, asOf: date, clockDate: date });
    test('the last payroll boundary preserves the full fortnight despite later policy publication and administrative opening', async () => {
        const plan = await prepare();
        await run('2026-10-20'); assert.equal((await pool.query('SELECT count(*)::int n FROM hr_gov_job_posts')).rows[0].n, 0);
        const first = await run('2026-10-21'); assert.equal(first.results[0].posts[0].credited_calendar_days, 14); assert.equal(first.results[0].posts[0].amount, '0.769230');
        await run('2026-10-21'); assert.equal((await pool.query('SELECT count(*)::int n FROM hr_gov_job_posts')).rows[0].n, 1);
        await run('2026-11-04'); assert.equal((await ledger.loadContext(pool, employee.id)).entitlements[0].balance, '21.538461');
        const policyDates = (await pool.query("SELECT to_char(effective_from,'YYYY-MM-DD') AS starts FROM hr_gov_policy_versions WHERE id=$1", [policy.id])).rows[0]; assert.equal(policyDates.starts, '2026-10-09');
        assert.ok(plan.initial_setup_review_id); assert.equal((await pool.query('SELECT count(*)::int n FROM hr_accrual_runs')).rows[0].n, 1);
    });
    test('ordinary openings still prorate from certification when no payroll continuity was reviewed', async () => {
        await prepare({ ...data(), previous_payroll_end: null });
        const first = await run('2026-10-21'); assert.equal(first.results[0].posts[0].credited_calendar_days, 13); assert.equal(first.results[0].posts[0].amount, '0.714285');
    });
    test('excluded service in the bridge is still excluded from credits', async () => {
        await ledger.addFoundationRecord(pool, { user: user(admin), actor: admin, employeeId: employee.id, kind: 'exclusion', data: { start_date: '2026-10-08', end_date: '2026-10-08', kind: 'lwop', source_reference: 'Verified excluded service before transfer', reason } });
        await prepare(); const first = await run('2026-10-21'); assert.equal(first.results[0].posts[0].credited_calendar_days, 13); assert.equal(first.results[0].posts[0].amount, '0.714285');
    });
    test('the continuity boundary requires recorded latest credits, initial transfer authority and a matching first fortnight', async () => {
        for (const change of [{ previous_payroll_end: '2026-09-23' }, { first_post_end: '2026-11-04' }]) await assert.rejects(jobs.prepareJobPlan(pool, { user: user(admin), actor: admin, employeeId: employee.id, data: { ...data(), ...change } }));
        await assert.rejects(jobs.prepareJobPlan(pool, { user: user(certifier), actor: certifier, employeeId: employee.id, data: data() }), /reviewed first Recreation schedule/);
        const plan = await jobs.prepareJobPlan(pool, { user: user(admin), actor: admin, employeeId: employee.id, data: data() });
        await pool.query("INSERT INTO hr_accrual_runs(period_end,credited,run_by) VALUES('2026-10-21',1,$1)", [admin.id]);
        await assert.rejects(jobs.approveJobPlan(pool, { user: user(admin), actor: admin, id: plan.id, reason }), /last credited payroll changed/);
    });
    test('bulk setup carries the payroll boundary into approved plans and preserves the starting balance', async () => {
        const body = { employee_ids: [employee.id], payroll_anchor: '2026-10-07', previous_payroll_end: '2026-10-07', calculation_confirmed: true };
        const preview = await setup.previewBalanceSetup(pool, { user: user(admin), data: body }); assert.equal(preview.ready, 1, preview.employees[0].issues.join(' '));
        assert.equal(preview.employees[0].schedules[0].first_post_end, '2026-10-21'); assert.equal(preview.employees[0].schedules[0].previous_payroll_end, '2026-10-07');
        const result = await setup.applyBalanceSetup(pool, { user: user(admin), actor: admin, data: { ...body, snapshot_hash: preview.snapshot_hash } }); assert.equal(result.created, 1);
        assert.equal((await ledger.loadContext(pool, employee.id)).entitlements[0].balance, '20.000000');
        assert.equal((await pool.query('SELECT count(*)::int n FROM hr_gov_job_posts')).rows[0].n, 0);
        assert.equal((await run('2026-10-21')).results[0].posts[0].amount, '0.769230');
    });
});

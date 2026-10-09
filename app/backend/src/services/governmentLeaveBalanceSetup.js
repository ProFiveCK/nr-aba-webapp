import { ServiceError } from '../lib/serviceError.js';
import { withTransaction } from '../lib/transaction.js';
import { COMMON_CODES, dayNumber, isoDay, fingerprint, serviceFacts } from '../lib/governmentLeaveRules.js';
import { assertCentral, configurationFor, today } from './governmentLeaveWorkflow.js';
import { assertInitialAdmin, firstAdminJobReview } from './governmentLeaveInitialAdmin.js';
import { loadContext, lockEmployee } from './governmentLeave.js';
import { assertCutoverResolved } from './governmentLeaveCutover.js';
import { prepareJobPlan, approveJobPlan } from './governmentLeaveJobs.js';
import { recordAudit } from './auditService.js';

const fail = (message, status = 409) => { throw new ServiceError(status, message); };
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function input(data) {
    const ids = data.employee_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(ids.map(id => id.toLowerCase())).size !== ids.length) fail('Select 1–50 distinct migrated employees.', 400);
    try { dayNumber(data.payroll_anchor); } catch { fail('Choose a valid fortnightly payroll date.', 400); }
    if (data.calculation_confirmed !== true) fail('Confirm the balance update schedule.', 400);
    return { employee_ids: ids.map(id => id.toLowerCase()).sort(), payroll_anchor: data.payroll_anchor, calculation_confirmed: true };
}

async function snapshot(client, plan, actorId) {
    const employees = [];
    for (const id of plan.employee_ids) {
        const context = await loadContext(client, id), config = await configurationFor(client, id);
        const published = (await client.query("SELECT * FROM hr_gov_job_plans WHERE employee_id=$1 AND status='published' ORDER BY approved_at,id", [id])).rows;
        const issues = [], schedules = [];
        if (context.employee.status !== 'active' || context.employee.leave_policy_regime !== 'government' || !config?.enabled_codes.length) issues.push('Move this employee to Government leave and enable their applicable leave types first.');
        try {
            await assertCutoverResolved(client, id);
            const facts = serviceFacts(context, today());
            if (facts.issues.length) fail(facts.issues.join(' '));
            for (const code of config?.enabled_codes || []) {
                if (!COMMON_CODES.includes(code)) fail('This leave type needs individual schedule review.');
                const existing = published.filter(p => p.code === code).at(-1);
                if (existing) { schedules.push({ code, status: 'retained', plan_id: existing.id }); continue; }
                const opening = context.entitlements.find(e => e.code === code && e.period_start === facts.period_start);
                if (!opening) fail(`Review the current ${code} balance first.`);
                const review = await firstAdminJobReview(client, actorId, id, code);
                if (!review) fail(`The ${code} schedule needs individual review. Bulk setup is available to the administrator who applied the initial staff transfer.`);
                const anchor = dayNumber(plan.payroll_anchor), first = anchor + Math.max(0, Math.ceil((dayNumber(opening.as_of) - anchor) / 14)) * 14;
                schedules.push({ code, status: 'new', initial_setup_review_id: review, first_post_end: code === 'recreation' ? isoDay(first) : null });
            }
        } catch (error) { if (!error.status) throw error; issues.push(error.message); }
        employees.push({ employee_id: id, display_name: context.employee.display_name, schedules, issues, source_hash: fingerprint({ context, config, published }) });
    }
    return { employees, snapshot_hash: fingerprint({ plan, employees }), ready: employees.filter(e => !e.issues.length).length, total: employees.length };
}

export async function previewBalanceSetup(pool, { user, data }) {
    const plan = input(data);
    return withTransaction(pool, async client => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await assertCentral(client, user); await assertInitialAdmin(client, user.id);
        return snapshot(client, plan, user.id);
    });
}

export async function applyBalanceSetup(pool, { user, actor, data }) {
    const plan = input(data);
    return withTransaction(pool, async client => {
        await assertCentral(client, user); await assertInitialAdmin(client, user.id);
        await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-gov-policies'))");
        for (const id of plan.employee_ids) await lockEmployee(client, id);
        const current = await snapshot(client, plan, user.id);
        if (current.snapshot_hash !== data.snapshot_hash || current.ready !== current.total) fail('Staff balances or schedules changed. Preview the current staff again.');
        let created = 0;
        const verifiedActor = { id: user.id, email: user.email, ip: actor?.ip };
        const reason = 'Administrator set up the reviewed initial staff balance schedules together.';
        for (const employee of current.employees) for (const schedule of employee.schedules.filter(s => s.status === 'new')) {
            const prepared = await prepareJobPlan(pool, { client, user, actor: verifiedActor, employeeId: employee.employee_id, data: {
                code: schedule.code, payroll_anchor: plan.payroll_anchor, first_post_end: schedule.first_post_end,
                temporary_start: 'qualification', source_reference: 'Administrator review of initial staff transfer and shared payroll schedule', reason,
            } });
            await approveJobPlan(pool, { client, user, actor: verifiedActor, id: prepared.id, reason });
            created++;
        }
        await recordAudit({ client, actor: verifiedActor, action: 'hr.gov.balance_schedules.applied', entityType: 'hr_gov_job_plan', after: { ...plan, snapshot_hash: current.snapshot_hash, created } });
        return { employees: current.total, created, retained: current.employees.reduce((sum, e) => sum + e.schedules.filter(s => s.status === 'retained').length, 0) };
    });
}

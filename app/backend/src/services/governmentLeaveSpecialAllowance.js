import { withTransaction } from '../lib/transaction.js';
import { ServiceError } from '../lib/serviceError.js';
import { units, decimal } from '../lib/governmentLeaveRules.js';
import { accountSql } from './governmentLeaveBalances.js';
import { lockEmployee, postMovement } from './governmentLeave.js';
import { resolvedPublishedPoliciesSql } from './governmentLeavePolicyTransitions.js';

// Staff brought across from the earlier leave setup kept its larger Special balance until their
// next anniversary. This brings every current Special account down to the yearly allowance now.
// The balance and pending figures come from the same query as the Staff balances page.
const reviewSql = `SELECT e.id AS employee_id,e.display_name,COALESCE(d.name,e.department_code) AS department,
  a.id AS entitlement_id,a.period_start,a.period_end,a.balance,a.held,
  COALESCE((SELECT -sum(l.amount) FROM hr_gov_ledger l WHERE l.entitlement_id=a.id AND (l.kind='use'
    OR (l.kind='reversal' AND EXISTS(SELECT 1 FROM hr_gov_ledger u WHERE u.id=l.reverses_id AND u.kind='use')))),0)::text AS used,
  EXISTS(SELECT 1 FROM hr_gov_job_plans p WHERE p.employee_id=e.id AND p.code='special' AND p.status='published') AS scheduled
  FROM hr_employees e LEFT JOIN hr_departments d ON d.id=e.department_id
  JOIN LATERAL (SELECT * FROM (${accountSql}) a WHERE a.employee_id=e.id AND a.code='special'
    AND a.period_start<=$1 AND a.as_of<=$1 ORDER BY a.period_start DESC,a.as_of DESC,a.id LIMIT 1) a ON TRUE
  WHERE e.status='active' AND e.leave_policy_regime='government' AND ($2::uuid IS NULL OR e.id=$2)
  ORDER BY lower(e.display_name),e.id`;

// Staff not yet moved to the current leave setup still read their Special balance from the older leave type.
const earlierSetupSql = `SELECT e.display_name,COALESCE(d.name,e.department_code) AS department,COALESCE(b.balance,t.default_days)::text AS balance
  FROM hr_employees e JOIN hr_leave_types t ON lower(t.name)='special' AND t.is_active
  LEFT JOIN hr_departments d ON d.id=e.department_id
  LEFT JOIN hr_leave_balances b ON b.employee_id=e.id AND b.leave_type_id=t.id AND b.year=EXTRACT(YEAR FROM $1::date)
  WHERE e.status='active' AND e.leave_entitled AND e.leave_policy_regime<>'government' AND COALESCE(b.balance,t.default_days)>$2::numeric
  ORDER BY lower(e.display_name),e.id`;

export const plainDays = value => decimal(units(value)).replace(/\.?0+$/, '');

// Leave already taken stays taken and pending leave keeps its hold, so someone who has used or
// applied for more than the allowance is brought to zero available rather than below it.
function review(row, allowance, asOf) {
  const balance = units(row.balance), held = units(row.held), credited = balance + units(row.used), over = credited - units(allowance);
  const base = { ...row, credited: decimal(credited), remove: '0.000000', balance_after: row.balance };
  if (row.period_end < asOf) return { ...base, status: 'year_ended' };
  if (over <= 0n) return { ...base, status: 'within' };
  const spare = balance - held, remove = over < spare ? over : spare > 0n ? spare : 0n;
  return { ...base, status: remove > 0n ? 'reduce' : 'nothing_left', remove: decimal(remove),
    balance_after: decimal(balance - remove), still_over: decimal(over - remove) };
}

async function load(client, employeeId = null) {
  const { rows: [{ as_of: asOf }] } = await client.query("SELECT to_char((NOW() AT TIME ZONE 'Pacific/Nauru')::date,'YYYY-MM-DD') AS as_of");
  const { rows: policies } = await client.query(resolvedPublishedPoliciesSql);
  const policy = policies.find(p => p.effective_from <= asOf && p.effective_to >= asOf);
  if (!policy) throw new ServiceError(409, 'No leave policy covers today. Add one under Settings first.');
  const allowance = policy.rules.special_annual_days;
  const { rows } = await client.query(reviewSql, [asOf, employeeId]);
  return { as_of: asOf, policy_label: policy.label, allowance, rows: rows.map(row => review(row, allowance, asOf)) };
}

/** Lists every Special account against the yearly allowance, and with `apply` removes the days above it. */
export async function alignSpecialLeave(pool, { apply = false, actor = null } = {}) {
  const report = await load(pool);
  const { rows: earlierSetup } = await pool.query(earlierSetupSql, [report.as_of, report.allowance]);
  const corrected = [];
  if (apply) for (const row of report.rows.filter(r => r.status === 'reduce')) {
    // One employee at a time, checked again under the lock in case leave was applied for meanwhile.
    const done = await withTransaction(pool, async client => {
      await lockEmployee(client, row.employee_id);
      const [fresh] = (await load(client, row.employee_id)).rows;
      if (fresh?.status !== 'reduce') return null;
      await postMovement(client, { entitlementId: fresh.entitlement_id, kind: 'correction', amount: decimal(-units(fresh.remove)),
        effectiveDate: report.as_of, eventKey: `correction:special-allowance:${fresh.entitlement_id}:${report.as_of}`,
        sourceReference: 'Special leave allowance review', actor,
        reason: `Special leave is ${plainDays(report.allowance)} days a service year. Removed ${plainDays(fresh.remove)} days kept from the earlier leave setup.` });
      return fresh;
    });
    if (done) corrected.push(done);
  }
  return { ...report, earlier_setup: earlierSetup, applied: apply, corrected };
}

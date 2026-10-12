import { withTransaction } from '../lib/transaction.js';
import { employeeScopeSql } from './hrAccess.js';
import { ledgerReadable } from './governmentLeave.js';

// Use the same committed ledger and holds as application evaluation. Never
// substitute retained balances or policy defaults for a certified account.
const accountSql = `SELECT a.id,a.employee_id,a.code,
  to_char(a.period_start,'YYYY-MM-DD') AS period_start,to_char(a.period_end,'YYYY-MM-DD') AS period_end,
  to_char(a.as_of,'YYYY-MM-DD') AS as_of,p.label AS policy_label,p.rules,
  COALESCE(l.days_in,0)::text AS days_in,COALESCE(l.days_out,0)::text AS days_out,
  COALESCE(l.balance,0)::text AS balance,COALESCE(h.held,0)::text AS held,
  (COALESCE(l.balance,0)-COALESCE(h.held,0))::text AS available
  FROM hr_gov_entitlements a JOIN hr_gov_policy_versions p ON p.id=a.policy_version_id
  LEFT JOIN LATERAL (SELECT sum(amount) AS balance,
    sum(GREATEST(amount,0)) AS days_in,sum(GREATEST(-amount,0)) AS days_out
    FROM hr_gov_ledger WHERE entitlement_id=a.id) l ON TRUE
  LEFT JOIN LATERAL (SELECT sum(amount) AS held FROM (
    SELECT h.amount FROM hr_gov_reservations h JOIN hr_gov_reservation_requests r ON r.id=h.request_id
      WHERE h.entitlement_id=a.id AND r.status='held'
    UNION ALL
    SELECT h.amount FROM hr_gov_case_credit_holds h JOIN hr_gov_requests r ON r.id=h.request_id
      WHERE h.entitlement_id=a.id AND r.status='pending'
      AND h.determination_id=(SELECT id FROM hr_gov_case_determinations WHERE request_id=r.id ORDER BY version DESC LIMIT 1)
  ) holds) h ON TRUE`;

export async function staffLeaveBalances(pool, { user, search = '', page = 1 }) {
  return withTransaction(pool, async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const scope = employeeScopeSql(user, 'hr_balance_manage', '$1', 'e');
    const where = `e.status='active' AND ${scope} AND ($2='' OR strpos(lower(e.display_name),lower($2))>0
      OR strpos(lower(COALESCE(d.name,e.department_code,'')),lower($2))>0)`;
    const params = [user.id, search];
    const { rows: [count] } = await client.query(`SELECT count(*)::int AS total FROM hr_employees e
      LEFT JOIN hr_departments d ON d.id=e.department_id WHERE ${where}`, params);
    const { rows: employees } = await client.query(`SELECT e.id,e.display_name,e.leave_policy_regime,
      COALESCE(d.name,e.department_code) AS department_name,COALESCE(v.name,e.division_code) AS division_name,
      CASE WHEN e.leave_policy_regime<>'government' AND NOT e.leave_entitled THEN 'not_entitled'
        WHEN e.leave_policy_regime<>'government' THEN 'setup_required'
        WHEN c.id IS NULL THEN 'activation_required' WHEN cardinality(c.enabled_codes)=0 THEN 'paused' ELSE 'active' END AS leave_status
      FROM hr_employees e LEFT JOIN hr_departments d ON d.id=e.department_id LEFT JOIN hr_divisions v ON v.id=e.division_id
      LEFT JOIN LATERAL (SELECT id,enabled_codes FROM hr_gov_workflow_configs WHERE employee_id=e.id AND status='published'
        ORDER BY approved_at DESC,id DESC LIMIT 1) c ON TRUE
      WHERE ${where} ORDER BY e.display_name,e.id LIMIT 50 OFFSET $3`, [...params, (page - 1) * 50]);
    const { rows: [date] } = await client.query("SELECT to_char((NOW() AT TIME ZONE 'Pacific/Nauru')::date,'YYYY-MM-DD') AS as_of");
    const { rows: accounts } = await client.query(`${accountSql} WHERE a.employee_id=ANY($1::uuid[])
      AND a.period_start<=$2 AND a.as_of<=$2 ORDER BY a.period_start DESC,a.as_of DESC,a.id`, [employees.filter(e => e.leave_policy_regime === 'government').map(e => e.id), date.as_of]);
    return { as_of: date.as_of, employees: employees.map(employee => {
      const current = new Map();
      for (const account of accounts) if (account.employee_id === employee.id && !current.has(account.code)) current.set(account.code, account);
      return { ...employee, balances: [...current.values()] };
    }), total: count.total, page, page_size: 50 };
  });
}

export async function employeeLeaveAccount(pool, { user, employeeId, entitlementId = null, page = 1 }) {
  return withTransaction(pool, async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await ledgerReadable(client, user, employeeId);
    const { rows: [employee] } = await client.query('SELECT id,display_name,leave_policy_regime,leave_entitled FROM hr_employees WHERE id=$1', [employeeId]);
    const { rows: accounts } = await client.query(`${accountSql} WHERE a.employee_id=$1 ORDER BY a.period_start DESC,a.code`, [employeeId]);
    // Calculate the running balance before pagination, separately for each
    // service-year account. Recording order is stable even for backdated entries.
    const { rows: movements } = await client.query(`SELECT * FROM (
      SELECT l.id,l.entitlement_id,a.code,l.kind,l.amount,l.reason,l.source_reference,l.recorded_at,
        to_char(l.effective_date,'YYYY-MM-DD') AS effective_date,
        to_char(a.period_start,'YYYY-MM-DD') AS period_start,to_char(a.period_end,'YYYY-MM-DD') AS period_end,
        sum(l.amount) OVER(PARTITION BY l.entitlement_id ORDER BY l.recorded_at,l.id ROWS UNBOUNDED PRECEDING)::text AS running_balance
      FROM hr_gov_ledger l JOIN hr_gov_entitlements a ON a.id=l.entitlement_id
      WHERE a.employee_id=$1 AND ($2::uuid IS NULL OR a.id=$2)
    ) movements ORDER BY recorded_at DESC,id DESC LIMIT 50 OFFSET $3`, [employeeId, entitlementId, (page - 1) * 50]);
    const { rows: [count] } = await client.query(`SELECT count(*)::int AS total FROM hr_gov_ledger l
      JOIN hr_gov_entitlements a ON a.id=l.entitlement_id WHERE a.employee_id=$1 AND ($2::uuid IS NULL OR a.id=$2)`, [employeeId, entitlementId]);
    const { rows: [date] } = await client.query("SELECT to_char((NOW() AT TIME ZONE 'Pacific/Nauru')::date,'YYYY-MM-DD') AS as_of");
    return { employee, accounts, movements, as_of: date.as_of, total: count.total, page, page_size: 50 };
  });
}

import { withTransaction } from '../lib/transaction.js';
import { badRequest, notFound, ServiceError } from '../lib/serviceError.js';
import { recordAudit } from './auditService.js';

export function managementReason(value) {
  if (typeof value !== 'string' || value.trim().length < 10 || value.length > 1000) throw badRequest('Record a verification reason of 10–1,000 characters.');
  return value.trim();
}

export async function listLinkableAccounts(pool, { search = '', page = 1 } = {}) {
  const where = `($1='' OR position(lower($1) in lower(r.display_name))>0 OR position(lower($1) in lower(r.email))>0)`;
  const { rows } = await pool.query(`SELECT r.id,r.display_name,r.email,r.account_type,r.status,e.id AS employee_id,e.display_name AS employee_name
    FROM reviewers r LEFT JOIN hr_employees e ON e.reviewer_id=r.id WHERE ${where} ORDER BY lower(r.display_name),r.id LIMIT 50 OFFSET $2`, [search.trim(),(page-1)*50]);
  const { rows: [count] } = await pool.query(`SELECT count(*)::int AS total FROM reviewers r WHERE ${where}`, [search.trim()]);
  return { accounts: rows,total: count.total,page,page_size: 50 };
}

export async function createManagedEmployee(pool, { data, actor, reason }) {
  const verifiedReason = managementReason(reason);
  return withTransaction(pool, async (client) => {
    const { rows: [department] } = await client.query('SELECT id,name FROM hr_departments WHERE id=$1 FOR SHARE',[data.department_id]);
    if (!department) throw badRequest('Choose a managed department.');
    let division = null;
    if (data.division_id) {
      ({ rows: [division] } = await client.query('SELECT id,name FROM hr_divisions WHERE id=$1 AND department_id=$2 FOR SHARE',[data.division_id,department.id]));
      if (!division) throw badRequest('Choose a division in this department.');
    }
    const { rows: [employee] } = await client.query(`INSERT INTO hr_employees(display_name,department_id,division_id,department_code,division_code)
      VALUES ($1,$2,$3,$4,$5) RETURNING id,display_name`, [data.display_name.trim(),department.id,division?.id || null,department.name,division?.name || null]);
    const { rows: [identifier] } = await client.query(`INSERT INTO hr_employee_external_ids(employee_id,source,external_id,verified_by,reason)
      VALUES ($1,'techone_payroll',$2,$3,$4) ON CONFLICT(source,external_id) DO NOTHING RETURNING id`,[employee.id,data.external_id.trim(),actor.id,verifiedReason]);
    if (!identifier) throw new ServiceError(409,'This Payroll ID already belongs to an employee. Find that record or use import reconciliation.');
    await recordAudit({ client,actor,action:'hr.employee.created.verified',entityType:'hr_employee',entityId:employee.id,after:{...employee,department_id:department.id,division_id:division?.id || null,payroll_id:data.external_id.trim(),reason:verifiedReason} });
    return employee;
  });
}

export async function updateManagedEmployee(pool, { employeeId, data, actor, reason }) {
  const verifiedReason = managementReason(reason);
  return withTransaction(pool, async (client) => {
    // Match the import's stable lock order while checking reporting cycles.
    const { rows } = await client.query('SELECT id,display_name,position_title,email,status,reviewer_id,manager_id FROM hr_employees ORDER BY id FOR UPDATE');
    const before = rows.find((row) => row.id===employeeId);
    if (!before) throw notFound('Employee not found.');
    const managerId = data.manager_id || null;
    if (managerId && !rows.some((row) => row.id===managerId)) throw badRequest('Choose a managed employee as the reporting manager.');
    const managers = new Map(rows.map((row) => [row.id,row.manager_id]));
    const seen = new Set([employeeId]);
    for (let id=managerId; id; id=managers.get(id)) {
      if (seen.has(id)) throw badRequest('The reporting line would create a manager cycle.');
      seen.add(id);
    }
    const requestedEmail = data.email?.trim().toLowerCase() || null;
    if (before.reviewer_id && requestedEmail!==(before.email?.toLowerCase() || null)) throw badRequest('Linked login email requires separate account verification.');
    const email = before.reviewer_id ? before.email : requestedEmail;
    const { rows: [after] } = await client.query(`UPDATE hr_employees SET display_name=$2,position_title=$3,email=$4,status=$5,manager_id=$6,updated_at=NOW()
      WHERE id=$1 RETURNING id,display_name,position_title,email,status,manager_id`,[employeeId,data.display_name.trim(),data.position_title?.trim() || null,email,data.status,managerId]);
    if (before.status!==after.status && before.reviewer_id) await client.query('DELETE FROM reviewer_sessions WHERE reviewer_id=$1',[before.reviewer_id]);
    await recordAudit({ client,actor,action:'hr.employee.details.verified',entityType:'hr_employee',entityId:employeeId,before,after:{...after,reason:verifiedReason} });
    return after;
  });
}

export async function createWorkPattern(pool, { data, actor, reason }) {
  const verifiedReason = managementReason(reason);
  if (new Set(data.working_weekdays).size!==data.working_weekdays.length) throw badRequest('Select each working weekday once.');
  return withTransaction(pool,async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-work-patterns'))");
    const { rows: [pattern] } = await client.query(`INSERT INTO hr_work_patterns(name,working_weekdays,hours_per_day)
      SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM hr_work_patterns WHERE lower(name)=lower($1))
      ON CONFLICT(name) DO NOTHING RETURNING *`,[data.name.trim(),data.working_weekdays,data.hours_per_day || null]);
    if (!pattern) throw new ServiceError(409,'That work pattern already exists.');
    await recordAudit({client,actor,action:'hr.work_pattern.created',entityType:'hr_work_pattern',entityId:pattern.id,after:{...pattern,reason:verifiedReason}});
    return pattern;
  });
}

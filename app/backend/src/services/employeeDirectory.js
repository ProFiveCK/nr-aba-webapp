import { withTransaction } from '../lib/transaction.js';
import { badRequest, forbidden, notFound, ServiceError } from '../lib/serviceError.js';
import { recordAudit } from './auditService.js';
import { generateTempPassword, hashPassphrase } from './authService.js';

export const EMPLOYMENT_CATEGORIES = ['permanent', 'probationary', 'temporary', 'contract', 'casual', 'unknown'];
export const APPROVAL_LEVELS = ['division', 'department', 'chief_secretary'];

function requireReason(reason) {
  if (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 1000) {
    throw badRequest('Provide a verification reason of 10–1,000 characters.');
  }
  return reason.trim();
}

async function lockEmployee(client, employeeId) {
  const { rows: [employee] } = await client.query('SELECT * FROM hr_employees WHERE id = $1 FOR UPDATE', [employeeId]);
  if (!employee) throw notFound('Employee not found.');
  return employee;
}

// No name/email matching and no provisioning as a side effect of reading Leave.
export async function linkedEmployee(pool, accountId) {
  const { rows: [employee] } = await pool.query('SELECT * FROM hr_employees WHERE reviewer_id = $1', [accountId]);
  if (!employee) throw forbidden('Your login has not been linked to a verified employee record. Contact HR.');
  if (employee.status !== 'active') throw forbidden('Your employee record is inactive. Contact HR.');
  return employee;
}

export async function listEmployeeDirectory(pool, { page = 1, pageSize = 50, search = '', departmentId = null, status = null, readiness = '' } = {}) {
  const values = [status, departmentId, search.trim(), readiness];
  const where = `($1::text IS NULL OR e.status = $1) AND ($2::uuid IS NULL OR e.department_id = $2)
    AND ($3 = '' OR position(lower($3) in lower(e.display_name)) > 0
      OR EXISTS (SELECT 1 FROM hr_employee_external_ids x WHERE x.employee_id = e.id AND x.external_id = $3))
    AND ($4 = '' OR ($4 = 'unlinked' AND e.reviewer_id IS NULL)
      OR ($4 = 'missing_id' AND NOT EXISTS (SELECT 1 FROM hr_employee_external_ids x WHERE x.employee_id=e.id))
      OR ($4 = 'missing_placement' AND (e.department_id IS NULL OR e.division_id IS NULL))
      OR ($4 = 'missing_pattern' AND NOT EXISTS (SELECT 1 FROM hr_employee_service_periods p WHERE p.employee_id=e.id
        AND p.start_date <= (NOW() AT TIME ZONE 'Pacific/Nauru')::date
        AND (p.end_date IS NULL OR p.end_date >= (NOW() AT TIME ZONE 'Pacific/Nauru')::date) AND p.work_pattern_id IS NOT NULL))
      OR ($4 = 'missing_service' AND NOT EXISTS (SELECT 1 FROM hr_employee_service_periods p WHERE p.employee_id=e.id
        AND p.start_date <= (NOW() AT TIME ZONE 'Pacific/Nauru')::date
        AND (p.end_date IS NULL OR p.end_date >= (NOW() AT TIME ZONE 'Pacific/Nauru')::date)
        AND p.employment_category <> 'unknown' AND p.counts_for_service IS NOT NULL)))`;
  const { rows } = await pool.query(
    `SELECT e.id, e.display_name, e.status, e.reviewer_id, e.department_id, e.division_id,
       e.department_code, e.division_code, d.name AS department_name, v.name AS division_name,
       p.employment_category, p.is_teacher, p.is_intern, p.counts_for_service,
       COALESCE((SELECT json_agg(json_build_object('source', x.source, 'external_id', x.external_id) ORDER BY x.external_id)
         FROM hr_employee_external_ids x WHERE x.employee_id = e.id), '[]'::json) AS external_ids
     FROM hr_employees e LEFT JOIN hr_departments d ON d.id = e.department_id LEFT JOIN hr_divisions v ON v.id = e.division_id
     LEFT JOIN LATERAL (SELECT employment_category,is_teacher,is_intern,counts_for_service FROM hr_employee_service_periods p
       WHERE p.employee_id=e.id AND p.start_date <= (NOW() AT TIME ZONE 'Pacific/Nauru')::date
         AND (p.end_date IS NULL OR p.end_date >= (NOW() AT TIME ZONE 'Pacific/Nauru')::date)
       ORDER BY p.start_date DESC,p.id LIMIT 1) p ON TRUE
     WHERE ${where} ORDER BY lower(e.display_name), e.id LIMIT $5 OFFSET $6`,
    [...values, pageSize, (page - 1) * pageSize]
  );
  const { rows: [count] } = await pool.query(`SELECT count(*)::int AS total FROM hr_employees e WHERE ${where}`, values);
  return { employees: rows, page, page_size: pageSize, total: count.total };
}

export async function employeeProfile(pool, employeeId) {
  const { rows: [employee] } = await pool.query(
    `SELECT e.id,e.display_name,e.position_title,e.email,e.status,e.reviewer_id,e.department_id,e.division_id,e.department_code,e.division_code,
       e.manager_id,m.display_name AS manager_name,e.join_date,r.display_name AS account_name,r.email AS account_email,r.account_type,r.status AS account_status
       FROM hr_employees e LEFT JOIN hr_employees m ON m.id=e.manager_id LEFT JOIN reviewers r ON r.id=e.reviewer_id WHERE e.id = $1`, [employeeId]
  );
  if (!employee) throw notFound('Employee not found.');
  const [{ rows: externalIds }, { rows: servicePeriods }, { rows: accountLinks }] = await Promise.all([
    pool.query('SELECT * FROM hr_employee_external_ids WHERE employee_id = $1 ORDER BY verified_at, id', [employeeId]),
    pool.query('SELECT * FROM hr_employee_service_periods WHERE employee_id = $1 ORDER BY start_date, id', [employeeId]),
    pool.query('SELECT * FROM hr_employee_account_links WHERE employee_id = $1 ORDER BY recorded_at DESC, id', [employeeId]),
  ]);
  return { employee, external_ids: externalIds, service_periods: servicePeriods, account_links: accountLinks };
}

export async function addEmployeeExternalId(pool, { employeeId, externalId, actor, reason }) {
  const verifiedReason = requireReason(reason);
  if (typeof externalId !== 'string' || !externalId.trim() || externalId.trim().length > 100) {
    throw badRequest('Payroll ID must be text of 1–100 characters.');
  }
  return withTransaction(pool, async (client) => {
    await lockEmployee(client, employeeId);
    const { rows: [identifier] } = await client.query(
      `INSERT INTO hr_employee_external_ids (employee_id, source, external_id, verified_by, reason)
       VALUES ($1, 'techone_payroll', $2, $3, $4) ON CONFLICT (source, external_id) DO NOTHING RETURNING *`,
      [employeeId, externalId.trim(), actor.id, verifiedReason]
    );
    if (!identifier) {
      const { rows: [existing] } = await client.query(
        "SELECT * FROM hr_employee_external_ids WHERE source = 'techone_payroll' AND external_id = $1", [externalId.trim()]
      );
      if (existing?.employee_id !== employeeId) throw new ServiceError(409, 'That Payroll ID belongs to another employee. HR must resolve the conflict.');
      return existing; // Retry does not duplicate identity history or change balances.
    }
    await recordAudit({ client, actor, action: 'hr.employee.external_id.verified', entityType: 'hr_employee', entityId: employeeId,
      after: { source: identifier.source, external_id: identifier.external_id, reason: verifiedReason } });
    return identifier;
  });
}

export async function setEmployeeOrganisation(pool, { employeeId, departmentId, divisionId = null, actor, reason }) {
  const verifiedReason = requireReason(reason);
  return withTransaction(pool, async (client) => {
    const before = await lockEmployee(client, employeeId);
    const { rows: [department] } = await client.query('SELECT id, name FROM hr_departments WHERE id = $1', [departmentId]);
    if (!department) throw badRequest('Choose a managed department.');
    let division = null;
    if (divisionId) {
      ({ rows: [division] } = await client.query('SELECT id, name FROM hr_divisions WHERE id = $1 AND department_id = $2', [divisionId, departmentId]));
      if (!division) throw badRequest('The division must belong to the chosen department.');
    }
    const { rows: [employee] } = await client.query(
      `UPDATE hr_employees SET department_id = $2, division_id = $3, department_code = $4, division_code = $5, updated_at = NOW()
       WHERE id = $1 RETURNING id, department_id, division_id, department_code, division_code`,
      [employeeId, departmentId, divisionId, department.name, division?.name || null]
    );
    await recordAudit({ client, actor, action: 'hr.employee.organisation.verified', entityType: 'hr_employee', entityId: employeeId,
      before: { department_id: before.department_id, division_id: before.division_id }, after: { ...employee, reason: verifiedReason } });
    return employee;
  });
}

export async function addServicePeriod(pool, { employeeId, period, actor, reason }) {
  const verifiedReason = requireReason(reason);
  if (period.end_date && period.end_date < period.start_date) throw badRequest('A service period cannot end before it starts.');
  return withTransaction(pool, async (client) => {
    await lockEmployee(client, employeeId);
    const { rows: overlap } = await client.query(
      `SELECT id FROM hr_employee_service_periods WHERE employee_id = $1
        AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')`,
      [employeeId, period.start_date, period.end_date || null]
    );
    if (overlap.length) throw new ServiceError(409, 'This service period overlaps an existing period. HR must resolve the dates.');
    const { rows: [created] } = await client.query(
      `INSERT INTO hr_employee_service_periods (employee_id, start_date, end_date, employment_category, is_teacher, is_intern,
         counts_for_service, work_pattern_id, appointment_reference, recorded_by, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [employeeId, period.start_date, period.end_date || null, period.employment_category, period.is_teacher ?? false,
        period.is_intern ?? false, period.counts_for_service ?? null, period.work_pattern_id || null,
        period.appointment_reference || null, actor.id, verifiedReason]
    );
    await recordAudit({ client, actor, action: 'hr.employee.service_period.recorded', entityType: 'hr_employee', entityId: employeeId, after: created });
    return created;
  });
}

export async function closeServicePeriod(pool, { employeeId, periodId, endDate, actor, reason }) {
  const verifiedReason = requireReason(reason);
  return withTransaction(pool, async (client) => {
    await lockEmployee(client, employeeId);
    const { rows: [before] } = await client.query('SELECT * FROM hr_employee_service_periods WHERE id = $1 AND employee_id = $2 FOR UPDATE', [periodId, employeeId]);
    if (!before) throw notFound('Service period not found.');
    if (endDate < before.start_date || (before.end_date && endDate > before.end_date)) throw badRequest('Closing a service period can only shorten its dates.');
    const { rows: [updated] } = await client.query('UPDATE hr_employee_service_periods SET end_date = $2 WHERE id = $1 RETURNING *', [periodId, endDate]);
    await recordAudit({ client, actor, action: 'hr.employee.service_period.closed', entityType: 'hr_employee', entityId: employeeId,
      before, after: { ...updated, closing_reason: verifiedReason } });
    return updated;
  });
}

// Caller holds a transaction. Locking accounts in ID order serializes competing
// links; the unique employee.reviewer_id constraint is the final guard.
export async function setEmployeeAccount(client, { employeeId, reviewerId, actor, reason }) {
  const verifiedReason = requireReason(reason);
  const employee = await lockEmployee(client, employeeId);
  const ids = [...new Set([employee.reviewer_id, reviewerId].filter(Boolean))].sort();
  const { rows: accounts } = await client.query('SELECT id, email, status FROM reviewers WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
  const account = accounts.find((row) => row.id === reviewerId);
  if (reviewerId && (!account || account.status !== 'active')) throw badRequest('Choose an active portal account.');
  if (reviewerId && employee.status !== 'active') throw badRequest('Activate the employee record before linking an account.');
  if (employee.reviewer_id === reviewerId) return employee;
  if (reviewerId) {
    const { rows: linked } = await client.query('SELECT id FROM hr_employees WHERE reviewer_id = $1 AND id <> $2', [reviewerId, employeeId]);
    if (linked.length) throw new ServiceError(409, 'That login is already linked to a different employee.');
  }
  const { rows: [updated] } = await client.query(
    'UPDATE hr_employees SET reviewer_id = $2, email = $3, updated_at = NOW() WHERE id = $1 RETURNING *',
    [employeeId, reviewerId, account?.email || null]
  );
  await client.query(`INSERT INTO hr_employee_account_links (employee_id, previous_reviewer_id, reviewer_id, verified_by, reason)
    VALUES ($1,$2,$3,$4,$5)`, [employeeId, employee.reviewer_id, reviewerId, actor.id, verifiedReason]);
  // Both owners must sign in again after a mapping changes. Existing capability
  // grants remain; access to this employee is determined by the new link.
  await client.query('DELETE FROM reviewer_sessions WHERE reviewer_id = ANY($1::uuid[])', [ids]);
  await recordAudit({ client, actor, action: 'hr.employee.account.verified', entityType: 'hr_employee', entityId: employeeId,
    before: { reviewer_id: employee.reviewer_id }, after: { reviewer_id: reviewerId, reason: verifiedReason } });
  return updated;
}

export async function provisionEmployeeAccount(pool, { employeeId, email, actor, reason }) {
  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassphrase(temporaryPassword);
  const result = await withTransaction(pool, async (client) => {
    const employee = await lockEmployee(client, employeeId);
    if (employee.reviewer_id) throw new ServiceError(409, 'This employee already has a linked account.');
    if (employee.status !== 'active') throw badRequest('Only active employees can receive an account.');
    const { rows: [identifier] } = await client.query('SELECT id FROM hr_employee_external_ids WHERE employee_id = $1 LIMIT 1', [employeeId]);
    if (!identifier) throw badRequest('Verify the employee Payroll ID before provisioning a login.');
    const { rows: [account] } = await client.query(
      `INSERT INTO reviewers (email, display_name, role, account_type, password_hash, must_change_password, notify_on_submission)
       VALUES ($1,$2,'user','employee',$3,TRUE,FALSE) RETURNING id, email, display_name, account_type`,
      [email.trim().toLowerCase(), employee.display_name, passwordHash]
    );
    await client.query(`INSERT INTO reviewer_capabilities (reviewer_id, capability, granted_by)
      VALUES ($1,'hr_access',$2), ($1,'hr_leave_apply',$2)`, [account.id, actor.id]);
    await setEmployeeAccount(client, { employeeId, reviewerId: account.id, actor, reason });
    return account;
  });
  return { account: result, temporary_password: temporaryPassword };
}

export async function assignLeaveApprover(pool, { assignment, actor, reason }) {
  const verifiedReason = requireReason(reason);
  if ((assignment.level === 'division' && (!assignment.department_id || !assignment.division_id))
    || (assignment.level === 'department' && (!assignment.department_id || assignment.division_id))
    || (assignment.level === 'chief_secretary' && (assignment.department_id || assignment.division_id))) {
    throw badRequest('Division offices need department and division; HOD offices need only department; Chief Secretary is government-wide.');
  }
  if (assignment.effective_to && assignment.effective_to < assignment.effective_from) throw badRequest('An approval assignment cannot end before it starts.');
  return withTransaction(pool, async (client) => {
    // Serializes assignment changes even for the government-wide final stage.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-approval-assignments'))");
    const approver = await lockEmployee(client, assignment.approver_employee_id);
    if (approver.status !== 'active' || !approver.reviewer_id) throw badRequest('Choose an active employee with a verified login link.');
    const { rows: overlap } = await client.query(
      `SELECT id FROM hr_approval_assignments WHERE level = $1 AND department_id IS NOT DISTINCT FROM $2::uuid
         AND division_id IS NOT DISTINCT FROM $3::uuid
         AND daterange(effective_from, effective_to, '[]') && daterange($4::date, $5::date, '[]')`,
      [assignment.level, assignment.department_id || null, assignment.division_id || null, assignment.effective_from, assignment.effective_to || null]
    );
    if (overlap.length) throw new ServiceError(409, 'An approver is already assigned to this scope for those dates.');
    const { rows: [created] } = await client.query(
      `INSERT INTO hr_approval_assignments (level, department_id, division_id, approver_employee_id, effective_from, effective_to, recorded_by, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [assignment.level, assignment.department_id || null, assignment.division_id || null, approver.id,
        assignment.effective_from, assignment.effective_to || null, actor.id, verifiedReason]
    );
    await recordAudit({ client, actor, action: 'hr.approver.assigned', entityType: 'hr_approval_assignment', entityId: created.id, after: created });
    return created;
  });
}

export async function closeApprovalAssignment(pool, { assignmentId, endDate, actor, reason }) {
  const verifiedReason = requireReason(reason);
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-approval-assignments'))");
    const { rows: [before] } = await client.query('SELECT * FROM hr_approval_assignments WHERE id = $1 FOR UPDATE', [assignmentId]);
    if (!before) throw notFound('Approval assignment not found.');
    if (endDate < before.effective_from || (before.effective_to && endDate > before.effective_to)) throw badRequest('Closing an assignment can only shorten its dates.');
    const { rows: [updated] } = await client.query('UPDATE hr_approval_assignments SET effective_to = $2 WHERE id = $1 RETURNING *', [assignmentId, endDate]);
    await recordAudit({ client, actor, action: 'hr.approver.assignment.closed', entityType: 'hr_approval_assignment', entityId: assignmentId,
      before, after: { ...updated, closing_reason: verifiedReason } });
    return updated;
  });
}

// A preview for configuration review. It cannot approve a leave application.
// Missing scopes, revoked grants, inactive accounts and self-approval all block
// readiness; delegation and the staged request state machine are the next build.
export async function previewApprovalChain(pool, employeeId, onDate) {
  const { rows: [employee] } = await pool.query('SELECT id, department_id, division_id FROM hr_employees WHERE id = $1', [employeeId]);
  if (!employee) throw notFound('Employee not found.');
  const { rows } = await pool.query(
    `SELECT a.*, e.reviewer_id, e.display_name AS approver_name, e.status AS employee_status, r.status AS account_status,
       EXISTS (SELECT 1 FROM reviewer_capabilities c WHERE c.reviewer_id = e.reviewer_id AND c.capability = 'hr_leave_approve') AS has_approval_grant,
       r.permissions->>'hr_leave_approve' AS approval_override
     FROM hr_approval_assignments a JOIN hr_employees e ON e.id = a.approver_employee_id
     LEFT JOIN reviewers r ON r.id = e.reviewer_id
     WHERE a.effective_from <= $1 AND (a.effective_to IS NULL OR a.effective_to >= $1)
       AND ((a.level = 'division' AND a.division_id = $2 AND a.department_id = $3)
         OR (a.level = 'department' AND a.department_id = $3) OR a.level = 'chief_secretary')`,
    [onDate, employee.division_id, employee.department_id]
  );
  const stages = APPROVAL_LEVELS.map((level) => {
    const matches = rows.filter((row) => row.level === level);
    const assignment = matches.length === 1 ? matches[0] : null;
    let issue = null;
    if (level === 'division' && !employee.division_id) issue = 'Employee division is unverified.';
    else if (level === 'department' && !employee.department_id) issue = 'Employee department is unverified.';
    else if (!assignment) issue = 'Exactly one effective approver must be assigned.';
    else if (assignment.approver_employee_id === employeeId) issue = 'Self-approval requires an authorised substitute.';
    else if (assignment.employee_status !== 'active' || assignment.account_status !== 'active') issue = 'Approver or account is inactive.';
    else if (assignment.approval_override === 'false' || (!assignment.has_approval_grant && assignment.approval_override !== 'true')) issue = 'Approver needs an explicit leave approval grant.';
    return { level, assignment_id: assignment?.id || null, approver_employee_id: assignment?.approver_employee_id || null,
      approver_name: assignment?.approver_name || null, issue };
  });
  return { employee_id: employeeId, on_date: onDate, ready: stages.every((stage) => !stage.issue), stages };
}

import { PERMISSIONS } from '../config.js';
import { ServiceError } from '../lib/serviceError.js';
import { withTransaction } from '../lib/transaction.js';
import { recordAudit } from './auditService.js';
import { managementReason } from './employeeManagement.js';

/**
 * Leave access beyond applying for leave comes from Leave settings, never from
 * ticks on the account page (central HR excepted):
 *
 * - HR officer (`hr_officer`): an active assignment in Leave settings ->
 *   Administration access for a department or division. One right covering
 *   staff records, balances and reports for that unit.
 * - Approver (`hr_leave_approve`): holding an approval office nominated in
 *   Leave settings -> Organisation & approvers, or a pending application step
 *   assigned to you. Government applications are decided by the officer bound
 *   to each step; old-rules applications by the approver's direct reports'
 *   reporting line or central HR.
 *
 * Both are worked out per request in authService.loadCapabilitiesFor.
 */
export const HR_OFFICER = 'hr_officer';
export const SCOPE_CAPABILITIES = [HR_OFFICER];
export const TODAY = "(NOW() AT TIME ZONE 'Pacific/Nauru')::date";
export const activeScopeSql = (alias = 's') => `${alias}.revoked_at IS NULL AND ${alias}.effective_from <= ${TODAY} AND (${alias}.effective_to IS NULL OR ${alias}.effective_to >= ${TODAY})`;
export const isCentralHr = (user) => user?.permissions?.[PERMISSIONS.HR_ADMIN] === true;

/**
 * True for an account whose active employee record holds an approval office
 * nominated in Leave settings (not yet ended), or is bound to a step of a
 * pending application (a substitute, for example). `reviewer` is SQL for the
 * account id.
 */
export const approverHolderSql = (reviewer) => `EXISTS (SELECT 1 FROM hr_employees me WHERE me.reviewer_id=${reviewer} AND me.status='active' AND (
  EXISTS (SELECT 1 FROM hr_approval_assignments a WHERE a.approver_employee_id=me.id AND (a.effective_to IS NULL OR a.effective_to>=${TODAY}))
  OR EXISTS (SELECT 1 FROM hr_gov_consent_offices o LEFT JOIN hr_gov_consent_withdrawals w ON w.office_id=o.id
    WHERE o.approver_employee_id=me.id AND (COALESCE(w.effective_to,o.effective_to) IS NULL OR COALESCE(w.effective_to,o.effective_to)>=${TODAY}))
  OR EXISTS (SELECT 1 FROM hr_gov_stage_bindings b JOIN hr_gov_request_stages st ON st.id=b.stage_id JOIN hr_gov_requests r ON r.id=st.request_id
    WHERE b.reviewer_id=me.reviewer_id AND r.status='pending')))`;
const unitMatch = (scope, alias) => `${scope}.department_id=${alias}.department_id AND (${scope}.division_id IS NULL OR ${scope}.division_id=${alias}.division_id OR ${scope}.division_id=(SELECT v.parent_division_id FROM hr_divisions v WHERE v.id=${alias}.division_id))`;

/**
 * SQL identifiers and rights are code-owned; account IDs are parameters.
 * `hr_officer`: central HR, or an HR officer assignment covering the person's unit.
 * `hr_leave_approve`: central HR only; individual approvers reach people
 * through managerScopeSql or the workflow step they are bound to.
 */
export function employeeScopeSql(user, right, parameter = '$1', alias = 'e') {
  if (![HR_OFFICER, PERMISSIONS.HR_LEAVE_APPROVE].includes(right)) throw new Error('Invalid HR right');
  if (isCentralHr(user)) return `(${parameter}::uuid IS NOT NULL)`;
  if (right !== HR_OFFICER || user?.permissions?.[HR_OFFICER] !== true) return `(${parameter}::uuid IS NULL AND FALSE)`;
  return `EXISTS (SELECT 1 FROM hr_access_scopes s WHERE s.reviewer_id=${parameter} AND ${activeScopeSql()} AND ${unitMatch('s', alias)})`;
}

/**
 * Who may read an application's supporting evidence (medical certificates and
 * the like): whoever may decide that person's leave. That is central HR or an
 * approver in their reporting line. The owner and the application's assigned
 * officers are allowed where each read is made.
 */
export function evidenceReadSql(user, parameter = '$1', alias = 'e') {
  return `(${employeeScopeSql(user,'hr_leave_approve',parameter,alias)} OR ${managerScopeSql(user,parameter,alias)})`;
}
export async function canReadEvidence(client, user, employeeId) {
  return canAccessEmployee(client,user,employeeId,'hr_leave_approve',{owner:true,manager:true});
}

/** Legacy manager access requires explicit assignment and the same division or its parent unit. */
export function managerScopeSql(user, parameter = '$1', alias = 'e', includeSelf = false) {
  if (user?.permissions?.hr_leave_approve !== true && !includeSelf) return 'FALSE';
  return `EXISTS (SELECT 1 FROM hr_employees me WHERE me.reviewer_id=${parameter} AND me.status='active'
    AND (${includeSelf ? `${alias}.id=me.id OR ` : ''}(${user?.permissions?.hr_leave_approve === true ? 'TRUE' : 'FALSE'} AND ${alias}.manager_id=me.id
      AND me.department_id IS NOT NULL AND me.department_id=${alias}.department_id
      AND (me.division_id IS NOT DISTINCT FROM ${alias}.division_id OR me.division_id=(SELECT v.parent_division_id FROM hr_divisions v WHERE v.id=${alias}.division_id)))))`;
}
export function employeeReadSql(user, parameter = '$1', alias = 'e', includeSelf = false) {
  return `(${employeeScopeSql(user,HR_OFFICER,parameter,alias)} OR ${managerScopeSql(user,parameter,alias,includeSelf)})`;
}

export async function canAccessEmployee(client, user, employeeId, capability, { owner = false, manager = false } = {}) {
  const condition = `(${employeeScopeSql(user,capability,'$2')} ${manager ? `OR ${managerScopeSql(user,'$2')}` : ''}
    ${owner ? "OR (e.reviewer_id=$2 AND e.status='active')" : ''})`;
  return (await client.query(`SELECT 1 FROM hr_employees e WHERE e.id=$1 AND ${condition}`,[employeeId,user.id])).rowCount > 0;
}

/** Write-time checks lock placement and matching assignments until commit. */
export async function assertEmployeeScope(client, user, employeeId, right = HR_OFFICER) {
  const { rows: [employee] } = await client.query('SELECT * FROM hr_employees WHERE id=$1 FOR UPDATE',[employeeId]);
  if (!employee) throw new ServiceError(404,'Employee not found.');
  if (isCentralHr(user)) return employee;
  if (right !== HR_OFFICER || user.permissions?.[HR_OFFICER] !== true) throw new ServiceError(404,'Employee not found.');
  const { rows } = await client.query(`SELECT s.id FROM hr_access_scopes s WHERE s.reviewer_id=$1
    AND ${activeScopeSql()} AND s.department_id=$2 AND (s.division_id IS NULL OR s.division_id=$3 OR s.division_id=(SELECT v.parent_division_id FROM hr_divisions v WHERE v.id=$3)) FOR SHARE`,
    [user.id,employee.department_id,employee.division_id]);
  if (!rows.length) throw new ServiceError(404,'Employee not found.');
  return employee;
}

export async function grantHrScope(pool, { user, actor, data }) {
  if (!isCentralHr(user)) throw new ServiceError(403,'Only central HR can assign access.');
  const reason = managementReason(data.reason);
  if (data.effective_to && data.effective_to < data.effective_from) throw new ServiceError(400,'Access cannot end before it starts.');
  return withTransaction(pool,async client=>{
    const { rows: [account] } = await client.query('SELECT id,status,account_type FROM reviewers WHERE id=$1 FOR UPDATE',[data.reviewer_id]);
    if (!account || account.status!=='active') throw new ServiceError(400,'Choose an active individual account.');
    if (account.account_type==='employee' && !(await client.query("SELECT 1 FROM hr_employees WHERE reviewer_id=$1 AND status='active'",[account.id])).rowCount) throw new ServiceError(400,'Employee-only accounts need an active verified employee link.');
    const { rows: [department] } = await client.query('SELECT id FROM hr_departments WHERE id=$1 FOR SHARE',[data.department_id]);
    if (!department) throw new ServiceError(400,'Choose a managed department.');
    if (data.division_id && !(await client.query('SELECT id FROM hr_divisions WHERE id=$1 AND department_id=$2 FOR SHARE',[data.division_id,department.id])).rowCount) throw new ServiceError(400,'Choose a division in this department.');
    const { rows: [scope] } = await client.query(`INSERT INTO hr_access_scopes(reviewer_id,department_id,division_id,capabilities,effective_from,effective_to,granted_by,reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[account.id,department.id,data.division_id||null,SCOPE_CAPABILITIES,data.effective_from,data.effective_to||null,actor.id,reason]);
    await client.query('DELETE FROM reviewer_sessions WHERE reviewer_id=$1',[account.id]);
    await recordAudit({client,actor,action:'hr.access_scope.granted',entityType:'hr_access_scope',entityId:scope.id,after:scope});
    return scope;
  });
}
export async function revokeHrScope(pool, { user, actor, scopeId, reason }) {
  if (!isCentralHr(user)) throw new ServiceError(403,'Only central HR can revoke access.');
  const verifiedReason = managementReason(reason);
  return withTransaction(pool,async client=>{
    // Lock the account before its scope, matching grants for this identity.
    const { rows: [reference] } = await client.query('SELECT reviewer_id FROM hr_access_scopes WHERE id=$1',[scopeId]);
    if (!reference) throw new ServiceError(404,'Access assignment not found.');
    await client.query('SELECT id FROM reviewers WHERE id=$1 FOR UPDATE',[reference.reviewer_id]);
    const { rows: [before] } = await client.query('SELECT * FROM hr_access_scopes WHERE id=$1 FOR UPDATE',[scopeId]);
    if (before.revoked_at) return before;
    const { rows: [after] } = await client.query('UPDATE hr_access_scopes SET revoked_at=NOW(),revoked_by=$2,revoke_reason=$3 WHERE id=$1 RETURNING *',[scopeId,actor.id,verifiedReason]);
    await client.query('DELETE FROM reviewer_sessions WHERE reviewer_id=$1',[after.reviewer_id]);
    await recordAudit({client,actor,action:'hr.access_scope.revoked',entityType:'hr_access_scope',entityId:scopeId,before,after});
    return after;
  });
}

import { PERMISSIONS } from '../config.js';
import { ServiceError } from '../lib/serviceError.js';
import { withTransaction } from '../lib/transaction.js';
import { recordAudit } from './auditService.js';
import { managementReason } from './employeeManagement.js';

export const SCOPE_CAPABILITIES = ['hr_staff_manage','hr_leave_approve','hr_balance_manage','hr_report_read','hr_evidence_read'];
const TODAY = "(NOW() AT TIME ZONE 'Pacific/Nauru')::date";
export const activeScopeSql = (alias = 's') => `${alias}.revoked_at IS NULL AND ${alias}.effective_from <= ${TODAY} AND (${alias}.effective_to IS NULL OR ${alias}.effective_to >= ${TODAY})`;
export const isCentralHr = (user) => user?.permissions?.[PERMISSIONS.HR_ADMIN] === true;

/** SQL identifiers and capability are code-owned; account IDs are parameters. */
export function employeeScopeSql(user, capability, parameter = '$1', alias = 'e') {
  if (isCentralHr(user)) return `(${parameter}::uuid IS NOT NULL)`;
  if (!SCOPE_CAPABILITIES.includes(capability)) throw new Error('Invalid HR scope capability');
  if (user?.permissions?.[capability] !== true) return `(${parameter}::uuid IS NULL AND FALSE)`;
  return `EXISTS (SELECT 1 FROM hr_access_scopes s WHERE s.reviewer_id=${parameter} AND '${capability}'=ANY(s.capabilities)
    AND ${activeScopeSql()} AND s.department_id=${alias}.department_id AND (s.division_id IS NULL OR s.division_id=${alias}.division_id OR s.division_id=(SELECT v.parent_division_id FROM hr_divisions v WHERE v.id=${alias}.division_id)))`;
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
  return `(${employeeScopeSql(user,'hr_staff_manage',parameter,alias)} OR ${employeeScopeSql(user,'hr_leave_approve',parameter,alias)}
    OR ${managerScopeSql(user,parameter,alias,includeSelf)})`;
}

export async function canAccessEmployee(client, user, employeeId, capability, { owner = false, manager = false } = {}) {
  const condition = `(${employeeScopeSql(user,capability,'$2')} ${manager ? `OR ${managerScopeSql(user,'$2')}` : ''}
    ${owner ? "OR (e.reviewer_id=$2 AND e.status='active')" : ''})`;
  return (await client.query(`SELECT 1 FROM hr_employees e WHERE e.id=$1 AND ${condition}`,[employeeId,user.id])).rowCount > 0;
}

/** Write-time checks lock placement and matching grants until commit. */
export async function assertEmployeeScope(client, user, employeeId, capability) {
  const { rows: [employee] } = await client.query('SELECT * FROM hr_employees WHERE id=$1 FOR UPDATE',[employeeId]);
  if (!employee) throw new ServiceError(404,'Employee not found.');
  if (isCentralHr(user)) return employee;
  if (user.permissions?.[capability] !== true) throw new ServiceError(404,'Employee not found.');
  const { rows } = await client.query(`SELECT s.id FROM hr_access_scopes s WHERE s.reviewer_id=$1 AND $2=ANY(s.capabilities)
    AND ${activeScopeSql()} AND s.department_id=$3 AND (s.division_id IS NULL OR s.division_id=$4 OR s.division_id=(SELECT v.parent_division_id FROM hr_divisions v WHERE v.id=$4)) FOR SHARE`,
    [user.id,capability,employee.department_id,employee.division_id]);
  if (!rows.length) throw new ServiceError(404,'Employee not found.');
  return employee;
}

export async function grantHrScope(pool, { user, actor, data }) {
  if (!isCentralHr(user)) throw new ServiceError(403,'Only central HR can assign access.');
  const reason = managementReason(data.reason);
  if (new Set(data.capabilities).size!==data.capabilities.length || data.capabilities.some(c=>!SCOPE_CAPABILITIES.includes(c))) throw new ServiceError(400,'Choose distinct scoped HR capabilities.');
  if (data.effective_to && data.effective_to < data.effective_from) throw new ServiceError(400,'Access cannot end before it starts.');
  return withTransaction(pool,async client=>{
    const { rows: [account] } = await client.query('SELECT id,status,account_type FROM reviewers WHERE id=$1 FOR UPDATE',[data.reviewer_id]);
    if (!account || account.status!=='active') throw new ServiceError(400,'Choose an active individual account.');
    if (account.account_type==='employee' && !(await client.query("SELECT 1 FROM hr_employees WHERE reviewer_id=$1 AND status='active'",[account.id])).rowCount) throw new ServiceError(400,'Employee-only accounts need an active verified employee link.');
    const { rows: [department] } = await client.query('SELECT id FROM hr_departments WHERE id=$1 FOR SHARE',[data.department_id]);
    if (!department) throw new ServiceError(400,'Choose a managed department.');
    if (data.division_id && !(await client.query('SELECT id FROM hr_divisions WHERE id=$1 AND department_id=$2 FOR SHARE',[data.division_id,department.id])).rowCount) throw new ServiceError(400,'Choose a division in this department.');
    const { rows: [scope] } = await client.query(`INSERT INTO hr_access_scopes(reviewer_id,department_id,division_id,capabilities,effective_from,effective_to,granted_by,reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[account.id,department.id,data.division_id||null,data.capabilities,data.effective_from,data.effective_to||null,actor.id,reason]);
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

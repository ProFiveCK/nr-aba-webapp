import {fingerprint} from '../lib/governmentLeaveRules.js';
import {ServiceError} from '../lib/serviceError.js';
/** Certification never silently enables leave while externally retained work is unresolved. */
export async function assertCutoverResolved(client,employeeId,{activation=false}={}) {
 const row=(await client.query(`SELECT r.plan FROM hr_gov_migration_reviews r JOIN hr_gov_migration_certifications c ON c.review_id=r.id WHERE r.employee_id=$1 ORDER BY c.recorded_at DESC,r.id DESC LIMIT 1`,[employeeId])).rows[0];
 if(!row)return;
 for(const d of row.plan.dispositions) {
  if(d.action==='carry_approved'){
   const legacy=(await client.query("SELECT id,leave_type_id,status,to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date,days FROM hr_leave_applications WHERE id=$1 AND employee_id=$2",[d.legacy_request_id,employeeId])).rows[0];
   if(!legacy||legacy.status!=='approved'||fingerprint(legacy)!==d.legacy_hash)throw new ServiceError(409,'The carried approved leave changed; review its transfer before continuing.');
   continue;
  }
  if(d.action==='retain_external')throw new ServiceError(409,'Resolve retained external pending/future leave in a fresh certified migration review before employee submission, activation or jobs. Central HR can prepare linked applications with fresh approvals.');
  const r=(await client.query('SELECT status FROM hr_gov_requests WHERE id=$1 AND employee_id=$2',[d.portal_request_id,employeeId])).rows[0];
  if(d.action==='transfer_with_fresh_approval'&&activation&&!r)continue;
  if(!r||!['pending','approved'].includes(r.status))throw new ServiceError(409,'A linked cutover application changed; prepare and certify a fresh retained-leave reconciliation.');
 }
}

export async function legacyTransferFor(client,employeeId,input,requestId) {
 if(!requestId)return null;
 const t=(await client.query('SELECT * FROM hr_gov_legacy_transfers WHERE request_id=$1 AND employee_id=$2',[requestId,employeeId])).rows[0];if(!t)return null;
 if(t.approval_preserved)throw new ServiceError(409,'This leave already retains its original approval; use the approved application.');
 const r=(await client.query("SELECT id,leave_type_id,status,to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date,days FROM hr_leave_applications WHERE id=$1 AND employee_id=$2",[t.legacy_request_id,employeeId])).rows[0];
 if(!r||fingerprint(r)!==t.legacy_hash||t.code!==input.code||r.start_date!==input.start_date||r.end_date!==input.end_date)throw new ServiceError(409,'The certified legacy transfer changed; preserve the source and prepare a fresh reconciliation.');
 return t;
}

import {assertDraftUsable} from './governmentLeaveDrafts.js';
import {withTransaction} from '../lib/transaction.js';
import {ServiceError} from '../lib/serviceError.js';
import {fingerprint,units,decimal,serviceFacts} from '../lib/governmentLeaveRules.js';
import {loadContext,lockEmployee} from './governmentLeave.js';
import {assertCentral,today} from './governmentLeaveWorkflow.js';
import {recordAudit} from './auditService.js';
const fail=(message,status=409)=>{throw new ServiceError(status,message);};
const text=(v,label,min=5)=>{if(typeof v!=='string'||v.trim().length<min||v.length>1000)fail(`Provide ${label}.`,400);return v.trim();};
export async function benefitBasisFor(client,employeeId){
 const original=(await client.query('SELECT * FROM hr_gov_benefit_bases WHERE employee_id=$1 ORDER BY id',[employeeId])).rows;
 if(original.length>1)fail('Reconcile multiple historic benefit bases before new commitments.');if(!original.length)return null;
 const revision=(await client.query('SELECT r.* FROM hr_gov_benefit_reconciliations r JOIN hr_gov_benefit_reconciliation_approvals a ON a.reconciliation_id=r.id WHERE r.employee_id=$1 ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1',[employeeId])).rows[0];
 return revision?{...original[0],service_basis_id:revision.service_basis_id,source_reference:revision.history_reference,prior_units:revision.prior_units,transition_reference:revision.transition_reference,reconciliation_id:revision.id}:original[0];
}
async function snapshot(client,employeeId){
 const context=await loadContext(client,employeeId),cessation=context.periods.map(p=>p.end_date).filter(date=>date&&date<=today()).sort().at(-1),asAt=context.employee.status==='active'?today():cessation;
 if(!asAt)fail('Verify the actual employment cessation date before reconciling an inactive benefit register.');
 const basis=serviceFacts(context,asAt);if(basis.issues.filter(issue=>issue!=='An anniversary crosses unverified future service.').length)fail(basis.issues.join(' '));
 const original=await benefitBasisFor(client,employeeId);if(!original)fail('No committed benefit baseline exists to reconcile.');
 const commitments=(await client.query('SELECT * FROM hr_gov_benefit_commitments WHERE employee_id=$1 ORDER BY request_id',[employeeId])).rows;
 const effects=(await client.query('SELECT e.* FROM hr_gov_case_effects e JOIN hr_gov_requests r ON r.id=e.request_id WHERE r.employee_id=$1 ORDER BY e.request_id',[employeeId])).rows;
 return {as_of:asAt,current_service_basis_id:basis.basis.id,original,service:{periods:context.periods,bases:context.bases,exclusions:context.exclusions},commitments,effects};
}
export async function prepareBenefitReconciliation(pool,{user,actor,data}){
 const history=text(data.history_reference,'signed corrected prior-payout register'),transition=text(data.transition_reference,'signed Long Service / Furlough transition determination'),source=text(data.source_reference,'reconciliation authority'),reason=text(data.reason,'reconciliation reason',10);
 let prior;try{prior=units(data.prior_units);if(prior<0n)fail('Prior units cannot be negative.',400);}catch(e){if(e.status)throw e;fail(e.message,400);}
 return withTransaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-gov-policies'))");await assertCentral(client,user);await lockEmployee(client,data.employee_id);
  const current=await snapshot(client,data.employee_id),payload={employee_id:data.employee_id,prior_units:decimal(prior),history_reference:history,transition_reference:transition,source_reference:source,reason},hash=fingerprint(payload);
  const old=(await client.query('SELECT * FROM hr_gov_benefit_reconciliations WHERE id=$1',[data.reconciliation_id])).rows[0];if(old){if(old.payload_hash!==hash||old.prepared_by!==actor.id)fail('Reconciliation key was used differently.');return old;}
  const row=(await client.query('INSERT INTO hr_gov_benefit_reconciliations(id,employee_id,original_basis_id,service_basis_id,prior_units,history_reference,transition_reference,source_reference,reason,prepared_by,payload_hash,snapshot_hash,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[data.reconciliation_id,data.employee_id,current.original.id,current.current_service_basis_id,decimal(prior),history,transition,source,reason,actor.id,hash,fingerprint(current),current])).rows[0];
  await recordAudit({client,actor,action:'hr.gov.benefit_reconciliation.prepared',entityType:'hr_gov_benefit_reconciliation',entityId:row.id,after:{employee_id:row.employee_id,snapshot_hash:row.snapshot_hash}});return row;
 });
}
export async function approveBenefitReconciliation(pool,{user,actor,id,data}){
 const reason=text(data.reason,'independent benefit reconciliation reason',10);
 return withTransaction(pool,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`hr-gov-draft:benefit_reconciliation:${id}`]);await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-gov-policies'))");await assertCentral(client,user);const row=(await client.query('SELECT * FROM hr_gov_benefit_reconciliations WHERE id=$1',[id])).rows[0];if(!row)fail('Reconciliation not found.',404);await lockEmployee(client,row.employee_id);await client.query('SELECT id FROM hr_gov_benefit_reconciliations WHERE id=$1 FOR UPDATE',[id]);await assertDraftUsable(client,'benefit_reconciliation',id);
  if(row.prepared_by===actor.id)fail('A different central HR officer must reconcile benefit history.',403);if(row.snapshot_hash!==data.snapshot_hash)fail('Confirm the exact reconciliation checksum.');
  const old=(await client.query('SELECT * FROM hr_gov_benefit_reconciliation_approvals WHERE reconciliation_id=$1',[id])).rows[0];if(old){if(old.actor_id!==actor.id||old.reason!==reason)fail('Reconciliation already has a different review.');return old;}
  const current=await snapshot(client,row.employee_id);if(fingerprint(current)!==row.snapshot_hash)fail('Benefit history or service changed. Prepare a fresh reconciliation.');
  const receipt=(await client.query('INSERT INTO hr_gov_benefit_reconciliation_approvals(reconciliation_id,actor_id,snapshot_hash,reason) VALUES($1,$2,$3,$4) RETURNING *',[id,actor.id,row.snapshot_hash,reason])).rows[0];
  await recordAudit({client,actor,action:'hr.gov.benefit_reconciliation.approved',entityType:'hr_gov_benefit_reconciliation',entityId:id,after:receipt});return receipt;
 });
}

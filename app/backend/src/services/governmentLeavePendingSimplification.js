import {withTransaction} from '../lib/transaction.js';
import {fingerprint} from '../lib/governmentLeaveRules.js';
import {ServiceError} from '../lib/serviceError.js';
import {isSimpleApproval} from '../lib/governmentLeaveSimpleApproval.js';
import {approvalRouteFor} from './governmentLeaveApprovalRoutes.js';
import {recordAudit} from './auditService.js';
import * as workflow from './governmentLeaveWorkflow.js';
import * as ledger from './governmentLeave.js';

// Audited maintenance only. Preserve original snapshots, decisions, balances
// and stages; opt unreviewed pending requests into the same approval rule.
export async function simplifyPendingApprovals(pool,{apply=false,expected=null}={}){
 return withTransaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-gov-policies'))");
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-approval-assignments'))");
  const refs=(await client.query("SELECT id,employee_id FROM hr_gov_requests r WHERE status='pending' AND application_snapshot->>'simple_approval' IS DISTINCT FROM 'true' AND NOT EXISTS(SELECT 1 FROM hr_gov_request_route_corrections c WHERE c.request_id=r.id) ORDER BY employee_id,id")).rows;
  const plans=[];
  for(const ref of refs){
   await ledger.lockEmployee(client,ref.employee_id);await client.query('SELECT id FROM hr_gov_requests WHERE id=$1 FOR UPDATE',[ref.id]);
   const request=await workflow.getRequest(client,ref.id);
   if(request.status!=='pending'||isSimpleApproval(request))continue;
   const stages=await workflow.stagesFor(client,ref.id),route=await approvalRouteFor(client,request.department_id,request.code,{simple:true});
   if(request.stage_index!==0||stages.some(s=>s.decision)||(await client.query('SELECT 1 FROM hr_gov_case_determinations WHERE request_id=$1',[ref.id])).rowCount)throw new ServiceError(409,`Application ${ref.id} already has review history; preserve it for explicit reconciliation.`);
   const retained=stages.slice(0,route.stages.length);
   if(retained.length!==route.stages.length||retained.some((s,i)=>s.ordinal!==i||s.level!==route.stages[i].level))throw new ServiceError(409,`Application ${ref.id} does not match the configured route; review its assignment separately.`);
   for(const stage of retained){const issue=await workflow.bindingIssue(client,request,stage);if(issue)throw new ServiceError(409,`${ref.id}: ${issue}`);}
   plans.push({id:ref.id,code:request.code,payload_hash:request.payload_hash,route:{...route,simple_approval:true},stage_ids:retained.map(s=>s.id),status:'pending',approval_decisions:0});
  }
  const manifest=plans.map(p=>({id:p.id,payload_hash:p.payload_hash,route:p.route,stage_ids:p.stage_ids}));
  if(apply&&(!expected||fingerprint(expected)!==fingerprint(manifest)))throw new ServiceError(409,'Pending applications or their routes changed. Review a fresh dry run before applying.');
  if(apply)for(const plan of plans){
   const reason='Applied the operator-requested simple approval rule to an unreviewed pending application. The configured assigned approver reviews supporting information with the decision; no separate HR review is added.';
   await client.query('INSERT INTO hr_gov_request_route_corrections(request_id,approval_route,stage_ids,standard_lwop,reason) VALUES($1,$2,$3,FALSE,$4)',[plan.id,plan.route,plan.stage_ids,reason]);
   await recordAudit({client,action:'hr.gov.request.simple_approval_enabled',entityType:'hr_gov_request',entityId:plan.id,after:plan,metadata:{maintenance:true,authorization:'Operator requested the same simple approval rule for all leave types',no_approval_recorded:true}});
  }
  return {applied:apply,applications:plans,manifest};
 });
}

import {withTransaction} from '../lib/transaction.js';
import {ServiceError} from '../lib/serviceError.js';
import {standardLwopPeriod} from '../lib/governmentLeaveStandardLwop.js';
import {recordAudit} from './auditService.js';
import {approvalRouteFor} from './governmentLeaveApprovalRoutes.js';
import * as workflow from './governmentLeaveWorkflow.js';
import * as ledger from './governmentLeave.js';
import {verifyCase} from './governmentLeaveCases.js';

const fail=message=>{throw new ServiceError(409,message);};

// Maintenance operation, deliberately not exposed as an HTTP endpoint. It can
// only complete a legacy LWOP request whose actual, certified approvals already
// satisfy the configured route. Original requests, stages and decisions remain.
export async function repairApprovedLwopRoute(pool,{id,expectedRouteId,apply=false}) {
 return withTransaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-gov-policies'))");
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-approval-assignments'))");
  const ref=await workflow.getRequest(client,id),employee=await ledger.lockEmployee(client,ref.employee_id);
  await client.query('SELECT id FROM hr_gov_requests WHERE id=$1 FOR UPDATE',[id]);
  const request=await workflow.getRequest(client,id);
  if(request.route_correction&&request.status==='approved')return {id,status:'approved',already_repaired:true};
  if(request.code!=='lwop'||request.status!=='pending'||request.application_snapshot.approval_route||request.route_correction)fail('Only a pending LWOP application with the old fixed route can be repaired.');
  const context=await ledger.loadContext(client,request.employee_id),basis=context.bases.find(b=>b.id===request.application_snapshot.evaluation.service_basis_id);
  if(!standardLwopPeriod(request.application_snapshot.input,basis?.leap_day_method))fail('Extended LWOP needs its exceptional review.');
  const route=await approvalRouteFor(client,request.department_id,'lwop');
  if(!route.configured||route.id!==expectedRouteId)fail('The configured approval route changed. Review the repair again.');
  const original=await workflow.stagesFor(client,id),retained=original.slice(0,route.stages.length);
  if(retained.length!==route.stages.length||retained.some((s,i)=>s.level!==route.stages[i].level||s.ordinal!==i||s.decision?.decision!=='approved'))fail('The recorded approvals do not complete the configured route.');
  if(original.slice(retained.length).some(s=>s.decision))fail('Later stages already have decisions; this application needs an explicit review.');
  if((await client.query('SELECT 1 FROM hr_gov_case_determinations WHERE request_id=$1',[id])).rowCount)fail('A separately reviewed determination already exists.');
  for(const stage of retained){const issue=await workflow.bindingIssue(client,request,stage);if(issue)fail(issue);
   const certified=await client.query("SELECT 1 FROM audit_log WHERE action='hr.gov.stage.decided' AND entity_id=$1 AND actor_id=$2 AND after->>'stage_id'=$3 AND after->>'certification_confirmed'='true'",[id,stage.decision.actor_id,stage.id]);
   if(!certified.rowCount)fail('The recorded approval lacks its application certification.');
  }
  await verifyCase(client,{...request,route_correction:{standard_lwop:true}},employee,{final:true});
  const preview={id,status_before:request.status,route_id:route.id,retained_stage_ids:retained.map(s=>s.id),retained_approver_names:retained.map(s=>s.binding.approver_name),removed_levels:original.slice(retained.length).map(s=>s.level),result:'approved',salary_percent:'0.000000',new_approval_decisions:0};
  if(!apply)return preview;
  const reason='Corrected the fixed LWOP route to the configured approval route and completed the existing certified approval. No new approval decision was recorded.';
  await client.query('INSERT INTO hr_gov_request_route_corrections(request_id,approval_route,stage_ids,reason) VALUES($1,$2,$3,$4)',[id,route,preview.retained_stage_ids,reason]);
  const corrected=await workflow.getRequest(client,id),last=retained.at(-1);
  // Effects belong to the actual approving officer, not a maintenance account.
  await workflow.finalizeApprovedRequest(pool,client,corrected,employee,{id:last.decision.actor_id},{note:reason});
  await recordAudit({client,action:'hr.gov.request.route_corrected',entityType:'hr_gov_request',entityId:id,before:{stage_index:request.stage_index,stages:original},after:preview,metadata:{maintenance:true,authorization:'Operator-requested correction using existing certified approvals',original_approval_decision_ids:retained.map(s=>s.decision.id)}});
  return {...preview,status:'approved'};
 });
}

import {approvedCarryoverPlan,carryApprovedApplications} from './governmentLeaveApprovedCarryover.js';
import {calendarCoverageRequired,calendarFallbackNotice} from '../lib/governmentLeaveCalendarRules.js';
import {divisionPlacementIssue} from './organisationHierarchy.js';
import {randomUUID} from 'node:crypto';
import {ServiceError} from '../lib/serviceError.js';
import {withTransaction} from '../lib/transaction.js';
import {COMMON_CODES,dayNumber,decimal,fingerprint,serviceFacts,units} from '../lib/governmentLeaveRules.js';
import {migrationState,migrationPlan,prepareMigration,certifyMigration} from './governmentLeavePayroll.js';
import {assertCentral,accountState,bindingIssue,cleanHistory,effectiveOffices,prepareConfiguration,publishConfiguration,readyConfiguration,today} from './governmentLeaveWorkflow.js';
import {approvalRouteFor} from './governmentLeaveApprovalRoutes.js';
import {isCentralHr} from './hrAccess.js';
import {lockEmployee} from './governmentLeave.js';
import {recordAudit} from './auditService.js';
import {assertInitialAdmin,withInitialAdminMigration} from './governmentLeaveInitialAdmin.js';

const fail=(message,status=409)=>{throw new ServiceError(status,message);};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const medicalRule='single_calendar_date_nonadjacent_scheduled_days';
function input(data){
 if(!Array.isArray(data.employees)||!data.employees.length||data.employees.length>50||data.employees.some(e=>!e||!uuid.test(e.employee_id))||new Set(data.employees.map(e=>e.employee_id.toLowerCase())).size!==data.employees.length)fail('Select 1–50 distinct existing employees.',400);
 try{dayNumber(data.cutover_date);}catch{fail('Choose a valid cutover date.',400);}
 if(data.cutover_date>today())fail('Use a cutover date on or before today.',400);
 if(data.history_confirmed!==true)fail('Confirm the complete reviewed Medical history, including employees with no prior absences.',400);
 for(const key of ['source_reference','payroll_reference','transition_reference','history_reference','reason'])if(typeof data[key]!=='string'||data[key].trim().length<(key==='reason'?10:5)||data[key].length>(key==='reason'?1000:500))fail(`Provide ${key.replaceAll('_',' ')}.`,400);
 if(data.initial_admin_setup!=null&&typeof data.initial_admin_setup!=='boolean')fail('Choose a valid initial admin migration option.',400);
 return {...Object.fromEntries(['cutover_date','source_reference','payroll_reference','transition_reference','history_reference','reason'].map(k=>[k,data[k].trim()])),initial_admin_setup:data.initial_admin_setup===true,history_confirmed:true,employees:data.employees.map(e=>({employee_id:e.employee_id.toLowerCase(),medical_history:e.medical_history||[]})).sort((a,b)=>a.employee_id.localeCompare(b.employee_id))};
}
async function snapshot(client,plan){
 const employees=[];
 for(const selected of plan.employees){
  const {state,hash}=await migrationState(client,selected.employee_id,plan.cutover_date),employeeRow=(await client.query('SELECT id,display_name,reviewer_id,status,department_id,division_id,leave_policy_regime,leave_entitled FROM hr_employees WHERE id=$1',[selected.employee_id])).rows[0];
  const {leave_entitled:leaveEntitled,...employee}=employeeRow;
  const legacyHistoryHash=(await client.query("SELECT md5(COALESCE(string_agg(md5(to_jsonb(a)::text),'' ORDER BY a.id),'')) AS hash FROM hr_leave_applications a WHERE employee_id=$1",[employee.id])).rows[0].hash;
  const appointment=state.context.periods.find(p=>p.start_date<=plan.cutover_date&&(!p.end_date||p.end_date>=plan.cutover_date));
  if(appointment?.employment_category==='contract'&&leaveEntitled===false){
   employees.push({employee_id:employee.id,display_name:employee.display_name,payroll_id:state.identity?.payroll_id||null,source_hash:hash,legacy_history_hash:legacyHistoryHash,employee,route:{stages:[]},offices:[],enabled_codes:[],excluded_targets:[],targets:[],warnings:[],issues:['This Contract appointment has no leave entitlement. Exclude this staff profile from leave consolidation; no opening credits are required.']});continue;
  }
  const route=await approvalRouteFor(client,employee.department_id,'recreation'),offices=[],issues=[],warnings=[];
  for(const stage of route.stages){
   const matches=await effectiveOffices(client,employee,stage.level),office=matches.length===1?matches[0]:null;
   let issue=office?await bindingIssue(client,{...employee,employee_id:employee.id,submitted_by:employee.reviewer_id},{level:stage.level,binding:{...office,assignment_id:office.id}}):`Nominate one current ${stage.label} officeholder.`;
   if(issue?.startsWith('Self-approval')){
    const state=await accountState(client,office.reviewer_id,employee);
    if(!state||(stage.level==='hr_verifier'?!isCentralHr(state.user):!state.approval))issue='The required officer capability is inactive or revoked.';
    else{warnings.push(`${stage.label}: this officer’s own applications require HR to record an authorised substitute before approval.`);issue=null;}
   }
   offices.push({level:stage.level,office,issue});if(issue)issues.push(issue);
  }
  if(plan.initial_admin_setup&&!state.identity?.payroll_id)warnings.push('Payroll ID is unverified. Existing staff identity and credit can migrate; verify the Payroll ID before Payroll exchange.');
  if(!calendarCoverageRequired(state.context)&&!state.context.calendars.some(c=>c.effective_from<=plan.cutover_date&&c.effective_to>=plan.cutover_date))warnings.push(calendarFallbackNotice);
  if(!route.configured)issues.push('Configure the approval levels for this cohort before consolidation.');
  if(employee.status!=='active')issues.push('Inactive personnel keep their retained records. Consolidate active employees first.');
  if(employee.leave_policy_regime!=='legacy'||state.context.entitlements.length||state.government_requests.length)issues.push('Initial consolidation requires an existing employee with no Government postings or applications. Use reconciliation for later changes.');
  if(!employee.department_id||!employee.division_id)issues.push('Verify the managed department and division.');
  const placementIssue=await divisionPlacementIssue(client,employee.division_id);if(placementIssue)issues.push(placementIssue);
  if(state.initial_setup?.status!=='adopted')issues.push('Adopt the reviewed policy and leave-type mappings.');
  if(state.retained_legacy_leave.some(r=>r.status==='pending'))issues.push('Resolve pending legacy applications before cohort consolidation. Approved leave carries forward with its existing approval during initial admin migration.');
  if(!plan.initial_admin_setup&&state.retained_legacy_leave.some(r=>r.status==='approved'))issues.push('Use initial admin migration to carry existing approved leave, or reconcile it individually.');
  if(appointment?.is_teacher)issues.push('Teacher Recreation uses the Education case route. Prepare this employee individually.');
  if(appointment&&!['permanent','temporary','contract'].includes(appointment.employment_category))issues.push('Verify a supported appointment category before activating common leave.');
  // Initial Treasury temporary staff use Medical/Special only. Retain their
  // legacy Annual rows as history, without manufacturing an opening or grant.
  const enabledCodes=appointment?.employment_category==='temporary'?['medical','special']:COMMON_CODES;
  const excludedTargets=[];
  const targets=COMMON_CODES.flatMap(code=>{
   const typeIds=state.initial_setup?.mappings.filter(m=>m.code===code).map(m=>m.leave_type_id)||[];
   const sources=typeIds.flatMap(typeId=>{const rows=state.historical_balances.filter(b=>b.leave_type_id===typeId&&b.leave_type_active&&b.year<=Number(plan.cutover_date.slice(0,4)));const latest=Math.max(...rows.map(b=>b.year));return rows.filter(b=>b.year===latest);});
   if(!enabledCodes.includes(code)){
    if(sources.some(b=>units(b.pending)!==0n))issues.push(`Reconcile the retained ${code} pending reservation before consolidation.`);
    excludedTargets.push({code,reason:'Recreation is not enabled for Temporary staff in this migration. Existing Annual records are retained as history.',sources:sources.map(b=>({id:b.id,name:b.leave_type_name,year:b.year,balance:b.balance,pending:b.pending}))});
    return [];
   }
   if(!sources.length)issues.push(`No current stored ${code} credit source. Review its opening individually; an unstored default is not a carried balance.`);
   const amount=sources.reduce((n,b)=>n+units(b.balance),0n);
   if(sources.some(b=>units(b.pending)!==0n))issues.push(`Reconcile the retained ${code} pending reservation before consolidation.`);
   return [{code,amount:decimal(amount),retained_balance_ids:amount>0n?sources.map(b=>b.id):[],sources:sources.map(b=>({id:b.id,name:b.leave_type_name,year:b.year,balance:b.balance,pending:b.pending}))}];
  });
  let approvedLeave=[];
  try{
   if(plan.initial_admin_setup)approvedLeave=await approvedCarryoverPlan(client,state,plan.cutover_date,enabledCodes);
   const context={...state.context,employee:{...state.context.employee,leave_policy_regime:'government'}},migration=migrationPlan({...state,context},{cutover_date:plan.cutover_date,targets,dispositions:approvedLeave},{allowMissingPayroll:plan.initial_admin_setup===true,allowApprovedCarryover:plan.initial_admin_setup===true});
   const facts=serviceFacts(context,plan.cutover_date);
   if(facts.basis?.schedule_mode==='roster')issues.push('Use individual preparation for the reviewed roster/shift Medical rule.');
   context.entitlements=migration.targets.map(t=>({id:`preview-${t.code}`,code:t.code,balance:t.target,held:'0',available:t.target,as_of:plan.cutover_date,period_start:facts.period_start,period_end:facts.period_end,policy_version_id:t.policy_version_id,retained_credit:t.retained_transfer?.amount||'0'}));
   readyConfiguration(context,enabledCodes);const medicalHistory=cleanHistory(selected.medical_history,context,medicalRule);if(medicalHistory.filter(h=>h.uncertified).length>3)fail('Reconcile the uncertified Medical history before consolidation.');
  }catch(e){if(!e.status)throw e;issues.push(e.message);}
  employees.push({employee_id:employee.id,display_name:employee.display_name,payroll_id:state.identity?.payroll_id||null,source_hash:hash,legacy_history_hash:legacyHistoryHash,employee,route,offices,enabled_codes:enabledCodes,excluded_targets:excludedTargets,targets,approved_leave:approvedLeave,warnings,issues:[...new Set(issues)]});
 }
 return {employees,hash:fingerprint({plan,employees})};
}
function view(result){return {snapshot_hash:result.hash,total:result.employees.length,ready:result.employees.filter(e=>!e.issues.length).length,employees:result.employees.map(e=>({employee_id:e.employee_id,display_name:e.display_name,payroll_id:e.payroll_id,enabled_codes:e.enabled_codes,excluded_targets:e.excluded_targets,targets:e.targets,approved_leave:e.approved_leave,warnings:e.warnings,issues:e.issues,route:e.route.stages}))};}
export async function previewCommissioning(pool,{user,data}){
 const plan=input(data);return withTransaction(pool,async client=>{await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await assertCentral(client,user);if(plan.initial_admin_setup)await assertInitialAdmin(client,user.id);return view(await snapshot(client,plan));});
}
export async function prepareCommissioning(pool,{user,actor,data}){
 const plan=input(data);return withTransaction(pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await assertCentral(client,user);if(plan.initial_admin_setup)await assertInitialAdmin(client,user.id);const current=await snapshot(client,plan);
  if(current.hash!==data.snapshot_hash)fail('The roster or balances changed. Preview the current cohort again.');
  if(current.employees.some(e=>e.issues.length))fail('Resolve every selected employee’s preparation issues before freezing the consolidation.');
  const {rows:[row]}=await client.query('INSERT INTO hr_gov_commissioning_reviews(plan,snapshot_hash,snapshot,prepared_by) VALUES($1,$2,$3,$4) RETURNING *',[plan,current.hash,current,user.id]);
  await recordAudit({client,actor,action:'hr.gov.commissioning.prepared',entityType:'hr_gov_commissioning_reviews',entityId:row.id,after:{snapshot_hash:current.hash,employee_ids:plan.employees.map(e=>e.employee_id)}});return {id:row.id,snapshot_hash:row.snapshot_hash};
 });
}
export async function applyCommissioning(pool,{user,actor,id,data}){
 return withTransaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-gov-policies'))");
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-gov-calendars'))");
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-approval-assignments'))");await assertCentral(client,user);
  const {rows:[review]}=await client.query('SELECT * FROM hr_gov_commissioning_reviews WHERE id=$1 FOR UPDATE',[id]);if(!review)fail('Consolidation review not found.',404);
  if(data.snapshot_hash!==review.snapshot_hash)fail('Confirm the exact consolidation review.');
  const old=(await client.query('SELECT * FROM hr_gov_commissioning_receipts WHERE review_id=$1',[id])).rows[0];if(old)return old;
  const initialAdmin=review.plan.initial_admin_setup===true;
  if(initialAdmin&&review.prepared_by!==user.id)fail('The preparing administrator must apply this initial admin migration.',403);
  if(review.prepared_by===user.id&&!initialAdmin)fail('A different HR officer must certify the cohort consolidation.',403);
  if(initialAdmin)await assertInitialAdmin(client,user.id);
  const preparer=await accountState(client,review.prepared_by);if(!preparer)fail('The original preparer account is inactive.',403);await assertCentral(client,preparer.user);
  const why=data.reason;if(typeof why!=='string'||why.trim().length<10||why.length>1000)fail('Record the consolidation reason.',400);
  for(const selected of review.plan.employees)await lockEmployee(client,selected.employee_id);
  const current=await snapshot(client,review.plan);if(current.hash!==review.snapshot_hash||current.employees.some(e=>e.issues.length))fail('The roster, rules, approvals or balances changed. Prepare a fresh consolidation review.');
  const apply=async()=>{
  const result=[];
  for(const selected of review.plan.employees){
   const employeeId=selected.employee_id,source=current.employees.find(e=>e.employee_id===employeeId);
   await client.query("UPDATE hr_employees SET leave_policy_regime='government' WHERE id=$1",[employeeId]);
   const migration=await prepareMigration(pool,{client,user:preparer.user,actor:{id:review.prepared_by},employeeId,data:{...review.plan,review_id:randomUUID(),targets:source.targets,dispositions:source.approved_leave||[]}});
   await certifyMigration(pool,{client,user,actor,id:migration.id,data:{context_hash:migration.context_hash,reason:why}});
   const config=await prepareConfiguration(pool,{client,user:preparer.user,actor:{id:review.prepared_by},employeeId,data:{...review.plan,enabled_codes:source.enabled_codes,medical_rule:medicalRule,medical_history:selected.medical_history,legacy_resolution_reference:review.plan.transition_reference}});
   await publishConfiguration(pool,{client,user,actor,id:config.id,reason:why});
   const approvedLeave=await carryApprovedApplications(client,{employee:source.employee,configurationId:config.id,dispositions:source.approved_leave||[],actor,cutover:review.plan.cutover_date});
   result.push({approved_leave:approvedLeave,employee_id:employeeId,migration_id:migration.id,configuration_id:config.id,enabled_codes:source.enabled_codes,excluded_targets:source.excluded_targets,targets:source.targets.map(t=>({code:t.code,amount:t.amount}))});
  }
  const {rows:[receipt]}=await client.query('INSERT INTO hr_gov_commissioning_receipts(review_id,actor_id,reason,result) VALUES($1,$2,$3,$4) RETURNING *',[id,user.id,why.trim(),JSON.stringify(result)]);
  await recordAudit({client,actor,action:'hr.gov.commissioning.applied',entityType:'hr_gov_commissioning_reviews',entityId:id,after:{result,snapshot_hash:review.snapshot_hash,approval_mode:initialAdmin?'initial_admin_setup':'independent'}});return receipt;
  };
  return initialAdmin?withInitialAdminMigration(client,review,actor,apply):apply();
 });
}

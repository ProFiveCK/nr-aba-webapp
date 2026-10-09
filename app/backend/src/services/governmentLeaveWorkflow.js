import {divisionPlacementIssue} from './organisationHierarchy.js';
import {creditLimit} from './governmentLeaveCarryover.js';
import {initialAdminReview} from './governmentLeaveInitialAdmin.js';
import {assertDraftUsable} from './governmentLeaveDrafts.js';
import {serviceCorrectionIssue} from './employeeServiceCorrections.js';
import {assertCutoverResolved,legacyTransferFor} from './governmentLeaveCutover.js';
import {randomUUID} from 'node:crypto';
import {withTransaction} from '../lib/transaction.js';
import {ServiceError} from '../lib/serviceError.js';
import {recordAudit} from './auditService.js';
import {reviewerSummary} from './authService.js';
import {isCentralHr,canAccessEmployee,activeScopeSql} from './hrAccess.js';
import * as ledger from './governmentLeave.js';
import {COMMON_CODES,calculateEvaluation,fingerprint,dayNumber,serviceFacts,units,ENGINE_VERSION} from '../lib/governmentLeaveRules.js';
import {medicalAssessment,singleMedicalShiftCharge} from '../lib/governmentLeaveWorkflowRules.js';
import * as cases from './governmentLeaveCases.js';
import {isCase} from '../lib/governmentLeaveCaseRules.js';
import {generateGovernmentLeavePdf} from './governmentLeavePdf.js';
import {approvalRouteFor,legacyRoute} from './governmentLeaveApprovalRoutes.js';

export const today=()=>new Date(Date.now()+12*3600000).toISOString().slice(0,10);
const fail=(message,status=409)=>{throw new ServiceError(status,message);};
const reasonText=value=>{if(typeof value!=='string'||value.trim().length<10||value.length>4000)fail('Provide a reason of 10–4,000 characters.',400);return value.trim();};
const audit=(client,actor,action,id,after)=>recordAudit({client,actor,action,entityType:'hr_gov_request',entityId:id,after});
const normalizedDates="*,to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date";
export async function accountState(client,id,scope=null) {
  const {rows:[row]}=await client.query('SELECT * FROM reviewers WHERE id=$1 FOR SHARE',[id]);
  if(!row||row.status!=='active'||row.onboarding_state!=='ready')return null;
  const {rows:grants}=await client.query('SELECT capability FROM reviewer_capabilities WHERE reviewer_id=$1 FOR SHARE',[id]);
  const {rows:scopes}=await client.query(`SELECT s.* FROM hr_access_scopes s WHERE s.reviewer_id=$1 AND ${activeScopeSql()} FOR SHARE`,[id]);
  const parentId=scope?.division_id?(await client.query('SELECT parent_division_id FROM hr_divisions WHERE id=$1',[scope.division_id])).rows[0]?.parent_division_id:null;
  const permitted=scopes.filter(s=>scope&&s.department_id===scope.department_id&&(!s.division_id||s.division_id===scope.division_id||s.division_id===parentId));
  const capabilities=[...grants.map(g=>g.capability),...permitted.flatMap(s=>s.capabilities)];
  return {user:reviewerSummary({...row,permissions:{...row.permissions}},undefined,capabilities),approval:row.permissions?.hr_leave_approve!==false&&(row.permissions?.hr_leave_approve===true||capabilities.includes('hr_leave_approve'))};
}
export async function assertCentral(client,user) {
  const state=await accountState(client,user.id);
  if(!state||!isCentralHr(state.user))fail('Current central HR authority is required.',403);
}
export async function configurationFor(client,employeeId) {
  const {rows:[config]}=await client.query("SELECT *,to_char(medical_period_start,'YYYY-MM-DD') AS medical_period_start,to_char(medical_as_of,'YYYY-MM-DD') AS medical_as_of FROM hr_gov_workflow_configs WHERE employee_id=$1 AND status='published' ORDER BY approved_at DESC,id DESC LIMIT 1",[employeeId]);
  return config||null;
}
export function cleanHistory(history,context,medicalRule) {
  const medical=context.entitlements.find(e=>e.code==='medical'&&e.period_start<=today()&&e.period_end>=today());
  if(!Array.isArray(history)||history.length>50)fail('Review at most 50 historical medical absences.',400);
  return history.map(item=>{
    dayNumber(item.start_date);dayNumber(item.end_date);
    if(!medical||item.start_date<medical.period_start||item.end_date>=medical.as_of||item.end_date<item.start_date||typeof item.uncertified!=='boolean')fail('Medical baseline dates must precede the certified cutover within its service year.',400);
    if(item.uncertified&&item.start_date!==item.end_date)fail('Historical exemptions must be single calendar dates.',400);
    // Read-only historical day calculation. The cutover opening deliberately
    // cannot be spent before its as-of date; ignore only that allocation issue.
    const result=calculateEvaluation(context,{code:'medical',start_date:item.start_date,end_date:item.end_date,notice_date:today(),certificate_available:!item.uncertified,verified_single_shift_exemption:medicalRule==='single_verified_shift_nonadjacent_scheduled_days'&&item.uncertified});
    const issues=result.issues.filter(issue=>issue!=='Certified opening entitlement is missing for a charged date; forecast accrual is not spendable.');
    if(issues.length)fail(`Medical baseline needs verified historical calculation: ${issues.join(' ')}`);
    if(item.uncertified&&!(medicalRule==='single_verified_shift_nonadjacent_scheduled_days'?singleMedicalShiftCharge(context,item.start_date,result.charge):units(result.charge)===1000000n))fail('Historical exemptions must match the independently approved one-day or verified-shift charge.',400);
    return {start_date:item.start_date,end_date:item.end_date,uncertified:item.uncertified,period_start:medical.period_start,charge:result.charge,calculation:{engine_version:result.engine_version,snapshot_hash:result.snapshot_hash,charge:result.charge,segments:result.segments,policy_versions:result.policy_versions,service_bases:result.service_bases}};
  });
}
async function annualPoolIssue(client,account,history,policy) {
  if(!account)return null;
  if(history.some(h=>typeof h.charge!=='string'))return 'Review and reapprove the historical Medical charges before applying.';
  const prior=history.reduce((sum,h)=>sum+units(h.charge),0n);
  const {rows:[usage]}=await client.query("SELECT COALESCE(-SUM(amount),0)::text AS used FROM hr_gov_ledger WHERE entitlement_id=$1 AND (kind='use' OR (kind='reversal' AND reverses_id IN (SELECT id FROM hr_gov_ledger WHERE kind='use')))",[account.id]);
  if(prior+units(account.balance)+units(usage.used)>creditLimit(account,policy.rules[`${account.code}_annual_days`],prior))return `${account.code==='medical'?'Medical':'Special'} opening/corrections and recorded usage exceed the single annual pool. Reconcile the historical cutover credit before activation or further application.`;
  return null;
}
export function readyConfiguration(context,codes) {
  if(context.employee.status!=='active'||context.employee.leave_policy_regime!=='government')fail('Choose an active government employee.');
  const facts=serviceFacts(context,today());if(facts.issues.length)fail(facts.issues.join(' '));
  for(const code of codes)if(!context.entitlements.some(e=>e.code===code&&e.period_start===facts.period_start&&e.period_end===facts.period_end&&e.as_of<=today()))fail(`Certify the ${code} opening for this service year first.`);
  const policy=context.policies.find(p=>p.effective_from<=today()&&p.effective_to>=today());if(!policy)fail('Publish an effective policy first.');
  for(const code of codes){const account=context.entitlements.find(e=>e.code===code&&e.period_start===facts.period_start);const limit=policy.rules[code==='recreation'?'recreation_cap_days':`${code}_annual_days`];if(units(account.balance)>creditLimit(account,limit))fail('A balance exceeds the standard government quantum/cap. Resolve the signed transition before activation; historical balances are preserved.');}
  if(!context.calendars.some(c=>c.effective_from<=today()&&c.effective_to>=today()))fail('Publish an approved calendar first.');
}
export async function prepareConfiguration(pool,{user,actor,employeeId,data,client:existingClient=null}) {
  ledger.central(user);
  const work=async client=>{
    await assertCentral(client,user);await ledger.lockEmployee(client,employeeId);
    const context=await ledger.loadContext(client,employeeId);
    if(!Array.isArray(data.enabled_codes)||new Set(data.enabled_codes).size!==data.enabled_codes.length||data.enabled_codes.some(c=>!COMMON_CODES.includes(c)))fail('Select distinct common leave codes.',400);
    if(data.enabled_codes.length){await assertCutoverResolved(client,employeeId,{activation:true});readyConfiguration(context,data.enabled_codes);}
    const history=cleanHistory(data.medical_history||[],context,data.medical_rule),medical=context.entitlements.find(e=>e.code==='medical'&&e.period_start<=today()&&e.period_end>=today());
    for(const code of data.enabled_codes.filter(code=>['medical','special'].includes(code))) {
      const account=context.entitlements.find(e=>e.code===code&&e.period_start<=today()&&e.period_end>=today());
      const policy=context.policies.find(p=>p.effective_from<=today()&&p.effective_to>=today()),issue=await annualPoolIssue(client,account,code==='medical'?history:[],policy);
      if(issue)fail(issue);
    }
    if(history.filter(h=>h.uncertified).length>3)fail('Resolve medical history exceeding three uncertified exemptions.',400);
    if(!['single_calendar_date_nonadjacent_scheduled_days','single_verified_shift_nonadjacent_scheduled_days'].includes(data.medical_rule))fail('Explicitly approve the supported medical day and adjacency definition.',400);
    for(let i=0;i<history.length;i++)for(let j=i+1;j<history.length;j++)if(history[i].start_date<=history[j].end_date&&history[i].end_date>=history[j].start_date)fail('Resolve overlapping historical medical records.',400);
    const {rows:[row]}=await client.query(`INSERT INTO hr_gov_workflow_configs(employee_id,enabled_codes,medical_rule,medical_history,medical_period_start,medical_as_of,source_reference,legacy_resolution_reference,snapshot_hash,prepared_by,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[employeeId,data.enabled_codes,data.medical_rule,JSON.stringify(history),medical?.period_start||null,medical?.as_of||null,data.source_reference,data.legacy_resolution_reference,fingerprint(context),actor.id,reasonText(data.reason)]);
    await audit(client,actor,'hr.gov.workflow.prepared',row.id,{employee_id:employeeId,enabled_codes:row.enabled_codes});return row;
  };return existingClient?work(existingClient):withTransaction(pool,work);
}
export async function publishConfiguration(pool,{user,actor,id,reason,client:existingClient=null}) {
  ledger.central(user);
  const work=async client=>{
    await assertCentral(client,user);const {rows:[ref]}=await client.query('SELECT employee_id FROM hr_gov_workflow_configs WHERE id=$1',[id]);if(!ref)fail('Configuration not found.',404);
    await ledger.lockEmployee(client,ref.employee_id);const {rows:[row]}=await client.query('SELECT * FROM hr_gov_workflow_configs WHERE id=$1 FOR UPDATE',[id]);
    if(row.status==='published')return row;await assertDraftUsable(client,'configuration',row.id);if(row.prepared_by===actor.id&&!initialAdminReview(client,actor.id,row.employee_id))fail('A different central HR officer must approve activation.',403);
    const context=await ledger.loadContext(client,row.employee_id);if(fingerprint(context)!==row.snapshot_hash)fail('The employee foundations changed. Prepare a fresh configuration.');
    if(row.enabled_codes.length){await assertCutoverResolved(client,row.employee_id,{activation:true});readyConfiguration(context,row.enabled_codes);}
    const {rows:[after]}=await client.query("UPDATE hr_gov_workflow_configs SET status='published',approved_by=$2,approved_at=NOW() WHERE id=$1 RETURNING *",[id,actor.id]);
    await audit(client,actor,'hr.gov.workflow.published',id,{employee_id:row.employee_id,enabled_codes:row.enabled_codes,reason:reasonText(reason)});return after;
  };return existingClient?work(existingClient):withTransaction(pool,work);
}
export async function assignConsentOffice(pool,{user,actor,data}) {
  ledger.central(user);
  return withTransaction(pool,async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-approval-assignments'))");await assertCentral(client,user);
    const {rows:[employee]}=await client.query("SELECT * FROM hr_employees WHERE id=$1 AND status='active'",[data.approver_employee_id]);
    const state=employee?.reviewer_id?await accountState(client,employee.reviewer_id,{department_id:data.department_id,division_id:null}):null;
    if(!state||(data.level==='hr_verifier'?!isCentralHr(state.user):!state.approval))fail('Choose an active linked officer with the required explicit approval or central HR grant.');
    if(data.effective_to&&data.effective_to<data.effective_from)fail('Office dates are reversed.',400);
    if(['relevant_secretary','minister'].includes(data.level)&&!data.department_id||data.level==='hr_verifier'&&data.department_id)fail('Secretary is department-specific; HR verifier is government-wide.',400);
    if((await client.query("SELECT 1 FROM hr_gov_consent_offices a LEFT JOIN hr_gov_consent_withdrawals w ON w.office_id=a.id WHERE level=$1 AND department_id IS NOT DISTINCT FROM $2::uuid AND daterange(effective_from,COALESCE(w.effective_to,a.effective_to),'[]') && daterange($3,$4,'[]')",[data.level,data.department_id||null,data.effective_from,data.effective_to||null])).rowCount)fail('An effective consent office already covers these dates.');
    const {rows:[row]}=await client.query('INSERT INTO hr_gov_consent_offices(level,department_id,approver_employee_id,effective_from,effective_to,source_reference,recorded_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[data.level,data.department_id||null,employee.id,data.effective_from,data.effective_to||null,data.source_reference,actor.id,reasonText(data.reason)]);
    await audit(client,actor,'hr.gov.consent_office.assigned',row.id,row);return row;
  });
}
export async function closeConsentOffice(pool,{user,actor,id,data}) {
  ledger.central(user);
  return withTransaction(pool,async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-approval-assignments'))");await assertCentral(client,user);
    const {rows:[office]}=await client.query("SELECT *,to_char(effective_from,'YYYY-MM-DD') AS effective_from,to_char(effective_to,'YYYY-MM-DD') AS effective_to FROM hr_gov_consent_offices WHERE id=$1",[id]);
    if(!office||data.effective_to<office.effective_from||(office.effective_to&&data.effective_to>office.effective_to))fail('The closing date must shorten this appointment.');
    const {rows:[prior]}=await client.query('SELECT * FROM hr_gov_consent_withdrawals WHERE office_id=$1',[id]);if(prior)fail('The appointment already has a recorded closure.');
    const {rows:[closure]}=await client.query('INSERT INTO hr_gov_consent_withdrawals(office_id,effective_to,actor_id,reason) VALUES($1,$2,$3,$4) RETURNING *',[id,data.effective_to,actor.id,reasonText(data.reason)]);
    await audit(client,actor,'hr.gov.consent_office.closed',id,closure);return closure;
  });
}
export function routeLevels(code) {return legacyRoute(code).map(stage=>stage.level);}
export async function effectiveOffices(client,request,level) {
  const enterprise=['division','parent_division','department','chief_secretary'].includes(level),table=enterprise?'hr_approval_assignments':'(SELECT *,NULL::uuid AS division_id FROM hr_gov_consent_offices)';
  const condition="((a.level='division' AND a.department_id=$3 AND a.division_id=$4) OR (a.level='parent_division' AND a.department_id=$3 AND a.division_id=(SELECT v.parent_division_id FROM hr_divisions v WHERE v.id=$4)) OR (a.level IN ('department','relevant_secretary','minister') AND a.department_id=$3) OR (a.level IN ('chief_secretary','hr_verifier') AND a.department_id IS NULL))";
  const {rows}=await client.query(`SELECT a.*,e.reviewer_id,e.display_name AS approver_name FROM ${table} a JOIN hr_employees e ON e.id=a.approver_employee_id ${enterprise?'': 'LEFT JOIN hr_gov_consent_withdrawals w ON w.office_id=a.id'} WHERE a.level=$1 AND a.effective_from<=$2 AND (${enterprise?'a.effective_to':'COALESCE(w.effective_to,a.effective_to)'} IS NULL OR ${enterprise?'a.effective_to':'COALESCE(w.effective_to,a.effective_to)'}>=$2) AND ${condition}`,[level,today(),request.department_id,request.division_id]);
  return rows.map(r=>({...r,assignment_kind:enterprise?'enterprise':'consent'}));
}
export async function bindOffice(client,stage,office,actor,reference,reason) {
  if(!office?.reviewer_id)return null;
  const {rows:[binding]}=await client.query(`INSERT INTO hr_gov_stage_bindings(stage_id,assignment_kind,assignment_id,approver_employee_id,reviewer_id,approver_name,source_reference,recorded_by,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[stage.id,office.assignment_kind,office.id,office.approver_employee_id,office.reviewer_id,office.approver_name,reference||office.source_reference||'Verified dated enterprise office',actor.id,reason]);
  return binding;
}
export async function stagesFor(client,id) {
  const {rows}=await client.query(`SELECT s.*,to_jsonb(b) AS binding,to_jsonb(d)-'evidence_verification'-'note' AS decision FROM hr_gov_request_stages s
    LEFT JOIN LATERAL(SELECT * FROM hr_gov_stage_bindings b WHERE b.stage_id=s.id ORDER BY recorded_at DESC,id DESC LIMIT 1)b ON TRUE
    LEFT JOIN hr_gov_decisions d ON d.stage_id=s.id WHERE s.request_id=$1 ORDER BY s.ordinal`,[id]);return rows;
}
export async function bindingIssue(client,request,stage) {
  const binding=stage.binding;if(!binding)return 'HR must assign the missing officeholder.';
  const {rows:[employee]}=await client.query('SELECT reviewer_id,status FROM hr_employees WHERE id=$1',[binding.approver_employee_id]);
  if(!employee||employee.status!=='active'||employee.reviewer_id!==binding.reviewer_id)return 'The officer or verified account link changed. HR must review the assignment.';
  if(binding.approver_employee_id===request.employee_id||binding.reviewer_id===request.submitted_by)return 'Self-approval requires an authorised substitute; Chief Secretary needs a verified acting officeholder.';
  const state=await accountState(client,binding.reviewer_id,request);
  if(!state||(stage.level==='hr_verifier'?!isCentralHr(state.user):!state.approval))return 'The required officer capability is inactive or revoked.';
  const offices=await effectiveOffices(client,request,stage.level);
  if(!offices.some(o=>o.id===binding.assignment_id&&(binding.assignment_kind==='substitute'||o.approver_employee_id===binding.approver_employee_id)))return 'The dated office assignment changed. HR must explicitly rebind the pending stage.';
  return null;
}
async function medicalHistory(client,employeeId,exclude=null) {
  const {rows}=await client.query(`SELECT ${normalizedDates},to_char(${cases.effectiveEndSql()},'YYYY-MM-DD') AS end_date,medical_mode='exemption' AS uncertified,application_snapshot->'evaluation'->'segments'->0->>'service_period_start' AS period_start FROM hr_gov_requests r WHERE employee_id=$1 AND code='medical' AND status IN ('pending','approved') AND ${cases.effectiveAbsenceSql()} AND ($2::uuid IS NULL OR id<>$2)`,[employeeId,exclude]);return rows;
}
async function assess(client,employeeId,input,exclude=null,retainedConfig=null,transferRequestId=null) {
  const config=retainedConfig||await configurationFor(client,employeeId);
  const evaluation=await ledger.evaluate(client,employeeId,{...input,notice_date:input.notice_date||today(),certificate_available:input.medical_mode==='certificate',verified_single_shift_exemption:config?.medical_rule==='single_verified_shift_nonadjacent_scheduled_days'&&input.medical_mode==='exemption',justification_available:!!input.reason});
  const context=await ledger.loadContext(client,employeeId);
  const correctionIssue=await serviceCorrectionIssue(client,employeeId,config?.recorded_at);if(correctionIssue)evaluation.issues.push(correctionIssue);
  if(!config||!config.enabled_codes.includes(input.code))evaluation.issues.push('This leave type is not activated for the employee. HR must approve the reviewed configuration.');
  if(config&&input.code==='medical') {
    const medical=medicalAssessment(context,config,input,evaluation,await medicalHistory(client,employeeId,exclude));
    evaluation.issues.push(...medical.issues);evaluation.medical_exemptions_used=medical.exemptions_used;
    const account=context.entitlements.find(e=>e.id===evaluation.allocations[0]?.entitlement_id),policy=context.policies.find(p=>p.id===evaluation.segments[0]?.policy_version_id);
    const issue=policy?await annualPoolIssue(client,account,config.medical_period_start===account?.period_start?config.medical_history:[],policy):null;
    if(issue)evaluation.issues.push(issue);
  }
  if(input.code==='special') {
    const account=context.entitlements.find(e=>e.id===evaluation.allocations[0]?.entitlement_id),policy=context.policies.find(p=>p.id===evaluation.segments[0]?.policy_version_id);
    const issue=policy?await annualPoolIssue(client,account,[],policy):null;if(issue)evaluation.issues.push(issue);
  }
  if((await client.query(`SELECT 1 FROM hr_gov_requests r WHERE employee_id=$1 AND status IN ('pending','approved') AND ${cases.isAbsenceSql()} AND ${cases.effectiveAbsenceSql()} AND ($2::uuid IS NULL OR id<>$2) AND daterange(start_date,${cases.effectiveEndSql()},'[]') && daterange($3,$4,'[]')`,[employeeId,exclude,input.start_date,input.end_date])).rowCount)evaluation.issues.push('The dates overlap another submitted or granted absence.');
  const transfer=await legacyTransferFor(client,employeeId,input,transferRequestId||exclude);
  if((await client.query("SELECT 1 FROM hr_leave_applications WHERE employee_id=$1 AND status IN ('pending','approved') AND ($4::uuid IS NULL OR id<>$4) AND daterange(start_date,end_date,'[]') && daterange($2,$3,'[]')",[employeeId,input.start_date,input.end_date,transfer?.legacy_request_id||null])).rowCount)evaluation.issues.push('Historical pending/future leave overlaps these dates. HR must reconcile it before applying.');
  evaluation.issues=[...new Set(evaluation.issues)];evaluation.eligible_for_preview=!evaluation.issues.length;evaluation.submission_enabled=evaluation.eligible_for_preview;
  return {config,evaluation,context};
}
export async function previewRequest(client,user,employeeId,input) {
  const employee=await ledger.lockEmployee(client,employeeId);
  if(employee.reviewer_id!==user.id||user.permissions?.hr_leave_apply!==true)fail('Only the verified employee can apply for this record.',403);
  await assertCutoverResolved(client,employeeId);
  return (await assess(client,employeeId,input)).evaluation;
}
// Shared office locks allow unrelated employees to apply concurrently while
// dated office changes take the exclusive lock and retain a coherent route.
export async function submitRequest(pool,{user,actor,employeeId,data,documents=[],client:existingClient}) {
  const reason=reasonText(data.reason),input={code:data.code,start_date:data.start_date,end_date:data.end_date,reason,medical_mode:data.code==='medical'?data.medical_mode:'not_applicable'};
  const payloadHash=fingerprint({input,...(data.assisted_reference?{assisted_reference:data.assisted_reference}:{}),documents:documents.map(d=>({sha256:d.sha256,file_name:d.file_name,content_type:d.content_type}))});
  const work=async client=>{
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-approval-assignments'))");const employee=await ledger.lockEmployee(client,employeeId);
    const state=await accountState(client,user.id,employee);
    if(!state||!(employee.reviewer_id===user.id&&state.user.permissions.hr_leave_apply||isCentralHr(state.user)&&typeof data.assisted_reference==='string'&&data.assisted_reference.trim().length>=5))fail('Only the current verified employee may submit this application.',403);
    const {rows:[old]}=await client.query('SELECT * FROM hr_gov_requests WHERE id=$1',[data.request_id]);
    if(old){if(old.employee_id!==employeeId||old.payload_hash!==payloadHash)fail('The request key was already used for a different application.');return {id:old.id,status:old.status};}
    if(employee.reviewer_id===user.id&&!data.assisted_reference)await assertCutoverResolved(client,employeeId);
    const transfer=await legacyTransferFor(client,employeeId,input,data.request_id);if(transfer&&(!isCentralHr(state.user)||data.assisted_reference?.trim()!==transfer.source_reference))fail('The certified transfer requires central HR assisted entry with its exact signed reconciliation reference.',403);
    const {config,evaluation}=await assess(client,employeeId,input,null,null,transfer?data.request_id:null);if(!evaluation.eligible_for_preview)fail(evaluation.issues.join(' '));
    if(!employee.department_id||!employee.division_id)fail('HR must verify the department and division.');
    const placementIssue=await divisionPlacementIssue(client,employee.division_id);if(placementIssue)fail(placementIssue);
    if(input.code==='medical'&&input.medical_mode==='certificate'&&!documents.length)fail('Attach the medical certificate before submitting.',400);
    const approvalRoute=await approvalRouteFor(client,employee.department_id,input.code);
    const applicationSnapshot={approval_route:approvalRoute,assisted_by:data.assisted_reference?actor.id:null,assisted_reference:data.assisted_reference||null,regime:'government',engine_version:ENGINE_VERSION,employee:{id:employee.id,name:employee.display_name,department_id:employee.department_id,division_id:employee.division_id,department_name:employee.department_code,division_name:employee.division_code},config_id:config.id,input:{...input,notice_date:today()},evaluation};
    const external=(await client.query("SELECT external_id FROM hr_employee_external_ids WHERE employee_id=$1 AND source='techone_payroll'",[employeeId])).rows;
    applicationSnapshot.employee.payroll_id=external.length===1?external[0].external_id:null;
    await ledger.reserveEvaluation(pool,{client,employeeId,input:{...input,notice_date:today(),certificate_available:input.medical_mode==='certificate',justification_available:true},requestId:data.request_id,actor,authorize:async()=>true});
    await client.query(`INSERT INTO hr_gov_requests(id,employee_id,config_id,code,start_date,end_date,reason,medical_mode,payload_hash,application_snapshot,department_id,division_id,reservation_id,charge,submitted_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$1,$13,$14)`,[data.request_id,employeeId,config.id,input.code,input.start_date,input.end_date,reason,input.medical_mode,payloadHash,applicationSnapshot,employee.department_id,employee.division_id,evaluation.charge,actor.id]);
    const request={id:data.request_id,employee_id:employeeId,department_id:employee.department_id,division_id:employee.division_id};
    for(const [ordinal,{level,label}] of approvalRoute.stages.entries()) {
      const {rows:[stage]}=await client.query('INSERT INTO hr_gov_request_stages(request_id,ordinal,level,label) VALUES($1,$2,$3,$4) RETURNING *',[request.id,ordinal,level,label]);
      const offices=await effectiveOffices(client,request,level);if(offices.length===1)await bindOffice(client,stage,offices[0],actor,null,'Dated route snapshot at employee submission');
    }
    for(const document of documents)await client.query('INSERT INTO hr_gov_request_documents(request_id,file_name,content_type,byte_size,sha256,file_data) VALUES($1,$2,$3,$4,$5,$6)',[request.id,document.file_name,document.content_type,document.byte_size,document.sha256,document.file_data]);
    await audit(client,actor,'hr.gov.request.submitted',request.id,{employee_id:employeeId,code:input.code,charge:evaluation.charge,config_id:config.id});return {id:request.id,status:'pending'};
  };return existingClient?work(existingClient):withTransaction(pool,work);
}
export async function getRequest(client,id) {
  const {rows:[request]}=await client.query(`SELECT ${normalizedDates} FROM hr_gov_requests WHERE id=$1`,[id]);if(!request)fail('Request not found.',404);return request;
}
export async function canReadRequest(client,user,request) {
  if(await canAccessEmployee(client,user,request.employee_id,'hr_report_read',{owner:true}))return true;
  const {rows:[placement]}=await client.query('SELECT department_id,division_id,status FROM hr_employees WHERE id=$1',[request.employee_id]);
  if(!placement||placement.status!=='active'&&!request.application_snapshot.separation_case||placement.department_id!==request.department_id||placement.division_id!==request.division_id)return false;
  const stages=await stagesFor(client,request.id);
  for(const stage of stages)if(stage.binding?.reviewer_id===user.id&&!await bindingIssue(client,request,stage))return true;
  return false;
}
export async function privateRead(client,user,request) {
  return canAccessEmployee(client,user,request.employee_id,'hr_evidence_read',{owner:true});
}
export async function requestView(client,user,id) {
  const request=await getRequest(client,id);if(!await canReadRequest(client,user,request))fail('Request not found.',404);
  const stages=await stagesFor(client,id),privateAccess=await privateRead(client,user,request);
  const decisions=(await client.query('SELECT * FROM hr_gov_decisions WHERE request_id=$1 ORDER BY decided_at',[id])).rows;
  const employee=(await client.query('SELECT reviewer_id,department_id,division_id,status FROM hr_employees WHERE id=$1',[request.employee_id])).rows[0];
  const placementChanged=employee.department_id!==request.department_id||employee.division_id!==request.division_id;
  const correctionIssue=await serviceCorrectionIssue(client,request.employee_id,request.submitted_at);
  for(const stage of stages) {
    stage.issue=await bindingIssue(client,request,stage);
    if(request.status==='pending'&&correctionIssue)stage.issue=correctionIssue;
    if(placementChanged)stage.issue='Employee placement changed. HR must reconcile or cancel/resubmit; the submitted route is retained.';
    stage.can_decide=request.status==='pending'&&stage.ordinal===request.stage_index&&!stage.issue&&stage.binding?.reviewer_id===user.id&&(employee.status==='active'||request.application_snapshot.separation_case===true);
    if(stage.decision&&privateAccess)stage.decision=decisions.find(d=>d.stage_id===stage.id);
  }
  const evidenceReview=(await client.query('SELECT actor_id,recorded_at FROM hr_gov_evidence_reviews WHERE request_id=$1',[id])).rows[0]||null;
  const separateEvidence=['medical','special'].includes(request.code)&&!stages.some(s=>s.level==='hr_verifier');
  const canVerifyEvidence=separateEvidence&&!evidenceReview&&request.status==='pending'&&isCentralHr(user)&&privateAccess&&user.id!==request.submitted_by&&user.id!==employee.reviewer_id;
  const documents=privateAccess?(await client.query('SELECT id,file_name,content_type,byte_size,sha256 FROM hr_gov_request_documents WHERE request_id=$1',[id])).rows:[];
  const ack=(await client.query('SELECT reference,recorded_at FROM hr_gov_salary_acknowledgements WHERE request_id=$1',[id])).rows[0]||null;
  const caseDetails=await cases.caseView(client,user,request,privateAccess),amendment=(await client.query('SELECT request_id,effect FROM hr_gov_case_effects WHERE original_request_id=$1 ORDER BY version DESC LIMIT 1',[id])).rows[0]||null;
  return {...caseDetails,approval_route:request.application_snapshot.approval_route||null,evidence_review_required:separateEvidence,evidence_review:evidenceReview,can_verify_evidence:canVerifyEvidence,amendment:amendment?{request_id:amendment.request_id,action:amendment.effect.action,effective_end:amendment.effect.effective_end}:null,assisted_entry:!!request.application_snapshot.assisted_by,can_continue:request.status==='pending'&&isCentralHr(user),id:request.id,employee_id:request.employee_id,employee_name:request.application_snapshot.employee.name,code:request.code,start_date:request.start_date,end_date:request.end_date,charge:request.charge,status:request.status,submitted_at:request.submitted_at,completed_at:request.completed_at,stage_index:request.stage_index,stages,reason:privateAccess?request.reason:null,documents,medical_mode:request.medical_mode,private_access:privateAccess,can_cancel:request.status==='pending'&&(employee.reviewer_id===user.id||isCentralHr(user)),can_pdf:request.status==='approved'&&privateAccess,salary_acknowledgement:ack,can_ack:request.status==='approved'&&isCentralHr(user)&&!ack};
}
async function lockedRequest(client,id) {
  const ref=await getRequest(client,id);const employee=await ledger.lockEmployee(client,ref.employee_id);
  const {rows:[request]}=await client.query(`SELECT ${normalizedDates} FROM hr_gov_requests WHERE id=$1 FOR UPDATE`,[id]);return {request,employee};
}
export async function rebindStage(pool,{user,actor,id,stageId,data}) {
  ledger.central(user);
  return withTransaction(pool,async client=>{
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-approval-assignments'))");await assertCentral(client,user);
    const {request}=await lockedRequest(client,id),stage=(await stagesFor(client,id)).find(s=>s.id===stageId);
    if(!stage||stage.decision||request.status!=='pending')fail('Only an undecided pending stage can be rebound.');
    const offices=await effectiveOffices(client,request,stage.level);if(offices.length!==1)fail('Assign exactly one current dated officeholder first.');
    let office=offices[0];
    if(data.substitute_employee_id&&data.substitute_employee_id!==office.approver_employee_id) {
      if(stage.level==='chief_secretary')fail('Chief Secretary must be the verified current or acting Chief Secretary; HOD delegation cannot substitute.');
      const {rows:[substitute]}=await client.query("SELECT id,display_name,reviewer_id FROM hr_employees WHERE id=$1 AND status='active'",[data.substitute_employee_id]);
      if(!substitute?.reviewer_id)fail('Choose an active verified substitute.');
      office={...office,assignment_kind:'substitute',approver_employee_id:substitute.id,approver_name:substitute.display_name,reviewer_id:substitute.reviewer_id};
    }
    const candidate={...stage,binding:{...office,assignment_id:office.id}};
    const issue=await bindingIssue(client,request,candidate);if(issue)fail(issue);
    const binding=await bindOffice(client,stage,office,actor,data.source_reference,reasonText(data.reason));
    await audit(client,actor,'hr.gov.stage.rebound',id,{stage_id:stageId,previous_binding:stage.binding?.id||null,binding});return binding;
  });
}
async function verifyRetainedRequest(client,request,employee) {
  if(employee.status!=='active'||employee.leave_policy_regime!=='government')fail('The government employee is inactive or its regime changed.');
  if(employee.department_id!==request.department_id||employee.division_id!==request.division_id)fail('Placement changed; reconcile and cancel/resubmit without rewriting the submitted route.');
  const config=(await client.query("SELECT *,to_char(medical_period_start,'YYYY-MM-DD') AS medical_period_start FROM hr_gov_workflow_configs WHERE id=$1",[request.config_id])).rows[0];
  const {evaluation}=await assess(client,request.employee_id,request.application_snapshot.input,request.id,config);
  const issues=evaluation.issues.filter(i=>!i.includes('exceeds a certified entitlement'));
  if(issues.length)fail(issues.join(' '));
  if(fingerprint(evaluation.segments)!==fingerprint(request.application_snapshot.evaluation.segments))fail('The calculation changed. Cancel and resubmit for a new calculation and approvals.');
  return evaluation;
}
async function evidenceFacts(client,request,data) {
 if(data.evidence_reviewed!==true||typeof data.source_reference!=='string'||data.source_reference.trim().length<5||data.source_reference.length>500)fail('HR must confirm the source and evidence review.',400);
 const documents=(await client.query('SELECT sha256 FROM hr_gov_request_documents WHERE request_id=$1 ORDER BY id',[request.id])).rows.map(d=>d.sha256);
 if(request.code==='medical'&&request.medical_mode==='certificate'){
  if(!data.certificate_reviewed||!data.covers_start||!data.covers_end)fail('Verify a registered-practitioner certificate covering the complete absence.',400);
  try{dayNumber(data.covers_start);dayNumber(data.covers_end);}catch{fail('Provide valid certificate coverage dates.',400);}
  if(data.covers_start>request.start_date||data.covers_end<request.end_date||!documents.length)fail('Verify a registered-practitioner certificate covering the complete absence.',400);
 }
 if(request.code==='special'&&data.justification_accepted!==true)fail('HR must record sufficient-cause justification review.',400);
 return {source_reference:data.source_reference.trim(),certificate_reviewed:data.certificate_reviewed===true,covers_start:data.covers_start||null,covers_end:data.covers_end||null,justification_accepted:data.justification_accepted===true,document_hashes:documents,snapshot_hash:fingerprint(request.application_snapshot)};
}
export async function verifyRequestEvidence(pool,{user,actor,id,data}) {
 const reason=reasonText(data.reason);
 return withTransaction(pool,async client=>{
  await assertCentral(client,user);const {request,employee}=await lockedRequest(client,id);
  if(!await privateRead(client,user,request))fail('Personnel evidence access is required.',403);
  const stages=await stagesFor(client,id);
  if(!['medical','special'].includes(request.code)||stages.some(s=>s.level==='hr_verifier'))fail('This application does not use a separate supporting-evidence review.');
  if(request.status!=='pending')fail('This application already completed.');
  if(user.id===request.submitted_by||user.id===employee.reviewer_id)fail('A different HR officer must review the applicant’s evidence.',403);
  const verification=await evidenceFacts(client,request,data),old=(await client.query('SELECT * FROM hr_gov_evidence_reviews WHERE request_id=$1',[id])).rows[0];
  if(old){if(old.actor_id!==user.id||fingerprint(old.evidence_verification)!==fingerprint(verification)||old.reason!==reason)fail('Evidence was already verified. Cancel and resubmit to correct the application.');return {request_id:id,recorded_at:old.recorded_at};}
  await verifyRetainedRequest(client,request,employee);
  const {rows:[review]}=await client.query('INSERT INTO hr_gov_evidence_reviews(request_id,actor_id,evidence_verification,reason) VALUES($1,$2,$3,$4) RETURNING *',[id,user.id,verification,reason]);
  await audit(client,actor,'hr.gov.evidence.verified',id,{actor_id:user.id,source_reference:verification.source_reference});return {request_id:id,recorded_at:review.recorded_at};
 });
}
async function requiredEvidenceReview(client,request,stages) {
 if(stages.some(s=>s.level==='hr_verifier')){
  if(!(await client.query("SELECT 1 FROM hr_gov_decisions d JOIN hr_gov_request_stages s ON s.id=d.stage_id WHERE d.request_id=$1 AND s.level='hr_verifier' AND d.evidence_verification IS NOT NULL",[request.id])).rowCount)fail('HR evidence verification is missing.');
  return null;
 }
 if(request.code==='recreation')return null;
 const {rows:[review]}=await client.query('SELECT * FROM hr_gov_evidence_reviews WHERE request_id=$1',[request.id]);
 if(!review)fail('HR evidence verification is missing. HR must verify the supporting records before final approval.');
 const state=await accountState(client,review.actor_id,request);
 if(!state||!isCentralHr(state.user)||!await privateRead(client,state.user,request)||review.actor_id===request.submitted_by)fail('The evidence verifier’s authority changed. HR must reconcile this application.');
 if(review.evidence_verification.snapshot_hash!==fingerprint(request.application_snapshot))fail('The verified application changed. Cancel and resubmit.');
 return review;
}
export async function decideRequest(pool,{user,actor,id,data}) {
  const note=reasonText(data.note),payloadHash=fingerprint({...data,note});
  return withTransaction(pool,async client=>{
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-gov-policies'))");
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-approval-assignments'))");const {request,employee}=await lockedRequest(client,id);
    const state=await accountState(client,user.id,request);if(!state)fail('Officer account is inactive.',403);
    const {rows:[old]}=await client.query('SELECT * FROM hr_gov_decisions WHERE event_key=$1',[data.event_key]);
    if(old){if(old.request_id!==id||old.actor_id!==actor.id||old.payload_hash!==payloadHash)fail('The decision key was used for a different decision.');return {id,status:request.status};}
    if(request.status!=='pending')fail('This request already completed.');
    const stages=await stagesFor(client,id),stage=stages.find(s=>s.ordinal===request.stage_index);
    if(!stage||stage.id!==data.stage_id||stage.binding?.id!==data.binding_id)fail('The current approval stage changed. Reload the request.');
    if(stage.binding.reviewer_id!==user.id)fail('Only the assigned officer can decide this stage.',403);
    const issue=await bindingIssue(client,request,stage);if(issue)fail(issue,403);
    let currentEvaluation=null;
    if(data.decision==='approved'){const correctionIssue=await serviceCorrectionIssue(client,request.employee_id,request.submitted_at);if(correctionIssue)fail(correctionIssue);if(isCase(request.code))await cases.verifyCase(client,request,employee,{hrActor:stage.level==='hr_verifier'?user.id:null,final:stage.level==='chief_secretary',discretionConfirmed:data.discretion_confirmed===true});else currentEvaluation=await verifyRetainedRequest(client,request,employee);}
    if(stage.level==='relevant_secretary'&&request.code==='recreation'&&data.decision==='rejected'&&(!data.operational_refusal||!data.alternative_date||!data.consultation_reference))fail('Secretary refusal requires operational reasons, employee consultation and an alternative date.',400);
    let verification=null;
    if(stage.level==='hr_verifier'&&data.decision==='approved') {
      if(!data.evidence_reviewed||!data.source_reference)fail('HR must confirm the source and evidence review.',400);
      if(request.code==='medical'&&request.medical_mode==='certificate') {
        if(!data.certificate_reviewed||!data.covers_start||!data.covers_end||data.covers_start>request.start_date||data.covers_end<request.end_date)fail('Verify a registered-practitioner certificate covering the complete absence.',400);
        if(!(await client.query('SELECT 1 FROM hr_gov_request_documents WHERE request_id=$1',[id])).rowCount)fail('Medical certificate is missing.');
      }
      if(request.code==='special'&&!data.justification_accepted)fail('HR must record sufficient-cause justification review.',400);
      verification={case_determination_id:isCase(request.code)?(await cases.determinationFor(client,id))?.id:null,source_reference:data.source_reference,certificate_reviewed:data.certificate_reviewed===true,covers_start:data.covers_start||null,covers_end:data.covers_end||null,justification_accepted:data.justification_accepted===true,document_hashes:(await client.query('SELECT sha256 FROM hr_gov_request_documents WHERE request_id=$1',[id])).rows.map(r=>r.sha256)};
    }
    await client.query(`INSERT INTO hr_gov_decisions(request_id,stage_id,binding_id,event_key,payload_hash,decision,actor_id,note,evidence_verification,alternative_date,consultation_reference)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id,stage.id,stage.binding.id,data.event_key,payloadHash,data.decision,actor.id,note,verification,data.alternative_date||null,data.consultation_reference||null]);
    if(data.decision==='rejected') {
      if(request.reservation_id)await ledger.finishReservation(pool,{client,employeeId:request.employee_id,requestId:request.reservation_id,action:'released',actor,reason:note,authorize:async()=>true});
      await client.query("UPDATE hr_gov_requests SET status='rejected',completed_at=NOW() WHERE id=$1",[id]);
    }else if(stage.ordinal===stages.length-1) {
      const completed=await stagesFor(client,id);
      if(completed.some(s=>s.decision?.decision!=='approved'))fail('Every required stage must approve before the final grant.');
      for(const prior of completed){const problem=await bindingIssue(client,request,prior);if(problem)fail(problem);}
      const evidenceReview=await requiredEvidenceReview(client,request,completed);
      const caseRow=isCase(request.code)?await cases.determinationFor(client,id):null;
      const before=(await ledger.loadContext(client,request.employee_id)).entitlements;
      if(request.reservation_id)await ledger.finishReservation(pool,{client,employeeId:request.employee_id,requestId:request.reservation_id,action:'consumed',actor,reason:note,authorize:async()=>true});
      const effect=caseRow?await cases.grantCaseEffects(client,request,caseRow,actor):null;
      const after=(await ledger.loadContext(client,request.employee_id)).entitlements;
      const allocations=caseRow&&['recreation_encashment','recreation_separation'].includes(request.code)?[{entitlement_id:caseRow.determination.facts.entitlement_id,amount:caseRow.determination.benefit.requested}]:request.application_snapshot.evaluation.allocations;
      const grant={...request.application_snapshot,evidence_review:evidenceReview,...(caseRow?{case_determination:caseRow.determination,case_determination_id:caseRow.id,evaluation:caseRow.determination.evaluation,effect}:{}),id,code:request.code,start_date:request.start_date,end_date:request.end_date,reason:request.reason,charge:request.charge,submitted_at:request.submitted_at,granted_at:new Date().toISOString(),stages:completed,balances:allocations.map(a=>({entitlement_id:a.entitlement_id,before:before.find(e=>e.id===a.entitlement_id)?.balance,used:a.amount,after:after.find(e=>e.id===a.entitlement_id)?.balance}))};
      if(request.code==='medical') {
        grant.medical_mode=request.medical_mode;
        const config=(await client.query("SELECT *,to_char(medical_period_start,'YYYY-MM-DD') AS medical_period_start,to_char(medical_as_of,'YYYY-MM-DD') AS medical_as_of FROM hr_gov_workflow_configs WHERE id=$1",[request.config_id])).rows[0];
        const {governmentLeaveMedicalSummary}=await import('./governmentLeaveMedicalSummary.js');
        grant.medical_tracking=await governmentLeaveMedicalSummary(client,{employeeId:request.employee_id,context:await ledger.loadContext(client,request.employee_id),config,asOf:request.start_date,approveRequestId:id});
        const medicalPolicy=currentEvaluation.policy_versions.find(p=>p.id===currentEvaluation.segments[0]?.policy_version_id);
        grant.medical_uncertified={limit:medicalPolicy.rules.medical_uncertified_occasions,other_committed:currentEvaluation.medical_exemptions_used,
          committed_including_this_request:currentEvaluation.medical_exemptions_used+(request.medical_mode==='exemption'?1:0)};
      }
      const bytes=await generateGovernmentLeavePdf(grant);
      await client.query("UPDATE hr_gov_requests SET status='approved',completed_at=NOW(),grant_snapshot=$2,final_pdf=$3 WHERE id=$1",[id,grant,Buffer.from(bytes)]);
    }else await client.query('UPDATE hr_gov_requests SET stage_index=stage_index+1 WHERE id=$1',[id]);
    await audit(client,actor,'hr.gov.stage.decided',id,{stage_id:stage.id,binding_id:stage.binding.id,level:stage.level,decision:data.decision});
    return {id,status:(await getRequest(client,id)).status};
  });
}
export async function cancelRequest(pool,{user,actor,id,reason,client:existingClient}) {
  reason=reasonText(reason);
  const work=async client=>{
    const {request,employee}=await lockedRequest(client,id);const state=await accountState(client,user.id,employee);
    if(!state||!(employee.reviewer_id===user.id||isCentralHr(state.user)))fail('Request not found.',404);
    if(request.status==='cancelled')return {id,status:'cancelled'};
    if(request.status!=='pending')fail('A granted/rejected request needs the assisted amendment workflow.');
    if(request.reservation_id)await ledger.finishReservation(pool,{client,employeeId:request.employee_id,requestId:request.reservation_id,action:'released',actor,reason,authorize:async()=>true});
    await client.query('INSERT INTO hr_gov_request_cancellations(request_id,actor_id,reason) VALUES($1,$2,$3)',[id,actor.id,reason]);
    await client.query("UPDATE hr_gov_requests SET status='cancelled',completed_at=NOW() WHERE id=$1",[id]);
    await audit(client,actor,'hr.gov.request.cancelled',id,{reason});return {id,status:'cancelled'};
  };return existingClient?work(existingClient):withTransaction(pool,work);
}
export async function acknowledgeSalary(pool,{user,actor,id,data}) {
  return withTransaction(pool,async client=>{
    await assertCentral(client,user);const {request}=await lockedRequest(client,id);if(request.status!=='approved')fail('Chief Secretary must grant leave first.');
    const {rows:[existing]}=await client.query('SELECT * FROM hr_gov_salary_acknowledgements WHERE request_id=$1',[id]);
    if(existing){if(existing.reference!==data.reference)fail('Salary acknowledgement already has a different reference.');return existing;}
    const {rows:[ack]}=await client.query('INSERT INTO hr_gov_salary_acknowledgements(request_id,actor_id,reference,reason) VALUES($1,$2,$3,$4) RETURNING *',[id,actor.id,data.reference,reasonText(data.reason)]);
    await audit(client,actor,'hr.gov.salary.acknowledged',id,{reference:ack.reference});return ack;
  });
}

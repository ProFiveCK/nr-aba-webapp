import {withTransaction} from '../lib/transaction.js';
import {ServiceError} from '../lib/serviceError.js';
import {recordAudit} from './auditService.js';
import * as ledger from './governmentLeave.js';
import * as workflow from './governmentLeaveWorkflow.js';
import {isCentralHr} from './hrAccess.js';
import {isCase,caseLevels,caseFoundation,determineCase,FINANCIAL_CODES,NON_ABSENCE_CODES} from '../lib/governmentLeaveCaseRules.js';
import {fingerprint,units,decimal,dayNumber,isoDay,monthBoundary} from '../lib/governmentLeaveRules.js';
const fail=(message,status=409)=>{throw new ServiceError(status,message);};
const text=(value,label,min=5,max=500)=>{if(typeof value!=='string'||value.trim().length<min||value.length>max)fail(`Provide ${label} (${min}–${max} characters).`,400);return value.trim();};
const audit=(client,actor,action,id,after)=>recordAudit({client,actor,action,entityType:'hr_gov_case',entityId:id,after});
const rules=fn=>{try{return fn();}catch(e){if(e.status)throw e;fail(e.message,400);}};
export const effectiveAbsenceSql=(alias='r')=>`NOT EXISTS(SELECT 1 FROM hr_gov_case_effects ce WHERE ce.original_request_id=${alias}.id AND ce.effect->>'action'='cancel_grant')`;
export const isAbsenceSql=(alias='r')=>`${alias}.code NOT IN ('long_service','recreation_encashment','recreation_separation','amendment','attendance') AND (${alias}.code<>'furlough' OR ${alias}.start_date<>${alias}.end_date OR (SELECT cd.determination->'facts'->>'action' FROM hr_gov_case_determinations cd WHERE cd.request_id=${alias}.id ORDER BY cd.version DESC LIMIT 1)='take_leave')`;
export const effectiveEndSql=(alias='r')=>`COALESCE((SELECT (ce.effect->>'effective_end')::date FROM hr_gov_case_effects ce WHERE ce.original_request_id=${alias}.id),${alias}.end_date)`;
async function locked(client,id){const ref=await workflow.getRequest(client,id);const employee=await ledger.lockEmployee(client,ref.employee_id);const request=await workflow.getRequest(client,id);await client.query('SELECT id FROM hr_gov_requests WHERE id=$1 FOR UPDATE',[id]);return {request,employee};}
async function snapshot(client,employeeId,input){const context=await ledger.loadContext(client,employeeId);const evaluation=rules(()=>caseFoundation(context,input));return {context,evaluation};}
async function overlap(client,employeeId,input,exclude=null){
 if(NON_ABSENCE_CODES.includes(input.code))return;
 if(input.code==='furlough'&&input.start_date===input.end_date&&(!exclude||(await determinationFor(client,exclude))?.determination.facts.action!=='take_leave'))return;
 if((await client.query(`SELECT 1 FROM hr_gov_requests r WHERE r.employee_id=$1 AND r.status IN ('pending','approved') AND ($2::uuid IS NULL OR r.id<>$2) AND ${isAbsenceSql()} AND ${effectiveAbsenceSql()} AND daterange(r.start_date,${effectiveEndSql()},'[]') && daterange($3,$4,'[]')`,[employeeId,exclude,input.start_date,input.end_date])).rowCount)fail('The dates overlap another submitted or granted absence.');
 if((await client.query("SELECT 1 FROM hr_leave_applications WHERE employee_id=$1 AND status IN ('pending','approved') AND daterange(start_date,end_date,'[]') && daterange($2,$3,'[]')",[employeeId,input.start_date,input.end_date])).rowCount)fail('Reconcile overlapping historical pending or granted leave first.');
}
export async function submitCase(pool,{user,actor,employeeId,data,documents=[],client:existingClient}){
 const input={code:data.code,start_date:data.start_date,end_date:data.end_date,reason:text(data.reason,'case explanation',10,4000),event_reference:text(data.event_reference,'event reference'),related_request_id:data.related_request_id||null,assisted_reference:data.assisted_reference?text(data.assisted_reference,'employee assisted-entry authority'):null,notice_date:workflow.today()};
 const {notice_date:_notice,...stableInput}=input;const hash=fingerprint({input:stableInput,documents:documents.map(d=>({sha256:d.sha256,file_name:d.file_name}))});
 const work=async client=>{
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-approval-assignments'))");const employee=await ledger.lockEmployee(client,employeeId),state=await workflow.accountState(client,user.id,employee);
  if(!state||!(employee.reviewer_id===user.id&&state.user.permissions.hr_leave_apply||isCentralHr(state.user)&&input.assisted_reference))fail('Verified employee access or sourced central HR assisted entry is required.',403);
  if(['attendance','amendment'].includes(input.code)&&!isCentralHr(state.user))fail('Attendance determinations and amendments require central HR assisted entry.',403);
  const separationCase=employee.status!=='active'&&isCentralHr(state.user)&&['long_service','furlough','recreation_separation'].includes(input.code)&&input.start_date===input.end_date;
  if(employee.status!=='active'&&!separationCase||!employee.department_id||!employee.division_id)fail('An active employee and verified placement are required.');
  const old=(await client.query('SELECT * FROM hr_gov_requests WHERE id=$1',[data.request_id])).rows[0];if(old){const legacyHash=fingerprint({input:{...input,notice_date:old.application_snapshot.input.notice_date},documents:documents.map(d=>({sha256:d.sha256,file_name:d.file_name}))});if(old.employee_id!==employeeId||![hash,legacyHash].includes(old.payload_hash))fail('The request key was used for different facts.');return {id:old.id,status:old.status};}
  const {evaluation}=await snapshot(client,employeeId,input);await overlap(client,employeeId,input);
  if((await client.query("SELECT 1 FROM hr_gov_requests WHERE employee_id=$1 AND code=$2 AND status IN ('pending','approved') AND application_snapshot->'input'->>'event_reference'=$3",[employeeId,input.code,input.event_reference])).rowCount)fail('This event reference already has a pending or granted case.');
  if(input.related_request_id){
   const original=await workflow.getRequest(client,input.related_request_id);if(original.employee_id!==employeeId||original.status!=='approved')fail('Link an approved case for the same employee.');
   if(input.code==='amendment'&&(await client.query("SELECT 1 FROM hr_gov_case_links l JOIN hr_gov_requests r ON r.id=l.request_id WHERE l.original_request_id=$1 AND l.kind='amendment' AND r.status IN ('pending','approved')",[original.id])).rowCount)fail('An amendment is already pending or granted for this application.');
  }else if(['amendment','extended_medical_minister'].includes(input.code))fail('This case requires its original approved application.');
  const external=(await client.query("SELECT external_id FROM hr_employee_external_ids WHERE employee_id=$1 AND source='techone_payroll'",[employeeId])).rows;
  const application={separation_case:separationCase,regime:'government',engine_version:'gov-assisted-1',input,evaluation,assisted_by:input.assisted_reference?actor.id:null,employee:{id:employeeId,name:employee.display_name,department_id:employee.department_id,division_id:employee.division_id,department_name:employee.department_code,division_name:employee.division_code,payroll_id:external.length===1?external[0].external_id:null}};
  await client.query(`INSERT INTO hr_gov_requests(id,employee_id,code,start_date,end_date,reason,medical_mode,payload_hash,application_snapshot,department_id,division_id,charge,submitted_by) VALUES($1,$2,$3,$4,$5,$6,'not_applicable',$7,$8,$9,$10,0,$11)`,[data.request_id,employeeId,input.code,input.start_date,input.end_date,input.reason,hash,application,employee.department_id,employee.division_id,actor.id]);
  if(input.related_request_id)await client.query('INSERT INTO hr_gov_case_links(request_id,original_request_id,kind,recorded_by,reference) VALUES($1,$2,$3,$4,$5)',[data.request_id,input.related_request_id,input.code==='amendment'?'amendment':'medical_escalation',actor.id,input.event_reference]);
  const request={id:data.request_id,employee_id:employeeId,department_id:employee.department_id,division_id:employee.division_id};
  for(const [ordinal,level] of caseLevels(input.code).entries()){const stage=(await client.query('INSERT INTO hr_gov_request_stages(request_id,ordinal,level) VALUES($1,$2,$3) RETURNING *',[request.id,ordinal,level])).rows[0],offices=await workflow.effectiveOffices(client,request,level);if(offices.length===1)await workflow.bindOffice(client,stage,offices[0],actor,null,'Dated assisted-case route at submission');}
  await insertDocuments(client,request.id,documents);await audit(client,actor,'hr.gov.case.submitted',request.id,{employee_id:employeeId,code:input.code,assisted_reference:input.assisted_reference});return {id:request.id,status:'pending'};
 };return existingClient?work(existingClient):withTransaction(pool,work);
}
async function insertDocuments(client,id,documents){for(const d of documents)await client.query('INSERT INTO hr_gov_request_documents(request_id,file_name,content_type,byte_size,sha256,file_data) VALUES($1,$2,$3,$4,$5,$6)',[id,d.file_name,d.content_type,d.byte_size,d.sha256,d.file_data]);}
export async function addCaseDocuments(pool,{user,actor,id,documents}){return withTransaction(pool,async client=>{await workflow.assertCentral(client,user);const {request}=await locked(client,id);if(!isCase(request.code)||request.status!=='pending'||(await workflow.stagesFor(client,id)).some(s=>s.level==='hr_verifier'&&s.decision))fail('Add case evidence only before HR verification.');if(!documents.length)fail('Attach evidence.',400);if((await client.query('SELECT 1 FROM hr_gov_request_documents WHERE request_id=$1',[id])).rowCount+documents.length>12)fail('A case supports at most twelve retained evidence files.');await insertDocuments(client,id,documents);await audit(client,actor,'hr.gov.case.evidence_added',id,{hashes:documents.map(d=>d.sha256)});});}
export async function determinationFor(client,id){return (await client.query('SELECT * FROM hr_gov_case_determinations WHERE request_id=$1 ORDER BY version DESC LIMIT 1',[id])).rows[0]||null;}
async function contextHash(client,employeeId,input){const {evaluation}=await snapshot(client,employeeId,input);const documents=(await client.query('SELECT sha256 FROM hr_gov_request_documents WHERE request_id=$1 ORDER BY id',[input.request_id])).rows;return fingerprint({evaluation,documents});}
async function extendedPrerequisite(client,request,facts){
 const original=await workflow.getRequest(client,request.application_snapshot.input.related_request_id);if(facts.prior_extended_request_id!==original.id||original.code!=='extended_medical'||original.status!=='approved'||original.employee_id!==request.employee_id||original.end_date!==isoDay(dayNumber(monthBoundary(original.start_date,3))-1)||request.start_date<=original.end_date)fail('Minister escalation must follow an approved complete three-month Chief Secretary medical extension.');
 if((await client.query('SELECT 1 FROM hr_gov_case_effects WHERE original_request_id=$1',[original.id])).rowCount)fail('Reconcile the amended medical extension before escalation.');
}
async function benefitAvailable(client,request,determination){
 const {facts,benefit,evaluation}=determination;if(!benefit)return;
 if(['recreation_encashment','recreation_separation'].includes(request.code)){
  const account=(await ledger.loadContext(client,request.employee_id)).entitlements.find(e=>e.id===facts.entitlement_id&&e.code==='recreation'&&e.as_of<=request.start_date&&e.period_end>=request.start_date);if(!account||units(account.available)+units((await client.query('SELECT h.amount FROM hr_gov_case_credit_holds h JOIN hr_gov_case_determinations d ON d.id=h.determination_id WHERE h.request_id=$1 AND h.entitlement_id=$2 AND h.determination_id=(SELECT id FROM hr_gov_case_determinations WHERE request_id=$1 ORDER BY version DESC LIMIT 1)',[request.id,account?.id||null])).rows[0]?.amount||'0')<units(benefit.requested))fail('Recreation encashment exceeds available certified credit, including pending holds.');return;
 }
 const basis=(await client.query('SELECT * FROM hr_gov_benefit_bases WHERE employee_id=$1',[request.employee_id])).rows[0];
 if(basis&&basis.service_basis_id!==evaluation.service_basis_id)fail('Certified benefit service basis changed; independently reconcile the preserved benefit register before further commitments.');
 if(basis&&(basis.source_reference!==facts.prior_history_reference||units(basis.prior_units)!==units(benefit.prior)||basis.unit!==benefit.unit||basis.transition_reference!==facts.transition_resolution_reference))fail('The certified historical benefit baseline changed. Resolve it through a sourced reconciliation; do not reset prior payouts.');
 text(facts.transition_resolution_reference,'long-service/furlough transition determination');
 const used=(await client.query(`SELECT COALESCE(sum(b.units-COALESCE((e.effect->>'benefit_refund')::numeric,0)),0)::text AS total FROM hr_gov_benefit_commitments b LEFT JOIN hr_gov_case_effects e ON e.original_request_id=b.request_id WHERE b.employee_id=$1 AND b.basis_id=$2`,[request.employee_id,basis?.id||null])).rows[0].total;
 // Include reviewed pending commitments so independently verified cases cannot
 // reserve the same remaining benefit for leave and encashment.
 const pending=(await client.query(`SELECT COALESCE(sum((d.determination->'benefit'->>'requested')::numeric),0)::text AS total FROM hr_gov_requests r JOIN LATERAL(SELECT determination FROM hr_gov_case_determinations WHERE request_id=r.id ORDER BY version DESC LIMIT 1)d ON TRUE WHERE r.employee_id=$1 AND r.id<>$2 AND r.status='pending' AND r.code IN ('long_service','furlough') AND d.determination->'evaluation'->>'service_basis_id'=$3`,[request.employee_id,request.id,evaluation.service_basis_id])).rows[0].total;
 if(units(benefit.prior)+units(used)+units(pending)+units(benefit.requested)>units(benefit.gross))fail('Prior history, committed and pending benefits exceed the credited service tier.');
}
async function validateAmendment(client,request,determination){
 const {facts}=determination,original=await workflow.getRequest(client,request.application_snapshot.input.related_request_id);
 if(facts.original_request_id!==original.id||original.employee_id!==request.employee_id||original.status!=='approved'||original.code==='amendment'||(await client.query('SELECT 1 FROM hr_gov_case_effects WHERE original_request_id=$1',[original.id])).rowCount)fail('Original approved grant changed or already has an amendment.');
 if(request.start_date!==original.start_date)fail('An amendment retains the original start date.');
 if(facts.action==='shorten_grant'){if(request.end_date>=original.end_date||request.end_date<original.start_date)fail('Early return must shorten the original approved period.');if(FINANCIAL_CODES.includes(original.code)&&original.grant_snapshot?.case_determination?.facts.action!=='take_leave')fail('A financial commitment can be cancelled, not shortened as an absence.');}
 else if(request.end_date!==original.end_date)fail('Cancellation must retain the original dates.');
 if(original.code==='lwop'&&(await client.query("SELECT 1 FROM hr_gov_service_exclusions WHERE source_reference=$1",[`government-case:${original.id}`])).rowCount===0)fail('Original LWOP service exclusion is missing; reconcile first.');
}
export async function prepareDetermination(pool,{user,actor,id,data}){
 return withTransaction(pool,async client=>{
  await workflow.assertCentral(client,user);const {request}=await locked(client,id);if(!isCase(request.code)||request.status!=='pending')fail('Only pending assisted cases accept a determination.');
  if((await workflow.stagesFor(client,id)).some(s=>s.level==='hr_verifier'&&s.decision))fail('HR verification already froze this determination. Cancel/resubmit a pending case to correct it.');
  const input={...request.application_snapshot.input,request_id:id},context=await ledger.loadContext(client,request.employee_id),determination=rules(()=>determineCase(context,input,data));
  if(!['lwop','attendance','amendment'].includes(request.code)&&(await client.query('SELECT 1 FROM hr_gov_request_documents WHERE request_id=$1',[id])).rowCount===0)fail('Supporting evidence must be retained before the factual determination.');
  if(request.application_snapshot.separation_case&&['take_leave','encashment'].includes(determination.facts.action))fail('An inactive separation case requires an actual qualified cessation event.');
  if(request.code==='extended_medical_minister')await extendedPrerequisite(client,request,determination.facts);
  if(request.code==='amendment')await validateAmendment(client,request,determination);
  await benefitAvailable(client,request,determination);await parentalDuplicate(client,request,determination);
  const version=(await client.query('SELECT COALESCE(max(version),0)+1 AS value FROM hr_gov_case_determinations WHERE request_id=$1',[id])).rows[0].value;
  const row=(await client.query('INSERT INTO hr_gov_case_determinations(request_id,version,prepared_by,source_reference,evidence_reference,reason,determination,context_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id,version,actor.id,determination.source_reference,determination.evidence_reference,text(data.reason,'determination reason',10,1000),determination,await contextHash(client,request.employee_id,input)])).rows[0];if(['recreation_encashment','recreation_separation'].includes(request.code))await client.query('INSERT INTO hr_gov_case_credit_holds(determination_id,request_id,entitlement_id,amount) VALUES($1,$2,$3,$4)',[row.id,id,determination.facts.entitlement_id,determination.benefit.requested]);await audit(client,actor,'hr.gov.case.determination_prepared',id,{determination_id:row.id,version});return row;
 });
}
async function parentalDuplicate(client,request,d){if(!['maternity','paternity','adoption'].includes(request.code))return;const key=request.code==='maternity'?'expected_birth_date':'event_date',value=d.facts[key];if((await client.query(`SELECT 1 FROM hr_gov_requests r JOIN LATERAL(SELECT determination FROM hr_gov_case_determinations WHERE request_id=r.id ORDER BY version DESC LIMIT 1)d ON TRUE WHERE r.employee_id=$1 AND r.id<>$2 AND r.code=$3 AND r.status IN ('pending','approved') AND ${effectiveAbsenceSql()} AND d.determination->'facts'->>$4=$5`,[request.employee_id,request.id,request.code,key,value])).rowCount)fail('This parental event already has a reviewed pending or granted case.');}
export async function verifyCase(client,request,employee,{hrActor=null,final=false,discretionConfirmed=false}={}){
 if(employee.status!=='active'&&!request.application_snapshot.separation_case||employee.leave_policy_regime!=='government'||employee.department_id!==request.department_id||employee.division_id!==request.division_id)fail('Active government status and submitted placement must remain verified. Cancel/resubmit or use the sourced assisted continuation.');
 const {evaluation}=await snapshot(client,request.employee_id,request.application_snapshot.input);if(evaluation.snapshot_hash!==request.application_snapshot.evaluation.snapshot_hash)fail('Policy, service, calendar or roster changed; cancel/resubmit for fresh approval.');
 await overlap(client,request.employee_id,request.application_snapshot.input,request.id);
 const row=await determinationFor(client,request.id);if(!hrActor&&!final)return row;
 if(!row)fail('Prepare a sourced factual and pay determination before independent HR verification.');
 if(hrActor&&row.prepared_by===hrActor)fail('A different central HR officer must verify the case determination.',403);
 if(row.context_hash!==await contextHash(client,request.employee_id,{...request.application_snapshot.input,request_id:request.id}))fail('Case foundations or evidence changed. Prepare a fresh determination.');
 const currentContext=await ledger.loadContext(client,request.employee_id),determination=rules(()=>determineCase(currentContext,request.application_snapshot.input,{...row.determination,reason:row.reason}));
 if(request.application_snapshot.separation_case&&['take_leave','encashment'].includes(determination.facts.action))fail('An inactive separation case requires an actual qualified cessation event.');
  if(request.code==='extended_medical_minister')await extendedPrerequisite(client,request,determination.facts);
 if(request.code==='amendment')await validateAmendment(client,request,determination);
 await benefitAvailable(client,request,determination);await parentalDuplicate(client,request,determination);
 if(final&&determination.discretion.length&&!discretionConfirmed)fail('Chief Secretary must explicitly confirm the recorded discretionary late notice or extended LWOP determination.',400);
 return row;
}
export async function grantCaseEffects(client,request,row,actor){
 const d=row.determination,effects={case:true,absence:!NON_ABSENCE_CODES.includes(request.code)&&(!FINANCIAL_CODES.includes(request.code)||d.facts.action==='take_leave'),pay_segments:d.pay_segments};
 if(request.code==='lwop'){
  if((await client.query(`SELECT 1 FROM hr_gov_service_exclusions x WHERE employee_id=$1 AND NOT EXISTS(SELECT 1 FROM hr_gov_exclusion_withdrawals w WHERE w.exclusion_id=x.id) AND daterange(start_date,end_date,'[]') && daterange($2,$3,'[]')`,[request.employee_id,request.start_date,request.end_date])).rowCount)fail('Reconcile overlapping service exclusions before LWOP grant.');
  const exclusion=(await client.query("INSERT INTO hr_gov_service_exclusions(employee_id,start_date,end_date,kind,source_reference,recorded_by,reason) VALUES($1,$2,$3,'lwop',$4,$5,$6) RETURNING id",[request.employee_id,request.start_date,request.end_date,`government-case:${request.id}`,actor.id,row.reason])).rows[0];effects.service_exclusion_id=exclusion.id;
 }
 if(d.benefit){
  let basis=null;if(!['recreation_encashment','recreation_separation'].includes(request.code)){
   basis=(await client.query(`INSERT INTO hr_gov_benefit_bases(employee_id,service_basis_id,source_reference,prior_units,unit,transition_reference,request_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(employee_id,service_basis_id) DO NOTHING RETURNING *`,[request.employee_id,d.evaluation.service_basis_id,d.facts.prior_history_reference,d.benefit.prior,d.benefit.unit,d.facts.transition_resolution_reference,request.id])).rows[0]||(await client.query('SELECT * FROM hr_gov_benefit_bases WHERE employee_id=$1 AND service_basis_id=$2',[request.employee_id,d.evaluation.service_basis_id])).rows[0];
  }else await ledger.postMovement(client,{entitlementId:d.facts.entitlement_id,kind:'use',amount:decimal(-units(d.benefit.requested)),effectiveDate:request.start_date,excludeCaseRequestId:request.id,eventKey:`case-use:${request.id}`,sourceReference:`government-case:${request.id}`,actor,reason:row.reason});
  await client.query('INSERT INTO hr_gov_benefit_commitments(request_id,employee_id,basis_id,code,units,determination_id) VALUES($1,$2,$3,$4,$5,$6)',[request.id,request.employee_id,basis?.id||null,request.code,d.benefit.requested,row.id]);effects.benefit=d.benefit;
 }
 let originalId=null;
 if(request.code==='amendment'){
  originalId=d.facts.original_request_id;const original=await workflow.getRequest(client,originalId);effects.action=d.facts.action;effects.effective_end=d.facts.action==='shorten_grant'?request.end_date:original.end_date;effects.salary_correction_reference=d.facts.salary_correction_reference;effects.absence=false;
  const movements=(await client.query("SELECT *,to_char(effective_date,'YYYY-MM-DD') AS effective_date FROM hr_gov_ledger WHERE kind='use' AND (event_key LIKE $1 OR event_key=$2) ORDER BY entitlement_id",[`use:${originalId}:%`,`case-use:${originalId}`])).rows;
  for(const movement of movements){let refund=-units(movement.amount);if(d.facts.action==='shorten_grant')refund=(original.application_snapshot.evaluation.segments||[]).filter(s=>s.entitlement_id===movement.entitlement_id&&s.date>request.end_date).reduce((n,s)=>n+units(s.charge),0n);
   if(refund>0n)await ledger.postMovement(client,{entitlementId:movement.entitlement_id,kind:'reversal',amount:decimal(refund),effectiveDate:movement.effective_date,eventKey:`amendment:${request.id}:${movement.id}`,sourceReference:row.source_reference,actor,reason:row.reason,reversesId:movement.id});}
  const benefit=(await client.query('SELECT * FROM hr_gov_benefit_commitments WHERE request_id=$1',[originalId])).rows[0];
  if(benefit){if(d.facts.action==='cancel_grant')effects.benefit_refund=benefit.units;else{const originalD=original.grant_snapshot.case_determination;effects.benefit_refund=decimal(originalD.evaluation.segments.filter(s=>s.date>request.end_date).reduce((n,s)=>n+(originalD.benefit.unit==='calendar_days'?1000000n:originalD.benefit.unit==='roster_shifts'?s.scheduled_hours>0?1000000n:0n:(s.holiday?0n:units(s.charge))),0n));}}
  if(original.code==='lwop'){
   const exclusion=(await client.query('SELECT * FROM hr_gov_service_exclusions WHERE source_reference=$1',[`government-case:${originalId}`])).rows[0];
   await client.query('INSERT INTO hr_gov_exclusion_withdrawals(exclusion_id,recorded_by,source_reference,reason) VALUES($1,$2,$3,$4)',[exclusion.id,actor.id,row.source_reference,row.reason]);
   if(d.facts.action==='shorten_grant')await client.query("INSERT INTO hr_gov_service_exclusions(employee_id,start_date,end_date,kind,source_reference,recorded_by,reason) VALUES($1,$2,$3,'lwop',$4,$5,$6)",[request.employee_id,original.start_date,request.end_date,`government-case:${request.id}`,actor.id,row.reason]);
  }
  const tasks=(await client.query('SELECT id FROM hr_gov_case_tasks WHERE request_id=$1',[originalId])).rows;for(const task of tasks)await client.query("INSERT INTO hr_gov_task_events(task_id,event_key,action,reference,reason,facts,actor_id) VALUES($1,gen_random_uuid(),'completed',$2,$3,$4,$5)",[task.id,d.facts.salary_correction_reference,row.reason,{amended_by:request.id},actor.id]);
  d.tasks.push({kind:'amendment_reconciliation',due_date:null,description:'Obtain Salary Unit correction acknowledgement; original grant and PDF remain in history. Replacement dates need a fresh approved application.'});
 }
 await client.query('INSERT INTO hr_gov_case_effects(request_id,original_request_id,effect,recorded_by) VALUES($1,$2,$3,$4)',[request.id,originalId,effects,actor.id]);
 for(const task of d.tasks)await client.query('INSERT INTO hr_gov_case_tasks(request_id,kind,due_date,description,created_by) VALUES($1,$2,$3,$4,$5)',[request.id,task.kind,task.due_date,task.description,actor.id]);
 await audit(client,actor,'hr.gov.case.effects_posted',request.id,effects);return effects;
}
export async function caseView(client,user,request,privateAccess){
 if(!isCase(request.code))return {case:false};
 const row=await determinationFor(client,request.id),effect=(await client.query('SELECT effect FROM hr_gov_case_effects WHERE request_id=$1',[request.id])).rows[0]?.effect;
 const tasks=(await client.query(`SELECT t.id,t.kind,to_char(t.due_date,'YYYY-MM-DD') AS due_date,t.description,COALESCE(e.action,'open') AS status,e.reference FROM hr_gov_case_tasks t LEFT JOIN LATERAL(SELECT * FROM hr_gov_task_events e WHERE e.task_id=t.id ORDER BY e.recorded_at DESC,e.id DESC LIMIT 1)e ON TRUE WHERE t.request_id=$1 ORDER BY t.recorded_at,t.id`,[request.id])).rows;
 return {case:true,event_reference:request.application_snapshot.input.event_reference,related_request_id:request.application_snapshot.input.related_request_id,assisted_entry:!!request.application_snapshot.assisted_by,can_prepare:isCentralHr(user)&&request.status==='pending'&&!(await workflow.stagesFor(client,request.id)).some(s=>s.level==='hr_verifier'&&s.decision),determination:row?{id:row.id,prepared_by:row.prepared_by,version:row.version,source_reference:row.source_reference,pay_segments:row.determination.pay_segments,benefit:row.determination.benefit,discretion:row.determination.discretion,...(privateAccess?{facts:row.determination.facts,reason:row.reason,evidence_reference:row.evidence_reference}:{})}:null,tasks:privateAccess?tasks:tasks.map(t=>({...t,description:'Personnel follow-up is recorded by authorised HR.',reference:null})),effect:effect?{absence:effect.absence,action:effect.action,effective_end:effect.effective_end}:null,can_manage_tasks:isCentralHr(user)&&privateAccess};
}
export async function recordTaskEvent(pool,{user,actor,id,taskId,data}){
 return withTransaction(pool,async client=>{
  await workflow.assertCentral(client,user);const {request}=await locked(client,id);if(request.status!=='approved')fail('Follow-up tasks require a granted case.');
  const task=(await client.query('SELECT * FROM hr_gov_case_tasks WHERE request_id=$1 AND id=$2',[id,taskId])).rows[0];if(!task)fail('Task not found.',404);
  const reference=text(data.reference,'actual follow-up reference'),reason=text(data.reason,'follow-up reason',10,1000),facts=data.facts||{},action=data.action;
  if(!['completed','reopened','noncompletion'].includes(action))fail('Choose an allowed follow-up action.',400);
  if(JSON.stringify(facts).length>6000)fail('Follow-up facts are too large.',400);
  const old=(await client.query('SELECT * FROM hr_gov_task_events WHERE event_key=$1',[data.event_key])).rows[0];if(old){if(old.task_id!==taskId||old.actor_id!==actor.id||fingerprint({action:old.action,reference:old.reference,reason:old.reason,facts:old.facts})!==fingerprint({action,reference,reason,facts}))fail('The task event key was used differently.');return old;}
  if(action==='noncompletion'){
   if(task.kind!=='trip_outcome')fail('Non-completion applies to the official-trip outcome.',400);dayNumber(facts.trigger_date);if(facts.trigger_date>workflow.today())fail('Record an actual trip outcome date, not a future trigger.',400);text(facts.recovery_determination_reference,'allowance recovery determination');if(!/^\d{1,10}(\.\d{1,2})?$/.test(String(facts.recovery_amount)))fail('Record the reviewed full/pro-rata recovery amount.',400);
   const approved=(await determinationFor(client,id))?.determination.facts.allowance_amount;if(approved===undefined)fail('Reconcile and approve the official allowance determination before recording a recovery.');text(facts.payment_reference,'actual allowance payment reference');if(!/^\d{1,10}(\.\d{1,2})?$/.test(String(facts.paid_amount))||units(facts.paid_amount)>units(approved)||units(facts.recovery_amount)>units(facts.paid_amount))fail('Recovery cannot exceed the actual paid amount or the signed approved allowance.',400);
   const context=await ledger.loadContext(client,request.employee_id);let counted=0,due=null;for(let n=dayNumber(facts.trigger_date)+1;n<=dayNumber(facts.trigger_date)+60;n++){const date=isoDay(n),calendar=context.calendars.find(c=>c.effective_from<=date&&c.effective_to>=date);if(!calendar)fail('Gazette calendar must cover the five-working-day recovery window.');const period=context.periods.find(p=>p.start_date<=date&&(!p.end_date||p.end_date>=date));if(!period)fail('Appointment must cover the recovery window.');const basis=context.bases.filter(b=>b.effective_from<=date).at(-1);let working;if(basis?.schedule_mode==='roster'){const roster=context.rosters.find(r=>r.day===date);if(!roster)fail('Recovery window requires every rostered/off-duty date.');working=Number(roster.paid_hours)>0;}else{const pattern=context.patterns.find(p=>p.id===period.work_pattern_id);if(!pattern||!context.pattern_approvals.some(p=>p.work_pattern_id===pattern.id))fail('Recovery window needs a certified working-day definition.');working=pattern.working_weekdays.includes(new Date(n*86400000).getUTCDay()||7);}if(working&&!calendar.holidays.some(h=>h.date===date)&&++counted===5){due=date;break;}}
   if(!due)fail('Unable to establish the five-working-day recovery deadline.');
   if((await client.query("SELECT 1 FROM hr_gov_case_tasks WHERE request_id=$1 AND kind='allowance_recovery'",[id])).rowCount)fail('Allowance recovery already exists; record further evidence on that task.');
   await client.query("INSERT INTO hr_gov_case_tasks(request_id,kind,due_date,description,created_by) VALUES($1,'allowance_recovery',$2,$3,$4)",[id,due,`Return reviewed allowance ${facts.recovery_amount} AUD to HOD. Record actual receipt; return to duty as soon as practicable.`,actor.id]);
  }
  if(action==='completed'&&['allowance_recovery','witness_remittance','benefit_reconciliation','amendment_reconciliation'].includes(task.kind)){text(facts.receipt_reference,'actual receipt or Salary Unit reconciliation reference');if(!/^\d{1,10}(\.\d{1,2})?$/.test(String(facts.amount)))fail('Record the actual reconciled amount, including zero where verified.',400);}
  if(action==='completed'&&task.kind==='witness_remittance'&&facts.travel_payments_excluded!==true)fail('Witness remittance must explicitly exclude travelling allowances and expenses.',400);
  if(action==='completed'&&task.kind==='return_confirmation')text(facts.return_position_reference,'same/equivalent position and retained benefits verification');
  const row=(await client.query('INSERT INTO hr_gov_task_events(task_id,event_key,action,reference,reason,facts,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[taskId,data.event_key,action,reference,reason,facts,actor.id])).rows[0];await audit(client,actor,'hr.gov.case.task_recorded',id,{task_id:taskId,event_id:row.id,action});return row;
 });
}

export async function continueRequest(pool,{user,actor,id,data}){
 return withTransaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-approval-assignments'))");await workflow.assertCentral(client,user);const {request}=await locked(client,id);
  const existing=(await client.query('SELECT * FROM hr_gov_continuations WHERE original_request_id=$1',[id])).rows[0];if(existing){if(existing.request_id!==data.request_id||existing.actor_id!==actor.id||existing.source_reference!==data.source_reference?.trim()||existing.reason!==data.reason?.trim())fail('This original application already has a different continuation.');return {id:existing.request_id,status:(await workflow.getRequest(client,existing.request_id)).status};}
  if(request.status!=='pending')fail('Only pending applications can be continued with fresh approvals.');
  const reference=text(data.source_reference,'continuation authority'),reason=text(data.reason,'continuation reason',10,1000),documents=(await client.query('SELECT * FROM hr_gov_request_documents WHERE request_id=$1',[id])).rows;
  await workflow.cancelRequest(pool,{client,user,actor,id,reason});
  const input={...request.application_snapshot.input,request_id:data.request_id,assisted_reference:reference};
  const result=await (isCase(request.code)?submitCase:workflow.submitRequest)(pool,{client,user,actor,employeeId:request.employee_id,data:input,documents});
  // An event escalation/amendment already retains its prerequisite link. The
  // continuation relationship is separately included in the new audit entry.
  if(!input.related_request_id)await client.query("INSERT INTO hr_gov_case_links(request_id,original_request_id,kind,recorded_by,reference) VALUES($1,$2,'continuation',$3,$4)",[result.id,id,actor.id,reference]);
  await client.query('INSERT INTO hr_gov_continuations(original_request_id,request_id,actor_id,source_reference,reason) VALUES($1,$2,$3,$4,$5)',[id,result.id,actor.id,reference,reason]);
  await audit(client,actor,'hr.gov.case.continued',result.id,{original_request_id:id,reference,reason});return result;
 });
}

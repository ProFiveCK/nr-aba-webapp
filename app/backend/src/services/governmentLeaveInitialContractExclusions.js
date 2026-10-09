import {withTransaction} from '../lib/transaction.js';
import {ServiceError} from '../lib/serviceError.js';
import {fingerprint} from '../lib/governmentLeaveRules.js';
import {assertCentral,today} from './governmentLeaveWorkflow.js';
import {assertInitialAdmin} from './governmentLeaveInitialAdmin.js';
import {recordAudit} from './auditService.js';
const fail=message=>{throw new ServiceError(409,message);};
function input(data){
 if(!Array.isArray(data.employee_ids)||!data.employee_ids.length||data.employee_ids.length>50||new Set(data.employee_ids).size!==data.employee_ids.length||data.employee_ids.some(id=>! /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)))fail('Choose distinct existing employee records.');
 if(data.no_paid_leave_confirmed!==true)fail('Confirm these actual contract terms; Contract does not itself imply no leave entitlement.');
 if(typeof data.source_reference!=='string'||data.source_reference.trim().length<5||data.source_reference.length>300||typeof data.reason!=='string'||data.reason.trim().length<10||data.reason.length>1000)fail('Record the owner-confirmed initial contract correction.');
 return {...data,employee_ids:[...data.employee_ids].sort()};
}
async function snapshot(client,plan){
 const people=[];
 for(const id of plan.employee_ids){
  const employee=(await client.query('SELECT * FROM hr_employees WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!employee||employee.status!=='active'||employee.leave_policy_regime!=='legacy')fail('Initial contract corrections are limited to active staff who have not migrated.');
  const periods=(await client.query("SELECT *,to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date FROM hr_employee_service_periods WHERE employee_id=$1 ORDER BY id FOR UPDATE",[id])).rows;
  if(periods.length!==1||periods[0].end_date||periods[0].start_date>today()||periods[0].is_teacher||periods[0].is_intern||!['permanent','contract'].includes(periods[0].employment_category))fail('Review complex or differing appointments individually.');
  if(employee.ineligible_reason||employee.study_leave_start||employee.study_leave_end)fail('Retain and review the existing eligibility restriction individually.');
  const government=(await client.query(`SELECT (EXISTS(SELECT 1 FROM hr_gov_entitlements WHERE employee_id=$1)
    OR EXISTS(SELECT 1 FROM hr_gov_requests WHERE employee_id=$1)
    OR EXISTS(SELECT 1 FROM hr_gov_workflow_configs WHERE employee_id=$1)
    OR EXISTS(SELECT 1 FROM hr_gov_job_plans WHERE employee_id=$1)
    OR EXISTS(SELECT 1 FROM hr_gov_migration_reviews WHERE employee_id=$1)) AS present`,[id])).rows[0].present;
  if(government)fail('Review existing Government leave preparation individually.');
  if((await client.query("SELECT 1 FROM hr_employee_service_corrections WHERE employee_id=$1 LIMIT 1",[id])).rowCount)fail('Review the existing appointment correction history individually.');
  if((await client.query("SELECT 1 FROM hr_leave_applications WHERE employee_id=$1 AND (status='pending' OR (status='approved' AND end_date>=$2)) LIMIT 1",[id,today()])).rowCount)fail('Review existing pending or future approved leave before restricting entitlement.');
  const retained_hash=(await client.query("SELECT md5(COALESCE(string_agg(md5(to_jsonb(b)::text),'' ORDER BY b.id),'')) AS hash FROM hr_leave_balances b WHERE employee_id=$1",[id])).rows[0].hash;
  people.push({employee,period:periods[0],retained_hash});
 }
 return {people,hash:fingerprint({plan,people})};
}
export async function previewInitialContractExclusions(pool,{user,data}){
 const plan=input(data);return withTransaction(pool,async client=>{await assertCentral(client,user);await assertInitialAdmin(client,user.id);const state=await snapshot(client,plan);return {snapshot_hash:state.hash,employees:state.people.map(p=>({id:p.employee.id,name:p.employee.display_name,start_date:p.period.start_date,from:p.period.employment_category,to:'contract',leave_entitled:false}))};});
}
/** Owner-confirmed initial corrections only: retain dates, schedule and credits.
 * This deliberately scoped admin path does not alter normal two-officer corrections.
 * It is an operator service, not a public API or automatic category inference. */
export async function applyInitialContractExclusions(pool,{user,actor,data}){
 const plan=input(data);const {snapshot_hash:expected,...reviewed}=plan;
 return withTransaction(pool,async client=>{
  await assertCentral(client,user);await assertInitialAdmin(client,user.id);
  if(user.id!==actor.id)fail('Use the initial administrator’s own correction.');
  const state=await snapshot(client,reviewed);if(state.hash!==expected)fail('Initial contract records changed. Review the current facts again.');
  const result=[];
  for(const {employee,period} of state.people){
   const proposed=Object.fromEntries(['start_date','end_date','employment_category','is_teacher','is_intern','counts_for_service','work_pattern_id','appointment_reference'].map(k=>[k,k==='employment_category'?'contract':period[k]??null]));
   if(period.employment_category!=='contract'){
    const correction=(await client.query(`INSERT INTO hr_employee_service_corrections(employee_id,period_id,before_snapshot,proposed,before_hash,source_reference,prepared_by,reason,status,approved_by,approval_reason,approved_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'approved',$7,$8,NOW()) RETURNING id`,[employee.id,period.id,period,proposed,fingerprint(period),reviewed.source_reference,actor.id,reviewed.reason])).rows[0];
    await client.query("UPDATE hr_employee_service_periods SET employment_category='contract' WHERE id=$1",[period.id]);
    await recordAudit({client,actor,action:'hr.employee.service_period.corrected',entityType:'hr_employee',entityId:employee.id,before:period,after:{correction_id:correction.id,...proposed,approval_mode:'initial_admin_setup',preserved_dates_schedule_balances:true}});
   }
   await client.query('UPDATE hr_employees SET leave_entitled=FALSE,eligibility_note=$2 WHERE id=$1',[employee.id,reviewed.source_reference]);
   await recordAudit({client,actor,action:'hr.gov.initial_contract_exclusion.applied',entityType:'hr_employee',entityId:employee.id,before:{leave_entitled:employee.leave_entitled,eligibility_note:employee.eligibility_note},after:{leave_entitled:false,employment_category:'contract',source_reference:reviewed.source_reference,reason:reviewed.reason,approval_mode:'initial_admin_setup',preserved_legacy_credits:true,government_leave_activated:false}});
   result.push({employee_id:employee.id,name:employee.display_name,category:'contract',leave_entitled:false,start_date:period.start_date});
  }
  return {corrected:result};
 });
}

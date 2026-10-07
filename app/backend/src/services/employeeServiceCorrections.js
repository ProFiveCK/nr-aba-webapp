import {withTransaction} from '../lib/transaction.js';
import {ServiceError} from '../lib/serviceError.js';
import {recordAudit} from './auditService.js';
import {central,lockEmployee} from './governmentLeave.js';
import {assertCentral} from './governmentLeaveWorkflow.js';
import {managementReason} from './employeeManagement.js';
import {EMPLOYMENT_CATEGORIES} from './employeeDirectory.js';
import {dayNumber,fingerprint} from '../lib/governmentLeaveRules.js';
const fail=(message,status=409)=>{throw new ServiceError(status,message);};
export async function initEmployeeServiceCorrectionSchema(client){
 await client.query(`CREATE TABLE IF NOT EXISTS hr_employee_service_corrections (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES hr_employees(id),period_id UUID NOT NULL REFERENCES hr_employee_service_periods(id),
 before_snapshot JSONB NOT NULL,proposed JSONB NOT NULL,before_hash TEXT NOT NULL,source_reference TEXT NOT NULL,
 prepared_by UUID NOT NULL REFERENCES reviewers(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','discarded')),
 approved_by UUID REFERENCES reviewers(id),approval_reason TEXT,approved_at TIMESTAMPTZ,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_hr_service_corrections ON hr_employee_service_corrections(employee_id,approved_at DESC);
 CREATE OR REPLACE FUNCTION hr_service_correction_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status='approved' THEN RAISE EXCEPTION 'Service correction history is immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','approved_by','approval_reason','approved_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','approved_by','approval_reason','approved_at']) THEN RAISE EXCEPTION 'Prepared correction facts are immutable'; END IF;
 RETURN NEW; END $$;
 DROP TRIGGER IF EXISTS hr_service_correction_guard ON hr_employee_service_corrections;
 CREATE TRIGGER hr_service_correction_guard BEFORE UPDATE OR DELETE ON hr_employee_service_corrections FOR EACH ROW EXECUTE FUNCTION hr_service_correction_guard();`);
}
const periodSelect="SELECT *,to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date FROM hr_employee_service_periods WHERE id=$1 AND employee_id=$2";
function proposedPeriod(data){
 dayNumber(data.start_date);if(data.end_date)dayNumber(data.end_date);
 if(data.end_date&&data.end_date<data.start_date)fail('Corrected appointment dates are reversed.',400);
 if(!EMPLOYMENT_CATEGORIES.includes(data.employment_category)||typeof data.is_teacher!=='boolean'||typeof data.is_intern!=='boolean'||data.counts_for_service!==null&&typeof data.counts_for_service!=='boolean')fail('Verify employment category and service classification.',400);
 return {start_date:data.start_date,end_date:data.end_date||null,employment_category:data.employment_category,is_teacher:data.is_teacher,is_intern:data.is_intern,counts_for_service:data.counts_for_service,work_pattern_id:data.work_pattern_id||null,appointment_reference:data.appointment_reference||null};
}
async function validatePeriod(client,employeeId,periodId,p){
 if(p.work_pattern_id&&!(await client.query('SELECT 1 FROM hr_work_patterns WHERE id=$1',[p.work_pattern_id])).rowCount)fail('Choose a recorded work pattern.',400);
 if((await client.query("SELECT 1 FROM hr_employee_service_periods WHERE employee_id=$1 AND id<>$2 AND daterange(start_date,end_date,'[]') && daterange($3::date,$4::date,'[]')",[employeeId,periodId,p.start_date,p.end_date])).rowCount)fail('Corrected dates overlap another appointment. Review both periods.');
}
export async function prepareServiceCorrection(pool,{user,actor,employeeId,periodId,data}){
 central(user);const reason=managementReason(data.reason),proposed=proposedPeriod(data);
 if(typeof data.source_reference!=='string'||data.source_reference.trim().length<5||data.source_reference.length>500)fail('Record the authorised correction source.',400);
 return withTransaction(pool,async client=>{
 await assertCentral(client,user);await lockEmployee(client,employeeId);const {rows:[before]}=await client.query(periodSelect+' FOR UPDATE',[periodId,employeeId]);if(!before)fail('Appointment not found.',404);
 if(fingerprint(before)!==data.expected_hash)fail('The appointment changed. Reload before preparing a correction.');
 await validatePeriod(client,employeeId,periodId,proposed);
 if(Object.keys(proposed).every(key=>proposed[key]===(before[key]??null)))fail('There are no appointment changes to review.',400);
 const {rows:[row]}=await client.query('INSERT INTO hr_employee_service_corrections(employee_id,period_id,before_snapshot,proposed,before_hash,source_reference,prepared_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[employeeId,periodId,JSON.stringify(before),JSON.stringify(proposed),fingerprint(before),data.source_reference.trim(),actor.id,reason]);
 await recordAudit({client,actor,action:'hr.employee.service_correction.prepared',entityType:'hr_employee',entityId:employeeId,after:row});return row;
 });
}
export async function approveServiceCorrection(pool,{user,actor,id,reason}){
 central(user);const approvalReason=managementReason(reason);
 return withTransaction(pool,async client=>{
 await assertCentral(client,user);const {rows:[ref]}=await client.query('SELECT employee_id FROM hr_employee_service_corrections WHERE id=$1',[id]);if(!ref)fail('Correction not found.',404);
 await lockEmployee(client,ref.employee_id);const {rows:[row]}=await client.query('SELECT * FROM hr_employee_service_corrections WHERE id=$1 FOR UPDATE',[id]);if(row.status!=='draft')fail('Only an active correction draft can be approved.');if(row.prepared_by===actor.id)fail('A different central HR officer must approve the appointment correction.',403);
 const {rows:[before]}=await client.query(periodSelect+' FOR UPDATE',[row.period_id,row.employee_id]);if(fingerprint(before)!==row.before_hash)fail('The appointment changed. Prepare a fresh correction.');
 await validatePeriod(client,row.employee_id,row.period_id,row.proposed);const p=row.proposed;
 await client.query('UPDATE hr_employee_service_periods SET start_date=$2,end_date=$3,employment_category=$4,is_teacher=$5,is_intern=$6,counts_for_service=$7,work_pattern_id=$8,appointment_reference=$9 WHERE id=$1',[row.period_id,p.start_date,p.end_date,p.employment_category,p.is_teacher,p.is_intern,p.counts_for_service,p.work_pattern_id,p.appointment_reference]);
 const {rows:[after]}=await client.query("UPDATE hr_employee_service_corrections SET status='approved',approved_by=$2,approval_reason=$3,approved_at=NOW() WHERE id=$1 RETURNING *",[id,actor.id,approvalReason]);
 await recordAudit({client,actor,action:'hr.employee.service_period.corrected',entityType:'hr_employee',entityId:row.employee_id,before,after:{...after,preserved_balances:true,pending_applications_require_review:true}});return after;
 });
}
export async function discardServiceCorrection(pool,{user,actor,id,reason,action='discard'}){
 central(user);const verified=managementReason(reason);if(!['discard','restore'].includes(action))fail('Choose discard or restore.',400);
 return withTransaction(pool,async client=>{await assertCentral(client,user);const {rows:[ref]}=await client.query('SELECT employee_id FROM hr_employee_service_corrections WHERE id=$1',[id]);if(!ref)fail('Correction not found.',404);await lockEmployee(client,ref.employee_id);const {rows:[row]}=await client.query('SELECT * FROM hr_employee_service_corrections WHERE id=$1 FOR UPDATE',[id]);if(row.status!==(action==='discard'?'draft':'discarded'))fail('The correction state changed; approved history cannot be discarded.');
 const {rows:[after]}=await client.query('UPDATE hr_employee_service_corrections SET status=$2 WHERE id=$1 RETURNING *',[id,action==='discard'?'discarded':'draft']);await recordAudit({client,actor,action:`hr.employee.service_correction.${action}`,entityType:'hr_employee',entityId:row.employee_id,after:{id,reason:verified}});return after;});
}
export async function serviceCorrectionIssue(client,employeeId,recordedAt){
 const {rowCount}=await client.query("SELECT 1 FROM hr_employee_service_corrections WHERE employee_id=$1 AND status='approved' AND approved_at>$2::timestamptz LIMIT 1",[employeeId,recordedAt||'1970-01-01']);
 return rowCount?'Appointment facts were corrected after this review. Reconcile service and balances, prepare fresh activation/jobs and cancel/resubmit affected pending applications. Approved grants and balances are preserved.':null;
}

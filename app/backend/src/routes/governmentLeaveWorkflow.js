import express from 'express';
import {decorateDrafts} from '../services/governmentLeaveDrafts.js';
import caseRouter from './governmentLeaveCases.js';
import {effectiveAbsenceSql,effectiveEndSql} from '../services/governmentLeaveCases.js';
import {pool} from '../db.js';
import {body,param,query,handleValidation} from '../middleware/validation.js';
import {requirePermission} from '../services/authService.js';
import {PERMISSIONS} from '../config.js';
import {withTransaction} from '../lib/transaction.js';
import {ServiceError} from '../lib/serviceError.js';
import {COMMON_CODES,dayNumber} from '../lib/governmentLeaveRules.js';
import {isCentralHr,employeeReadSql,employeeScopeSql} from '../services/hrAccess.js';
import {linkedEmployee} from '../services/employeeDirectory.js';
import * as workflow from '../services/governmentLeaveWorkflow.js';
import {approvalRouteSettings,publishApprovalRoute,APPROVAL_OFFICES} from '../services/governmentLeaveApprovalRoutes.js';
import {previewCommissioning,prepareCommissioning,applyCommissioning} from '../services/governmentLeaveCommissioning.js';
import {previewInitialFoundations,applyInitialFoundations,recordInitialCredit} from '../services/governmentLeaveInitialFoundations.js';
import * as jobs from '../services/governmentLeaveJobs.js';
import { previewBalanceSetup, applyBalanceSetup } from '../services/governmentLeaveBalanceSetup.js';
import {governmentEvidenceUpload} from '../services/governmentLeaveUpload.js';
const router=express.Router();
const access=requirePermission(PERMISSIONS.HR_ACCESS,PERMISSIONS.HR_ADMIN,PERMISSIONS.HR_LEAVE_APPROVE,PERMISSIONS.HR_REPORT_READ);
const central=requirePermission(PERMISSIONS.HR_ADMIN),apply=requirePermission(PERMISSIONS.HR_LEAVE_APPLY);
router.use(access);
router.use(caseRouter);
const id=param('id').isUUID(),reason=body('reason').isString().trim().isLength({min:10,max:1000});
const reference=body('source_reference').isString().trim().isLength({min:5,max:500});
const date=name=>body(name).isString().custom(value=>{dayNumber(value);return true;});
const optionalDate=name=>body(name).optional({nullable:true,checkFalsy:true}).custom(value=>{dayNumber(value);return true;});
const actor=req=>({id:req.user.id,email:req.user.email,ip:req.ip});
const args=req=>({user:req.user,actor:actor(req),employeeId:req.params.id,id:req.params.id,data:req.body});
const input=req=>({code:req.body.code,start_date:req.body.start_date,end_date:req.body.end_date,reason:req.body.reason,medical_mode:req.body.medical_mode});
const applicationFields=[body('code').isIn(COMMON_CODES),date('start_date'),date('end_date'),body('reason').isString().trim().isLength({min:10,max:4000}),body('medical_mode').custom((value,{req})=>req.body.code==='medical'?['certificate','exemption'].includes(value):value==null||value==='not_applicable').withMessage('Choose certificate or exemption for Medical leave.')];
router.get('/me',async(req,res)=>{
  const employee=await linkedEmployee(pool,req.user.id),config=await workflow.configurationFor(pool,employee.id);
  const policy=(await pool.query(`SELECT p.id,p.label,p.rules FROM hr_gov_policy_versions p LEFT JOIN hr_gov_policy_transitions t ON t.predecessor_id=p.id WHERE p.status='published' AND p.effective_from<=$1 AND LEAST(p.effective_to,COALESCE(t.effective_from-1,p.effective_to))>=$1`,[workflow.today()])).rows[0];
  res.json({employee_id:employee.id,enabled_codes:config?.enabled_codes||[],medical_rule:config?.medical_rule||null,regime:employee.leave_policy_regime,policy:policy?{id:policy.id,label:policy.label,recreation_notice_days:policy.rules.recreation_notice_days}:null});
});
const commissioningFields=[reason,reference,date('cutover_date'),body('initial_admin_setup').optional().isBoolean({strict:true}),body('employees').isArray({min:1,max:50}),body('employees.*.employee_id').isUUID(),body('employees.*.medical_history').isArray({max:50}),body('employees.*.medical_history.*.start_date').custom(value=>{dayNumber(value);return true;}),body('employees.*.medical_history.*.end_date').custom(value=>{dayNumber(value);return true;}),body('employees.*.medical_history.*.uncertified').isBoolean(),body('history_confirmed').equals('true'),...['payroll_reference','transition_reference','history_reference'].map(name=>body(name).isString().trim().isLength({min:5,max:500}))];
router.get('/commissioning',central,async(req,res)=>{
 const {rows}=await pool.query('SELECT r.*,c.recorded_at AS applied_at FROM hr_gov_commissioning_reviews r LEFT JOIN hr_gov_commissioning_receipts c ON c.review_id=r.id ORDER BY r.recorded_at DESC,r.id DESC LIMIT 20');res.json({reviews:rows});
});
router.post('/commissioning/initial-credit',central,[body('employee_id').isUUID(),body('leave_type_id').isUUID()],async(req,res)=>{if(!handleValidation(req,res))return;res.status(201).json(await recordInitialCredit(pool,args(req)));});
router.post('/balance-setup/preview',central,async(req,res)=>{res.json(await previewBalanceSetup(pool,args(req)));});
router.post('/balance-setup/apply',central,async(req,res)=>{res.json(await applyBalanceSetup(pool,args(req)));});
router.post('/commissioning/foundations/preview',central,async(req,res)=>{res.json(await previewInitialFoundations(pool,args(req)));});
router.post('/commissioning/foundations/apply',central,async(req,res)=>{res.json(await applyInitialFoundations(pool,args(req)));});
router.post('/commissioning/preview',central,commissioningFields,async(req,res)=>{if(!handleValidation(req,res))return;res.json(await previewCommissioning(pool,args(req)));});
router.post('/commissioning',central,[...commissioningFields,body('snapshot_hash').isHexadecimal().isLength({min:64,max:64})],async(req,res)=>{if(!handleValidation(req,res))return;res.status(201).json(await prepareCommissioning(pool,args(req)));});
router.post('/commissioning/:id/apply',central,[id,reason,body('snapshot_hash').isHexadecimal().isLength({min:64,max:64})],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await applyCommissioning(pool,args(req)));});
router.get('/approval-route',central,[query('department_id').optional().isUUID()],async(req,res)=>{
 if(!handleValidation(req,res))return;res.json(await approvalRouteSettings(pool,req.query.department_id));
});
router.post('/approval-route',central,[reason,reference,body('department_id').optional({nullable:true}).isUUID(),body('expected_latest_id').optional({nullable:true}).isUUID(),body('stages').isArray({min:1,max:5}),body('stages.*.level').isIn(APPROVAL_OFFICES),body('stages.*.label').isString().trim().isLength({min:3,max:100})],async(req,res)=>{
 if(!handleValidation(req,res))return;res.status(201).json(await publishApprovalRoute(pool,args(req)));
});
router.post('/requests/:id/evidence-review',central,[id,reason,reference,body('evidence_reviewed').isBoolean(),body('certificate_reviewed').optional().isBoolean(),body('justification_accepted').optional().isBoolean(),optionalDate('covers_start'),optionalDate('covers_end')],async(req,res)=>{
 if(!handleValidation(req,res))return;res.json(await workflow.verifyRequestEvidence(pool,args(req)));
});
router.get('/administration',central,[query('employee_id').optional().isUUID()],async(req,res)=>{
  if(!handleValidation(req,res))return;const employeeId=req.query.employee_id||null;
  const configs=(await pool.query('SELECT c.*,e.display_name FROM hr_gov_workflow_configs c JOIN hr_employees e ON e.id=c.employee_id WHERE ($1::uuid IS NULL OR c.employee_id=$1) ORDER BY c.recorded_at DESC LIMIT 100',[employeeId])).rows;
  const offices=(await pool.query("SELECT a.*,e.display_name,w.office_id AS closed_office_id,to_char(a.effective_from,'YYYY-MM-DD') AS effective_from,to_char(COALESCE(w.effective_to,a.effective_to),'YYYY-MM-DD') AS effective_to FROM hr_gov_consent_offices a JOIN hr_employees e ON e.id=a.approver_employee_id LEFT JOIN hr_gov_consent_withdrawals w ON w.office_id=a.id ORDER BY a.recorded_at DESC LIMIT 100")).rows;
  const plans=(await pool.query("SELECT p.*,e.display_name,to_char(first_post_end,'YYYY-MM-DD') AS first_post_end,to_char(payroll_anchor,'YYYY-MM-DD') AS payroll_anchor FROM hr_gov_job_plans p JOIN hr_employees e ON e.id=p.employee_id WHERE ($1::uuid IS NULL OR p.employee_id=$1) ORDER BY p.recorded_at DESC LIMIT 100",[employeeId])).rows;
  const alerts=(await pool.query('SELECT j.*,e.display_name FROM hr_gov_job_posts j JOIN hr_employees e ON e.id=j.employee_id WHERE j.capped AND ($1::uuid IS NULL OR j.employee_id=$1) ORDER BY recorded_at DESC LIMIT 50',[employeeId])).rows;
  res.json({configs:await decorateDrafts(pool,'configuration',configs),offices,plans:await decorateDrafts(pool,'job',plans),alerts});
});
router.post('/employees/:id/configurations',central,[id,reason,reference,body('legacy_resolution_reference').isString().trim().isLength({min:5,max:500}),body('enabled_codes').isArray({max:3}),body('enabled_codes.*').isIn(COMMON_CODES),body('medical_rule').isIn(['single_calendar_date_nonadjacent_scheduled_days','single_verified_shift_nonadjacent_scheduled_days']),body('history_confirmed').equals('true'),body('medical_history').isArray({max:50}),body('medical_history.*.start_date').custom(value=>{dayNumber(value);return true;}),body('medical_history.*.end_date').custom(value=>{dayNumber(value);return true;}),body('medical_history.*.uncertified').isBoolean()],async(req,res)=>{if(!handleValidation(req,res))return;res.status(201).json(await workflow.prepareConfiguration(pool,args(req)));});
router.post('/configurations/:id/publish',central,[id,reason],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await workflow.publishConfiguration(pool,{...args(req),reason:req.body.reason}));});
router.get('/consent-offices',central,[query('page').optional().isInt({min:1,max:100000}),query('page_size').optional().isInt({min:1,max:50}),query('search').optional().isString().isLength({max:100}),query('department_id').optional().isUUID(),query('scope').optional().isIn(['government','department']),query('level').optional().isIn(['hr_verifier','relevant_secretary','minister']),query('timing').optional().isIn(['current','upcoming','ended'])],async(req,res)=>{
 if(!handleValidation(req,res))return;
 const page=Number(req.query.page)||1,pageSize=Number(req.query.page_size)||25;
 const filters=[req.query.search?.trim()||'',req.query.department_id||null,req.query.level||null,req.query.timing||null,req.query.scope||null];
 const from="FROM hr_gov_consent_offices a JOIN hr_employees e ON e.id=a.approver_employee_id LEFT JOIN hr_gov_consent_withdrawals w ON w.office_id=a.id LEFT JOIN hr_departments d ON d.id=a.department_id";
 const end='COALESCE(w.effective_to,a.effective_to)';
 const where=`($1='' OR position(lower($1) in lower(concat_ws(' ',e.display_name,d.name,a.source_reference)))>0) AND ($2::uuid IS NULL OR a.department_id=$2) AND ($3::text IS NULL OR a.level=$3) AND ($5::text IS NULL OR ($5='government' AND a.department_id IS NULL) OR ($5='department' AND a.department_id IS NOT NULL)) AND ($4::text IS NULL OR ($4='current' AND a.effective_from<=(NOW() AT TIME ZONE 'Pacific/Nauru')::date AND (${end} IS NULL OR ${end}>=(NOW() AT TIME ZONE 'Pacific/Nauru')::date)) OR ($4='upcoming' AND a.effective_from>(NOW() AT TIME ZONE 'Pacific/Nauru')::date) OR ($4='ended' AND ${end}<(NOW() AT TIME ZONE 'Pacific/Nauru')::date))`;
 const offices=(await pool.query(`SELECT a.*,e.display_name,d.name AS department_name,w.office_id AS closed_office_id,to_char(a.effective_from,'YYYY-MM-DD') AS effective_from,to_char(${end},'YYYY-MM-DD') AS effective_to ${from} WHERE ${where} ORDER BY a.recorded_at DESC,a.id LIMIT $6 OFFSET $7`,[...filters,pageSize,(page-1)*pageSize])).rows;
 const total=(await pool.query(`SELECT count(*)::int AS total ${from} WHERE ${where}`,filters)).rows[0].total;
 res.json({offices,total,page,page_size:pageSize});
});
router.post('/consent-offices',central,[reason,reference,body('level').isIn(['relevant_secretary','hr_verifier','minister']),body('department_id').optional({nullable:true,checkFalsy:true}).isUUID(),body('approver_employee_id').isUUID(),date('effective_from'),optionalDate('effective_to')],async(req,res)=>{if(!handleValidation(req,res))return;res.status(201).json(await workflow.assignConsentOffice(pool,args(req)));});
router.post('/consent-offices/:id/close',central,[id,reason,date('effective_to')],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await workflow.closeConsentOffice(pool,args(req)));});
router.post('/employees/:id/job-plans',central,[id,reason,reference,body('code').isIn(COMMON_CODES),body('calculation_confirmed').equals('true'),optionalDate('first_post_end'),optionalDate('payroll_anchor'),body('temporary_start').optional().isIn(['appointment','qualification'])],async(req,res)=>{if(!handleValidation(req,res))return;res.status(201).json(await jobs.prepareJobPlan(pool,args(req)));});
router.post('/job-plans/:id/approve',central,[id,reason],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await jobs.approveJobPlan(pool,{...args(req),reason:req.body.reason}));});
router.post('/employees/:id/run-jobs',central,[id,optionalDate('as_of')],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await jobs.runEmployeeJobs(pool,{...args(req),asOf:req.body.as_of||workflow.today()}));});
router.post('/preview',apply,applicationFields,async(req,res)=>{
  if(!handleValidation(req,res))return;const employee=await linkedEmployee(pool,req.user.id);
  res.json(await withTransaction(pool,client=>workflow.previewRequest(client,req.user,employee.id,input(req))));
});
router.post('/requests',apply,governmentEvidenceUpload,[...applicationFields,body('request_id').isUUID()],async(req,res)=>{
  if(!handleValidation(req,res))return;const employee=await linkedEmployee(pool,req.user.id);
  res.status(201).json(await workflow.submitRequest(pool,{...args(req),employeeId:employee.id,documents:req.governmentDocuments||[]}));
});
// Calendar exposes absence dates only; personnel reasons, files and medical
// evidence stay behind the separate request/evidence checks.
router.get('/calendar',[query('from').custom(value=>{dayNumber(value);return true;}),query('to').custom(value=>{dayNumber(value);return true;}),query('page').optional().isInt({min:1,max:10000})],async(req,res)=>{
  if(!handleValidation(req,res))return;
  if(req.query.to<req.query.from||dayNumber(req.query.to)-dayNumber(req.query.from)>62)throw new ServiceError(400,'Choose a calendar window of up to 63 days.');
  const page=Number(req.query.page)||1;
  const {rows}=await pool.query(`SELECT r.id,e.id AS employee_id,e.display_name AS employee_name,e.department_code,
    'Approved government leave' AS leave_type_name,'leave' AS kind,to_char(r.start_date,'YYYY-MM-DD') AS start_date,to_char(${effectiveEndSql()},'YYYY-MM-DD') AS end_date,r.charge AS days
    FROM hr_gov_requests r JOIN hr_employees e ON e.id=r.employee_id WHERE r.status='approved' AND ${effectiveAbsenceSql()} AND r.code NOT IN ('amendment','attendance','long_service','recreation_encashment','recreation_separation') AND (r.code<>'furlough' OR r.grant_snapshot->'case_determination'->'facts'->>'action'='take_leave') AND r.start_date<=$2 AND ${effectiveEndSql()}>=$1
    AND ${employeeReadSql(req.user,'$3','e',true)} ORDER BY r.start_date,r.id LIMIT 201 OFFSET $4`,[req.query.from,req.query.to,req.user.id,(page-1)*200]);
  res.json({entries:rows.slice(0,200),has_more:rows.length>200,page});
});
router.get('/requests',[query('page').optional().isInt({min:1,max:100000}),query('mode').optional().isIn(['mine','queue','all']),query('status').optional().isIn(['pending','approved','rejected','cancelled','all']),query('employee_id').optional().isUUID()],async(req,res)=>{
  if(!handleValidation(req,res))return;const page=Number(req.query.page)||1,mode=req.query.mode||'queue',status=req.query.status||'pending';
  if(mode==='all'&&!isCentralHr(req.user))throw new ServiceError(403,'Central HR administration is required.');
  const scope=mode==='all'?'($1::uuid IS NOT NULL)':mode==='mine'?'e.reviewer_id=$1':`(${employeeScopeSql(req.user,'hr_report_read','$1')} OR EXISTS(SELECT 1 FROM hr_gov_request_stages s JOIN LATERAL(SELECT reviewer_id FROM hr_gov_stage_bindings b WHERE b.stage_id=s.id ORDER BY recorded_at DESC,id DESC LIMIT 1)b ON TRUE WHERE s.request_id=r.id AND b.reviewer_id=$1 AND (e.status='active' OR r.application_snapshot->>'separation_case'='true') AND e.department_id=r.department_id AND e.division_id=r.division_id))`;
  const where=`${scope} AND ($2='all' OR r.status=$2) AND ($4::uuid IS NULL OR r.employee_id=$4)`;
  const {rows}=await pool.query(`SELECT r.id,r.employee_id,r.application_snapshot->'employee'->>'name' AS employee_name,r.code,to_char(r.start_date,'YYYY-MM-DD') AS start_date,to_char(r.end_date,'YYYY-MM-DD') AS end_date,r.charge,r.status,r.submitted_at,r.stage_index,s.level AS current_level,s.label AS current_label,b.approver_name AS current_approver,
    (SELECT count(*)::int FROM hr_gov_request_stages missing WHERE missing.request_id=r.id AND NOT EXISTS(SELECT 1 FROM hr_gov_stage_bindings mb WHERE mb.stage_id=missing.id)) AS unassigned_stages,
    EXISTS(SELECT 1 FROM hr_gov_salary_acknowledgements ack WHERE ack.request_id=r.id) AS salary_acknowledged
    FROM hr_gov_requests r JOIN hr_employees e ON e.id=r.employee_id LEFT JOIN hr_gov_request_stages s ON s.request_id=r.id AND s.ordinal=r.stage_index
    LEFT JOIN LATERAL(SELECT approver_name FROM hr_gov_stage_bindings b WHERE b.stage_id=s.id ORDER BY recorded_at DESC,id DESC LIMIT 1)b ON TRUE
    WHERE ${where} ORDER BY r.submitted_at DESC,r.id LIMIT 50 OFFSET $3`,[req.user.id,status,(page-1)*50,req.query.employee_id||null]);
  const count=(await pool.query(`SELECT count(*)::int AS total FROM hr_gov_requests r JOIN hr_employees e ON e.id=r.employee_id WHERE ${where} AND $3::int=0`,[req.user.id,status,0,req.query.employee_id||null])).rows[0].total;
  const requests=[];for(const row of rows){if(isCentralHr(req.user)||mode==='mine'||await workflow.canReadRequest(pool,req.user,await workflow.getRequest(pool,row.id)))requests.push(row);}
  res.json({requests,total:count,page,page_size:50});
});
router.get('/requests/:id',[id],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await workflow.requestView(pool,req.user,req.params.id));});
router.post('/requests/:id/decisions',[
  id,body('stage_id').isUUID(),body('binding_id').isUUID(),body('event_key').isUUID(),body('decision').isIn(['approved','rejected']),body('note').isString().trim().isLength({min:10,max:4000}),
  body('source_reference').optional().isString().trim().isLength({min:5,max:500}),optionalDate('covers_start'),optionalDate('covers_end'),optionalDate('alternative_date'),body('consultation_reference').optional().isString().trim().isLength({min:5,max:500}),
  ...['evidence_reviewed','certificate_reviewed','justification_accepted','operational_refusal','discretion_confirmed'].map(name=>body(name).optional().isBoolean())
],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await workflow.decideRequest(pool,args(req)));});
router.post('/requests/:id/cancel',[id,reason],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await workflow.cancelRequest(pool,{...args(req),reason:req.body.reason}));});
router.post('/requests/:id/stages/:stageId/rebind',central,[id,param('stageId').isUUID(),reason,reference,body('substitute_employee_id').optional({nullable:true,checkFalsy:true}).isUUID()],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await workflow.rebindStage(pool,{...args(req),stageId:req.params.stageId}));});
router.post('/requests/:id/salary-acknowledgement',central,[id,reason,body('reference').isString().trim().isLength({min:5,max:500})],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await workflow.acknowledgeSalary(pool,args(req)));});
router.get('/requests/:id/documents/:documentId',[id,param('documentId').isUUID()],async(req,res)=>{
  if(!handleValidation(req,res))return;const request=await workflow.getRequest(pool,req.params.id);
  if(!await workflow.canReadRequest(pool,req.user,request)||!await workflow.privateRead(pool,req.user,request))throw new ServiceError(404,'Document not found.');
  const {rows:[file]}=await pool.query('SELECT * FROM hr_gov_request_documents WHERE id=$1 AND request_id=$2',[req.params.documentId,request.id]);if(!file)throw new ServiceError(404,'Document not found.');
  res.set({'Content-Type':file.content_type,'Content-Disposition':`attachment; filename="${encodeURIComponent(file.file_name)}"`,'X-Content-Type-Options':'nosniff'}).send(file.file_data);
});
router.get('/requests/:id/pdf',[id],async(req,res)=>{
  if(!handleValidation(req,res))return;const view=await workflow.requestView(pool,req.user,req.params.id);
  if(!view.can_pdf)throw new ServiceError(404,'Granted personnel-file PDF not available.');
  const request=await workflow.getRequest(pool,req.params.id);
  res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="government-leave-${request.id}.pdf"`,'X-Content-Type-Options':'nosniff'}).send(request.final_pdf);
});
export default router;

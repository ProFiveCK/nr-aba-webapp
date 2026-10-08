import express from 'express';
import { pool } from '../db.js';
import { recordAudit } from '../services/auditService.js';
import { withTransaction } from '../lib/transaction.js';
import { ServiceError } from '../lib/serviceError.js';
import { PERMISSIONS } from '../config.js';
import { body,param,query,handleValidation } from '../middleware/validation.js';
import { requirePermission } from '../services/authService.js';
import { applyOnboarding,issueEmployeeLink,offboardEmployee,previewOnboarding,reconcileOnboarding } from '../services/employeeOnboarding.js';
const router=express.Router();
router.use(requirePermission(PERMISSIONS.HR_ADMIN));
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const provision=requirePermission(PERMISSIONS.ADMIN);
const reason=body('reason').isString().trim().isLength({min:10,max:1000});
const actor=req=>({id:req.user.id,email:req.user.email,ip:req.ip});
router.get('/batches',[query('page').optional().isInt({min:1,max:100000}),query('employee_id').optional().isUUID()],async(req,res)=>{
  if(!handleValidation(req,res))return;
  const page=Number(req.query.page)||1,employeeId=req.query.employee_id||null;
  const where='($2::uuid IS NULL OR EXISTS(SELECT 1 FROM hr_onboarding_rows selected WHERE selected.batch_id=b.id AND selected.employee_id=$2))';
  const {rows}=await pool.query(`SELECT b.*,count(r.id)::int AS employee_count FROM hr_onboarding_batches b LEFT JOIN hr_onboarding_rows r ON r.batch_id=b.id WHERE ${where}
    GROUP BY b.id ORDER BY b.prepared_at DESC,b.id LIMIT 20 OFFSET $1`,[(page-1)*20,employeeId]);
  const {rows:[count]}=await pool.query('SELECT count(*)::int AS total FROM hr_onboarding_batches b WHERE ($1::uuid IS NULL OR EXISTS(SELECT 1 FROM hr_onboarding_rows selected WHERE selected.batch_id=b.id AND selected.employee_id=$1))',[employeeId]);
  res.json({batches:rows,total:count.total,page,page_size:20});
});
router.post('/preview',[reason,body('login_mode').isIn(['email','payroll']),body('department_id').optional({nullable:true}).isUUID(),
  body('employee_ids').optional({nullable:true}).isArray({min:1,max:2000}),body('employee_ids.*').isUUID()],async(req,res)=>{
  if(!handleValidation(req,res))return;
  res.status(201).json(await previewOnboarding(pool,{departmentId:req.body.department_id||null,employeeIds:req.body.employee_ids||null,loginMode:req.body.login_mode,actor:actor(req),reason:req.body.reason}));
});
router.get('/batches/:id',[param('id').isUUID(),query('page').optional().isInt({min:1,max:100000}),query('employee_id').optional().isUUID()],async(req,res)=>{
  if(!handleValidation(req,res))return;
  const {rows:[batch]}=await pool.query('SELECT * FROM hr_onboarding_batches WHERE id=$1',[req.params.id]);
  if(!batch)return res.status(404).json({message:'Onboarding preview not found.'});
  if(req.query.employee_id){const {rows:[scope]}=await pool.query('SELECT count(*)::int AS total,count(*) FILTER(WHERE employee_id=$2)::int AS matching FROM hr_onboarding_rows WHERE batch_id=$1',[batch.id,req.query.employee_id]);if(scope.total!==1||scope.matching!==1)return res.status(409).json({message:'This is a multi-employee cohort. Review it under Settings → Employee setup before applying.'});}
  const page=Number(req.query.page)||1;
  const {rows}=await pool.query('SELECT * FROM hr_onboarding_rows WHERE batch_id=$1 ORDER BY lower(snapshot->>\'display_name\'),employee_id LIMIT 50 OFFSET $2',[batch.id,(page-1)*50]);
  const {rows:counts}=await pool.query('SELECT decision,count(*)::int AS count FROM hr_onboarding_rows WHERE batch_id=$1 GROUP BY decision',[batch.id]);
  res.json({batch,rows,counts,total:counts.reduce((n,v)=>n+v.count,0),page,page_size:50});
});
router.post('/batches/:id/rows/:rowId',[param('id').isUUID(),param('rowId').isUUID(),reason,body('decision').isIn(['link','skip']),body('reviewer_id').optional({nullable:true}).isUUID()],async(req,res)=>{
  if(!handleValidation(req,res))return;
  await reconcileOnboarding(pool,{batchId:req.params.id,rowId:req.params.rowId,decision:req.body.decision,reviewerId:req.body.reviewer_id||null,actor:actor(req),reason:req.body.reason});res.json({message:'Verification decision saved.'});
});
router.post('/batches/:id/apply',provision,[param('id').isUUID(),reason,body('confirmed').equals('true')],async(req,res)=>{
  if(!handleValidation(req,res))return;
  res.json(await applyOnboarding(pool,{batchId:req.params.id,actor:actor(req),reason:req.body.reason}));
});
router.get('/accounts',[query('page').optional().isInt({min:1,max:100000}),query('search').optional().isString().isLength({max:100}),query('employee_id').optional().isUUID()],async(req,res)=>{
  if(!handleValidation(req,res))return;
  const page=Number(req.query.page)||1,search=String(req.query.search||'').trim();
  const where="($3::uuid IS NULL OR e.id=$3) AND ($1='' OR position(lower($1) in lower(e.display_name))>0 OR r.email=$1 OR r.login_alias=$1 OR EXISTS(SELECT 1 FROM hr_employee_external_ids x WHERE x.employee_id=e.id AND x.source='techone_payroll' AND x.external_id=$1))";
  const {rows}=await pool.query(`SELECT e.id AS employee_id,e.display_name,e.status AS employee_status,r.id AS reviewer_id,r.email,r.login_alias,r.account_type,r.status AS account_status,r.onboarding_state,
    (SELECT max(t.expires_at) FROM hr_account_tokens t WHERE t.reviewer_id=r.id AND t.consumed_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>NOW()) AS link_expires_at
    FROM hr_employees e JOIN reviewers r ON r.id=e.reviewer_id WHERE ${where} ORDER BY lower(e.display_name),e.id LIMIT 50 OFFSET $2`,[search,(page-1)*50,req.query.employee_id||null]);
  const {rows:[count]}=await pool.query(`SELECT count(*)::int AS total FROM hr_employees e JOIN reviewers r ON r.id=e.reviewer_id WHERE ${where} AND $2::int=0`,[search,0,req.query.employee_id||null]);
  res.json({accounts:rows,total:count.total,page,page_size:50});
});
router.post('/employees/:id/link',provision,[param('id').isUUID(),reason,body('purpose').isIn(['activation','recovery']),body('handover').isIn(['verified_email','in_person'])],async(req,res)=>{
  if(!handleValidation(req,res))return;
  res.status(201).json(await issueEmployeeLink(pool,{employeeId:req.params.id,purpose:req.body.purpose,handover:req.body.handover,actor:actor(req),reason:req.body.reason}));
});
router.post('/employees/:id/offboard',[param('id').isUUID(),reason],async(req,res)=>{
  if(!handleValidation(req,res))return;
  res.json(await offboardEmployee(pool,{employeeId:req.params.id,actor:actor(req),reason:req.body.reason,portalAdmin:req.user.permissions?.admin===true}));
});
router.post('/employees/:id/restore',[param('id').isUUID(),reason],async(req,res)=>{
  if(!handleValidation(req,res))return;
  await withTransaction(pool,async client=>{
    const {rows:[employee]}=await client.query('SELECT id,status FROM hr_employees WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!employee)throw new ServiceError(404,'Employee not found.');
    if(employee.status!=='inactive')throw new ServiceError(409,'This employee is already active.');
    await client.query("UPDATE hr_employees SET status='active',updated_at=NOW() WHERE id=$1",[employee.id]);
    await recordAudit({client,actor:actor(req),action:'hr.employee.restored',entityType:'hr_employee',entityId:employee.id,after:{reason:req.body.reason}});
  });
  res.json({message:'Employee record restored. Linked account and previous access grants remain disabled; verify reappointment facts before activation.'});
});
router.post('/employees/:id/revoke-links',[param('id').isUUID(),reason],async(req,res)=>{
  if(!handleValidation(req,res))return;
  await withTransaction(pool,async client=>{
    const {rows:[employee]}=await client.query('SELECT id,reviewer_id FROM hr_employees WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!employee?.reviewer_id)throw new ServiceError(404,'Linked employee account not found.');
    await client.query('SELECT id FROM reviewers WHERE id=$1 FOR UPDATE',[employee.reviewer_id]);
    await client.query('UPDATE hr_account_tokens SET revoked_at=NOW() WHERE reviewer_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',[employee.reviewer_id]);
    await client.query('DELETE FROM password_reset_tokens WHERE reviewer_id=$1',[employee.reviewer_id]);
    await client.query('DELETE FROM reviewer_sessions WHERE reviewer_id=$1',[employee.reviewer_id]);
    await recordAudit({client,actor:actor(req),action:'hr.employee.links.revoked',entityType:'hr_employee',entityId:employee.id,after:{reason:req.body.reason}});
  });
  res.json({message:'Unused activation/recovery links and current sessions revoked. Account status is unchanged.'});
});
export default router;

import {decorateDrafts} from '../services/governmentLeaveDrafts.js';
import {prepareBenefitReconciliation,approveBenefitReconciliation} from '../services/governmentLeaveBenefitReconciliation.js';
import express from 'express';
import {pool} from '../db.js';
import {body,param,query,handleValidation} from '../middleware/validation.js';
import {requirePermission} from '../services/authService.js';
import {PERMISSIONS,GOVERNMENT_LEAVE_SCHEDULER_ENABLED} from '../config.js';
import {withTransaction} from '../lib/transaction.js';
import {assertCentral} from '../services/governmentLeaveWorkflow.js';
import {EVIDENCE_KEYS,previewWave,prepareWave,approveWave,prepareCoverage,approveCoverage} from '../services/governmentLeaveRollout.js';
const router=express.Router();
router.use(requirePermission(PERMISSIONS.HR_ADMIN));
const id=param('id').isUUID(),reason=body('reason').isString().trim().isLength({min:10,max:1000});
const args=req=>({user:req.user,actor:{id:req.user.id,email:req.user.email,ip:req.ip},id:req.params.id,data:req.body});
const pageValidation=query('page').optional().isInt({min:1,max:100000});
router.get('/operations',async(req,res)=>{
 const result=await withTransaction(pool,async client=>{
  await assertCentral(client,req.user);
  const totals=(await client.query(`SELECT
   (SELECT count(*)::int FROM hr_gov_requests WHERE status='pending') AS pending_requests,
   (SELECT count(*)::int FROM hr_gov_requests r WHERE status='approved' AND NOT EXISTS(SELECT 1 FROM hr_gov_salary_acknowledgements a WHERE a.request_id=r.id)) AS salary_acknowledgements_due,
   (SELECT count(*)::int FROM hr_gov_payroll_batches b WHERE NOT EXISTS(SELECT 1 FROM hr_gov_payroll_batches n WHERE n.supersedes_id=b.id) AND NOT EXISTS(SELECT 1 FROM hr_gov_payroll_receipts a WHERE a.batch_id=b.id)) AS registers_due,
   (SELECT count(*)::int FROM hr_gov_openings WHERE status='preview') AS openings_due,
   (SELECT count(*)::int FROM hr_gov_job_plans WHERE status='draft') AS job_plans_due,
   (SELECT count(*)::int FROM hr_gov_requests r JOIN hr_gov_request_stages s ON s.request_id=r.id AND s.ordinal=r.stage_index WHERE r.status='pending' AND NOT EXISTS(SELECT 1 FROM hr_gov_stage_bindings b WHERE b.stage_id=s.id)) AS missing_officeholders`)).rows[0];
  const job_runs=(await client.query('SELECT * FROM hr_gov_job_runs ORDER BY started_at DESC,id DESC LIMIT 10')).rows;
  return {totals,job_runs,evidence_keys:EVIDENCE_KEYS,schedulers:{government:GOVERNMENT_LEAVE_SCHEDULER_ENABLED,legacy:(process.env.ACCRUAL_SCHEDULER||'on').toLowerCase()!=='off'},email_configured:Boolean(process.env.SMTP_HOST),activation:'Independent per-employee configurations remain required. A cohort approval records release evidence; it does not grant access, enable leave or start jobs.'};
 });res.json(result);
});
router.get('/benefit-reconciliations',[pageValidation],async(req,res)=>{
 if(!handleValidation(req,res))return;const page=Number(req.query.page)||1;
 res.json(await withTransaction(pool,async client=>{await assertCentral(client,req.user);const reconciliations=(await client.query('SELECT r.*,a.actor_id AS approved_by FROM hr_gov_benefit_reconciliations r LEFT JOIN hr_gov_benefit_reconciliation_approvals a ON a.reconciliation_id=r.id ORDER BY r.recorded_at DESC,r.id DESC LIMIT 50 OFFSET $1',[(page-1)*50])).rows;return {reconciliations:await decorateDrafts(client,'benefit_reconciliation',reconciliations),total:(await client.query('SELECT count(*)::int AS total FROM hr_gov_benefit_reconciliations')).rows[0].total};}));
});
router.post('/benefit-reconciliations',[body('reconciliation_id').isUUID(),body('employee_id').isUUID(),body('prior_units').isString().matches(/^\d{1,10}(\.\d{1,6})?$/),body('history_reference').isString().trim().isLength({min:5,max:1000}),body('transition_reference').isString().trim().isLength({min:5,max:1000}),body('source_reference').isString().trim().isLength({min:5,max:1000}),reason],async(req,res)=>{if(!handleValidation(req,res))return;res.status(201).json(await prepareBenefitReconciliation(pool,args(req)));});
router.post('/benefit-reconciliations/:id/approve',[id,reason,body('snapshot_hash').isHexadecimal().isLength({min:64,max:64})],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await approveBenefitReconciliation(pool,args(req)));});
router.get('/coverage',[pageValidation],async(req,res)=>{
 if(!handleValidation(req,res))return;const page=Number(req.query.page)||1;
 res.json(await withTransaction(pool,async client=>{await assertCentral(client,req.user);const coverage=(await client.query("SELECT c.*,a.actor_id AS approved_by,to_char(c.effective_from,'YYYY-MM-DD') AS effective_from,to_char(c.effective_to,'YYYY-MM-DD') AS effective_to FROM hr_gov_assisted_coverage c LEFT JOIN hr_gov_assisted_coverage_approvals a ON a.coverage_id=c.id ORDER BY c.recorded_at DESC,c.id DESC LIMIT 50 OFFSET $1",[(page-1)*50])).rows;const total=(await client.query('SELECT count(*)::int AS total FROM hr_gov_assisted_coverage')).rows[0].total;return {coverage:await decorateDrafts(client,'coverage',coverage),total,page,page_size:50};}));
});
router.post('/coverage',[body('coverage_id').isUUID(),body('label').isString().trim().isLength({min:5,max:500}),body('employee_ids').isArray({min:1,max:50}),body('employee_ids.*').isUUID(),body('effective_from').isISO8601({strict:true}),body('effective_to').isISO8601({strict:true}),body('source_reference').isString().trim().isLength({min:5,max:500}),reason],async(req,res)=>{if(!handleValidation(req,res))return;res.status(201).json(await prepareCoverage(pool,args(req)));});
router.post('/coverage/:id/approve',[id,reason,body('snapshot_hash').isHexadecimal().isLength({min:64,max:64})],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await approveCoverage(pool,args(req)));});
router.post('/preview',[body('employee_ids').isArray({min:1,max:50}),body('employee_ids.*').isUUID()],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await previewWave(pool,req.user,req.body.employee_ids));});
router.get('/waves',[pageValidation],async(req,res)=>{
 if(!handleValidation(req,res))return;const page=Number(req.query.page)||1;
 res.json(await withTransaction(pool,async client=>{await assertCentral(client,req.user);const waves=(await client.query("SELECT w.id,w.label,w.kind,w.prepared_by,w.snapshot_hash,w.snapshot->>'as_of' AS as_of,(w.snapshot->>'ready')::int AS ready,cardinality(w.employee_ids) AS total,w.recorded_at,a.actor_id AS approved_by FROM hr_gov_rollout_waves w LEFT JOIN hr_gov_rollout_approvals a ON a.wave_id=w.id ORDER BY w.recorded_at DESC,w.id LIMIT 50 OFFSET $1",[(page-1)*50])).rows;const total=(await client.query('SELECT count(*)::int AS total FROM hr_gov_rollout_waves')).rows[0].total;return {waves,total,page,page_size:50};}));
});
router.post('/waves',[body('wave_id').isUUID(),body('label').isString().trim().isLength({min:5,max:500}),body('kind').isIn(['rehearsal','pilot','department']),body('employee_ids').isArray({min:1,max:50}),body('employee_ids.*').isUUID(),body('payroll_batch_ids').isArray({min:2,max:2}),body('payroll_batch_ids.*').isUUID(),body('evidence').isObject(),body('source_reference').isString().trim().isLength({min:5,max:500}),reason],async(req,res)=>{if(!handleValidation(req,res))return;res.status(201).json(await prepareWave(pool,args(req)));});
router.get('/waves/:id/export',[id],async(req,res)=>{
 if(!handleValidation(req,res))return;
 const wave=await withTransaction(pool,async client=>{await assertCentral(client,req.user);return (await client.query('SELECT w.*,to_jsonb(a) AS approval FROM hr_gov_rollout_waves w LEFT JOIN hr_gov_rollout_approvals a ON a.wave_id=w.id WHERE w.id=$1',[req.params.id])).rows[0];});
 if(!wave)return res.status(404).json({message:'Cohort review not found.'});
 res.set({'Content-Disposition':`attachment; filename="leave-cohort-${wave.id}.json"`,'X-Content-Type-Options':'nosniff'}).json(wave);
});
router.post('/waves/:id/approve',[id,reason,body('snapshot_hash').isHexadecimal().isLength({min:64,max:64})],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await approveWave(pool,args(req)));});
export default router;

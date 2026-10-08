import {governmentEvidenceUpload} from '../services/governmentLeaveUpload.js';
import express from 'express';
import {pool} from '../db.js';
import {body,param,query,handleValidation} from '../middleware/validation.js';
import {requirePermission} from '../services/authService.js';
import {PERMISSIONS} from '../config.js';
import {dayNumber} from '../lib/governmentLeaveRules.js';
import {withTransaction} from '../lib/transaction.js';
import {assertCentral} from '../services/governmentLeaveWorkflow.js';
import * as service from '../services/governmentLeavePayroll.js';
import {payrollCsv} from '../lib/governmentLeavePayrollRules.js';
const router=express.Router();
router.use(requirePermission(PERMISSIONS.HR_ADMIN));
const id=param('id').isUUID(),why=body('reason').isString().trim().isLength({min:10,max:1000});
const date=name=>body(name).isString().custom(v=>{dayNumber(v);return true;});
const reference=name=>body(name).isString().trim().isLength({min:5,max:500});
const args=req=>({user:req.user,actor:{id:req.user.id,email:req.user.email,ip:req.ip},data:req.body,id:req.params.id,employeeId:req.params.id});
router.get('/registers',[query('page').optional().isInt({min:1,max:100000})],async(req,res)=>{
 if(!handleValidation(req,res))return;const page=Number(req.query.page)||1;
 const result=await withTransaction(pool,async client=>{await assertCentral(client,req.user);const rows=(await client.query(`SELECT b.id,to_char(b.period_start,'YYYY-MM-DD') AS period_start,to_char(b.period_end,'YYYY-MM-DD') AS period_end,b.version,b.supersedes_id,b.prepared_by,b.snapshot_hash,b.recorded_at,
 jsonb_array_length(b.snapshot->'lines') AS line_count,jsonb_array_length(b.snapshot->'changes') AS change_count,a.reference AS receipt_reference,
 NOT EXISTS(SELECT 1 FROM hr_gov_payroll_batches n WHERE n.supersedes_id=b.id) AS latest
 FROM hr_gov_payroll_batches b LEFT JOIN hr_gov_payroll_receipts a ON a.batch_id=b.id ORDER BY b.recorded_at DESC,b.id LIMIT 50 OFFSET $1`,[(page-1)*50])).rows;
 const total=(await client.query('SELECT count(*)::int AS total FROM hr_gov_payroll_batches')).rows[0].total;return {registers:rows,total,page,page_size:50};});res.json(result);
});
router.get('/register-preview',[query('period_start').custom(v=>{dayNumber(v);return true;}),query('period_end').custom(v=>{dayNumber(v);return true;})],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await service.previewPayroll(pool,req.user,req.query));});
router.post('/registers',[body('batch_id').isUUID(),date('period_start'),date('period_end'),reference('source_reference'),why,body('payroll_ids').optional().isObject()],async(req,res)=>{if(!handleValidation(req,res))return;res.status(201).json(await service.preparePayroll(pool,args(req)));});
router.get('/registers/:id',[id],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await service.payrollView(pool,req.user,req.params.id));});
router.get('/registers/:id/export',[id,query('format').optional().isIn(['json','csv','corrections'])],async(req,res)=>{
 if(!handleValidation(req,res))return;const batch=await service.payrollView(pool,req.user,req.params.id),format=req.query.format||'json';
 res.set({'X-Content-Type-Options':'nosniff','X-Leave-Snapshot-SHA256':batch.snapshot_hash,'Content-Disposition':`attachment; filename="leave-payroll-${batch.id}-v${batch.version}.${format==='json'?'json':'csv'}"`});
 if(format==='json')res.json(batch);else res.type('text/csv').send(payrollCsv(batch,format==='corrections'));
});
router.post('/registers/:id/receipt',[id,reference('reference'),why,body('snapshot_hash').isHexadecimal().isLength({min:64,max:64}),body('corrections_reconciled').optional().isBoolean()],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await service.acknowledgePayroll(pool,args(req)));});
router.get('/employees/:id/migration-state',[id,query('cutover_date').custom(v=>{dayNumber(v);return true;})],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await service.previewMigration(pool,req.user,req.params.id,req.query.cutover_date));});
router.get('/migrations',[query('page').optional().isInt({min:1,max:100000}),query('employee_id').optional().isUUID()],async(req,res)=>{
 if(!handleValidation(req,res))return;const page=Number(req.query.page)||1,employee=req.query.employee_id||null;
 const result=await withTransaction(pool,async client=>{await assertCentral(client,req.user);const rows=(await client.query("SELECT r.id,r.employee_id,e.display_name,r.prepared_by,to_char(r.cutover_date,'YYYY-MM-DD') AS cutover_date,r.context_hash,r.plan,r.source_reference,r.transition_reference,r.history_reference,r.recorded_at,(SELECT COALESCE(jsonb_agg(jsonb_build_object('legacy_request_id',t.legacy_request_id,'request_id',t.request_id,'code',t.code,'status',q.status)),'[]'::jsonb) FROM hr_gov_legacy_transfers t LEFT JOIN hr_gov_requests q ON q.id=t.request_id WHERE t.review_id=r.id) AS transfers,c.actor_id AS certified_by FROM hr_gov_migration_reviews r JOIN hr_employees e ON e.id=r.employee_id LEFT JOIN hr_gov_migration_certifications c ON c.review_id=r.id WHERE ($1::uuid IS NULL OR r.employee_id=$1) ORDER BY r.recorded_at DESC,r.id LIMIT 50 OFFSET $2",[employee,(page-1)*50])).rows;const total=(await client.query('SELECT count(*)::int AS total FROM hr_gov_migration_reviews WHERE ($1::uuid IS NULL OR employee_id=$1)',[employee])).rows[0].total;return {reviews:rows,total,page,page_size:50};});res.json(result);
});
router.post('/employees/:id/migrations',[id,body('review_id').isUUID(),date('cutover_date'),why,...['source_reference','payroll_reference','transition_reference','history_reference'].map(reference),body('targets').isArray({min:3,max:3}),body('targets.*.code').isIn(['recreation','medical','special']),body('targets.*.amount').isDecimal({decimal_digits:'0,6'}),body('targets.*.retained_balance_ids').optional().isArray({max:100}),body('targets.*.retained_balance_ids.*').optional().isUUID(),body('dispositions').isArray({max:2000}),body('dispositions.*.legacy_request_id').isUUID(),body('dispositions.*.action').isIn(['portal_link','retain_external','transfer_with_fresh_approval']),body('dispositions.*.reference').isString().isLength({min:5,max:500}),body('dispositions.*.portal_request_id').optional().isUUID(),body('dispositions.*.code').optional().isString().isLength({max:60})],async(req,res)=>{if(!handleValidation(req,res))return;res.status(201).json(await service.prepareMigration(pool,args(req)));});
router.get('/migrations/:id/export',[id],async(req,res)=>{
 if(!handleValidation(req,res))return;
 const review=await withTransaction(pool,async client=>{await assertCentral(client,req.user);return (await client.query('SELECT r.*,c.actor_id AS certified_by,c.reason AS certification_reason,c.postings FROM hr_gov_migration_reviews r LEFT JOIN hr_gov_migration_certifications c ON c.review_id=r.id WHERE r.id=$1',[req.params.id])).rows[0];});
 if(!review)return res.status(404).json({message:'Migration review not found.'});
 res.set({'Content-Disposition':`attachment; filename="leave-migration-${review.id}.json"`,'X-Content-Type-Options':'nosniff'}).json(review);
});
router.post('/migrations/:id/certify',[id,why,body('context_hash').isHexadecimal().isLength({min:64,max:64})],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await service.certifyMigration(pool,args(req)));});
router.post('/transfers/:id/submit',governmentEvidenceUpload,[id,why,body('medical_mode').optional().isIn(['certificate','exemption','not_applicable']),body('related_request_id').optional().isUUID()],async(req,res)=>{if(!handleValidation(req,res))return;res.status(201).json(await service.submitLegacyTransfer(pool,{...args(req),documents:req.governmentDocuments||[]}));});
router.get('/handovers',[query('page').optional().isInt({min:1,max:100000})],async(req,res)=>{
 if(!handleValidation(req,res))return;const page=Number(req.query.page)||1;
 const result=await withTransaction(pool,async client=>{await assertCentral(client,req.user);const rows=(await client.query("SELECT h.id,h.prepared_by,h.snapshot_hash,h.recorded_at,h.snapshot->'employee_ids' AS employee_ids,(h.snapshot->>'includes_evidence')::boolean AS includes_evidence,r.reference AS receipt_reference FROM hr_gov_handovers h LEFT JOIN hr_gov_handover_receipts r ON r.handover_id=h.id ORDER BY h.recorded_at DESC,h.id LIMIT 50 OFFSET $1",[(page-1)*50])).rows;const total=(await client.query('SELECT count(*)::int AS total FROM hr_gov_handovers')).rows[0].total;return {handovers:rows,total,page,page_size:50};});res.json(result);
});
router.post('/handovers',[body('handover_id').isUUID(),body('employee_ids').isArray({min:1,max:50}),body('employee_ids.*').isUUID(),body('include_documents').isBoolean(),reference('source_reference'),why],async(req,res)=>{if(!handleValidation(req,res))return;res.status(201).json(await service.prepareHandover(pool,args(req)));});
router.get('/handovers/:id/export',[id],async(req,res)=>{if(!handleValidation(req,res))return;const handover=await service.handoverView(pool,req.user,req.params.id);res.set({'Content-Disposition':`attachment; filename="leave-handover-${handover.id}.json"`,'X-Content-Type-Options':'nosniff','X-Leave-Snapshot-SHA256':handover.snapshot_hash}).json(handover);});
router.post('/handovers/:id/receipt',[id,reference('reference'),why,body('snapshot_hash').isHexadecimal().isLength({min:64,max:64})],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await service.acknowledgeHandover(pool,args(req)));});
export default router;

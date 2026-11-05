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
export default router;

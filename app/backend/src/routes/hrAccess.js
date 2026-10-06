import express from 'express';
import { pool } from '../db.js';
import { PERMISSIONS } from '../config.js';
import { requirePermission } from '../services/authService.js';
import { body,param,query,handleValidation } from '../middleware/validation.js';
import { activeScopeSql,grantHrScope,isCentralHr,revokeHrScope,SCOPE_CAPABILITIES } from '../services/hrAccess.js';
const router=express.Router();
const central=requirePermission(PERMISSIONS.HR_ADMIN);
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/context',requirePermission(PERMISSIONS.HR_ACCESS,PERMISSIONS.HR_ADMIN,PERMISSIONS.HR_STAFF_MANAGE),async(req,res)=>{
  const {rows}=await pool.query(`SELECT s.id,s.department_id,s.division_id,s.capabilities,s.effective_from,s.effective_to,
    d.name AS department_name,v.name AS division_name FROM hr_access_scopes s JOIN hr_departments d ON d.id=s.department_id
    LEFT JOIN hr_divisions v ON v.id=s.division_id WHERE s.reviewer_id=$1 AND ${activeScopeSql()} ORDER BY d.name,v.name,s.id`,[req.user.id]);
  res.json({central:isCentralHr(req.user),scopes:rows});
});
router.get('/',central,[query('page').optional().isInt({min:1,max:100000}),query('search').optional().isString().isLength({max:100})],async(req,res)=>{
  if(!handleValidation(req,res))return;
  const page=Number(req.query.page)||1,search=String(req.query.search||'').trim();
  const where="($1='' OR position(lower($1) in lower(r.display_name))>0 OR position(lower($1) in lower(r.email))>0)";
  const {rows}=await pool.query(`SELECT s.*,r.display_name AS account_name,r.email AS account_email,r.status AS account_status,
    d.name AS department_name,v.name AS division_name FROM hr_access_scopes s JOIN reviewers r ON r.id=s.reviewer_id
    JOIN hr_departments d ON d.id=s.department_id LEFT JOIN hr_divisions v ON v.id=s.division_id
    WHERE ${where} ORDER BY s.granted_at DESC,s.id LIMIT 50 OFFSET $2`,[search,(page-1)*50]);
  const {rows:[count]}=await pool.query(`SELECT count(*)::int AS total FROM hr_access_scopes s JOIN reviewers r ON r.id=s.reviewer_id WHERE ${where}`,[search]);
  res.json({assignments:rows,total:count.total,page,page_size:50});
});
const date=(field,required=false)=>{const v=body(field);return(required?v:v.optional({nullable:true})).matches(/^\d{4}-\d{2}-\d{2}$/).isISO8601({strict:true});};
const reason=body('reason').isString().trim().isLength({min:10,max:1000});
const actor=req=>({id:req.user.id,email:req.user.email,ip:req.ip});
router.post('/',central,[reason,body('reviewer_id').isUUID(),body('department_id').isUUID(),body('division_id').optional({nullable:true}).isUUID(),
  body('capabilities').isArray({min:1,max:5}),body('capabilities.*').isIn(SCOPE_CAPABILITIES),date('effective_from',true),date('effective_to')],async(req,res)=>{
  if(!handleValidation(req,res))return;
  res.status(201).json(await grantHrScope(pool,{user:req.user,actor:actor(req),data:req.body}));
});
router.post('/:id/revoke',central,[param('id').isUUID(),reason],async(req,res)=>{
  if(!handleValidation(req,res))return;
  res.json(await revokeHrScope(pool,{user:req.user,actor:actor(req),scopeId:req.params.id,reason:req.body.reason}));
});
export default router;

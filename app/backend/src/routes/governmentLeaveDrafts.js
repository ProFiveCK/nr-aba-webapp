import express from 'express';
import {pool} from '../db.js';
import {body,param,handleValidation} from '../middleware/validation.js';
import {requirePermission} from '../services/authService.js';
import {PERMISSIONS} from '../config.js';
import {changeDraftState} from '../services/governmentLeaveDrafts.js';
const router=express.Router();
router.use(requirePermission(PERMISSIONS.HR_ADMIN));
router.post('/:kind/:id/lifecycle',[param('kind').isIn(['configuration','job','opening','coverage','benefit_reconciliation']),param('id').isUUID(),body('action').isIn(['discard','restore']),body('expected_revision').isInt({min:0}),body('reason').isString().trim().isLength({min:10,max:1000})],async(req,res)=>{
 if(!handleValidation(req,res))return;
 res.json(await changeDraftState(pool,{user:req.user,actor:{id:req.user.id,email:req.user.email,ip:req.ip},kind:req.params.kind,id:req.params.id,data:{...req.body,expected_revision:Number(req.body.expected_revision)}}));
});
export default router;

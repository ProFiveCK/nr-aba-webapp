import express from 'express';
import {pool} from '../db.js';
import {query,handleValidation} from '../middleware/validation.js';
import {requirePermission} from '../services/authService.js';
import {PERMISSIONS} from '../config.js';
import {governmentActivity} from '../services/governmentLeaveReporting.js';
const router=express.Router();
router.get('/',requirePermission(PERMISSIONS.HR_ADMIN,PERMISSIONS.HR_REPORT_READ),[
 query('from').isString().matches(/^\d{4}-\d{2}-\d{2}$/),query('to').isString().matches(/^\d{4}-\d{2}-\d{2}$/),query('page').optional().isInt({min:1,max:100000})
],async(req,res)=>{if(!handleValidation(req,res))return;res.json(await governmentActivity(pool,{user:req.user,from:req.query.from,to:req.query.to,page:Number(req.query.page)||1}));});
export default router;

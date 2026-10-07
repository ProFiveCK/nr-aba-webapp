import express from 'express';
import { pool } from '../db.js';
import { param, handleValidation } from '../middleware/validation.js';
import { requirePermission } from '../services/authService.js';
import { PERMISSIONS } from '../config.js';
import { employeeLeaveArrangements, employeeLeavePolicyUsage } from '../services/employeeLeaveArrangements.js';

const router = express.Router();
router.get('/leave-policy-usage', requirePermission(PERMISSIONS.HR_ADMIN), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await employeeLeavePolicyUsage(pool, { user: req.user }));
});
router.get('/:id/leave-arrangements', requirePermission(PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN), [param('id').isUUID()], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.set('Cache-Control', 'no-store');
  res.json(await employeeLeaveArrangements(pool, { user: req.user, employeeId: req.params.id }));
});
export default router;

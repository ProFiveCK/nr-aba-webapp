import express from 'express';
import { pool } from '../db.js';
import { body, param, handleValidation } from '../middleware/validation.js';
import { requirePermission } from '../services/authService.js';
import { PERMISSIONS } from '../config.js';
import { employeeLeaveArrangements, enrollGovernmentRegime, employeeLeavePolicyUsage } from '../services/employeeLeaveArrangements.js';

const router = express.Router();
router.get('/leave-policy-usage', requirePermission(PERMISSIONS.HR_ADMIN), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await employeeLeavePolicyUsage(pool, { user: req.user }));
});
router.get('/:id/leave-arrangements', requirePermission(PERMISSIONS.HR_OFFICER, PERMISSIONS.HR_ADMIN), [param('id').isUUID()], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.set('Cache-Control', 'no-store');
  res.json(await employeeLeaveArrangements(pool, { user: req.user, employeeId: req.params.id }));
});
// The reviewed regime change for a staff record that already has a linked login:
// balances are then carried as certified government openings before activation.
router.post(
  '/:id/enroll-government',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [param('id').isUUID(), body('reason').isString().trim().isLength({ min: 10, max: 1000 }),
    body('source_reference').isString().trim().isLength({ min: 5, max: 500 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    res.set('Cache-Control', 'no-store');
    res.json(await enrollGovernmentRegime(pool, { user: req.user, employeeId: req.params.id,
      data: { reason: req.body.reason, source_reference: req.body.source_reference } }));
  }
);
export default router;

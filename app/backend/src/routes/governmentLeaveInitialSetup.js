import express from 'express';
import { pool } from '../db.js';
import { body, param, query, handleValidation } from '../middleware/validation.js';
import { requirePermission } from '../services/authService.js';
import { PERMISSIONS } from '../config.js';
import { CODES, dayNumber } from '../lib/governmentLeaveRules.js';
import * as service from '../services/governmentLeaveInitialSetup.js';

const router = express.Router();
router.use(requirePermission(PERMISSIONS.HR_ADMIN));
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const date = value => { dayNumber(value); return true; };
const actor = req => ({ id: req.user.id, email: req.user.email, ip: req.ip });
const args = req => ({ user: req.user, actor: actor(req), id: req.params.id, data: req.body });
const reason = () => body('reason').isString().trim().isLength({ min: 10, max: 1000 });
const revision = () => body('expected_revision').isInt({ min: 1, max: 2147483646 }).toInt();
const sourceHash = () => body('source_hash').isString().matches(/^[0-9a-f]{64}$/);
const plan = () => [body('policy_id').optional({ nullable: true }).isUUID(), body('start_date').custom(date),
  body('mappings').isArray({ max: 500 }), body('mappings.*.leave_type_id').isUUID(),
  body('mappings.*.code').optional({ nullable: true }).isIn([...CODES, 'retain_history']),
  body('adopt_employee_ids').isArray({ max: 2000 }), body('adopt_employee_ids.*').isUUID()];
router.get('/', [query('start_date').optional().custom(date)], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.json(await service.initialSetupState(pool, { user: req.user, startDate: req.query.start_date }));
});
router.get('/employees', [query('page').optional().isInt({ min: 1, max: 100000 }), query('search').optional().isString().isLength({ max: 100 }), query('start_date').optional().custom(date)], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.json(await service.initialSetupEmployees(pool, { user: req.user, page: Number(req.query.page) || 1, search: req.query.search || '', startDate: req.query.start_date }));
});
router.post('/preview', plan(), async (req, res) => { if (!handleValidation(req, res)) return; res.json(await service.previewInitialSetup(pool, args(req))); });
router.post('/drafts', [...plan(), sourceHash(), reason()], async (req, res) => { if (!handleValidation(req, res)) return; res.status(201).json(await service.saveInitialSetupDraft(pool, args(req))); });
router.put('/drafts/:id', [param('id').isUUID(), ...plan(), sourceHash(), revision(), reason()], async (req, res) => { if (!handleValidation(req, res)) return; res.json(await service.saveInitialSetupDraft(pool, args(req))); });
router.delete('/drafts/:id', [param('id').isUUID(), revision(), reason()], async (req, res) => { if (!handleValidation(req, res)) return; res.json(await service.deleteInitialSetupDraft(pool, args(req))); });
router.post('/drafts/:id/adopt', [param('id').isUUID(), sourceHash(), revision(), reason()], async (req, res) => { if (!handleValidation(req, res)) return; res.json(await service.adoptInitialSetup(pool, args(req))); });
export default router;

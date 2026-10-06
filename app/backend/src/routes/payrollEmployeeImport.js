import express from 'express';
import { pool } from '../db.js';
import { body, param, query, handleValidation } from '../middleware/validation.js';
import { requirePermission } from '../services/authService.js';
import { PERMISSIONS } from '../config.js';
import { PAYROLL_IMPORT_COLUMNS, PAYROLL_IMPORT_MAX_BYTES } from '../lib/payrollEmployeeCsv.js';
import { applyPayrollImport, previewPayrollImport, readPayrollImport, reconcilePayrollImportRow, refreshPayrollImport } from '../services/payrollEmployeeImport.js';

const router = express.Router();
const centralHr = requirePermission(PERMISSIONS.HR_ADMIN);
const actor = (req) => ({ id: req.user.id, email: req.user.email, ip: req.ip });
const batchId = param('id').isUUID();
const revision = body('revision').isInt({ min: 1 });

router.get('/template', centralHr, (_req, res) => {
  res.type('text/csv').attachment('payroll-employee-import-v1.csv').send(`\uFEFF${PAYROLL_IMPORT_COLUMNS.join(',')}\r\n`);
});

router.get('/', centralHr, [query('page').optional().isInt({ min: 1, max: 100000 })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  const page = Number(req.query.page) || 1;
  const { rows } = await pool.query(`SELECT id, file_name, export_date, status, row_count, revision, created_at, applied_at, result
    FROM hr_employee_import_batches ORDER BY created_at DESC, id LIMIT 20 OFFSET $1`, [(page - 1) * 20]);
  const { rows: [count] } = await pool.query('SELECT count(*)::int AS total FROM hr_employee_import_batches');
  res.set('Cache-Control', 'no-store').json({ batches: rows, total: count.total, page, page_size: 20 });
});

router.post('/preview', centralHr, [
  body('csv').isString().isLength({ min: 1, max: PAYROLL_IMPORT_MAX_BYTES }),
  body('file_name').isString().isLength({ min: 1, max: 200 }),
  body('export_date').matches(/^\d{4}-\d{2}-\d{2}$/).isISO8601({ strict: true }),
], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.set('Cache-Control', 'no-store').status(201).json(await previewPayrollImport(pool, {
    csv: req.body.csv, fileName: req.body.file_name, exportDate: req.body.export_date, actor: actor(req),
  }));
});

router.get('/:id', centralHr, [batchId, query('page').optional().isInt({ min: 1, max: 100000 }),
  query('filter').optional().isIn(['all', 'ready', 'blocked', 'skipped', 'applied']),
], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.set('Cache-Control', 'no-store').json(await readPayrollImport(pool, req.params.id, { page: Number(req.query.page) || 1, filter: req.query.filter || 'all' }));
});

router.put('/:id/rows/:rowNumber', centralHr, [batchId, param('rowNumber').isInt({ min: 2, max: 3001 }), revision,
  body('decision').isIn(['create', 'update', 'skip']), body('employee_id').optional({ nullable: true }).isUUID(),
  body('reason').isString().trim().isLength({ min: 10, max: 1000 }),
], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.set('Cache-Control', 'no-store').json(await reconcilePayrollImportRow(pool, { batchId: req.params.id, rowNumber: Number(req.params.rowNumber),
    decision: req.body.decision, employeeId: req.body.employee_id, reason: req.body.reason, revision: Number(req.body.revision), actor: actor(req) }));
});

router.post('/:id/refresh', centralHr, [batchId, revision], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.set('Cache-Control', 'no-store').json(await refreshPayrollImport(pool, { batchId: req.params.id, revision: Number(req.body.revision), actor: actor(req) }));
});

router.post('/:id/apply', centralHr, [batchId, revision, body('review_note').isString().trim().isLength({ min: 10, max: 1000 })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.set('Cache-Control', 'no-store').json(await applyPayrollImport(pool, { batchId: req.params.id, revision: Number(req.body.revision), reviewNote: req.body.review_note, actor: actor(req) }));
});

export default router;

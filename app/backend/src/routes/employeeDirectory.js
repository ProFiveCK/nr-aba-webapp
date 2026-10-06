import express from 'express';
import { pool } from '../db.js';
import { body, param, query, handleValidation } from '../middleware/validation.js';
import { requirePermission } from '../services/authService.js';
import { PERMISSIONS } from '../config.js';
import { withTransaction } from '../lib/transaction.js';
import payrollEmployeeImportRouter from './payrollEmployeeImport.js';
import { createManagedEmployee, createWorkPattern, listLinkableAccounts, updateManagedEmployee } from '../services/employeeManagement.js';
import {
  APPROVAL_LEVELS, EMPLOYMENT_CATEGORIES, addEmployeeExternalId, addServicePeriod, assignLeaveApprover, closeApprovalAssignment, closeServicePeriod,
  employeeProfile, listEmployeeDirectory, previewApprovalChain, provisionEmployeeAccount, setEmployeeAccount, setEmployeeOrganisation,
} from '../services/employeeDirectory.js';

const router = express.Router();
router.use('/imports', payrollEmployeeImportRouter);
// This first slice is central-HR configuration. Departmental HR access will be
// enabled only once row scopes are enforced across the existing HR endpoints.
const centralHr = requirePermission(PERMISSIONS.HR_ADMIN);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const employeeId = param('id').isUUID();
const reason = body('reason').isString().trim().isLength({ min: 10, max: 1000 });
const dateOnly = (field, required = false) => {
  const validator = body(field);
  return (required ? validator : validator.optional({ nullable: true })).matches(/^\d{4}-\d{2}-\d{2}$/).isISO8601({ strict: true });
};

router.get('/', centralHr, [
  query('page').optional().isInt({ min: 1, max: 100000 }),
  query('page_size').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString().isLength({ max: 100 }),
  query('department_id').optional().isUUID(),
  query('status').optional().isIn(['active', 'inactive']),
  query('readiness').optional().isIn(['unlinked','missing_id','missing_placement','missing_service','missing_pattern']),
], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.json(await listEmployeeDirectory(pool, { page: Number(req.query.page) || 1, pageSize: Number(req.query.page_size) || 50,
    search: req.query.search || '', departmentId: req.query.department_id || null, status: req.query.status || null, readiness: req.query.readiness || '' }));
});

router.get('/accounts', centralHr, [query('page').optional().isInt({min:1,max:100000}),query('search').optional().isString().isLength({max:100})], async (req,res) => {
  if (!handleValidation(req,res)) return;
  res.json(await listLinkableAccounts(pool,{page:Number(req.query.page)||1,search:req.query.search||''}));
});

router.post('/', centralHr, [reason,body('display_name').isString().trim().isLength({min:1,max:200}),body('external_id').isString().trim().isLength({min:1,max:100}).not().matches(/[\u0000-\u001f\u007f]/),
  body('department_id').isUUID(),body('division_id').optional({nullable:true}).isUUID()], async (req,res) => {
  if (!handleValidation(req,res)) return;
  res.status(201).json(await createManagedEmployee(pool,{data:req.body,actor:actor(req),reason:req.body.reason}));
});

router.put('/:id/details', centralHr, [employeeId,reason,body('display_name').isString().trim().isLength({min:1,max:200}),
  body('position_title').optional({nullable:true}).isString().trim().isLength({max:120}),
  body('email').optional({nullable:true}).isEmail().isLength({max:254}),body('status').isIn(['active','inactive']),
  body('manager_id').exists({values:'undefined'}),body('manager_id').optional({nullable:true}).isUUID()], async (req,res) => {
  if (!handleValidation(req,res)) return;
  res.json(await updateManagedEmployee(pool,{employeeId:req.params.id,data:req.body,actor:actor(req),reason:req.body.reason}));
});

router.get('/work-patterns', centralHr, async (_req,res) => res.json((await pool.query('SELECT * FROM hr_work_patterns ORDER BY lower(name),id')).rows));
router.post('/work-patterns', centralHr, [reason,body('name').isString().trim().isLength({min:1,max:120}),
  body('working_weekdays').isArray({min:1,max:7}),body('working_weekdays.*').isInt({min:1,max:7}),
  body('hours_per_day').optional({nullable:true}).isFloat({gt:0,max:24})], async (req,res) => {
  if (!handleValidation(req,res)) return;
  res.status(201).json(await createWorkPattern(pool,{data:req.body,actor:actor(req),reason:req.body.reason}));
});

router.get('/:id/profile', centralHr, [employeeId], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.json(await employeeProfile(pool, req.params.id));
});

router.post('/:id/external-ids', centralHr, [employeeId, reason, body('external_id').isString().trim().isLength({ min: 1, max: 100 })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.status(201).json(await addEmployeeExternalId(pool, { employeeId: req.params.id, externalId: req.body.external_id, actor: actor(req), reason: req.body.reason }));
});

router.put('/:id/organisation', centralHr, [employeeId, reason, body('department_id').isUUID(), body('division_id').optional({ nullable: true }).isUUID()], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.json(await setEmployeeOrganisation(pool, { employeeId: req.params.id, departmentId: req.body.department_id,
    divisionId: req.body.division_id || null, actor: actor(req), reason: req.body.reason }));
});

router.post('/:id/service-periods', centralHr, [employeeId, reason, dateOnly('start_date', true), dateOnly('end_date'),
  body('employment_category').isIn(EMPLOYMENT_CATEGORIES), body('is_teacher').optional().isBoolean(), body('is_intern').optional().isBoolean(),
  body('counts_for_service').optional({ nullable: true }).isBoolean(), body('work_pattern_id').optional({ nullable: true }).isUUID(),
  body('appointment_reference').optional({ nullable: true }).isString().isLength({ max: 200 }),
], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.status(201).json(await addServicePeriod(pool, { employeeId: req.params.id, period: req.body, actor: actor(req), reason: req.body.reason }));
});

router.post('/:id/service-periods/:periodId/close', centralHr, [employeeId, param('periodId').isUUID(), reason, dateOnly('end_date', true)], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.json(await closeServicePeriod(pool, { employeeId: req.params.id, periodId: req.params.periodId, endDate: req.body.end_date,
    actor: actor(req), reason: req.body.reason }));
});

router.put('/:id/account-link', centralHr, [employeeId, reason, body('reviewer_id').exists({ values: 'undefined' }), body('reviewer_id').optional({ nullable: true }).isUUID()], async (req, res) => {
  if (!handleValidation(req, res)) return;
  const updated = await withTransaction(pool, (client) => setEmployeeAccount(client, { employeeId: req.params.id,
    reviewerId: req.body.reviewer_id, actor: actor(req), reason: req.body.reason }));
  res.json({ employee_id: updated.id, reviewer_id: updated.reviewer_id });
});

router.post('/:id/account', centralHr, [employeeId, reason, body('email').isEmail().isLength({ max: 254 })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  if (req.user.permissions?.[PERMISSIONS.ADMIN] !== true) {
    res.status(403).json({ message: 'Portal administration access is also required to provision an account.' });
    return;
  }
  res.set('Cache-Control', 'no-store');
  res.status(201).json(await provisionEmployeeAccount(pool, { employeeId: req.params.id, email: req.body.email, actor: actor(req), reason: req.body.reason }));
});

router.post('/approval-assignments', centralHr, [reason, body('level').isIn(APPROVAL_LEVELS),
  body('department_id').optional({ nullable: true }).isUUID(), body('division_id').optional({ nullable: true }).isUUID(),
  body('approver_employee_id').isUUID(), dateOnly('effective_from', true), dateOnly('effective_to'),
], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.status(201).json(await assignLeaveApprover(pool, { assignment: req.body, actor: actor(req), reason: req.body.reason }));
});

router.get('/approval-assignments', centralHr, [query('page').optional().isInt({ min: 1, max: 100000 })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  const page = Number(req.query.page) || 1;
  const { rows } = await pool.query(`SELECT a.*,e.display_name AS approver_name,d.name AS department_name,v.name AS division_name,
    e.status AS employee_status,r.status AS account_status,e.reviewer_id,
    (COALESCE(r.permissions->>'hr_leave_approve','') <> 'false' AND (r.permissions->>'hr_leave_approve'='true'
      OR EXISTS(SELECT 1 FROM reviewer_capabilities c WHERE c.reviewer_id=r.id AND c.capability='hr_leave_approve'))) AS has_approval_grant
    FROM hr_approval_assignments a JOIN hr_employees e ON e.id=a.approver_employee_id
    LEFT JOIN reviewers r ON r.id=e.reviewer_id LEFT JOIN hr_departments d ON d.id=a.department_id LEFT JOIN hr_divisions v ON v.id=a.division_id
    ORDER BY a.level,a.effective_from,a.id LIMIT 50 OFFSET $1`, [(page - 1) * 50]);
  const { rows: [count] } = await pool.query('SELECT count(*)::int AS total FROM hr_approval_assignments');
  res.json({ assignments: rows, total: count.total, page, page_size: 50 });
});

router.post('/approval-assignments/:id/close', centralHr, [employeeId, reason, dateOnly('end_date', true)], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.json(await closeApprovalAssignment(pool, { assignmentId: req.params.id, endDate: req.body.end_date, actor: actor(req), reason: req.body.reason }));
});

router.get('/:id/approval-chain', centralHr, [employeeId, query('on_date').matches(/^\d{4}-\d{2}-\d{2}$/).isISO8601({ strict: true })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.json(await previewApprovalChain(pool, req.params.id, req.query.on_date));
});

function actor(req) { return { id: req.user.id, email: req.user.email, ip: req.ip }; }
export default router;

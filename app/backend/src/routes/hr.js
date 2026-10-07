import express from 'express';
import { body, param, query, handleValidation } from '../middleware/validation.js';
import { pool } from '../db.js';
import { requirePermission } from '../services/authService.js';
import { recordAudit } from '../services/auditService.js';
import { notifyLeaveDecision, notifyLeaveSubmitted } from '../services/notificationService.js';
import { runLeaveAccrual } from '../services/leaveAccrual.js';
import {
  adjustBalance,
  applyForLeave,
  cancelLeave,
  decideLeave,
  leaveApprovers,
  setOpeningBalance,
} from '../services/leaveService.js';
import { withTransaction } from '../lib/transaction.js';
import { ServiceError } from '../lib/serviceError.js';
import { PERMISSIONS } from '../config.js';
import { buildUpdateAssignments, changedFields, collectUpdates } from '../lib/sqlUpdate.js';
import { normalizeNameKey } from '../lib/names.js';
import { INELIGIBLE_REASONS, resolveEligibility } from '../lib/eligibility.js';
import { calculateWorkingDays, monthsBetween, parseDateOnly, toIsoDate } from '../lib/leaveDates.js';
import { generateLeaveApplicationPdf } from '../services/leaveApplicationPdf.js';
import { leaveAttachmentUpload, sha256 } from '../middleware/upload.js';

import hrAccessRouter from './hrAccess.js';
import employeeOnboardingRouter from './employeeOnboarding.js';
import governmentLeaveRouter from './governmentLeave.js';
import { assertEmployeeScope,canAccessEmployee,employeeReadSql,employeeScopeSql,isCentralHr,managerScopeSql,activeScopeSql } from '../services/hrAccess.js';
import employeeDirectoryRouter from './employeeDirectory.js';
import { linkedEmployee, setEmployeeAccount } from '../services/employeeDirectory.js';

const router = express.Router();
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.use('/access-scopes',hrAccessRouter);
router.use('/onboarding',employeeOnboardingRouter);
router.use('/government',governmentLeaveRouter);
router.use('/directory', employeeDirectoryRouter);

// Staff records are imported/created by HR and linked explicitly. Reading
// Leave must never claim another person's record or create a duplicate.
const currentEmployee = (req) => linkedEmployee(pool, req.user.id);

/** Capability and current employee placement are checked independently. */
async function canActOnEmployee(req, employeeId, client = pool) {
  return canAccessEmployee(client, req.user, employeeId, 'hr_leave_approve', { manager: true });
}

/**
 * An employee row with the pay rate removed unless the caller may see it.
 *
 * `daily_rate` is remuneration — the only such field in this database — and
 * several endpoints select whole employee rows. Stripping it at the response
 * boundary means a new endpoint cannot leak it by selecting `e.*`, which is the
 * mistake that would otherwise be one careless query away.
 */
function canSeePay(req) {
  return req.user.permissions?.[PERMISSIONS.HR_ADMIN] === true;
}

function visibleEmployee(req, row) {
  if (!row || canSeePay(req)) return row;
  const { daily_rate: _withheld, ...rest } = row;
  return rest;
}

const visibleEmployees = (req, rows) => rows.map((row) => visibleEmployee(req, row));

// ===== Reference data =====

router.get('/leave-types', requirePermission(PERMISSIONS.HR_ACCESS), async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM hr_leave_types WHERE is_active = TRUE ORDER BY name'
  );
  res.json(rows);
});

// ===== The signed-in user =====

router.get('/me', requirePermission(PERMISSIONS.HR_ACCESS), async (req, res) => {
  const employee = await currentEmployee(req);
  const year = new Date().getFullYear();
  // Staff who are not entitled to leave have no balances to show.
  if (employee.leave_entitled === false) {
    const { rows: manager } = await pool.query(
      'SELECT id, display_name, email FROM hr_employees WHERE id = $1',
      [employee.manager_id]
    );
    res.json({ employee: visibleEmployee(req, employee), year, balances: [], manager: manager[0] || null });
    return;
  }
  // Return every active leave type, not just the ones the employee has touched,
  // so the form can show a zero (or not-yet-accrued) balance instead of hiding
  // the type entirely. Untouched accruable types read as zero; upfront types
  // read as their full entitlement — matching what ensureBalance would seed.
  const { rows: balances } = await pool.query(
    `SELECT COALESCE(b.id, t.id) AS id,
            t.id AS leave_type_id,
            t.name AS leave_type_name,
            COALESCE(b.balance, CASE WHEN t.is_accruable THEN 0 ELSE t.default_days END) AS balance,
            COALESCE(b.pending, 0) AS pending,
            $2 AS year,
            t.requires_note
       FROM hr_leave_types t
       LEFT JOIN hr_leave_balances b
         ON b.leave_type_id = t.id AND b.employee_id = $1 AND b.year = $2
      WHERE t.is_active = TRUE AND ($3::boolean=FALSE OR b.id IS NOT NULL)
      ORDER BY t.name`,
    [employee.id, year,employee.leave_policy_regime==='government' || req.user.account_type==='employee']
  );
  const { rows: manager } = await pool.query(
    'SELECT id, display_name, email FROM hr_employees WHERE id = $1',
    [employee.manager_id]
  );
  res.json({ employee: visibleEmployee(req, employee), year, balances, manager: manager[0] || null });
});

// The documents attached to an application, without their bytes. Written as a
// subquery rather than a join so an application with two attachments is still
// one row.
const ATTACHMENT_SUMMARY_SQL = `
  COALESCE((
    SELECT json_agg(json_build_object(
             'id', att.id, 'file_name', att.file_name,
             'content_type', att.content_type, 'byte_size', att.byte_size,
             'created_at', att.created_at
           ) ORDER BY att.created_at)
      FROM hr_leave_attachments att
     WHERE att.application_id = a.id
  ), '[]'::json) AS attachments`;

router.get('/leaves', requirePermission(PERMISSIONS.HR_ACCESS), async (req, res) => {
  const employee = await currentEmployee(req);
  const { rows } = await pool.query(
    `SELECT a.*, t.name AS leave_type_name, r.display_name AS reviewed_by_name,
            ${ATTACHMENT_SUMMARY_SQL}
       FROM hr_leave_applications a
       JOIN hr_leave_types t ON t.id = a.leave_type_id
       LEFT JOIN reviewers r ON r.id = a.reviewed_by
      WHERE a.employee_id = $1 AND a.archived_at IS NULL
      ORDER BY a.applied_at DESC`,
    [employee.id]
  );
  res.json(rows);
});

// Approval-time balances and staff details are frozen for reliable reprints.
// Older approvals lack a snapshot and must not be shown with today's balance.
async function approvedLeaveForm(req, id) {
  const { rows } = await pool.query(
      `SELECT a.id, a.employee_id, a.reviewed_by, a.start_date, a.end_date, a.days, a.reason,
              a.applied_at, a.reviewed_at, a.payroll_form_snapshot,
              e.reviewer_id, e.manager_id, e.display_name AS current_employee_name,
              e.position_title AS current_position_title, e.department_code AS current_department_code,
              e.division_code AS current_division_code,
              m.display_name AS current_supervisor_name, t.name AS current_leave_type_name,
              r.display_name AS current_approver_name
         FROM hr_leave_applications a
         JOIN hr_employees e ON e.id = a.employee_id
         JOIN hr_leave_types t ON t.id = a.leave_type_id
         LEFT JOIN hr_employees m ON m.id = e.manager_id
         LEFT JOIN reviewers r ON r.id = a.reviewed_by
        WHERE a.id = $1 AND a.status = 'approved'`,
      [id]
    );
    if (!rows.length) return null;
    const application = rows[0];
    if (!(await canAccessEmployee(pool,req.user,application.employee_id,'hr_report_read',{owner:true,manager:true}))
      && !(await canActOnEmployee(req,application.employee_id))) return null;

    const snapshot = application.payroll_form_snapshot;
    return {
      id: application.id,
      employee_name: snapshot?.employee_name || application.current_employee_name,
      position_title: snapshot ? snapshot.position_title : application.current_position_title,
      department_code: snapshot ? snapshot.department_code : application.current_department_code,
      division_code: snapshot ? snapshot.division_code : application.current_division_code,
      supervisor_name: snapshot ? snapshot.supervisor_name : application.current_supervisor_name,
      approved_by_name: snapshot ? snapshot.approved_by_name : application.current_approver_name,
      leave_type_name: snapshot?.leave_type_name || application.current_leave_type_name,
      start_date: application.start_date,
      end_date: application.end_date,
      days: Number(application.days),
      reason: application.reason,
      applied_at: application.applied_at,
      approved_at: application.reviewed_at,
      balance_year: snapshot?.balance_year || null,
      balances: snapshot?.balances || null,
      approval_snapshot_available: Boolean(snapshot),
    };
}

const leaveFormAccess = requirePermission(
  PERMISSIONS.HR_ACCESS, PERMISSIONS.HR_LEAVE_APPROVE,
  PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_REPORT_READ, PERMISSIONS.HR_EVIDENCE_READ, PERMISSIONS.HR_ADMIN
);

router.get(
  '/leaves/:id/payroll-form',
  leaveFormAccess,
  [param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const form = await approvedLeaveForm(req, req.params.id);
    if (!form) {
      res.status(404).json({ message: 'Approved leave form not found.' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.json(form);
  }
);

router.get(
  '/leaves/:id/application.pdf',
  leaveFormAccess,
  [param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const form = await approvedLeaveForm(req, req.params.id);
    if (!form) {
      res.status(404).json({ message: 'Approved leave form not found.' });
      return;
    }
    const bytes = await generateLeaveApplicationPdf(form);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="leave-application-${form.id}.pdf"`);
    res.send(Buffer.from(bytes));
  }
);

/**
 * Downloads a document attached to a leave application.
 *
 * A medical certificate is health information, so this is deliberately
 * narrower than the rest of the leave endpoints: the applicant, the manager
 * the application is routed to, the approver who decided it, and HR. A
 * capability to approve leave in general is not enough — the same separation
 * of capability from reporting line that `canActOnEmployee` makes everywhere
 * else.
 *
 * An attachment the caller may not see is reported as missing rather than
 * forbidden, so this cannot be used to confirm that someone has filed a
 * certificate.
 */
router.get(
  '/leaves/:id/attachments/:attachmentId',
  leaveFormAccess,
  [param('id').isUUID(), param('attachmentId').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows } = await pool.query(
      `SELECT att.file_name, att.content_type, att.file_data,
              a.employee_id, a.reviewed_by, e.reviewer_id, e.manager_id
         FROM hr_leave_attachments att
         JOIN hr_leave_applications a ON a.id = att.application_id
         JOIN hr_employees e ON e.id = a.employee_id
        WHERE att.id = $1 AND att.application_id = $2`,
      [req.params.attachmentId, req.params.id]
    );
    const missing = () => res.status(404).json({ message: 'Attachment not found.' });
    if (!rows.length) return missing();
    const attachment = rows[0];

    // Evidence has its own grant. Owners and verified direct managers retain
    // their application access; a past decision does not confer permanent access.
    if (!(await canAccessEmployee(pool,req.user,attachment.employee_id,'hr_evidence_read',{owner:true,manager:true}))) return missing();

    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', attachment.content_type || 'application/octet-stream');
    // Always an attachment, never inline: nothing uploaded by a user should be
    // rendered by the browser on the portal's own origin.
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.file_name)}"`);
    return res.send(attachment.file_data);
  }
);

// Accepts JSON, or multipart when the leave type needs a supporting document
// (an invitation letter, a medical certificate). `leaveAttachmentUpload` leaves
// a JSON request untouched, so both shapes reach the same validation below.
router.post(
  '/leaves',
  requirePermission(PERMISSIONS.HR_LEAVE_APPLY),
  leaveAttachmentUpload,
  [
    body('leave_type_id').isUUID(),
    body('start_date').isISO8601(),
    body('end_date').isISO8601(),
    body('reason').isString().trim().notEmpty().isLength({ max: 2000 }),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const employee = await currentEmployee(req);
    if (req.user.account_type === 'employee' || employee.leave_policy_regime==='government') {
      throw new ServiceError(409, 'Government leave submission will open after the division, department and Chief Secretary approval workflow is enabled.');
    }
    const { application, leaveType } = await applyForLeave(pool, {
      employee,
      leaveTypeId: req.body.leave_type_id,
      startDate: req.body.start_date,
      endDate: req.body.end_date,
      reason: req.body.reason,
      attachments: (req.files || []).map((file) => ({
        fileName: file.originalname,
        contentType: file.mimetype,
        buffer: file.buffer,
        checksum: sha256(file.buffer),
      })),
      actorId: req.user.id,
    });
    res.status(201).json(application);

    // After the response, and best effort: a mail failure must not fail an
    // application the database has already accepted.
    leaveApprovers(pool, employee)
      .then((approvers) => notifyLeaveSubmitted({
        application: { ...application, leave_type_name: leaveType.name },
        employee,
        approvers,
      }))
      .catch((err) => console.error('Failed to notify the approver of a leave application', err));
  }
);

router.post(
  '/leaves/:id/cancel',
  requirePermission(PERMISSIONS.HR_LEAVE_APPLY),
  [param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const employee = await currentEmployee(req);
    await cancelLeave(pool, { employee, applicationId: req.params.id });
    res.json({ message: 'Leave application cancelled.' });
  }
);

// Archiving only hides a finished application from the applicant's own list;
// it never affects balances, and the row is kept for reporting.
router.post(
  '/leaves/:id/archive',
  requirePermission(PERMISSIONS.HR_ACCESS),
  [param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const employee = await currentEmployee(req);
    const { rows } = await pool.query(
      `UPDATE hr_leave_applications SET archived_at = NOW()
        WHERE id = $1 AND employee_id = $2 AND status IN ('cancelled','rejected')
        RETURNING id`,
      [req.params.id, employee.id]
    );
    if (!rows.length) {
      res.status(400).json({ message: 'Only your own cancelled or rejected applications can be archived.' });
      return;
    }
    res.json({ message: 'Application archived.' });
  }
);

// ===== Manager: team and approvals =====

router.get('/team', requirePermission(PERMISSIONS.HR_LEAVE_APPROVE, PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN), async (req,res) => {
  const {rows}=await pool.query(`SELECT e.*, m.display_name AS manager_name FROM hr_employees e
    LEFT JOIN hr_employees m ON m.id=e.manager_id AND ${employeeReadSql(req.user,'$1','m')}
    WHERE e.status='active' AND ${employeeReadSql(req.user)} ORDER BY e.display_name`,[req.user.id]);
  res.json(visibleEmployees(req,rows));
});

router.get('/approvals',requirePermission(PERMISSIONS.HR_LEAVE_APPROVE,PERMISSIONS.HR_ADMIN),
  [query('status').optional().isIn(['pending','approved'])],async(req,res)=>{
  if(!handleValidation(req,res))return;
  const status=req.query.status==='approved'?'approved':'pending';
  const {rows}=await pool.query(`SELECT a.id,a.employee_id,a.leave_type_id,a.start_date,a.end_date,a.days,a.reason,a.status,
    a.applied_at,a.reviewed_at,a.reviewer_note,t.name AS leave_type_name,e.display_name AS employee_name,e.department_code,
    CASE WHEN (${employeeScopeSql(req.user,'hr_evidence_read','$2')} OR ${managerScopeSql(req.user,'$2')}) THEN ${ATTACHMENT_SUMMARY_SQL.replace(/ AS attachments$/, '')} ELSE '[]'::json END AS attachments FROM hr_leave_applications a JOIN hr_leave_types t ON t.id=a.leave_type_id
    JOIN hr_employees e ON e.id=a.employee_id WHERE a.status=$1
    AND (${employeeScopeSql(req.user,'hr_leave_approve','$2')} OR ${managerScopeSql(req.user,'$2')})
    ORDER BY ${status==='pending'?'a.applied_at':'a.reviewed_at DESC'} ${status==='approved'?'LIMIT 20':''}`,[status,req.user.id]);
  res.json(rows);
});

router.post(
  '/leaves/:id/decision',
  requirePermission(PERMISSIONS.HR_LEAVE_APPROVE, PERMISSIONS.HR_ADMIN),
  [
    param('id').isUUID(),
    body('decision').isIn(['approved', 'rejected']),
    body('reviewer_note').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const decision = req.body.decision;
    const note = String(req.body.reviewer_note || '').trim();

    const {rows:[decisionTarget]} = await pool.query('SELECT employee_id FROM hr_leave_applications WHERE id=$1',[req.params.id]);
    if (!decisionTarget || !(await canActOnEmployee(req,decisionTarget.employee_id))) throw new ServiceError(404,'Leave application not found.');

    const { rows: [owner] } = await pool.query(`SELECT r.account_type,e.leave_policy_regime FROM hr_leave_applications a
      JOIN hr_employees e ON e.id = a.employee_id LEFT JOIN reviewers r ON r.id = e.reviewer_id WHERE a.id = $1`, [req.params.id]);
    if (owner?.account_type === 'employee' || owner?.leave_policy_regime==='government') {
      throw new ServiceError(409, 'Government employee leave requires the staged approval workflow. The legacy decision endpoint cannot grant it.');
    }

    const { application, applicant, leaveTypeName } = await decideLeave(pool, {
      applicationId: req.params.id,
      decision,
      note,
      actorId: req.user.id,
      // Capability is checked above; whose leave this approver may touch is a
      // question about the reporting line, which lives here rather than in the
      // service.
      canAct: async (employeeId,client) => {
        const {rows:[current]}=await client.query(`SELECT e.leave_policy_regime,r.account_type FROM hr_employees e LEFT JOIN reviewers r ON r.id=e.reviewer_id WHERE e.id=$1`,[employeeId]);
        if(current?.leave_policy_regime==='government' || current?.account_type==='employee') throw new ServiceError(409,'Government employee leave requires the staged approval workflow.');
        return canActOnEmployee(req,employeeId,client);
      },
    });

    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: `hr.leave.${decision}`,
      entityType: 'hr_leave_application',
      entityId: application.id,
      after: { decision, days: application.days },
    });

    if (applicant) {
      notifyLeaveDecision({
        application: { ...application, leave_type_name: leaveTypeName },
        employee: applicant,
        decision,
        note,
        decidedBy: req.user.display_name || req.user.email,
      }).catch((err) => console.error('Failed to notify applicant of leave decision', err));
    }
    res.json({ message: `Leave ${decision}.` });
  }
);

// ===== Staff administration =====

/**
 * Checks a department/division pair against the managed list and returns the
 * list's own spelling, so staff records cannot drift into near-duplicates.
 */
async function resolveOrgUnit(departmentInput, divisionInput) {
  const department = String(departmentInput ?? '').trim();
  const division = String(divisionInput ?? '').trim();
  if (!department) {
    return division ? { error: 'Choose a department before a division.' } : { department: null, division: null, department_id: null, division_id: null };
  }
  const { rows: departments } = await pool.query(
    'SELECT id, name FROM hr_departments WHERE lower(name) = lower($1)', [department]
  );
  if (!departments.length) {
    return { error: `Department "${department}" is not in the list. A leave administrator can add it in Policies.` };
  }
  if (!division) return { department: departments[0].name, division: null, department_id: departments[0].id, division_id: null };
  const { rows: divisions } = await pool.query(
    'SELECT id, name FROM hr_divisions WHERE department_id = $1 AND lower(name) = lower($2)',
    [departments[0].id, division]
  );
  if (!divisions.length) {
    return { error: `Division "${division}" is not listed under ${departments[0].name}. A leave administrator can add it in Policies.` };
  }
  return { department: departments[0].name, division: divisions[0].name, department_id: departments[0].id, division_id: divisions[0].id };
}

router.get('/org-units', requirePermission(PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN), async (req, res) => {
  const {rows:allowed}=await pool.query(`SELECT DISTINCT department_id,division_id FROM hr_access_scopes s WHERE reviewer_id=$1 AND ${activeScopeSql()}`,[req.user.id]);
  const [{ rows: departments }, { rows: divisions }] = await Promise.all([
    pool.query('SELECT id, name FROM hr_departments ORDER BY lower(name)'),
    pool.query('SELECT id, department_id, name FROM hr_divisions ORDER BY lower(name)'),
  ]);
  res.json(departments.filter(d=>isCentralHr(req.user)||allowed.some(s=>s.department_id===d.id)).map((department) => ({
    id: department.id,
    name: department.name,
    divisions: divisions
      .filter((division) => division.department_id === department.id && (isCentralHr(req.user)||allowed.some(s=>s.department_id===department.id && (!s.division_id||s.division_id===division.id))))
      .map((division) => ({ id: division.id, name: division.name })),
  })));
});

router.post(
  '/departments',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [body('name').isString().trim().isLength({ min: 1, max: 60 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    let created;
    try {
      const { rows } = await pool.query(
        'INSERT INTO hr_departments (name) VALUES ($1) RETURNING id, name', [req.body.name.trim()]
      );
      created = rows[0];
    } catch (err) {
      if (err.code === '23505') {
        res.status(409).json({ message: 'That department already exists.' });
        return;
      }
      throw err;
    }
    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: 'hr.department.created',
      entityType: 'hr_department',
      entityId: created.id,
      after: { name: created.name },
    });
    res.status(201).json({ ...created, divisions: [] });
  }
);

router.delete(
  '/departments/:id',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows } = await pool.query('SELECT id, name FROM hr_departments WHERE id = $1', [req.params.id]);
    if (!rows.length) {
      res.status(404).json({ message: 'Department not found.' });
      return;
    }
    const [{ rows: divisions }, { rows: staff }] = await Promise.all([
      pool.query('SELECT 1 FROM hr_divisions WHERE department_id = $1 LIMIT 1', [req.params.id]),
      pool.query('SELECT COUNT(*)::int AS count FROM hr_employees WHERE lower(btrim(department_code)) = lower($1)', [rows[0].name]),
    ]);
    if (divisions.length) {
      res.status(409).json({ message: 'Remove this department\'s divisions first.' });
      return;
    }
    if (staff[0].count > 0) {
      res.status(409).json({ message: `${staff[0].count} staff are assigned to this department. Move them first.` });
      return;
    }
    await pool.query('DELETE FROM hr_departments WHERE id = $1', [req.params.id]);
    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: 'hr.department.deleted',
      entityType: 'hr_department',
      entityId: rows[0].id,
      before: { name: rows[0].name },
    });
    res.json({ message: 'Department removed.' });
  }
);

router.post(
  '/departments/:id/divisions',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [param('id').isUUID(), body('name').isString().trim().isLength({ min: 1, max: 60 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows: department } = await pool.query('SELECT id, name FROM hr_departments WHERE id = $1', [req.params.id]);
    if (!department.length) {
      res.status(404).json({ message: 'Department not found.' });
      return;
    }
    let created;
    try {
      const { rows } = await pool.query(
        'INSERT INTO hr_divisions (department_id, name) VALUES ($1, $2) RETURNING id, name',
        [req.params.id, req.body.name.trim()]
      );
      created = rows[0];
    } catch (err) {
      if (err.code === '23505') {
        res.status(409).json({ message: 'That division already exists in this department.' });
        return;
      }
      throw err;
    }
    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: 'hr.division.created',
      entityType: 'hr_division',
      entityId: created.id,
      after: { name: created.name, department: department[0].name },
    });
    res.status(201).json(created);
  }
);

router.delete(
  '/divisions/:id',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows } = await pool.query(
      `SELECT v.id, v.name, d.name AS department_name
         FROM hr_divisions v JOIN hr_departments d ON d.id = v.department_id WHERE v.id = $1`,
      [req.params.id]
    );
    if (!rows.length) {
      res.status(404).json({ message: 'Division not found.' });
      return;
    }
    const { rows: staff } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM hr_employees
        WHERE lower(btrim(department_code)) = lower($1) AND lower(btrim(division_code)) = lower($2)`,
      [rows[0].department_name, rows[0].name]
    );
    if (staff[0].count > 0) {
      res.status(409).json({ message: `${staff[0].count} staff are assigned to this division. Move them first.` });
      return;
    }
    await pool.query('DELETE FROM hr_divisions WHERE id = $1', [req.params.id]);
    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: 'hr.division.deleted',
      entityType: 'hr_division',
      entityId: rows[0].id,
      before: { name: rows[0].name, department: rows[0].department_name },
    });
    res.json({ message: 'Division removed.' });
  }
);

router.get('/employees', requirePermission(PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.*, m.display_name AS manager_name
       FROM hr_employees e
       LEFT JOIN hr_employees m ON m.id = e.manager_id AND ${employeeScopeSql(req.user,'hr_staff_manage','$1','m')}
      WHERE ${employeeScopeSql(req.user,'hr_staff_manage')} ORDER BY e.status, e.display_name`,[req.user.id]
  );
  res.json(visibleEmployees(req, rows));
});

// One-call matrix for the "balances report": every active staff member
// against every active leave type. A type an employee has never been
// adjusted or applied against has no hr_leave_balances row yet (it is
// seeded lazily by ensureBalance on first touch), so it falls back to the
// type's default_days (or zero for accruable types) here — the same number
// that first touch would seed.
router.get(
  '/employees/balances',
  requirePermission(PERMISSIONS.HR_BALANCE_MANAGE, PERMISSIONS.HR_ADMIN),
  [query('year').optional().isInt()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const year = Number(req.query.year) || new Date().getFullYear();
    const [{ rows: employees }, { rows: types }, { rows: balances }] = await Promise.all([
      pool.query(
        `SELECT id, display_name, department_code, division_code, status, reviewer_id, email, join_date
           FROM hr_employees e
          WHERE status = 'active' AND leave_entitled = TRUE AND ${employeeScopeSql(req.user,'hr_balance_manage')}
          ORDER BY display_name`,[req.user.id]
      ),
      pool.query('SELECT id, name, default_days, is_accruable FROM hr_leave_types WHERE is_active = TRUE ORDER BY name'),
      pool.query(`SELECT b.employee_id,b.leave_type_id,b.balance,b.pending FROM hr_leave_balances b JOIN hr_employees e ON e.id=b.employee_id WHERE b.year=$1 AND ${employeeScopeSql(req.user,'hr_balance_manage','$2')}`, [year,req.user.id]),
    ]);
    const balanceByKey = new Map(balances.map((b) => [`${b.employee_id}:${b.leave_type_id}`, b]));
    const result = employees.map((e) => {
      const byType = {};
      for (const t of types) {
        const b = balanceByKey.get(`${e.id}:${t.id}`);
        byType[t.name] = {
          balance: b ? Number(b.balance) : (t.is_accruable ? 0 : Number(t.default_days)),
          pending: b ? Number(b.pending) : 0,
        };
      }
      return { ...e, balances: byType };
    });
    res.json({
      year,
      leave_types: types.map((t) => t.name),
      leave_type_rules: types.map((t) => ({
        name: t.name,
        default_days: Number(t.default_days),
        is_accruable: t.is_accruable,
      })),
      employees: result,
    });
  }
);

// Creates a leave/HR record ahead of a portal login existing — e.g. HR wants
// to set up someone's department, manager and opening balance before their
// account is provisioned. `reviewer_id` starts NULL; central HR verifies
// the link once a login exists. First use never claims a record by name.
router.post(
  '/employees',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [
    body('display_name').isString().trim().isLength({ min: 1, max: 200 }),
    body('position_title').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    body('department_code').optional({ nullable: true }).isString().isLength({ max: 60 }),
    body('division_code').optional({ nullable: true }).isString().isLength({ max: 60 }),
    body('manager_id').optional({ nullable: true }).isUUID(),
    body('join_date').optional({ nullable: true }).isISO8601(),
    body('leave_entitled').optional().isBoolean(),
    body('ineligible_reason').optional({ nullable: true }).isIn(INELIGIBLE_REASONS),
    body('study_leave_start').optional({ nullable: true }).isISO8601(),
    body('study_leave_end').optional({ nullable: true }).isISO8601(),
    body('eligibility_note').optional({ nullable: true }).isString().isLength({ max: 300 }),
    body('confirm').optional().isBoolean(),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;

    const orgUnit = await resolveOrgUnit(req.body.department_code, req.body.division_code);
    if (orgUnit.error) {
      res.status(400).json({ message: orgUnit.error });
      return;
    }
    const eligibility = resolveEligibility({ ...req.body, leave_entitled: req.body.leave_entitled ?? true });
    if (eligibility.error) {
      res.status(400).json({ message: eligibility.error });
      return;
    }

    // Catches a re-typed name before it becomes a second permanent record —
    // e.g. "Val-cade" entered here when "Valcade" already exists. Two people
    // can legitimately share a name, so this warns rather than blocks: the
    // caller re-submits with `confirm: true` to create it anyway.
    if (!req.body.confirm) {
      const key = normalizeNameKey(req.body.display_name);
      const { rows: existing } = await pool.query(
        "SELECT id, display_name, status FROM hr_employees WHERE status = 'active'"
      );
      const match = existing.find((row) => normalizeNameKey(row.display_name) === key);
      if (match) {
        res.status(409).json({
          message: `A staff record for "${match.display_name}" already exists. If this is a different person, submit again to confirm.`,
          existing_employee_id: match.id,
        });
        return;
      }

      // Catches the other direction: someone already has a portal login (set
      // up through User Management) but no staff record yet. This is a warning
      // for HR review, never authority to link the account by name.
      const { rows: unlinkedLogins } = await pool.query(
        `SELECT r.id, r.display_name, r.email FROM reviewers r
          LEFT JOIN hr_employees e ON e.reviewer_id = r.id
          WHERE r.status = 'active' AND e.id IS NULL`
      );
      const loginMatch = unlinkedLogins.find((row) => normalizeNameKey(row.display_name || row.email) === key);
      if (loginMatch) {
        res.status(409).json({
          message: `"${loginMatch.display_name || loginMatch.email}" already has a portal login without a staff record. Link it from User Management (the "Leave staff record" field) instead of creating a new one here — HR must verify whether this is the same employee.`,
          existing_reviewer_id: loginMatch.id,
        });
        return;
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO hr_employees (display_name, position_title, department_code, division_code, manager_id, join_date, leave_entitled,
                                 ineligible_reason, study_leave_start, study_leave_end, eligibility_note, department_id, division_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [req.body.display_name, req.body.position_title || null, orgUnit.department,
       orgUnit.division, req.body.manager_id || null, req.body.join_date || null, req.body.leave_entitled ?? true,
       eligibility.values.ineligible_reason, eligibility.values.study_leave_start,
       eligibility.values.study_leave_end, eligibility.values.eligibility_note, orgUnit.department_id, orgUnit.division_id]
    );
    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: 'hr.employee.created',
      entityType: 'hr_employee',
      entityId: rows[0].id,
      after: { display_name: rows[0].display_name },
    });
    res.status(201).json(rows[0]);
  }
);

/**
 * Columns an employment record update may touch. Also the allowlist the SET
 * clause is built from, so a request body can never name a column.
 *
 * `nullable` marks the ones that can be cleared: a field is only written when
 * the request actually carries it, so `null` means "clear this" rather than
 * "leave it alone". That distinction is why this does not use COALESCE — with
 * COALESCE a manager could be set but never removed, and a wrong join date
 * never blanked.
 */
const EMPLOYEE_UPDATABLE = {
  display_name: { nullable: false },
  manager_id: { nullable: true },
  position_title: { nullable: true },
  department_code: { nullable: true },
  division_code: { nullable: true },
  join_date: { nullable: true },
  reviewer_id: { nullable: true },
  daily_rate: { nullable: true },
  status: { nullable: false },
  leave_entitled: { nullable: false },
  ineligible_reason: { nullable: true },
  study_leave_start: { nullable: true },
  study_leave_end: { nullable: true },
  eligibility_note: { nullable: true },
};

/**
 * A cleared `<input type="date">` or `<select>` posts an empty string, which
 * means "no value". Normalising it to null before validation lets it clear the
 * column instead of failing the format check.
 */
function blankToNull(req, _res, next) {
  for (const [field, { nullable }] of Object.entries(EMPLOYEE_UPDATABLE)) {
    if (nullable && req.body?.[field] === '') req.body[field] = null;
  }
  next();
}

router.put(
  '/employees/:id',
  requirePermission(PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN),
  blankToNull,
  [
    param('id').isUUID(),
    body('display_name').optional().isString().trim().isLength({ min: 1, max: 200 }),
    body('manager_id').optional({ nullable: true }).isUUID(),
    body('position_title').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    body('department_code').optional({ nullable: true }).isString().isLength({ max: 60 }),
    body('division_code').optional({ nullable: true }).isString().isLength({ max: 60 }),
    body('join_date').optional({ nullable: true }).isISO8601(),
    body('reviewer_id').optional({ nullable: true }).isUUID(),
    body('daily_rate').optional({ nullable: true }).isFloat({ min: 0, max: 100000 }),
    // Both columns are NOT NULL, so null is rejected rather than treated as a clear.
    body('status').optional().isIn(['active', 'inactive']),
    body('leave_entitled').optional().isBoolean(),
    body('ineligible_reason').optional({ nullable: true }).isIn(INELIGIBLE_REASONS),
    body('study_leave_start').optional({ nullable: true }).isISO8601(),
    body('study_leave_end').optional({ nullable: true }).isISO8601(),
    body('eligibility_note').optional({ nullable: true }).isString().isLength({ max: 300 }),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;

    if (!isCentralHr(req.user) && Object.keys(req.body).some(key=>!['display_name','position_title','manager_id'].includes(key))) throw new ServiceError(403,'Central HR controls identity, placement, status and eligibility changes in historical tools.');
    if (!(await canAccessEmployee(pool,req.user,req.params.id,'hr_staff_manage'))) throw new ServiceError(404,'Employee not found.');
    if (req.body.manager_id && !(await canAccessEmployee(pool,req.user,req.body.manager_id,'hr_staff_manage'))) throw new ServiceError(404,'Reporting manager not found.');

    // Only the fields the caller actually sent, so an unmentioned field keeps
    // its value and an explicit null clears it.
    const updates = collectUpdates(req.body, Object.keys(EMPLOYEE_UPDATABLE));
    if (!Object.keys(updates).length) {
      res.status(400).json({ message: 'No changes were supplied.' });
      return;
    }
    if (updates.manager_id === req.params.id) {
      res.status(400).json({ message: 'An employee cannot be their own manager.' });
      return;
    }
    // Managing staff records and setting what they are paid are different
    // powers; HR_STAFF_MANAGE grants the first, not the second.
    if (Object.hasOwn(updates, 'daily_rate') && !canSeePay(req)) {
      res.status(403).json({ message: 'Only an administrator can set a pay rate.' });
      return;
    }

    const { rows: existing } = await pool.query('SELECT * FROM hr_employees WHERE id = $1', [req.params.id]);
    if (!existing.length) {
      res.status(404).json({ message: 'Employee not found.' });
      return;
    }

    // Only a changed department or division is checked, so an older record with
    // a value that is not in the list can still be edited for other reasons.
    if (Object.hasOwn(updates, 'department_code') || Object.hasOwn(updates, 'division_code')) {
      const orgUnit = await resolveOrgUnit(
        Object.hasOwn(updates, 'department_code') ? updates.department_code : existing[0].department_code,
        Object.hasOwn(updates, 'division_code') ? updates.division_code : existing[0].division_code
      );
      if (orgUnit.error) {
        res.status(400).json({ message: orgUnit.error });
        return;
      }
      updates.department_code = orgUnit.department;
      updates.division_code = orgUnit.division;
      updates.department_id = orgUnit.department_id;
      updates.division_id = orgUnit.division_id;
    }

    // The reason and study-leave dates only mean something together with the
    // toggle, so they are settled as a whole whenever any of them changes.
    const eligibilityFields = ['leave_entitled', 'ineligible_reason', 'study_leave_start', 'study_leave_end', 'eligibility_note'];
    if (eligibilityFields.some((field) => Object.hasOwn(updates, field))) {
      const eligibility = resolveEligibility({ ...existing[0], ...updates });
      if (eligibility.error) {
        res.status(400).json({ message: eligibility.error });
        return;
      }
      Object.assign(updates, eligibility.values);
    }

    // The contact address follows the linked login: linking adopts the
    // account's address, unlinking drops it so notifications cannot keep going
    // to a login that is no longer this person's.
    if (Object.hasOwn(updates, 'reviewer_id')) {
      if (req.user.permissions?.[PERMISSIONS.HR_ADMIN] !== true) {
        res.status(403).json({ message: 'Only central HR can verify an employee login link.' });
        return;
      }
      if (updates.reviewer_id === null) {
        updates.email = null;
      } else {
        const { rows: account } = await pool.query('SELECT email FROM reviewers WHERE id = $1', [updates.reviewer_id]);
        if (!account.length) {
          res.status(400).json({ message: 'No such account.' });
          return;
        }
        updates.email = account[0].email;
      }
    }

    // $1 is the id in the WHERE clause, so the assignments start at $2.
    const { clause, values } = buildUpdateAssignments(updates, 1);

    let updated;
    try {
      updated = await withTransaction(pool, async (client) => {
        // Preserve the managed screen's reporting-line invariant for direct legacy API edits.
        // Lock in the same UUID order used by management and Payroll import.
        if (Object.hasOwn(updates,'manager_id')) {
          const { rows: reportingLines } = await client.query('SELECT id,manager_id FROM hr_employees ORDER BY id FOR UPDATE');
          const managers = new Map(reportingLines.map(row=>[row.id,row.manager_id]));
          if (updates.manager_id && !managers.has(updates.manager_id)) throw new ServiceError(404,'Reporting manager not found.');
          const seen = new Set([req.params.id]);
          for (let id=updates.manager_id; id; id=managers.get(id)) {
            if (seen.has(id)) throw new ServiceError(400,'The reporting line would create a manager cycle.');
            seen.add(id);
          }
        }
        await assertEmployeeScope(client,req.user,req.params.id,'hr_staff_manage');
        if (updates.manager_id) await assertEmployeeScope(client,req.user,updates.manager_id,'hr_staff_manage');
        if (Object.hasOwn(updates, 'reviewer_id')) {
          await setEmployeeAccount(client, { employeeId: req.params.id, reviewerId: updates.reviewer_id,
            actor: { id: req.user.id, email: req.user.email, ip: req.ip },
            reason: 'Central HR confirmed the account link in Leave Staff.' });
        }
        const { rows } = await client.query(
          `UPDATE hr_employees SET ${clause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
          [req.params.id, ...values]
        );
        if (Object.hasOwn(updates,'status') && existing[0].status!==rows[0].status && rows[0].reviewer_id) await client.query('DELETE FROM reviewer_sessions WHERE reviewer_id=$1',[rows[0].reviewer_id]);
        return rows[0];
      });
    } catch (err) {
      if (err.code === '23505') {
        res.status(409).json({ message: 'That login is already linked to a different staff record.' });
        return;
      }
      throw err;
    }

    // Record what actually changed, so a balance or a reporting line can always
    // be explained later.
    const changed = changedFields(existing[0], updated, Object.keys(updates));
    if (changed.length) {
      await recordAudit({
        actor: { id: req.user.id, email: req.user.email, ip: req.ip },
        action: Object.hasOwn(updates, 'reviewer_id') ? 'hr.employee.linked' : 'hr.employee.updated',
        entityType: 'hr_employee',
        entityId: updated.id,
        before: Object.fromEntries(changed.map((field) => [field, existing[0][field]])),
        after: Object.fromEntries(changed.map((field) => [field, updated[field]])),
      });
    }

    // Recording that someone is away does not touch the requests already in
    // their approver's queue, and those requests can no longer be approved.
    // Saying so here is the only moment the administrator is in a position to
    // deal with them.
    let pendingWarning = null;
    if (existing[0].leave_entitled !== false && updated.leave_entitled === false) {
      const { rows: pending } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM hr_leave_applications
          WHERE employee_id = $1 AND status = 'pending'`,
        [updated.id]
      );
      if (pending[0].count > 0) {
        pendingWarning = `${updated.display_name} has ${pending[0].count} leave `
          + `application${pending[0].count === 1 ? '' : 's'} still awaiting approval. `
          + 'They can no longer be approved while this person is not entitled to leave — '
          + 'ask the approver to reject them, or have the applicant cancel them.';
      }
    }

    res.json({ ...visibleEmployee(req, updated), pending_leave_warning: pendingWarning });
  }
);

// Removes a staff record outright. The foreign keys from leave applications,
// balances and adjustments are ON DELETE CASCADE at the database level (so an
// org chart with managers can still delete cleanly), which means Postgres
// itself will not stop this from silently destroying real leave history —
// that guard has to live here. Deletion is refused once the record carries
// anything worth keeping: a linked login, any leave application, any balance
// adjustment, or a direct report pointing at it as their manager. A true
// duplicate — created moments ago, untouched — has none of those and is safe
// to remove; anything else should be set inactive instead (see PUT above).
//
// `force` lifts only the balance-adjustment guard, and only for an
// administrator: an opening balance set on a record that was itself created
// by mistake (the duplicate-staff scenario this route exists for) isn't real
// payroll history worth preserving — it's an artifact of the same error. The
// other three guards never lift, even forced: they'd either orphan a login,
// destroy an actual leave record, or strand someone's reporting line, none of
// which "this record shouldn't exist" excuses. What force deletes is written
// to the audit log before it goes, so the action stays accountable even
// though the row doesn't survive it.
router.delete(
  '/employees/:id',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [param('id').isUUID(), body('force').optional().isBoolean()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows: existing } = await pool.query('SELECT * FROM hr_employees WHERE id = $1', [req.params.id]);
    if (!existing.length) {
      res.status(404).json({ message: 'Employee not found.' });
      return;
    }
    const employee = existing[0];
    const forcing = req.body.force === true && req.user.permissions?.hr_admin === true;

    const reasons = [];
    if (employee.reviewer_id) reasons.push('it is linked to a portal login');
    const [{ rows: applications }, { rows: adjustments }, { rows: reports }] = await Promise.all([
      pool.query('SELECT 1 FROM hr_leave_applications WHERE employee_id = $1 LIMIT 1', [req.params.id]),
      pool.query('SELECT * FROM hr_leave_adjustments WHERE employee_id = $1', [req.params.id]),
      pool.query('SELECT 1 FROM hr_employees WHERE manager_id = $1 LIMIT 1', [req.params.id]),
    ]);
    if (applications.length) reasons.push('it has leave applications on file');
    if (adjustments.length && !forcing) reasons.push('it has balance history on file');
    if (reports.length) reasons.push('someone reports to it');

    if (reasons.length) {
      res.status(409).json({
        message: `"${employee.display_name}" can't be deleted because ${reasons.join(' and ')}. Set it to inactive instead.`,
        force_available: !forcing && adjustments.length > 0 && !applications.length && !reports.length && !employee.reviewer_id,
      });
      return;
    }

    await pool.query('DELETE FROM hr_employees WHERE id = $1', [req.params.id]);
    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: adjustments.length ? 'hr.employee.force_deleted' : 'hr.employee.deleted',
      entityType: 'hr_employee',
      entityId: req.params.id,
      before: {
        display_name: employee.display_name,
        department_code: employee.department_code,
        ...(adjustments.length ? { adjustments_destroyed: adjustments } : {}),
      },
    });
    res.status(204).end();
  }
);

// Bulk-creates unlinked staff records (like POST /employees, repeated) and
// sets each one's opening balance per leave type in the same call. Reuses
// ensureBalance's default-seed-then-adjust path so an import produces the
// exact same audit trail (hr_leave_adjustments) a manual adjustment would.
// Skips (never overwrites) any name that already has a staff record, so
// re-running an import after fixing a few rows is safe.
router.post(
  '/employees/import',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [
    body('rows').isArray({ min: 1, max: 500 }),
    body('rows.*.display_name').isString().trim().isLength({ min: 1, max: 200 }),
    body('rows.*.department_code').optional({ nullable: true }).isString().isLength({ max: 60 }),
    body('rows.*.division_code').optional({ nullable: true }).isString().isLength({ max: 60 }),
    body('rows.*.join_date').optional({ nullable: true }).isISO8601(),
    body('rows.*.balances').optional().isObject(),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const year = new Date().getFullYear();
    const [{ rows: existing }, { rows: types }, { rows: unlinkedLogins }] = await Promise.all([
      pool.query('SELECT display_name FROM hr_employees'),
      pool.query('SELECT id, name FROM hr_leave_types'),
      // Same cross-check as POST /employees: a login set up through User
      // Management, with no staff record yet, that this row is about to
      // duplicate under a differently-typed name instead of being linked to.
      pool.query(
        `SELECT r.display_name, r.email FROM reviewers r
          LEFT JOIN hr_employees e ON e.reviewer_id = r.id
          WHERE r.status = 'active' AND e.id IS NULL`
      ),
    ]);
    // Normalized (punctuation/spacing-insensitive) so "Val-cade" in a CSV
    // doesn't slip past a "Valcade" already on file — see normalizeNameKey.
    const existingNames = new Set(existing.map((r) => normalizeNameKey(r.display_name)));
    const unlinkedLoginNames = new Set(unlinkedLogins.map((r) => normalizeNameKey(r.display_name || r.email)));
    const typeByName = new Map(types.map((t) => [t.name.toLowerCase(), t]));

    const created = [];
    const skipped = [];
    for (const row of req.body.rows) {
      const name = row.display_name.trim();
      const key = normalizeNameKey(name);
      if (existingNames.has(key)) {
        skipped.push({ display_name: name, reason: 'A staff record with this name (or a close match) already exists.' });
        continue;
      }
      if (unlinkedLoginNames.has(key)) {
        skipped.push({ display_name: name, reason: 'A portal login with this name already exists without a staff record. Link it from User Management instead of importing it here.' });
        continue;
      }
      const orgUnit = await resolveOrgUnit(row.department_code, row.division_code);
      if (orgUnit.error) {
        skipped.push({ display_name: name, reason: orgUnit.error });
        continue;
      }
      try {
        const employeeId = await withTransaction(pool, async (client) => {
          const { rows: inserted } = await client.query(
            `INSERT INTO hr_employees (display_name, department_code, division_code, join_date,department_id,division_id)
             VALUES ($1, $2, $3, $4,$5,$6) RETURNING id`,
            [name, orgUnit.department, orgUnit.division, row.join_date || null,orgUnit.department_id,orgUnit.division_id]
          );
          const id = inserted[0].id;
          for (const [typeName, rawAmount] of Object.entries(row.balances || {})) {
            const amount = Number(rawAmount);
            const type = typeByName.get(String(typeName).trim().toLowerCase());
            if (!Number.isFinite(amount) || !type) continue;
            await setOpeningBalance(client, {
              employeeId: id,
              leaveTypeId: type.id,
              target: amount,
              reason: 'Bulk import: opening balance',
              actorId: req.user.id,
              year,
            });
          }
          return id;
        });
        existingNames.add(key);
        created.push({ id: employeeId, display_name: name });
      } catch (err) {
        console.error(`Bulk import failed for "${name}"`, err);
        skipped.push({ display_name: name, reason: 'Unable to import this row.' });
      }
    }

    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: 'hr.employees.bulk_import',
      entityType: 'hr_employee',
      entityId: null,
      after: { created: created.length, skipped: skipped.length },
    });

    res.status(201).json({ created, skipped });
  }
);

router.get(
  '/employees/:id/balances',
  requirePermission(PERMISSIONS.HR_BALANCE_MANAGE, PERMISSIONS.HR_ADMIN),
  [param('id').isUUID(), query('year').optional().isInt()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    if (!(await canAccessEmployee(pool,req.user,req.params.id,'hr_balance_manage'))) throw new ServiceError(404,'Employee not found.');
    const year = Number(req.query.year) || new Date().getFullYear();
    const { rows } = await pool.query(
      `SELECT b.*, t.name AS leave_type_name
         FROM hr_leave_balances b
         JOIN hr_leave_types t ON t.id = b.leave_type_id
        WHERE b.employee_id = $1 AND b.year = $2
        ORDER BY t.name`,
      [req.params.id, year]
    );
    res.json({ year, balances: rows });
  }
);

// Manual balance correction. The reason is mandatory and every adjustment is
// kept, so a balance can always be explained.
router.post(
  '/adjustments',
  requirePermission(PERMISSIONS.HR_BALANCE_MANAGE, PERMISSIONS.HR_ADMIN),
  [
    body('employee_id').isUUID(),
    body('leave_type_id').isUUID(),
    body('amount').isFloat(),
    body('reason').isString().isLength({ min: 3, max: 2000 }),
    body('year').optional().isInt(),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { amount, year, reason } = await adjustBalance(pool, {
      employeeId: req.body.employee_id,
      leaveTypeId: req.body.leave_type_id,
      amount: req.body.amount,
      reason: req.body.reason,
      actorId: req.user.id,
      year: req.body.year,
      authorize: client=>assertEmployeeScope(client,req.user,req.body.employee_id,'hr_balance_manage'),
    });
    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: 'hr.balance.adjusted',
      entityType: 'hr_employee',
      entityId: req.body.employee_id,
      after: { amount, reason, year },
    });
    res.status(201).json({ message: 'Balance adjusted.' });
  }
);

// ===== Leave policies =====

router.get('/policies', requirePermission(PERMISSIONS.HR_ADMIN), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*,
            ((SELECT COUNT(*) FROM hr_leave_applications a WHERE a.leave_type_id = t.id)
           + (SELECT COUNT(*) FROM hr_leave_balances b WHERE b.leave_type_id = t.id)
           + (SELECT COUNT(*) FROM hr_leave_adjustments adj WHERE adj.leave_type_id = t.id))::int AS usage_count
       FROM hr_leave_types t
      ORDER BY t.name`
  );
  res.json(rows);
});

router.post(
  '/policies',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [
    body('name').isString().isLength({ min: 1, max: 100 }),
    body('description').optional({ nullable: true }).isString().isLength({ max: 500 }),
    body('default_days').isFloat({ min: 0, max: 365 }),
    body('is_accruable').optional().isBoolean(),
    body('requires_note').optional().isBoolean(),
    body('accrual_days_per_fortnight').optional().isFloat({ min: 0, max: 365 }),
    body('reset_period').optional().isIn(['none', 'financial_year', 'anniversary']),
    body('max_balance').optional({ nullable: true }).isFloat({ min: 0, max: 1000 }),
    body('requires_attachment').optional().isBoolean(),
    body('attachment_label').optional({ nullable: true }).isString().isLength({ max: 200 }),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const { rows } = await pool.query(
        `INSERT INTO hr_leave_types (name, description, default_days, is_accruable, requires_note, accrual_days_per_fortnight, reset_period, max_balance, requires_attachment, attachment_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [req.body.name.trim(), req.body.description || null, req.body.default_days,
         req.body.is_accruable === true, req.body.requires_note === true,
         req.body.accrual_days_per_fortnight ?? 0, req.body.reset_period || 'none', req.body.max_balance ?? null,
         req.body.requires_attachment === true, String(req.body.attachment_label || '').trim() || null]
      );
      await recordAudit({
        actor: { id: req.user.id, email: req.user.email, ip: req.ip },
        action: 'hr.leave_type.created',
        entityType: 'hr_leave_type',
        entityId: rows[0].id,
        after: { name: rows[0].name },
      });
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        res.status(409).json({ message: 'A leave type with that name already exists.' });
        return;
      }
      throw err;
    }
  }
);

router.put(
  '/policies/:id',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [
    param('id').isUUID(),
    body('name').optional().isString().isLength({ min: 1, max: 100 }),
    body('description').optional({ nullable: true }).isString().isLength({ max: 500 }),
    body('default_days').optional().isFloat({ min: 0, max: 365 }),
    body('is_accruable').optional().isBoolean(),
    body('requires_note').optional().isBoolean(),
    body('is_active').optional().isBoolean(),
    body('accrual_days_per_fortnight').optional().isFloat({ min: 0, max: 365 }),
    body('reset_period').optional().isIn(['none', 'financial_year', 'anniversary']),
    body('max_balance').optional({ nullable: true }).isFloat({ min: 0, max: 1000 }),
    body('requires_attachment').optional().isBoolean(),
    body('attachment_label').optional({ nullable: true }).isString().isLength({ max: 200 }),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const before = await pool.query('SELECT * FROM hr_leave_types WHERE id = $1', [req.params.id]);
    if (!before.rows.length) {
      res.status(404).json({ message: 'Leave type not found.' });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE hr_leave_types
          SET name = COALESCE($2, name),
              description = COALESCE($3, description),
              default_days = COALESCE($4, default_days),
              is_accruable = COALESCE($5, is_accruable),
              requires_note = COALESCE($6, requires_note),
              is_active = COALESCE($7, is_active),
              accrual_days_per_fortnight = COALESCE($8, accrual_days_per_fortnight),
              reset_period = COALESCE($9, reset_period),
              max_balance = CASE WHEN $10::boolean THEN $11::numeric ELSE max_balance END,
              requires_attachment = COALESCE($12, requires_attachment),
              attachment_label = CASE WHEN $13::boolean THEN $14::text ELSE attachment_label END
        WHERE id = $1 RETURNING *`,
      [req.params.id, req.body.name ?? null, req.body.description ?? null, req.body.default_days ?? null,
       req.body.is_accruable ?? null, req.body.requires_note ?? null, req.body.is_active ?? null,
       req.body.accrual_days_per_fortnight ?? null, req.body.reset_period ?? null,
       Object.hasOwn(req.body, 'max_balance'), req.body.max_balance ?? null,
       req.body.requires_attachment ?? null,
       Object.hasOwn(req.body, 'attachment_label'), String(req.body.attachment_label || '').trim() || null]
    );
    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: 'hr.leave_type.updated',
      entityType: 'hr_leave_type',
      entityId: req.params.id,
      before: { name: before.rows[0].name, default_days: before.rows[0].default_days, max_balance: before.rows[0].max_balance },
      after: { name: rows[0].name, default_days: rows[0].default_days, max_balance: rows[0].max_balance },
    });
    res.json(rows[0]);
  }
);

// Deleting a leave type is allowed only when nothing references it — i.e. it
// has never been applied against, held a balance, or been adjusted. A type in
// use cannot be removed without breaking the historical record.
router.delete(
  '/policies/:id',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows: usage } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM hr_leave_applications WHERE leave_type_id = $1) AS apps,
         (SELECT COUNT(*) FROM hr_leave_balances WHERE leave_type_id = $1) AS balances,
         (SELECT COUNT(*) FROM hr_leave_adjustments WHERE leave_type_id = $1) AS adjustments`,
      [req.params.id]
    );
    if (!usage.length) {
      res.status(404).json({ message: 'Leave type not found.' });
      return;
    }
    const used = Number(usage[0].apps) + Number(usage[0].balances) + Number(usage[0].adjustments);
    if (used > 0) {
      res.status(409).json({
        message: 'This leave type is already in use and cannot be deleted. Deactivate it instead.',
      });
      return;
    }
    const { rows } = await pool.query('DELETE FROM hr_leave_types WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows.length) {
      res.status(404).json({ message: 'Leave type not found.' });
      return;
    }
    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: 'hr.leave_type.deleted',
      entityType: 'hr_leave_type',
      entityId: req.params.id,
      after: { name: rows[0].name },
    });
    res.json({ message: 'Leave type deleted.' });
  }
);

// ===== Public holidays =====

// Days the office is closed. Everyone needs to read them — the application
// form previews a day count with them applied — but only an administrator sets
// them.
router.get('/public-holidays', requirePermission(PERMISSIONS.HR_ACCESS), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date, name
       FROM hr_public_holidays ORDER BY holiday_date`
  );
  res.json(rows);
});

router.post(
  '/public-holidays',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [
    body('holiday_date').isISO8601(),
    body('name').isString().trim().isLength({ min: 1, max: 120 }),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const day = toIsoDate(parseDateOnly(req.body.holiday_date));
    let created;
    try {
      const { rows } = await pool.query(
        `INSERT INTO hr_public_holidays (holiday_date, name, created_by)
         VALUES ($1, $2, $3)
         RETURNING id, to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date, name`,
        [day, req.body.name.trim(), req.user.id]
      );
      created = rows[0];
    } catch (err) {
      if (err.code === '23505') {
        res.status(409).json({ message: 'That date is already a public holiday.' });
        return;
      }
      throw err;
    }
    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: 'hr.public_holiday.created',
      entityType: 'hr_public_holiday',
      entityId: created.id,
      after: { holiday_date: created.holiday_date, name: created.name },
    });
    res.status(201).json(created);
  }
);

router.delete(
  '/public-holidays/:id',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows } = await pool.query(
      `DELETE FROM hr_public_holidays WHERE id = $1
       RETURNING to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date, name`,
      [req.params.id]
    );
    if (!rows.length) {
      res.status(404).json({ message: 'Public holiday not found.' });
      return;
    }
    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: 'hr.public_holiday.deleted',
      entityType: 'hr_public_holiday',
      entityId: req.params.id,
      after: { holiday_date: rows[0].holiday_date, name: rows[0].name },
    });
    res.json({ message: 'Public holiday removed.' });
  }
);

// ===== Accrual & reset =====

/**
 * Runs one fortnight of accrual and any due balance resets. Idempotent per
 * `period_end` (accrual) and per balance's `last_reset_at` (reset).
 */
router.post(
  '/accrual/run',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [body('period_end').optional().isISO8601()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const periodEnd = req.body.period_end
      ? toIsoDate(parseDateOnly(req.body.period_end))
      : toIsoDate(new Date());
    const periodStart = parseDateOnly(periodEnd);
    periodStart.setDate(periodStart.getDate() - 13);

    const { credited, reset } = await withTransaction(pool, async (client) => {
      const { rows: existingRun } = await client.query(
        'SELECT id FROM hr_accrual_runs WHERE period_end = $1',
        [periodEnd]
      );
      if (existingRun.length) {
        throw new ServiceError(409, `Accrual for the period ending ${periodEnd} has already been run.`);
      }

      const outcome = await runLeaveAccrual(client, { periodEnd, actorId: req.user.id });
      await client.query(
        'INSERT INTO hr_accrual_runs (period_end, credited, run_by) VALUES ($1, $2, $3)',
        [periodEnd, outcome.credited, req.user.id]
      );
      return outcome;
    });

    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: 'hr.accrual.run',
      entityType: 'hr_accrual_run',
      entityId: null,
      after: { period_start: toIsoDate(periodStart), period_end: periodEnd, credited, reset },
    });

    res.status(201).json({
      message: `Accrual complete: ${credited} balance(s) credited, ${reset} balance(s) reset.`,
      period_end: periodEnd,
      credited,
      reset,
    });
  }
);

// The first pay date of the fortnightly accrual schedule. Once set, the server
// runs accrual on this date and every 14 days after it, automatically.
router.get('/accrual/settings', requirePermission(PERMISSIONS.HR_ADMIN), async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT accrual_anchor_date FROM reviewer_settings WHERE id = TRUE'
  );
  res.json({ accrual_anchor_date: rows[0]?.accrual_anchor_date || null });
});

router.put(
  '/accrual/settings',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [body('accrual_anchor_date').optional({ nullable: true }).isISO8601()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const value = req.body.accrual_anchor_date
      ? toIsoDate(parseDateOnly(req.body.accrual_anchor_date))
      : null;
    await pool.query(
      `INSERT INTO reviewer_settings (id, accrual_anchor_date)
       VALUES (TRUE, $1)
       ON CONFLICT (id) DO UPDATE SET accrual_anchor_date = EXCLUDED.accrual_anchor_date`,
      [value]
    );
    await recordAudit({
      actor: { id: req.user.id, email: req.user.email, ip: req.ip },
      action: 'hr.accrual.settings.updated',
      entityType: 'reviewer_settings',
      entityId: 'hr_accrual_anchor_date',
      after: { accrual_anchor_date: value },
    });
    res.json({ accrual_anchor_date: value });
  }
);

// ===== Senior management overview =====

/**
 * Working days of one application that fall inside the reporting window.
 *
 * Every "days taken" figure on the overview uses this, so the tiles, the bars
 * and the trend line all measure the same thing and add up to each other. The
 * alternative — summing `a.days`, the application's whole length — credits a
 * ten-day absence entirely to whichever window it touches, so a leave starting
 * three days before the window still contributed all ten days to it.
 *
 * Mon-Fri inclusive, matching calculateWorkingDays() in lib/leaveDates.js, so a figure here is
 * comparable with the days deducted from a balance. Correlated on `a`, so it
 * only makes sense inside a LATERAL join against hr_leave_applications, with
 * the window bound to $1 and $2.
 */
const WORKING_DAYS_IN_RANGE = `(
  SELECT COUNT(*)::numeric AS days
    FROM generate_series(
      GREATEST(a.start_date, $1::date), LEAST(a.end_date, $2::date), INTERVAL '1 day'
    ) AS day
   WHERE EXTRACT(ISODOW FROM day) < 6
     AND NOT EXISTS (SELECT 1 FROM hr_public_holidays h WHERE h.holiday_date = day::date)
)`;

// Aggregate KPIs for leadership: headcount, application throughput, usage by
// type/department, a monthly trend, and who's out soon. HR_ADMIN only — this
// is a leadership summary, not a personal or team view.
router.get(
  '/overview',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [query('from').optional().isISO8601(), query('to').optional().isISO8601()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const today = new Date();
    const to = req.query.to || today.toISOString().slice(0, 10);
    const from = req.query.from || new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1)
      .toISOString().slice(0, 10);

    const [
      headcount, applications, turnaround, byType, byDepartment, monthly, upcoming,
      pendingAge, negative, excess, studyReturnDue, coverage, liability, balanceByType,
    ] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM hr_employees WHERE status = 'active') AS active_employees,
           (SELECT COUNT(*) FROM (
              SELECT a.employee_id FROM hr_leave_applications a
               WHERE a.status = 'approved' AND a.start_date <= CURRENT_DATE AND a.end_date >= CURRENT_DATE
              UNION
              SELECT e.id FROM hr_employees e
               WHERE e.status = 'active' AND e.leave_entitled = FALSE AND e.ineligible_reason = 'study_leave'
                 AND e.study_leave_start <= CURRENT_DATE
                 AND (e.study_leave_end IS NULL OR e.study_leave_end >= CURRENT_DATE)
            ) away_today) AS on_leave_today,
           (SELECT COUNT(*) FROM hr_employees e
             WHERE e.status = 'active' AND e.leave_entitled = FALSE AND e.ineligible_reason = 'study_leave'
               AND e.study_leave_start <= CURRENT_DATE
               AND (e.study_leave_end IS NULL OR e.study_leave_end >= CURRENT_DATE)) AS on_study_leave`
      ),
      pool.query(
        `SELECT status, COUNT(*) AS count
           FROM hr_leave_applications
          WHERE applied_at >= $1 AND applied_at < ($2::date + INTERVAL '1 day')
          GROUP BY status`,
        [from, to]
      ),
      pool.query(
        `SELECT AVG(EXTRACT(EPOCH FROM (reviewed_at - applied_at)) / 3600) AS avg_hours
           FROM hr_leave_applications
          WHERE applied_at >= $1 AND applied_at < ($2::date + INTERVAL '1 day') AND reviewed_at IS NOT NULL`,
        [from, to]
      ),
      pool.query(
        `SELECT t.name AS leave_type, SUM(w.days) AS days, COUNT(*) FILTER (WHERE w.days > 0) AS count
           FROM hr_leave_applications a
           JOIN hr_leave_types t ON t.id = a.leave_type_id
           CROSS JOIN LATERAL ${WORKING_DAYS_IN_RANGE} w
          WHERE a.status = 'approved' AND a.start_date <= $2 AND a.end_date >= $1
          GROUP BY t.name
          ORDER BY days DESC`,
        [from, to]
      ),
      pool.query(
        `SELECT COALESCE(e.department_code, 'Unassigned') AS department_code, SUM(w.days) AS days, COUNT(*) FILTER (WHERE w.days > 0) AS count
           FROM hr_leave_applications a
           JOIN hr_employees e ON e.id = a.employee_id
           CROSS JOIN LATERAL ${WORKING_DAYS_IN_RANGE} w
          WHERE a.status = 'approved' AND a.start_date <= $2 AND a.end_date >= $1
          GROUP BY department_code
          ORDER BY days DESC`,
        [from, to]
      ),
      pool.query(
        `SELECT to_char(day, 'YYYY-MM') AS month,
                COUNT(*)::numeric AS days, COUNT(DISTINCT a.id) AS count
           FROM hr_leave_applications a
           CROSS JOIN LATERAL generate_series(
             GREATEST(a.start_date, $1::date), LEAST(a.end_date, $2::date), INTERVAL '1 day'
           ) AS day
          WHERE a.status = 'approved' AND a.start_date <= $2 AND a.end_date >= $1
            AND EXTRACT(ISODOW FROM day) < 6
            AND NOT EXISTS (SELECT 1 FROM hr_public_holidays h WHERE h.holiday_date = day::date)
          GROUP BY month
          ORDER BY month`,
        [from, to]
      ),
      pool.query(
        `SELECT e.display_name AS employee_name, t.name AS leave_type_name,
                a.start_date, a.end_date, a.days
           FROM hr_leave_applications a
           JOIN hr_employees e ON e.id = a.employee_id
           JOIN hr_leave_types t ON t.id = a.leave_type_id
          WHERE a.status = 'approved' AND a.start_date >= CURRENT_DATE
            AND a.start_date <= CURRENT_DATE + INTERVAL '30 days'
          ORDER BY a.start_date
          LIMIT 10`
      ),
      // ---- Exceptions: the things a manager should act on ----
      //
      // How long approvals have been waiting. "24 pending" is a workload;
      // "3 waiting over five days" is something somebody has to do today.
      pool.query(
        `SELECT
           COUNT(*) AS pending_approvals,
           COUNT(*) FILTER (WHERE applied_at < NOW() - INTERVAL '5 days') AS over_five_days,
           COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - applied_at)) / 86400), 0) AS oldest_days
           FROM hr_leave_applications WHERE status = 'pending'`
      ),
      // Balances that have gone below zero. The staff report already paints
      // these red, so they happen; the overview never said so.
      pool.query(
        `SELECT COUNT(DISTINCT e.id) AS count
           FROM hr_leave_balances b
           JOIN hr_employees e ON e.id = b.employee_id
          WHERE e.status = 'active' AND b.year = $1 AND (b.balance - b.pending) < 0`,
        [today.getFullYear()]
      ),
      // Staff sitting on more than twice their annual entitlement of an earned
      // type. Both a growing liability and a wellbeing signal: people who
      // never take leave.
      pool.query(
        `WITH excess_people AS (
           SELECT DISTINCT e.id, e.display_name
             FROM hr_leave_balances b
             JOIN hr_leave_types t ON t.id = b.leave_type_id
             JOIN hr_employees e ON e.id = b.employee_id
            WHERE e.status = 'active' AND e.leave_entitled = TRUE AND b.year = $1
              AND t.is_active = TRUE AND t.is_accruable = TRUE AND t.default_days > 0
              AND (b.balance - b.pending) > 2 * t.default_days
         )
         SELECT COUNT(*) AS count,
                COALESCE((
                  SELECT json_agg(display_name ORDER BY display_name)
                    FROM (SELECT display_name FROM excess_people ORDER BY display_name LIMIT 3) preview
                ), '[]'::json) AS employee_names
           FROM excess_people`,
        [today.getFullYear()]
      ),
      // Study leave whose return date has been and gone. Nothing restores
      // eligibility automatically — deliberately, because somebody has to
      // confirm the person actually came back — so until an administrator
      // does, they cannot apply for leave and accrue nothing. That is a
      // silence worth breaking.
      pool.query(
        `SELECT COUNT(*) AS count,
                COALESCE((
                  SELECT json_agg(display_name ORDER BY display_name)
                    FROM (
                      SELECT display_name FROM hr_employees
                       WHERE status = 'active' AND leave_entitled = FALSE
                         AND ineligible_reason = 'study_leave'
                         AND study_leave_end IS NOT NULL AND study_leave_end < CURRENT_DATE
                       ORDER BY display_name LIMIT 3
                    ) preview
                ), '[]'::json) AS employee_names
           FROM hr_employees
          WHERE status = 'active' AND leave_entitled = FALSE
            AND ineligible_reason = 'study_leave'
            AND study_leave_end IS NOT NULL AND study_leave_end < CURRENT_DATE`
      ),
      // Coverage risk: a department with more than a third of its people away
      // on the same working day in the next month. This is the question a
      // roster cannot answer at a glance but a schedule depends on.
      pool.query(
        `WITH department_size AS (
           SELECT COALESCE(department_code, 'Unassigned') AS department_code, COUNT(*) AS headcount
             FROM hr_employees WHERE status = 'active'
            GROUP BY 1
         ),
         away AS (
           SELECT department_code, day, COUNT(DISTINCT employee_id) AS people_out
             FROM (
               SELECT a.employee_id, COALESCE(e.department_code, 'Unassigned') AS department_code, day::date AS day
                 FROM hr_leave_applications a
                 JOIN hr_employees e ON e.id = a.employee_id
                 CROSS JOIN LATERAL generate_series(
                   GREATEST(a.start_date, CURRENT_DATE),
                   LEAST(a.end_date, CURRENT_DATE + INTERVAL '30 days'),
                   INTERVAL '1 day'
                 ) AS day
                WHERE a.status = 'approved'
                  AND a.start_date <= CURRENT_DATE + INTERVAL '30 days' AND a.end_date >= CURRENT_DATE
                  AND EXTRACT(ISODOW FROM day) < 6
                  AND NOT EXISTS (SELECT 1 FROM hr_public_holidays h WHERE h.holiday_date = day::date)
               UNION ALL
               SELECT e.id, COALESCE(e.department_code, 'Unassigned'), day::date
                 FROM hr_employees e
                 CROSS JOIN LATERAL generate_series(
                   GREATEST(e.study_leave_start, CURRENT_DATE),
                   LEAST(COALESCE(e.study_leave_end, CURRENT_DATE + 30), CURRENT_DATE + 30),
                   INTERVAL '1 day'
                 ) AS day
                WHERE e.status = 'active' AND e.leave_entitled = FALSE AND e.ineligible_reason = 'study_leave'
                  AND e.study_leave_start <= CURRENT_DATE + 30
                  AND (e.study_leave_end IS NULL OR e.study_leave_end >= CURRENT_DATE)
                  AND EXTRACT(ISODOW FROM day) < 6
                  AND NOT EXISTS (SELECT 1 FROM hr_public_holidays h WHERE h.holiday_date = day::date)
             ) absences
            GROUP BY 1, 2
         )
         SELECT away.department_code, to_char(away.day, 'YYYY-MM-DD') AS day,
                away.people_out, d.headcount,
                ROUND(away.people_out * 100.0 / d.headcount) AS percent_out
           FROM away JOIN department_size d USING (department_code)
          WHERE d.headcount > 0 AND away.people_out * 3 > d.headcount
          ORDER BY percent_out DESC, away.day
          LIMIT 5`
      ),
      // Leave liability: what the unused balances would cost to pay out.
      //
      // Only accruable types count. Those are *earned* — untaken days are owed
      // and are a provision on the books. An upfront grant like sick leave is
      // an allowance, not something owed on separation, so including it would
      // overstate the figure badly.
      //
      // Staff with no rate recorded are left out rather than counted at zero,
      // and are reported alongside so the number is read with its coverage.
      pool.query(
        `SELECT
           COALESCE(SUM(available * e.daily_rate), 0) AS liability,
           COALESCE(SUM(available) FILTER (WHERE e.daily_rate IS NOT NULL), 0) AS valued_days,
           COUNT(DISTINCT e.id) FILTER (WHERE e.daily_rate IS NULL) AS staff_without_rate,
           COUNT(DISTINCT e.id) AS staff_total
           FROM hr_leave_types t
           CROSS JOIN hr_employees e
           LEFT JOIN hr_leave_balances b
             ON b.employee_id = e.id AND b.leave_type_id = t.id AND b.year = $1
           CROSS JOIN LATERAL (
             SELECT GREATEST(COALESCE(b.balance, 0) - COALESCE(b.pending, 0), 0) AS available
           ) AS v
          WHERE t.is_active = TRUE AND t.is_accruable = TRUE
            AND e.status = 'active' AND e.leave_entitled = TRUE`,
        [today.getFullYear()]
      ),
      // Stock, not flow: how many unused days are currently sitting on the
      // books per leave type, across active staff, this calendar year. A
      // type never touched for a given employee has no balance row yet
      // (ensureBalance seeds it lazily) so it falls back to default_days (or
      // zero for accruable types), the same number a first touch would seed.
      pool.query(
        `SELECT t.name AS leave_type,
                SUM(GREATEST(COALESCE(b.balance, CASE WHEN t.is_accruable THEN 0 ELSE t.default_days END) - COALESCE(b.pending, 0), 0)) AS available_days
           FROM hr_leave_types t
           CROSS JOIN hr_employees e
           LEFT JOIN hr_leave_balances b
             ON b.employee_id = e.id AND b.leave_type_id = t.id AND b.year = $1
          WHERE t.is_active = TRUE AND e.status = 'active' AND e.leave_entitled = TRUE
          GROUP BY t.name
          ORDER BY available_days DESC`,
        [today.getFullYear()]
      ),
    ]);

    const byTypeRows = byType.rows.map((r) => ({
      leave_type: r.leave_type, days: Number(r.days), count: Number(r.count),
    }));

    const statusCounts = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
    for (const row of applications.rows) statusCounts[row.status] = Number(row.count);

    // Fill every month in range so the trend line has no gaps to misread as
    // zero-vs-missing. Built by integer arithmetic on the YYYY-MM-DD strings
    // rather than by stepping a Date, which would put the month a day out
    // whenever the server's timezone is not the one the dates were written in.
    const monthByKey = new Map(monthly.rows.map((r) => [r.month, { days: Number(r.days), count: Number(r.count) }]));
    const trendMonths = monthsBetween(from, to).map((month) => ({
      month,
      days: monthByKey.get(month)?.days || 0,
      count: monthByKey.get(month)?.count || 0,
    }));

    res.json({
      from,
      to,
      headcount: {
        active_employees: Number(headcount.rows[0].active_employees),
        on_leave_today: Number(headcount.rows[0].on_leave_today),
        on_study_leave: Number(headcount.rows[0].on_study_leave),
      },
      applications: {
        ...statusCounts,
        total: Object.values(statusCounts).reduce((sum, n) => sum + n, 0),
        avg_turnaround_hours: turnaround.rows[0].avg_hours ? Number(turnaround.rows[0].avg_hours) : null,
      },
      // The figure every "days taken" panel sums to. Stated outright so the
      // dashboard can be checked against itself at a glance.
      days_taken: byTypeRows.reduce((sum, r) => sum + r.days, 0),
      exceptions: {
        pending_approvals: Number(pendingAge.rows[0].pending_approvals),
        pending_over_five_days: Number(pendingAge.rows[0].over_five_days),
        oldest_pending_days: Number(pendingAge.rows[0].oldest_days),
        negative_balances: Number(negative.rows[0].count),
        excess_balances: Number(excess.rows[0].count),
        excess_employee_names: excess.rows[0].employee_names,
        study_leave_return_due: Number(studyReturnDue.rows[0].count),
        study_leave_return_names: studyReturnDue.rows[0].employee_names,
        coverage_risks: coverage.rows.map((r) => ({
          department_code: r.department_code,
          day: r.day,
          people_out: Number(r.people_out),
          headcount: Number(r.headcount),
          percent_out: Number(r.percent_out),
        })),
      },
      liability: {
        value: Number(liability.rows[0].liability),
        days: Number(liability.rows[0].valued_days),
        staff_without_rate: Number(liability.rows[0].staff_without_rate),
        staff_total: Number(liability.rows[0].staff_total),
      },
      by_type: byTypeRows,
      by_department: byDepartment.rows.map((r) => ({
        department_code: r.department_code, days: Number(r.days), count: Number(r.count),
      })),
      monthly_trend: trendMonths,
      upcoming: upcoming.rows.map((r) => ({ ...r, days: Number(r.days) })),
      balance_by_type: balanceByType.rows.map((r) => ({
        leave_type: r.leave_type, available_days: Number(r.available_days),
      })),
    });
  }
);

// Who is behind a bar on the overview.
//
// The dashboard used to be a poster: a department could be shown taking twice
// as much leave as any other with no way to ask who. This answers that, using
// the same windowed measure as the chart so the rows add up to the bar.
router.get(
  '/overview/breakdown',
  requirePermission(PERMISSIONS.HR_ADMIN),
  [
    query('dimension').isIn(['department', 'leave_type']),
    query('value').isString().isLength({ min: 1, max: 200 }),
    query('from').isISO8601(),
    query('to').isISO8601(),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const byDepartment = req.query.dimension === 'department';
    const { rows } = await pool.query(
      `SELECT e.display_name AS employee_name,
              COALESCE(e.department_code, 'Unassigned') AS department_code,
              t.name AS leave_type_name,
              SUM(w.days) AS days,
              COUNT(*) FILTER (WHERE w.days > 0) AS applications
         FROM hr_leave_applications a
         JOIN hr_employees e ON e.id = a.employee_id
         JOIN hr_leave_types t ON t.id = a.leave_type_id
         CROSS JOIN LATERAL ${WORKING_DAYS_IN_RANGE} w
        WHERE a.status = 'approved' AND a.start_date <= $2 AND a.end_date >= $1
          AND ${byDepartment ? "COALESCE(e.department_code, 'Unassigned') = $3" : 't.name = $3'}
        GROUP BY e.display_name, department_code, t.name
       HAVING SUM(w.days) > 0
        ORDER BY days DESC, e.display_name`,
      [req.query.from, req.query.to, req.query.value]
    );
    res.json({
      dimension: req.query.dimension,
      value: req.query.value,
      rows: rows.map((r) => ({ ...r, days: Number(r.days), applications: Number(r.applications) })),
    });
  }
);

// ===== Calendar and reporting =====

// Approved leave across the people the caller can see, for the roster view.
router.get(
  '/calendar',
  requirePermission(PERMISSIONS.HR_ACCESS),
  [query('from').isISO8601(), query('to').isISO8601()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows: applications } = await pool.query(
      `SELECT a.id, a.employee_id, a.start_date, a.end_date, a.days, a.status,
              t.name AS leave_type_name, e.display_name AS employee_name, e.department_code,
              'leave' AS kind
         FROM hr_leave_applications a
         JOIN hr_leave_types t ON t.id = a.leave_type_id
         JOIN hr_employees e ON e.id = a.employee_id
        WHERE a.status = 'approved'
          AND NOT EXISTS(SELECT 1 FROM hr_gov_legacy_transfers tr JOIN hr_gov_requests gr ON gr.id=tr.request_id WHERE tr.legacy_request_id=a.id AND gr.status='approved')
          AND a.start_date <= $2 AND a.end_date >= $1
          AND ${employeeReadSql(req.user,'$3','e',true)}
        ORDER BY a.start_date, e.display_name`,
      [req.query.from, req.query.to, req.user.id]
    );
    // Study leave is a period away recorded on the staff record, not an application.
    const { rows: studyLeave } = await pool.query(
      `SELECT 'study-' || e.id AS id, e.id AS employee_id, e.study_leave_start AS start_date, e.study_leave_end AS end_date,
              NULL::numeric AS days, 'approved' AS status, 'Study leave' AS leave_type_name,
              e.display_name AS employee_name, e.department_code, 'study_leave' AS kind
         FROM hr_employees e
        WHERE e.status = 'active' AND e.leave_entitled = FALSE AND e.ineligible_reason = 'study_leave'
          AND e.study_leave_start <= $2 AND (e.study_leave_end IS NULL OR e.study_leave_end >= $1)
          AND ${employeeReadSql(req.user,'$3','e',true)}
        ORDER BY e.display_name`,
      [req.query.from, req.query.to, req.user.id]
    );
    res.json([...applications, ...studyLeave]);
  }
);

// Approved leave per person for a pay period. Returned as rows; the client
// turns it into CSV so no spreadsheet dependency is needed server side.
//
// Counts only the working days falling inside the requested window, the same
// measure the overview uses, so the export and the dashboard agree. Summing
// each application's whole length instead would count a leave that straddles
// two pay periods in full against both of them.
router.get(
  '/report',
  requirePermission(PERMISSIONS.HR_REPORT_READ, PERMISSIONS.HR_ADMIN),
  [query('from').isISO8601(), query('to').isISO8601()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows } = await pool.query(
      `SELECT e.display_name AS employee_name, e.department_code, t.name AS leave_type_name,
              SUM(w.days) AS total_days, COUNT(*) FILTER (WHERE w.days > 0) AS applications
         FROM hr_leave_applications a
         JOIN hr_leave_types t ON t.id = a.leave_type_id
         JOIN hr_employees e ON e.id = a.employee_id
         CROSS JOIN LATERAL ${WORKING_DAYS_IN_RANGE} w
        WHERE a.status = 'approved'
          AND a.start_date <= $2 AND a.end_date >= $1
          AND ${employeeScopeSql(req.user,'hr_report_read','$3')}
        GROUP BY e.display_name, e.department_code, t.name
        ORDER BY e.display_name, t.name`,
      [req.query.from, req.query.to,req.user.id]
    );
    res.json({ from: req.query.from, to: req.query.to, rows });
  }
);

export default router;

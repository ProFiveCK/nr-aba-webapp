import express from 'express';
import {leaveOverview,leaveOverviewBreakdown,leavePlanning} from '../services/leaveOverview.js';
import {createOrganisationDivision} from '../services/organisationHierarchy.js';
import { body, param, query, handleValidation } from '../middleware/validation.js';
import { pool } from '../db.js';
import { requirePermission } from '../services/authService.js';
import { recordAudit } from '../services/auditService.js';
import { INELIGIBLE_REASONS, resolveEligibility } from '../lib/eligibility.js';
import { parseDateOnly, toIsoDate } from '../lib/leaveDates.js';
import { generateLeaveApplicationPdf } from '../services/leaveApplicationPdf.js';
import {buildUpdateAssignments, changedFields, collectUpdates} from '../lib/sqlUpdate.js';
import {normalizeNameKey} from '../lib/names.js';
import { ServiceError } from '../lib/serviceError.js';
import { PERMISSIONS } from '../config.js';
import { withTransaction } from '../lib/transaction.js';

import hrAccessRouter from './hrAccess.js';
import { CALENDAR_VIEWS, MASKED_LEAVE_LABEL, ROSTER_VIEWS, calendarAudienceSql, calendarRoster, unitNamesSql } from '../services/leaveCalendar.js';
import employeeOnboardingRouter from './employeeOnboarding.js';
import governmentLeaveRouter from './governmentLeave.js';
import { assertEmployeeScope,canAccessEmployee,employeeReadSql,employeeScopeSql,isCentralHr,managerScopeSql,activeScopeSql,canReadEvidence,evidenceReadSql } from '../services/hrAccess.js';
import employeeDirectoryRouter from './employeeDirectory.js';
import { routineReason } from '../middleware/routineReason.js';
import { linkedEmployee, setEmployeeAccount } from '../services/employeeDirectory.js';

const router = express.Router();
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.use(routineReason);
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

// ===== The signed-in user =====

router.get('/me', requirePermission(PERMISSIONS.HR_ACCESS), async (req, res) => {
  const employee = await currentEmployee(req);
  // Legacy balances are retired: government staff read their entitlements from
  // the government ledger through /government/..., and excluded-contract
  // records carry none. The field stays in the response so older clients that
  // still read it see an empty list.
  const { rows: manager } = await pool.query(
    'SELECT id, display_name, email FROM hr_employees WHERE id = $1',
    [employee.manager_id]
  );
  res.json({ employee: visibleEmployee(req, employee), year: new Date().getFullYear(), balances: [], manager: manager[0] || null });
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
    if (!(await canAccessEmployee(pool,req.user,application.employee_id,'hr_officer',{owner:true,manager:true}))
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
  PERMISSIONS.HR_OFFICER, PERMISSIONS.HR_ADMIN
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
    const bytes = await generateLeaveApplicationPdf(form,{firstPageOnly:true});
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

    // Evidence follows the right to decide this person's leave, plus the owner.
    // A past decision does not confer permanent access.
    if (!(await canReadEvidence(pool,req.user,attachment.employee_id))) return missing();

    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', attachment.content_type || 'application/octet-stream');
    // Always an attachment, never inline: nothing uploaded by a user should be
    // rendered by the browser on the portal's own origin.
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.file_name)}"`);
    return res.send(attachment.file_data);
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

router.get('/org-units', requirePermission(PERMISSIONS.HR_OFFICER, PERMISSIONS.HR_ADMIN), async (req, res) => {
  const {rows:allowed}=await pool.query(`SELECT DISTINCT department_id,division_id FROM hr_access_scopes s WHERE reviewer_id=$1 AND ${activeScopeSql()}`,[req.user.id]);
  const [{ rows: departments }, { rows: divisions }] = await Promise.all([
    pool.query('SELECT id, name FROM hr_departments ORDER BY lower(name)'),
    pool.query('SELECT v.id,v.department_id,v.name,v.parent_division_id,p.name AS parent_division_name FROM hr_divisions v LEFT JOIN hr_divisions p ON p.id=v.parent_division_id ORDER BY lower(v.name)'),
  ]);
  res.json(departments.filter(d=>isCentralHr(req.user)||allowed.some(s=>s.department_id===d.id)).map((department) => ({
    id: department.id,
    name: department.name,
    divisions: divisions
      .filter((division) => division.department_id === department.id && (isCentralHr(req.user)||allowed.some(s=>s.department_id===department.id && (!s.division_id||s.division_id===division.id||s.division_id===division.parent_division_id))))
      .map((division) => ({ id: division.id, name: division.name, parent_division_id:division.parent_division_id,parent_division_name:division.parent_division_name })),
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

router.post('/departments/:id/divisions',requirePermission(PERMISSIONS.HR_ADMIN),[
 param('id').isUUID(),body('name').isString().trim().isLength({min:1,max:60}),body('parent_division_id').optional({nullable:true}).isUUID(),
],async(req,res)=>{
 if(!handleValidation(req,res))return;
 const created=await createOrganisationDivision(pool,{departmentId:req.params.id,name:req.body.name,parentDivisionId:req.body.parent_division_id||null,actor:{id:req.user.id,email:req.user.email,ip:req.ip}});
 res.status(201).json(created);
});

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
    if((await pool.query('SELECT 1 FROM hr_divisions WHERE parent_division_id=$1 LIMIT 1',[req.params.id])).rowCount){res.status(409).json({message:'This parent unit still contains divisions. Retain it while those divisions exist.'});return;}
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

router.get('/employees', requirePermission(PERMISSIONS.HR_OFFICER, PERMISSIONS.HR_ADMIN), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.*, m.display_name AS manager_name
       FROM hr_employees e
       LEFT JOIN hr_employees m ON m.id = e.manager_id AND ${employeeScopeSql(req.user,'hr_officer','$1','m')}
      WHERE ${employeeScopeSql(req.user,'hr_officer')} ORDER BY e.status, e.display_name`,[req.user.id]
  );
  res.json(visibleEmployees(req, rows));
});

// Current balance accounts, bounded by the caller's active employee scope.
// Stored balances are retained for employees who still use their original rules;
// current-policy staff use only their current entitlement ledger and live holds.
router.get(
  '/employees/balances',
  requirePermission(PERMISSIONS.HR_OFFICER, PERMISSIONS.HR_ADMIN),
  [query('year').optional().isInt()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const asOf = new Date(Date.now() + 12 * 3600000).toISOString().slice(0,10);
    const year = Number(asOf.slice(0,4));
    if (req.query.year !== undefined && Number(req.query.year) !== year) {
      throw new ServiceError(400,'This view shows current balances only. Use the leave reports and employee history for earlier records.');
    }
    const { rows: employees } = await pool.query(`WITH scoped AS (
      SELECT e.id,e.display_name,e.department_code,e.division_code,e.status,e.reviewer_id,e.email,e.join_date,
        e.leave_policy_regime,COALESCE(r.account_type,'staff') AS account_type
      FROM hr_employees e LEFT JOIN reviewers r ON r.id=e.reviewer_id
      WHERE e.status='active' AND e.leave_entitled AND ${employeeScopeSql(req.user,'hr_officer','$2')}
    ), accounts AS (
      SELECT e.id AS employee_id,t.name AS leave_type,b.balance,b.pending
      FROM scoped e JOIN hr_leave_balances b ON b.employee_id=e.id AND b.year=$1
      JOIN hr_leave_types t ON t.id=b.leave_type_id AND t.is_active
      WHERE e.leave_policy_regime<>'government' AND e.account_type<>'employee'
      UNION ALL
      SELECT e.id,initcap(replace(a.code,'_',' ')),
        COALESCE((SELECT sum(l.amount) FROM hr_gov_ledger l WHERE l.entitlement_id=a.id),0),
        COALESCE((SELECT sum(h.amount) FROM hr_gov_reservations h JOIN hr_gov_reservation_requests rq ON rq.id=h.request_id WHERE h.entitlement_id=a.id AND rq.status='held'),0)
        + COALESCE((SELECT sum(h.amount) FROM hr_gov_case_credit_holds h JOIN hr_gov_requests rq ON rq.id=h.request_id
          WHERE h.entitlement_id=a.id AND rq.status='pending' AND h.determination_id=(SELECT cd.id FROM hr_gov_case_determinations cd WHERE cd.request_id=rq.id ORDER BY version DESC LIMIT 1)),0)
      FROM scoped e JOIN hr_gov_entitlements a ON a.employee_id=e.id
      WHERE (e.leave_policy_regime='government' OR e.account_type='employee')
        AND (NOW() AT TIME ZONE 'Pacific/Nauru')::date BETWEEN GREATEST(a.as_of,a.period_start) AND a.period_end
    ) SELECT e.id,e.display_name,e.department_code,e.division_code,e.status,e.reviewer_id,e.email,e.join_date,
      e.leave_policy_regime<>'government' AND e.account_type<>'employee' AS can_adjust_balance,
      COALESCE(jsonb_object_agg(a.leave_type,jsonb_build_object('balance',a.balance,'pending',a.pending)) FILTER(WHERE a.leave_type IS NOT NULL),'{}'::jsonb) AS balances
      FROM scoped e LEFT JOIN accounts a ON a.employee_id=e.id
      GROUP BY e.id,e.display_name,e.department_code,e.division_code,e.status,e.reviewer_id,e.email,e.join_date,e.leave_policy_regime,e.account_type
      ORDER BY e.display_name`,[year,req.user.id]);
    const { rows: types } = await pool.query('SELECT name,default_days,is_accruable FROM hr_leave_types WHERE is_active ORDER BY name');
    const names = new Set(employees.flatMap(employee => Object.keys(employee.balances)));
    if (employees.some(employee => employee.can_adjust_balance)) for (const type of types) names.add(type.name);
    if (employees.some(employee => !employee.can_adjust_balance)) for (const name of ['Recreation','Medical','Special']) names.add(name);
    res.json({ year, as_of: asOf,
      leave_types: [...names].sort(),
      leave_type_rules: types.map(type => ({ name:type.name,default_days:Number(type.default_days),is_accruable:type.is_accruable })),
      employees,
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

// An employee's stored balances for one year, read-only: the government
// ledger owns current entitlements, this view answers questions about the
// historical record.
router.get(
  '/employees/:id/balances',
  requirePermission(PERMISSIONS.HR_OFFICER, PERMISSIONS.HR_ADMIN),
  [param('id').isUUID(), query('year').optional().isInt()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    if (!(await canAccessEmployee(pool,req.user,req.params.id,'hr_officer'))) throw new ServiceError(404,'Employee not found.');
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

router.put(
  '/employees/:id',
  requirePermission(PERMISSIONS.HR_OFFICER, PERMISSIONS.HR_ADMIN),
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
    if (!(await canAccessEmployee(pool,req.user,req.params.id,'hr_officer'))) throw new ServiceError(404,'Employee not found.');
    if (req.body.manager_id && !(await canAccessEmployee(pool,req.user,req.body.manager_id,'hr_officer'))) throw new ServiceError(404,'Reporting manager not found.');

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
    // powers; an HR officer has the first, not the second.
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
        await assertEmployeeScope(client,req.user,req.params.id,'hr_officer');
        if (updates.manager_id) await assertEmployeeScope(client,req.user,updates.manager_id,'hr_officer');
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
        return res.status(409).json({ message: 'That login is already linked to a different employee. Resolve the existing link in HR first.' });
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

// ===== Senior management overview =====

/**
 * Working days of one application that fall inside the reporting window.
 *
 * Retained-record reports split leave across the selected dates rather than
 * counting an application's full length in every window it overlaps. The
 * current leadership overview uses leaveOverview.js for both leave regimes.
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

// The leadership dashboard combines current grants with retained historical
// activity and reads current balances from each employee's leave regime.
router.get('/overview', requirePermission(PERMISSIONS.HR_ADMIN),
  [query('from').optional().isISO8601(),query('to').optional().isISO8601()],
  async(req,res)=>{
    if(!handleValidation(req,res))return;
    const today=new Date(Date.now()+12*3600000).toISOString().slice(0,10);
    const to=req.query.to||today;
    const previousYear=new Date(`${today}T00:00:00Z`);
    previousYear.setUTCFullYear(previousYear.getUTCFullYear()-1);
    const from=req.query.from||previousYear.toISOString().slice(0,10);
    res.json(await leaveOverview(pool,{user:req.user,from,to}));
  });
router.get('/overview/planning',requirePermission(PERMISSIONS.HR_ADMIN),async(req,res)=>{
  res.json(await leavePlanning(pool,{user:req.user}));
});
router.get('/overview/breakdown',requirePermission(PERMISSIONS.HR_ADMIN),
  [query('dimension').isIn(['department','leave_type']),query('value').isString().isLength({min:1,max:200}),query('from').isISO8601(),query('to').isISO8601()],
  async(req,res)=>{
    if(!handleValidation(req,res))return;
    const {from,to,dimension,value}=req.query;
    res.json(await leaveOverviewBreakdown(pool,{user:req.user,from,to,dimension,value}));
  });

// ===== Calendar and reporting =====

// Who the team or department calendar lists: its name and who is in it.
router.get('/calendar/members', requirePermission(PERMISSIONS.HR_ACCESS), [query('view').optional().isIn(ROSTER_VIEWS)], async (req, res) => {
  if (!handleValidation(req, res)) return;
  res.json(await calendarRoster(pool, req.user.id, req.query.view || 'team'));
});

// Approved and submitted leave for one calendar view (see leaveCalendar.js).
router.get(
  '/calendar',
  requirePermission(PERMISSIONS.HR_ACCESS),
  [query('from').isISO8601(), query('to').isISO8601(), query('view').optional().isIn(CALENDAR_VIEWS),
    query('department_id').optional().isUUID(), query('division_id').optional().isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const audience = calendarAudienceSql(req.user, req.query.view || 'team', { userParam: '$3', departmentParam: '$4', divisionParam: '$5' });
    const params = [req.query.from, req.query.to, req.user.id, req.query.department_id || null, req.query.division_id || null];
    const { rows: applications } = await pool.query(
      `SELECT a.id, a.employee_id, a.start_date, a.end_date, a.status,
              CASE WHEN ${audience.masked} THEN '${MASKED_LEAVE_LABEL}' ELSE t.name END AS leave_type_name,
              e.display_name AS employee_name, ${unitNamesSql('e')}, 'leave' AS kind, ${audience.own} AS own
         FROM hr_leave_applications a
         JOIN hr_leave_types t ON t.id = a.leave_type_id
         JOIN hr_employees e ON e.id = a.employee_id
        WHERE a.status IN ('pending', 'approved')
          AND NOT EXISTS(SELECT 1 FROM hr_gov_legacy_transfers tr JOIN hr_gov_requests gr ON gr.id=tr.request_id WHERE tr.legacy_request_id=a.id AND gr.status IN ('pending','approved'))
          AND a.start_date <= $2 AND a.end_date >= $1
          AND ${audience.where}
        ORDER BY a.start_date, e.display_name`,
      params
    );
    // Study leave is a period away recorded on the staff record, not an
    // application. It is not private, so every view shows it as study leave.
    const { rows: studyLeave } = await pool.query(
      `SELECT 'study-' || e.id AS id, e.id AS employee_id, e.study_leave_start AS start_date, e.study_leave_end AS end_date,
              'approved' AS status, 'Study leave' AS leave_type_name,
              e.display_name AS employee_name, ${unitNamesSql('e')},
              'study_leave' AS kind, ${audience.own} AS own
         FROM hr_employees e
        WHERE e.status = 'active' AND e.leave_entitled = FALSE AND e.ineligible_reason = 'study_leave'
          AND e.study_leave_start <= $2 AND (e.study_leave_end IS NULL OR e.study_leave_end >= $1)
          AND ${audience.where}
        ORDER BY e.display_name`,
      params
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
  requirePermission(PERMISSIONS.HR_OFFICER, PERMISSIONS.HR_ADMIN),
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
          AND ${employeeScopeSql(req.user,'hr_officer','$3')}
        GROUP BY e.display_name, e.department_code, t.name
        ORDER BY e.display_name, t.name`,
      [req.query.from, req.query.to,req.user.id]
    );
    res.json({ from: req.query.from, to: req.query.to, rows });
  }
);

export default router;

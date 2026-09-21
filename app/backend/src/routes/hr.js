import express from 'express';
import { body, param, query, handleValidation } from '../middleware/validation.js';
import { pool } from '../db.js';
import { requireAuth, requirePermission } from '../services/authService.js';
import { recordAudit } from '../services/auditService.js';
import { PERMISSIONS } from '../config.js';

const router = express.Router();

/**
 * Working days (Mon-Fri) between two dates, inclusive. Mirrors the leave
 * calculation the standalone HR app used, so balances stay comparable.
 */
export function calculateWorkingDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end < start) return 0;
  let days = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

/** The signed-in user's employee record, created on first use. */
async function currentEmployee(req) {
  const { rows } = await pool.query(
    'SELECT * FROM hr_employees WHERE reviewer_id = $1',
    [req.user.id]
  );
  if (rows.length) return rows[0];

  const { rows: created } = await pool.query(
    `INSERT INTO hr_employees (reviewer_id, display_name, email, department_code)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (reviewer_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [req.user.id, req.user.display_name || req.user.email, req.user.email, req.user.department_code]
  );
  return created[0];
}

/**
 * Whether `req.user` may act on `employeeId`.
 *
 * Capability and data scope are deliberately separate: HR_LEAVE_APPROVE grants
 * the ability to approve, the reporting line in hr_employees.manager_id decides
 * whose leave. HR_ADMIN sees everyone.
 */
async function canActOnEmployee(req, employeeId) {
  if (req.user.permissions?.[PERMISSIONS.HR_ADMIN]) return true;
  if (req.user.permissions?.[PERMISSIONS.HR_STAFF_MANAGE]) return true;
  const me = await currentEmployee(req);
  if (me.id === employeeId) return true;
  const { rows } = await pool.query(
    'SELECT 1 FROM hr_employees WHERE id = $1 AND manager_id = $2',
    [employeeId, me.id]
  );
  return rows.length > 0;
}

async function ensureBalance(client, employeeId, leaveTypeId, year) {
  const { rows } = await client.query(
    'SELECT * FROM hr_leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3',
    [employeeId, leaveTypeId, year]
  );
  if (rows.length) return rows[0];

  // Seed from the leave type's annual entitlement the first time it is used.
  const { rows: created } = await client.query(
    `INSERT INTO hr_leave_balances (employee_id, leave_type_id, year, balance, pending)
     SELECT $1, $2, $3, default_days, 0 FROM hr_leave_types WHERE id = $2
     ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET year = EXCLUDED.year
     RETURNING *`,
    [employeeId, leaveTypeId, year]
  );
  return created[0];
}

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
  const { rows: balances } = await pool.query(
    `SELECT b.*, t.name AS leave_type_name, t.requires_note
       FROM hr_leave_balances b
       JOIN hr_leave_types t ON t.id = b.leave_type_id
      WHERE b.employee_id = $1 AND b.year = $2
      ORDER BY t.name`,
    [employee.id, year]
  );
  const { rows: manager } = await pool.query(
    'SELECT id, display_name, email FROM hr_employees WHERE id = $1',
    [employee.manager_id]
  );
  res.json({ employee, year, balances, manager: manager[0] || null });
});

router.get('/leaves', requirePermission(PERMISSIONS.HR_ACCESS), async (req, res) => {
  const employee = await currentEmployee(req);
  const { rows } = await pool.query(
    `SELECT a.*, t.name AS leave_type_name, r.display_name AS reviewed_by_name
       FROM hr_leave_applications a
       JOIN hr_leave_types t ON t.id = a.leave_type_id
       LEFT JOIN reviewers r ON r.id = a.reviewed_by
      WHERE a.employee_id = $1 AND a.archived_at IS NULL
      ORDER BY a.applied_at DESC`,
    [employee.id]
  );
  res.json(rows);
});

router.post(
  '/leaves',
  requirePermission(PERMISSIONS.HR_LEAVE_APPLY),
  [
    body('leave_type_id').isUUID(),
    body('start_date').isISO8601(),
    body('end_date').isISO8601(),
    body('reason').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const employee = await currentEmployee(req);
    const { leave_type_id: leaveTypeId, start_date: startDate, end_date: endDate } = req.body;
    const days = calculateWorkingDays(startDate, endDate);
    if (days <= 0) {
      res.status(400).json({ message: 'The selected dates contain no working days.' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: types } = await client.query(
        'SELECT * FROM hr_leave_types WHERE id = $1 AND is_active = TRUE',
        [leaveTypeId]
      );
      if (!types.length) {
        await client.query('ROLLBACK');
        res.status(400).json({ message: 'Unknown leave type.' });
        return;
      }
      if (types[0].requires_note && !String(req.body.reason || '').trim()) {
        await client.query('ROLLBACK');
        res.status(400).json({ message: `${types[0].name} leave requires a reason.` });
        return;
      }

      const year = new Date(startDate).getFullYear();
      const balance = await ensureBalance(client, employee.id, leaveTypeId, year);
      const available = Number(balance.balance) - Number(balance.pending);
      if (days > available) {
        await client.query('ROLLBACK');
        res.status(400).json({
          message: `Insufficient leave balance. You have ${available} working days available but requested ${days}.`,
        });
        return;
      }

      // Hold the days against `pending` until the application is decided.
      await client.query(
        'UPDATE hr_leave_balances SET pending = pending + $1 WHERE id = $2',
        [days, balance.id]
      );
      const { rows: created } = await client.query(
        `INSERT INTO hr_leave_applications (employee_id, leave_type_id, start_date, end_date, days, reason)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [employee.id, leaveTypeId, startDate, endDate, days, req.body.reason || null]
      );
      await client.query('COMMIT');
      res.status(201).json(created[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Failed to submit leave application', err);
      res.status(500).json({ message: 'Unable to submit leave application.' });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/leaves/:id/cancel',
  requirePermission(PERMISSIONS.HR_LEAVE_APPLY),
  [param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const employee = await currentEmployee(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT * FROM hr_leave_applications WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (!rows.length || rows[0].employee_id !== employee.id) {
        await client.query('ROLLBACK');
        res.status(404).json({ message: 'Leave application not found.' });
        return;
      }
      const application = rows[0];
      if (application.status !== 'pending') {
        await client.query('ROLLBACK');
        res.status(400).json({ message: 'Only pending applications can be cancelled.' });
        return;
      }
      await releasePending(client, application);
      await client.query(
        `UPDATE hr_leave_applications SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [application.id]
      );
      await client.query('COMMIT');
      res.json({ message: 'Leave application cancelled.' });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Failed to cancel leave application', err);
      res.status(500).json({ message: 'Unable to cancel leave application.' });
    } finally {
      client.release();
    }
  }
);

/** Releases the pending hold created when the application was submitted. */
async function releasePending(client, application) {
  const year = new Date(application.start_date).getFullYear();
  await client.query(
    `UPDATE hr_leave_balances
        SET pending = GREATEST(0, pending - $1)
      WHERE employee_id = $2 AND leave_type_id = $3 AND year = $4`,
    [application.days, application.employee_id, application.leave_type_id, year]
  );
}

// ===== Manager: team and approvals =====

router.get('/team', requirePermission(PERMISSIONS.HR_LEAVE_APPROVE, PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN), async (req, res) => {
  const me = await currentEmployee(req);
  const seesEveryone = req.user.permissions?.[PERMISSIONS.HR_ADMIN] || req.user.permissions?.[PERMISSIONS.HR_STAFF_MANAGE];
  const { rows } = await pool.query(
    seesEveryone
      ? `SELECT e.*, m.display_name AS manager_name FROM hr_employees e
           LEFT JOIN hr_employees m ON m.id = e.manager_id
          WHERE e.status = 'active' ORDER BY e.display_name`
      : `SELECT e.*, m.display_name AS manager_name FROM hr_employees e
           LEFT JOIN hr_employees m ON m.id = e.manager_id
          WHERE e.manager_id = $1 AND e.status = 'active' ORDER BY e.display_name`,
    seesEveryone ? [] : [me.id]
  );
  res.json(rows);
});

router.get('/approvals', requirePermission(PERMISSIONS.HR_LEAVE_APPROVE, PERMISSIONS.HR_ADMIN), async (req, res) => {
  const me = await currentEmployee(req);
  const seesEveryone = Boolean(req.user.permissions?.[PERMISSIONS.HR_ADMIN]);
  const { rows } = await pool.query(
    `SELECT a.*, t.name AS leave_type_name, e.display_name AS employee_name, e.department_code
       FROM hr_leave_applications a
       JOIN hr_leave_types t ON t.id = a.leave_type_id
       JOIN hr_employees e ON e.id = a.employee_id
      WHERE a.status = 'pending' ${seesEveryone ? '' : 'AND e.manager_id = $1'}
      ORDER BY a.applied_at`,
    seesEveryone ? [] : [me.id]
  );
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
    if (decision === 'rejected' && !note) {
      res.status(400).json({ message: 'A reason is required when rejecting leave.' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT * FROM hr_leave_applications WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        res.status(404).json({ message: 'Leave application not found.' });
        return;
      }
      const application = rows[0];
      if (application.status !== 'pending') {
        await client.query('ROLLBACK');
        res.status(400).json({ message: 'This application is no longer pending.' });
        return;
      }
      if (!(await canActOnEmployee(req, application.employee_id))) {
        await client.query('ROLLBACK');
        res.status(403).json({ message: 'This person does not report to you.' });
        return;
      }

      await releasePending(client, application);
      if (decision === 'approved') {
        const year = new Date(application.start_date).getFullYear();
        await client.query(
          `UPDATE hr_leave_balances SET balance = balance - $1
            WHERE employee_id = $2 AND leave_type_id = $3 AND year = $4`,
          [application.days, application.employee_id, application.leave_type_id, year]
        );
      }
      await client.query(
        `UPDATE hr_leave_applications
            SET status = $1, reviewed_by = $2, reviewed_at = NOW(), reviewer_note = $3, updated_at = NOW()
          WHERE id = $4`,
        [decision, req.user.id, note || null, application.id]
      );
      await client.query('COMMIT');

      await recordAudit({
        actor: { id: req.user.id, email: req.user.email, ip: req.ip },
        action: `hr.leave.${decision}`,
        entityType: 'hr_leave_application',
        entityId: application.id,
        after: { decision, days: application.days },
      });
      res.json({ message: `Leave ${decision}.` });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Failed to decide leave application', err);
      res.status(500).json({ message: 'Unable to record the decision.' });
    } finally {
      client.release();
    }
  }
);

// ===== Staff administration =====

router.get('/employees', requirePermission(PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.*, m.display_name AS manager_name
       FROM hr_employees e
       LEFT JOIN hr_employees m ON m.id = e.manager_id
      ORDER BY e.status, e.display_name`
  );
  res.json(rows);
});

router.put(
  '/employees/:id',
  requirePermission(PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN),
  [
    param('id').isUUID(),
    body('manager_id').optional({ nullable: true }).isUUID(),
    body('department_code').optional({ nullable: true }).isString().isLength({ max: 10 }),
    body('join_date').optional({ nullable: true }).isISO8601(),
    body('status').optional().isIn(['active', 'inactive']),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    if (req.body.manager_id === req.params.id) {
      res.status(400).json({ message: 'An employee cannot be their own manager.' });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE hr_employees
          SET manager_id = COALESCE($2, manager_id),
              department_code = COALESCE($3, department_code),
              join_date = COALESCE($4, join_date),
              status = COALESCE($5, status),
              updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [req.params.id, req.body.manager_id ?? null, req.body.department_code ?? null,
       req.body.join_date ?? null, req.body.status ?? null]
    );
    if (!rows.length) {
      res.status(404).json({ message: 'Employee not found.' });
      return;
    }
    res.json(rows[0]);
  }
);

router.get(
  '/employees/:id/balances',
  requirePermission(PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN),
  [param('id').isUUID(), query('year').optional().isInt()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
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
  requirePermission(PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN),
  [
    body('employee_id').isUUID(),
    body('leave_type_id').isUUID(),
    body('amount').isFloat(),
    body('reason').isString().isLength({ min: 3, max: 2000 }),
    body('year').optional().isInt(),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const year = Number(req.body.year) || new Date().getFullYear();
    const amount = Number(req.body.amount);
    if (amount === 0) {
      res.status(400).json({ message: 'Adjustment amount cannot be zero.' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const balance = await ensureBalance(client, req.body.employee_id, req.body.leave_type_id, year);
      await client.query('UPDATE hr_leave_balances SET balance = balance + $1 WHERE id = $2', [amount, balance.id]);
      await client.query(
        `INSERT INTO hr_leave_adjustments (employee_id, leave_type_id, amount, reason, adjusted_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.body.employee_id, req.body.leave_type_id, amount, req.body.reason.trim(), req.user.id]
      );
      await client.query('COMMIT');
      await recordAudit({
        actor: { id: req.user.id, email: req.user.email, ip: req.ip },
        action: 'hr.balance.adjusted',
        entityType: 'hr_employee',
        entityId: req.body.employee_id,
        after: { amount, reason: req.body.reason.trim(), year },
      });
      res.status(201).json({ message: 'Balance adjusted.' });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Failed to adjust leave balance', err);
      res.status(500).json({ message: 'Unable to adjust the balance.' });
    } finally {
      client.release();
    }
  }
);

// ===== Leave policies =====

router.get('/policies', requirePermission(PERMISSIONS.HR_ADMIN), async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM hr_leave_types ORDER BY name');
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
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const { rows } = await pool.query(
        `INSERT INTO hr_leave_types (name, description, default_days, is_accruable, requires_note)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.body.name.trim(), req.body.description || null, req.body.default_days,
         req.body.is_accruable === true, req.body.requires_note === true]
      );
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
    body('description').optional({ nullable: true }).isString().isLength({ max: 500 }),
    body('default_days').optional().isFloat({ min: 0, max: 365 }),
    body('is_accruable').optional().isBoolean(),
    body('requires_note').optional().isBoolean(),
    body('is_active').optional().isBoolean(),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows } = await pool.query(
      `UPDATE hr_leave_types
          SET description = COALESCE($2, description),
              default_days = COALESCE($3, default_days),
              is_accruable = COALESCE($4, is_accruable),
              requires_note = COALESCE($5, requires_note),
              is_active = COALESCE($6, is_active)
        WHERE id = $1 RETURNING *`,
      [req.params.id, req.body.description ?? null, req.body.default_days ?? null,
       req.body.is_accruable ?? null, req.body.requires_note ?? null, req.body.is_active ?? null]
    );
    if (!rows.length) {
      res.status(404).json({ message: 'Leave type not found.' });
      return;
    }
    res.json(rows[0]);
  }
);

export default router;

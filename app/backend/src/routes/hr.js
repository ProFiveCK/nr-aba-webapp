import express from 'express';
import { body, param, query, handleValidation } from '../middleware/validation.js';
import { pool } from '../db.js';
import { requireAuth, requirePermission } from '../services/authService.js';
import { recordAudit } from '../services/auditService.js';
import { notifyLeaveDecision, notifyLeaveSubmitted } from '../services/notificationService.js';
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

      // Best effort: a mail failure must not fail an accepted application.
      if (employee.manager_id) {
        const { rows: managers } = await pool.query(
          'SELECT display_name, email FROM hr_employees WHERE id = $1',
          [employee.manager_id]
        );
        notifyLeaveSubmitted({
          application: { ...created[0], leave_type_name: types[0].name },
          employee,
          manager: managers[0],
        }).catch((err) => console.error('Failed to notify manager of leave application', err));
      }
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
      const { rows: applicants } = await pool.query(
        `SELECT e.display_name, e.email, t.name AS leave_type_name
           FROM hr_employees e, hr_leave_types t
          WHERE e.id = $1 AND t.id = $2`,
        [application.employee_id, application.leave_type_id]
      );
      if (applicants.length) {
        notifyLeaveDecision({
          application: { ...application, leave_type_name: applicants[0].leave_type_name },
          employee: applicants[0],
          decision,
          note,
          decidedBy: req.user.display_name || req.user.email,
        }).catch((err) => console.error('Failed to notify applicant of leave decision', err));
      }
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

// One-call matrix for the "balances report": every active staff member
// against every active leave type. A type an employee has never been
// adjusted or applied against has no hr_leave_balances row yet (it is
// seeded lazily by ensureBalance on first touch), so it falls back to the
// type's default_days here — the same number that first touch would seed.
router.get(
  '/employees/balances',
  requirePermission(PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN),
  [query('year').optional().isInt()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const year = Number(req.query.year) || new Date().getFullYear();
    const [{ rows: employees }, { rows: types }, { rows: balances }] = await Promise.all([
      pool.query(
        `SELECT id, display_name, department_code, status, reviewer_id, email, join_date
           FROM hr_employees WHERE status = 'active' ORDER BY display_name`
      ),
      pool.query('SELECT id, name, default_days FROM hr_leave_types WHERE is_active = TRUE ORDER BY name'),
      pool.query('SELECT employee_id, leave_type_id, balance, pending FROM hr_leave_balances WHERE year = $1', [year]),
    ]);
    const balanceByKey = new Map(balances.map((b) => [`${b.employee_id}:${b.leave_type_id}`, b]));
    const result = employees.map((e) => {
      const byType = {};
      for (const t of types) {
        const b = balanceByKey.get(`${e.id}:${t.id}`);
        byType[t.name] = {
          balance: b ? Number(b.balance) : Number(t.default_days),
          pending: b ? Number(b.pending) : 0,
        };
      }
      return { ...e, balances: byType };
    });
    res.json({ year, leave_types: types.map((t) => t.name), employees: result });
  }
);

// Creates a leave/HR record ahead of a portal login existing — e.g. HR wants
// to set up someone's department, manager and opening balance before their
// account is provisioned. `reviewer_id` starts NULL; see PUT below to link a
// login once one exists. This coexists with the lazy auto-provisioning in
// currentEmployee(): once linked, a person's own first visit to the Leave
// app finds this row by reviewer_id instead of creating a duplicate.
router.post(
  '/employees',
  requirePermission(PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN),
  [
    body('display_name').isString().trim().isLength({ min: 1, max: 200 }),
    body('department_code').optional({ nullable: true }).isString().isLength({ max: 10 }),
    body('manager_id').optional({ nullable: true }).isUUID(),
    body('join_date').optional({ nullable: true }).isISO8601(),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows } = await pool.query(
      `INSERT INTO hr_employees (display_name, department_code, manager_id, join_date)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.body.display_name, req.body.department_code || null, req.body.manager_id || null, req.body.join_date || null]
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

router.put(
  '/employees/:id',
  requirePermission(PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN),
  [
    param('id').isUUID(),
    body('manager_id').optional({ nullable: true }).isUUID(),
    body('department_code').optional({ nullable: true }).isString().isLength({ max: 10 }),
    body('join_date').optional({ nullable: true }).isISO8601(),
    body('status').optional().isIn(['active', 'inactive']),
    body('reviewer_id').optional({ nullable: true }).isUUID(),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    if (req.body.manager_id === req.params.id) {
      res.status(400).json({ message: 'An employee cannot be their own manager.' });
      return;
    }
    let linkedEmail = null;
    if (req.body.reviewer_id) {
      const { rows: reviewerRows } = await pool.query('SELECT id, display_name, email FROM reviewers WHERE id = $1', [req.body.reviewer_id]);
      if (!reviewerRows.length) {
        res.status(400).json({ message: 'No such account.' });
        return;
      }
      linkedEmail = reviewerRows[0].email;
    }
    try {
      const { rows } = await pool.query(
        `UPDATE hr_employees
            SET manager_id = COALESCE($2, manager_id),
                department_code = COALESCE($3, department_code),
                join_date = COALESCE($4, join_date),
                status = COALESCE($5, status),
                reviewer_id = COALESCE($6, reviewer_id),
                email = COALESCE($7, email),
                updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [req.params.id, req.body.manager_id ?? null, req.body.department_code ?? null,
         req.body.join_date ?? null, req.body.status ?? null, req.body.reviewer_id ?? null, linkedEmail]
      );
      if (!rows.length) {
        res.status(404).json({ message: 'Employee not found.' });
        return;
      }
      if (req.body.reviewer_id) {
        await recordAudit({
          actor: { id: req.user.id, email: req.user.email, ip: req.ip },
          action: 'hr.employee.linked',
          entityType: 'hr_employee',
          entityId: rows[0].id,
          after: { reviewer_id: req.body.reviewer_id },
        });
      }
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        res.status(409).json({ message: 'That login is already linked to a different staff record.' });
        return;
      }
      throw err;
    }
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
  requirePermission(PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN),
  [
    body('rows').isArray({ min: 1, max: 500 }),
    body('rows.*.display_name').isString().trim().isLength({ min: 1, max: 200 }),
    body('rows.*.department_code').optional({ nullable: true }).isString().isLength({ max: 10 }),
    body('rows.*.join_date').optional({ nullable: true }).isISO8601(),
    body('rows.*.balances').optional().isObject(),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const year = new Date().getFullYear();
    const [{ rows: existing }, { rows: types }] = await Promise.all([
      pool.query('SELECT display_name FROM hr_employees'),
      pool.query('SELECT id, name FROM hr_leave_types'),
    ]);
    const existingNames = new Set(existing.map((r) => r.display_name.trim().toLowerCase()));
    const typeByName = new Map(types.map((t) => [t.name.toLowerCase(), t]));

    const created = [];
    const skipped = [];
    for (const row of req.body.rows) {
      const name = row.display_name.trim();
      if (existingNames.has(name.toLowerCase())) {
        skipped.push({ display_name: name, reason: 'A staff record with this name already exists.' });
        continue;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: inserted } = await client.query(
          `INSERT INTO hr_employees (display_name, department_code, join_date)
           VALUES ($1, $2, $3) RETURNING id`,
          [name, row.department_code || null, row.join_date || null]
        );
        const employeeId = inserted[0].id;
        for (const [typeName, rawAmount] of Object.entries(row.balances || {})) {
          const amount = Number(rawAmount);
          const type = typeByName.get(String(typeName).trim().toLowerCase());
          if (!Number.isFinite(amount) || !type) continue;
          const balance = await ensureBalance(client, employeeId, type.id, year);
          const delta = amount - Number(balance.balance);
          if (delta !== 0) {
            await client.query('UPDATE hr_leave_balances SET balance = balance + $1 WHERE id = $2', [delta, balance.id]);
            await client.query(
              `INSERT INTO hr_leave_adjustments (employee_id, leave_type_id, amount, reason, adjusted_by)
               VALUES ($1, $2, $3, $4, $5)`,
              [employeeId, type.id, delta, 'Bulk import: opening balance', req.user.id]
            );
          }
        }
        await client.query('COMMIT');
        existingNames.add(name.toLowerCase());
        created.push({ id: employeeId, display_name: name });
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Bulk import failed for "${name}"`, err);
        skipped.push({ display_name: name, reason: 'Unable to import this row.' });
      } finally {
        client.release();
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

// ===== Senior management overview =====

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

    const [headcount, applications, turnaround, byType, byDepartment, monthly, upcoming, balanceByType] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM hr_employees WHERE status = 'active') AS active_employees,
           (SELECT COUNT(DISTINCT a.employee_id) FROM hr_leave_applications a
             WHERE a.status = 'approved' AND a.start_date <= CURRENT_DATE AND a.end_date >= CURRENT_DATE
           ) AS on_leave_today`
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
        `SELECT t.name AS leave_type, SUM(a.days) AS days, COUNT(*) AS count
           FROM hr_leave_applications a
           JOIN hr_leave_types t ON t.id = a.leave_type_id
          WHERE a.status = 'approved' AND a.start_date <= $2 AND a.end_date >= $1
          GROUP BY t.name
          ORDER BY days DESC`,
        [from, to]
      ),
      pool.query(
        `SELECT COALESCE(e.department_code, 'Unassigned') AS department_code, SUM(a.days) AS days, COUNT(*) AS count
           FROM hr_leave_applications a
           JOIN hr_employees e ON e.id = a.employee_id
          WHERE a.status = 'approved' AND a.start_date <= $2 AND a.end_date >= $1
          GROUP BY department_code
          ORDER BY days DESC`,
        [from, to]
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', a.start_date), 'YYYY-MM') AS month,
                SUM(a.days) AS days, COUNT(*) AS count
           FROM hr_leave_applications a
          WHERE a.status = 'approved' AND a.start_date >= $1 AND a.start_date <= $2
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
      // Stock, not flow: how many unused days are currently sitting on the
      // books per leave type, across active staff, this calendar year. A
      // type never touched for a given employee has no balance row yet
      // (ensureBalance seeds it lazily) so it falls back to default_days,
      // the same number a first touch would seed.
      pool.query(
        `SELECT t.name AS leave_type,
                SUM(GREATEST(COALESCE(b.balance, t.default_days) - COALESCE(b.pending, 0), 0)) AS available_days
           FROM hr_leave_types t
           CROSS JOIN hr_employees e
           LEFT JOIN hr_leave_balances b
             ON b.employee_id = e.id AND b.leave_type_id = t.id AND b.year = $1
          WHERE t.is_active = TRUE AND e.status = 'active'
          GROUP BY t.name
          ORDER BY available_days DESC`,
        [today.getFullYear()]
      ),
    ]);

    const statusCounts = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
    for (const row of applications.rows) statusCounts[row.status] = Number(row.count);

    // Fill every month in range so the trend line has no gaps to misread as zero-vs-missing.
    const monthByKey = new Map(monthly.rows.map((r) => [r.month, { days: Number(r.days), count: Number(r.count) }]));
    const trendMonths = [];
    const cursor = new Date(from);
    cursor.setDate(1);
    const end = new Date(to);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 7);
      const found = monthByKey.get(key);
      trendMonths.push({ month: key, days: found?.days || 0, count: found?.count || 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    res.json({
      from,
      to,
      headcount: {
        active_employees: Number(headcount.rows[0].active_employees),
        on_leave_today: Number(headcount.rows[0].on_leave_today),
      },
      applications: {
        ...statusCounts,
        total: Object.values(statusCounts).reduce((sum, n) => sum + n, 0),
        avg_turnaround_hours: turnaround.rows[0].avg_hours ? Number(turnaround.rows[0].avg_hours) : null,
      },
      by_type: byType.rows.map((r) => ({ leave_type: r.leave_type, days: Number(r.days), count: Number(r.count) })),
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

// ===== Calendar and reporting =====

// Approved leave across the people the caller can see, for the roster view.
router.get(
  '/calendar',
  requirePermission(PERMISSIONS.HR_ACCESS),
  [query('from').isISO8601(), query('to').isISO8601()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const me = await currentEmployee(req);
    const seesEveryone = Boolean(
      req.user.permissions?.[PERMISSIONS.HR_ADMIN] || req.user.permissions?.[PERMISSIONS.HR_STAFF_MANAGE]
    );
    const { rows } = await pool.query(
      `SELECT a.id, a.start_date, a.end_date, a.days, a.status,
              t.name AS leave_type_name, e.display_name AS employee_name, e.department_code
         FROM hr_leave_applications a
         JOIN hr_leave_types t ON t.id = a.leave_type_id
         JOIN hr_employees e ON e.id = a.employee_id
        WHERE a.status = 'approved'
          AND a.start_date <= $2 AND a.end_date >= $1
          ${seesEveryone ? '' : 'AND (e.manager_id = $3 OR e.id = $3)'}
        ORDER BY a.start_date, e.display_name`,
      seesEveryone ? [req.query.from, req.query.to] : [req.query.from, req.query.to, me.id]
    );
    res.json(rows);
  }
);

// Approved leave per person for a pay period. Returned as rows; the client
// turns it into CSV so no spreadsheet dependency is needed server side.
router.get(
  '/report',
  requirePermission(PERMISSIONS.HR_STAFF_MANAGE, PERMISSIONS.HR_ADMIN),
  [query('from').isISO8601(), query('to').isISO8601()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows } = await pool.query(
      `SELECT e.display_name AS employee_name, e.department_code, t.name AS leave_type_name,
              SUM(a.days) AS total_days, COUNT(*) AS applications
         FROM hr_leave_applications a
         JOIN hr_leave_types t ON t.id = a.leave_type_id
         JOIN hr_employees e ON e.id = a.employee_id
        WHERE a.status = 'approved'
          AND a.start_date <= $2 AND a.end_date >= $1
        GROUP BY e.display_name, e.department_code, t.name
        ORDER BY e.display_name, t.name`,
      [req.query.from, req.query.to]
    );
    res.json({ from: req.query.from, to: req.query.to, rows });
  }
);

export default router;

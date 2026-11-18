/**
 * Support for the tests that need a real Postgres.
 *
 * The leave engine's behaviour lives in its SQL — lateral joins, FOR UPDATE,
 * ON CONFLICT, NUMERIC arithmetic — so a mocked client would only assert that
 * the code calls the queries it calls. These tests run against a real database
 * or they do not run at all.
 *
 * They are skipped unless TEST_DATABASE_URL is set, so `npm test` stays
 * dependency-free. `npm run test:db` starts a throwaway Postgres in Docker,
 * sets the variable and runs everything.
 */

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';

/** The reason to skip, or false when a database is available. */
export const skipWithoutDatabase = TEST_DATABASE_URL
  ? false
  : 'needs a database — run `npm run test:db`';

/**
 * Grants each `true` key of a fixture's access map as a capability, the only
 * place access lives. Fixtures still describe an account's access as a map;
 * writing it to reviewers.permissions instead would now grant nothing.
 */
export async function grantAccess(pool, reviewerId, access = {}) {
  const keys = Object.entries(access || {}).filter(([, value]) => value === true).map(([key]) => key);
  if (keys.length) {
    await pool.query(
      `INSERT INTO reviewer_capabilities (reviewer_id, capability) SELECT $1, unnest($2::text[])
       ON CONFLICT (reviewer_id, capability) DO NOTHING`, [reviewerId, keys]);
  }
}

/**
 * Connects, applies the real schema, and hands back the pool.
 *
 * `db.js` builds its pool from the environment when it is first imported, so
 * the variable is set here and the module imported dynamically after.
 */
export async function connectTestDatabase() {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || '0123456789abcdef0123456789abcdef';
  const { pool, initSchema } = await import('../db.js');
  await initSchema();
  return pool;
}

/** Empties the leave tables between tests so each starts from a known state. */
export async function resetLeaveTables(pool) {
  await pool.query(`TRUNCATE hr_leave_adjustments, hr_leave_applications, hr_leave_balances,
                             hr_accrual_runs, hr_public_holidays, hr_employees, hr_divisions, hr_departments
                             RESTART IDENTITY CASCADE`);
  await pool.query(`UPDATE reviewer_settings SET accrual_anchor_date = NULL, furlough_review_days = 0 WHERE id = TRUE`);
}

/** A leave type, created or updated by name so a rerun is safe. */
export async function upsertLeaveType(pool, { name, defaultDays = 0, accruable = false, perFortnight = 0, resetPeriod = 'none', active = true, maxBalance = null, requiresAttachment = false, attachmentLabel = null }) {
  const { rows } = await pool.query(
    `INSERT INTO hr_leave_types (name, default_days, is_accruable, requires_note, accrual_days_per_fortnight, reset_period, is_active, max_balance, requires_attachment, attachment_label)
     VALUES ($1, $2, $3, FALSE, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (name) DO UPDATE SET
       default_days = EXCLUDED.default_days, is_accruable = EXCLUDED.is_accruable,
       accrual_days_per_fortnight = EXCLUDED.accrual_days_per_fortnight,
       reset_period = EXCLUDED.reset_period, is_active = EXCLUDED.is_active,
       max_balance = EXCLUDED.max_balance,
       requires_attachment = EXCLUDED.requires_attachment,
       attachment_label = EXCLUDED.attachment_label
     RETURNING *`,
    [name, defaultDays, accruable, perFortnight, resetPeriod, active, maxBalance, requiresAttachment, attachmentLabel]
  );
  return rows[0];
}

export async function createEmployee(pool, { name, joinDate = null, entitled = true, status = 'active', department = null }) {
  const { rows } = await pool.query(
    `INSERT INTO hr_employees (display_name, join_date, leave_entitled, status, department_code)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, joinDate, entitled, status, department]
  );
  return rows[0];
}

/** The stored balance for one employee and type, as plain numbers. */
export async function readBalance(pool, employeeId, leaveTypeId, year) {
  const { rows } = await pool.query(
    `SELECT balance, pending, to_char(last_reset_at, 'YYYY-MM-DD') AS last_reset_date
       FROM hr_leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
    [employeeId, leaveTypeId, year]
  );
  if (!rows.length) return null;
  return {
    balance: Number(rows[0].balance),
    pending: Number(rows[0].pending),
    lastResetDate: rows[0].last_reset_date,
  };
}

/**
 * Makes an account a leave approver the way production does: a nomination in
 * Leave settings. Uses a division office in its own synthetic department, so
 * it never becomes the office a workflow test resolves. Creates a linked
 * employee record when the account has none. Returns the assignment id, which
 * a test can close (set effective_to) to withdraw the approver.
 */
export async function nominateApprover(pool, reviewerId) {
  const suffix = Math.random().toString(36).slice(2, 10);
  let { rows: [employee] } = await pool.query("SELECT id FROM hr_employees WHERE reviewer_id = $1 AND status = 'active' LIMIT 1", [reviewerId]);
  if (!employee) {
    ({ rows: [employee] } = await pool.query(
      "INSERT INTO hr_employees (display_name, reviewer_id, status) VALUES ($1, $2, 'active') RETURNING id", [`Synthetic approver ${suffix}`, reviewerId]));
  }
  const { rows: [department] } = await pool.query('INSERT INTO hr_departments (name) VALUES ($1) RETURNING id', [`Synthetic nominations ${suffix}`]);
  const { rows: [division] } = await pool.query('INSERT INTO hr_divisions (department_id, name) VALUES ($1, $2) RETURNING id', [department.id, `Synthetic office ${suffix}`]);
  const { rows: [assignment] } = await pool.query(
    `INSERT INTO hr_approval_assignments (level, department_id, division_id, approver_employee_id, effective_from, reason)
     VALUES ('division', $1, $2, $3, '2000-01-01', 'Synthetic nomination for a test approver.') RETURNING id`,
    [department.id, division.id, employee.id]);
  return assignment.id;
}

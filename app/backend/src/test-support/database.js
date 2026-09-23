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
                             hr_accrual_runs, hr_employees RESTART IDENTITY CASCADE`);
  await pool.query(`UPDATE reviewer_settings SET accrual_anchor_date = NULL WHERE id = TRUE`);
}

/** A leave type, created or updated by name so a rerun is safe. */
export async function upsertLeaveType(pool, { name, defaultDays = 0, accruable = false, perFortnight = 0, resetPeriod = 'none', active = true }) {
  const { rows } = await pool.query(
    `INSERT INTO hr_leave_types (name, default_days, is_accruable, requires_note, accrual_days_per_fortnight, reset_period, is_active)
     VALUES ($1, $2, $3, FALSE, $4, $5, $6)
     ON CONFLICT (name) DO UPDATE SET
       default_days = EXCLUDED.default_days, is_accruable = EXCLUDED.is_accruable,
       accrual_days_per_fortnight = EXCLUDED.accrual_days_per_fortnight,
       reset_period = EXCLUDED.reset_period, is_active = EXCLUDED.is_active
     RETURNING *`,
    [name, defaultDays, accruable, perFortnight, resetPeriod, active]
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
    'SELECT balance, pending, last_reset_at FROM hr_leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3',
    [employeeId, leaveTypeId, year]
  );
  if (!rows.length) return null;
  return {
    balance: Number(rows[0].balance),
    pending: Number(rows[0].pending),
    lastResetAt: rows[0].last_reset_at,
  };
}

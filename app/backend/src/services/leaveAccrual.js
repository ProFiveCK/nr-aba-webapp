/**
 * Leave balance accrual and reset engine, shared by the HR admin endpoint and
 * the fortnightly cron script so both stay in lock-step. Functions here expect
 * an open database client (from `pool.connect()`) and do not manage
 * transactions themselves.
 */

/**
 * Lazily create (or fetch) an employee's balance row for a leave type and year.
 * Accruable types seed at zero and grow with each pay run; upfront types seed
 * at their full annual entitlement.
 */
export async function ensureBalance(client, employeeId, leaveTypeId, year) {
  const { rows } = await client.query(
    'SELECT * FROM hr_leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3',
    [employeeId, leaveTypeId, year]
  );
  if (rows.length) return rows[0];

  const { rows: typeRows } = await client.query(
    'SELECT default_days, is_accruable, reset_period FROM hr_leave_types WHERE id = $1',
    [leaveTypeId]
  );
  const type = typeRows[0];
  const fresh = type && !type.is_accruable ? Number(type.default_days) : 0;

  // A type configured to never reset carries any unused balance from the most
  // recent prior year into the new one, on top of the fresh grant.
  let carryover = 0;
  if (type && type.reset_period === 'none') {
    const { rows: prior } = await client.query(
      `SELECT balance, pending FROM hr_leave_balances
        WHERE employee_id = $1 AND leave_type_id = $2 AND year < $3
        ORDER BY year DESC LIMIT 1`,
      [employeeId, leaveTypeId, year]
    );
    if (prior.length) carryover = Math.max(0, Number(prior[0].balance) - Number(prior[0].pending));
  }

  const { rows: created } = await client.query(
    `INSERT INTO hr_leave_balances (employee_id, leave_type_id, year, balance, pending, last_reset_at)
     VALUES ($1, $2, $3, $4, 0, NOW())
     ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET year = EXCLUDED.year
     RETURNING *`,
    [employeeId, leaveTypeId, year, fresh + carryover]
  );
  return created[0];
}

function resetBoundary(employee, resetPeriod, now) {
  if (resetPeriod === 'financial_year') {
    return new Date(now.getFullYear(), 0, 1);
  }
  if (resetPeriod === 'anniversary') {
    if (!employee.join_date) return null;
    const joined = new Date(employee.join_date);
    let anniversary = new Date(now.getFullYear(), joined.getMonth(), joined.getDate());
    if (anniversary > now) anniversary = new Date(now.getFullYear() - 1, joined.getMonth(), joined.getDate());
    return anniversary;
  }
  return null;
}

/**
 * Credits one fortnight of accrual to every active accruable leave type and
 * forfeits/regrants balances whose reset boundary has passed. Idempotent:
 * accrual is keyed on the accrual-runs table's `period_end`, and resets stamp
 * `last_reset_at` so a boundary is only applied once.
 *
 * Returns `{ periodEnd, credited, reset }`.
 */
export async function runLeaveAccrual(client, { periodEnd, actorId }) {
  const year = new Date(periodEnd).getFullYear();

  const [{ rows: accruable }, { rows: resetTypes }, { rows: employees }] = await Promise.all([
    client.query(
      'SELECT id, name, accrual_days_per_fortnight FROM hr_leave_types WHERE is_active = TRUE AND is_accruable = TRUE AND accrual_days_per_fortnight > 0'
    ),
    client.query(
      "SELECT id, name, reset_period, default_days, is_accruable FROM hr_leave_types WHERE is_active = TRUE AND reset_period <> 'none'"
    ),
    client.query("SELECT id, join_date FROM hr_employees WHERE status = 'active' AND leave_entitled = TRUE"),
  ]);

  let credited = 0;
  for (const type of accruable) {
    const amount = Number(type.accrual_days_per_fortnight);
    for (const employee of employees) {
      const balance = await ensureBalance(client, employee.id, type.id, year);
      await client.query('UPDATE hr_leave_balances SET balance = balance + $1 WHERE id = $2', [amount, balance.id]);
      await client.query(
        `INSERT INTO hr_leave_adjustments (employee_id, leave_type_id, amount, reason, adjusted_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [employee.id, type.id, amount, `Fortnightly accrual — period ending ${periodEnd}`, actorId]
      );
      credited += 1;
    }
  }

  let reset = 0;
  const now = new Date();
  for (const type of resetTypes) {
    const fresh = type.is_accruable ? 0 : Number(type.default_days);
    for (const employee of employees) {
      const boundary = resetBoundary(employee, type.reset_period, now);
      if (!boundary) continue;
      const { rows } = await client.query(
        'SELECT * FROM hr_leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3 FOR UPDATE',
        [employee.id, type.id, year]
      );
      if (!rows.length) continue;
      const balance = rows[0];
      const lastReset = balance.last_reset_at ? new Date(balance.last_reset_at) : null;
      if (lastReset && lastReset >= boundary) continue;
      const delta = fresh - Number(balance.balance);
      await client.query(
        'UPDATE hr_leave_balances SET balance = $1, last_reset_at = NOW() WHERE id = $2',
        [fresh, balance.id]
      );
      if (delta !== 0) {
        await client.query(
          `INSERT INTO hr_leave_adjustments (employee_id, leave_type_id, amount, reason, adjusted_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [employee.id, type.id, delta, `Balance reset (${type.reset_period})`, actorId]
        );
      }
      reset += 1;
    }
  }

  return { periodEnd, credited, reset };
}

function toISODateLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Runs every accrued period that is now due but has not been processed yet.
 * The anchor date (the first pay date) is stored in reviewer_settings; from it
 * the schedule steps forward 14 days at a time. Each period is idempotent via
 * the accrual-runs table, so this is safe to call on startup and on a timer.
 *
 * Returns `{ ran }` — the list of period-end dates that were processed.
 */
export async function runDueLeaveAccruals(pool) {
  const { rows } = await pool.query(
    'SELECT accrual_anchor_date FROM reviewer_settings WHERE id = TRUE'
  );
  const anchor = rows[0]?.accrual_anchor_date;
  if (!anchor) return { ran: [] };

  const [y, m, d] = String(anchor).split('-').map(Number);
  if (!y || !m || !d) return { ran: [] };
  const anchorDate = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const ran = [];
  const client = await pool.connect();
  try {
    for (let cursor = new Date(anchorDate); cursor <= today; cursor.setDate(cursor.getDate() + 14)) {
      const periodEnd = toISODateLocal(cursor);
      const { rows: existing } = await client.query(
        'SELECT id FROM hr_accrual_runs WHERE period_end = $1',
        [periodEnd]
      );
      if (existing.length) continue;
      await client.query('BEGIN');
      try {
        const { credited, reset } = await runLeaveAccrual(client, { periodEnd, actorId: null });
        await client.query(
          'INSERT INTO hr_accrual_runs (period_end, credited, run_by) VALUES ($1, $2, $3)',
          [periodEnd, credited, null]
        );
        await client.query('COMMIT');
        ran.push(periodEnd);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
  return { ran };
}

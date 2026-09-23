/**
 * Postgres advisory locks, for work that must not run twice at once.
 *
 * The leave accrual scheduler runs inside the API process. With one container
 * that is fine; with two, both wake on the same hour and both start crediting.
 * The `period_end` unique constraint stops the balances being doubled, but the
 * loser's transaction fails noisily for no reason. Taking a lock first means
 * one instance does the work and the other simply declines.
 *
 * The lock is session-scoped and held on one connection, so it is released
 * when the work finishes or when the connection dies — a crash mid-run cannot
 * leave it stuck.
 */

/** Distinct constants so two different jobs never share a lock by accident. */
export const LOCK_KEYS = {
  LEAVE_ACCRUAL: 4_814_001,
};

/**
 * Runs `work` if the lock is free, and does nothing at all if it is not.
 *
 * Returns `{ acquired, result }`. `acquired: false` means another process is
 * already doing it, which is a normal outcome and not an error.
 */
export async function withAdvisoryLock(pool, key, work) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [key]);
    if (!rows[0].acquired) return { acquired: false, result: undefined };
    try {
      return { acquired: true, result: await work() };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
    }
  } finally {
    client.release();
  }
}

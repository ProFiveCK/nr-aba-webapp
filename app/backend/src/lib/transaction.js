/**
 * Runs `work` inside a transaction, releasing the connection whichever way it
 * ends.
 *
 * Every write path had its own BEGIN/COMMIT/ROLLBACK/release ladder, and each
 * one had to remember to roll back on every early return. Here the only way
 * out without a commit is to throw.
 */
export async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // A rollback can itself fail if the connection has already gone; the
    // original error is the one worth reporting.
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

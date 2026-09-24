#!/usr/bin/env node
// Fortnightly leave accrual for Naoero payroll. Credits accruable leave types
// and applies any due balance resets (financial-year or service-anniversary).
// Safe to run repeatedly: a period is never credited twice.
//
// Usage: node scripts/run-accrual.js [--due] [--period-end=ISO_DATE] [--dry-run]
//
// --due is the cron entry point: it processes every period that has fallen due
// since the anchor date and has not been run yet, which is exactly what the
// in-process scheduler does. Use it with ACCRUAL_SCHEDULER=off to move accrual
// out of the API container:
//
//   0 2 * * *  cd /srv/ron && docker compose exec -T api npm run accrual -- --due
import { pool } from '../src/db.js';
import { runDueLeaveAccruals, runLeaveAccrual } from '../src/services/leaveAccrual.js';
import { LOCK_KEYS, withAdvisoryLock } from '../src/lib/advisoryLock.js';
import { parseDateOnly, toIsoDate } from '../src/lib/leaveDates.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { periodEnd: null, dryRun: false, help: false, due: false };
  for (const arg of args) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--due') options.due = true;
    else if (arg.startsWith('--period-end=')) options.periodEnd = arg.substring('--period-end='.length);
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

async function run() {
  const options = parseArgs();
  if (options.help) {
    console.log(`Usage: node scripts/run-accrual.js [--due] [--period-end=ISO_DATE] [--dry-run]

Credits leave accrual and applies due balance resets.

  --due                 Run every period that is due and not yet run (cron).
  --period-end=DATE     Run the single period ending on DATE.
  --dry-run             Report what one period would do, and change nothing.

Defaults to the current date as the period end. Safe to run repeatedly: a
period is never credited twice.`);
    return;
  }

  // Cron mode. The advisory lock keeps this from colliding with an API
  // container that still has its own scheduler switched on.
  if (options.due) {
    const { acquired, result } = await withAdvisoryLock(
      pool, LOCK_KEYS.LEAVE_ACCRUAL, () => runDueLeaveAccruals(pool)
    );
    if (!acquired) {
      console.log('[run-accrual] Another process is already running accrual. Nothing to do.');
      return;
    }
    if (!result.ran.length) {
      console.log('[run-accrual] No periods are due.');
      return;
    }
    for (const periodEnd of result.ran) {
      console.log(`[run-accrual] Ran leave accrual for period ending ${periodEnd}`);
    }
    return;
  }

  const periodEnd = options.periodEnd
    ? toIsoDate(parseDateOnly(options.periodEnd))
    : toIsoDate(new Date());

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existingRun } = await client.query(
      'SELECT id FROM hr_accrual_runs WHERE period_end = $1',
      [periodEnd]
    );
    if (existingRun.length) {
      await client.query('ROLLBACK');
      console.log(`[run-accrual] Period ending ${periodEnd} already processed. Nothing to do.`);
      return;
    }

    if (options.dryRun) {
      await client.query('ROLLBACK');
      console.log(`[run-accrual] DRY RUN: would credit accrual and reset balances for period ending ${periodEnd}.`);
      return;
    }

    const { credited, reset } = await runLeaveAccrual(client, { periodEnd, actorId: null });
    await client.query(
      'INSERT INTO hr_accrual_runs (period_end, credited, run_by) VALUES ($1, $2, $3)',
      [periodEnd, credited, null]
    );
    await client.query('COMMIT');
    console.log(`[run-accrual] Period ending ${periodEnd}: ${credited} balance(s) credited, ${reset} balance(s) reset.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

run()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[run-accrual] Failed to run accrual:', err.message);
    await pool.end();
    process.exit(1);
  });

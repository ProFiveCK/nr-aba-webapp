#!/usr/bin/env node
// Fortnightly leave accrual for Naoero payroll. Credits accruable leave types
// and applies any due balance resets (financial-year or service-anniversary).
// Safe to run repeatedly: a period is never credited twice.
//
// Usage: node scripts/run-accrual.js [--period-end=ISO_DATE] [--dry-run]
import { pool } from '../src/db.js';
import { runLeaveAccrual } from '../src/services/leaveAccrual.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { periodEnd: null, dryRun: false, help: false };
  for (const arg of args) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--period-end=')) options.periodEnd = arg.substring('--period-end='.length);
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

async function run() {
  const options = parseArgs();
  if (options.help) {
    console.log(`Usage: node scripts/run-accrual.js [--period-end=ISO_DATE] [--dry-run]

Credits one fortnight of leave accrual and applies due balance resets.
Defaults to the current date as the period end.`);
    return;
  }

  const periodEnd = options.periodEnd
    ? new Date(options.periodEnd).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

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

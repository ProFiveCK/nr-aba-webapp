#!/usr/bin/env node
import { pool } from '../src/db.js';
import { getArchiveRetentionInterval, getArchiveCutoffDate } from '../src/config/archive.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { dryRun: false, before: null, help: false };
  args.forEach((arg) => {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--before=')) {
      options.before = arg.substring('--before='.length);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  });
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/archive-old-batches.js [--dry-run] [--before=ISO_DATE]

Options:
  --dry-run       Report how many rows are eligible without moving data
  --before=DATE   Override cutoff date (default: retention window of ${getArchiveRetentionInterval()})
  --help          Show this message
`);
}

async function run() {
  const options = parseArgs();
  if (options.help) {
    printUsage();
    return;
  }

  const cutoffDate = options.before ? new Date(options.before) : getArchiveCutoffDate();
  if (Number.isNaN(cutoffDate.getTime())) {
    throw new Error(`Invalid cutoff date provided: ${options.before}`);
  }
  const cutoffIso = cutoffDate.toISOString();
  console.log(`[archive-old-batches] Retention window: ${getArchiveRetentionInterval()}`);
  console.log(`[archive-old-batches] Archiving batches created before ${cutoffIso}`);

  if (options.dryRun) {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::bigint AS count FROM batch_archives WHERE created_at < $1',
      [cutoffIso]
    );
    const count = rows[0]?.count ?? 0;
    console.log(`[archive-old-batches] DRY RUN: ${count} batches eligible for archival.`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertResult = await client.query(
      `INSERT INTO batch_archives_history (
        batch_id,
        file_name,
        file_path,
        checksum,
        duplicate_report_path,
        transactions,
        created_at,
        code,
        department_code,
        file_data,
        duplicate_report_data,
        pd_number,
        submitted_email,
        submitted_by,
        stage,
        stage_updated_at,
        root_batch_id,
        is_draft,
        deleted_at,
        archived_at
      )
      SELECT
        batch_id,
        file_name,
        file_path,
        checksum,
        duplicate_report_path,
        transactions,
        created_at,
        code,
        department_code,
        file_data,
        duplicate_report_data,
        pd_number,
        submitted_email,
        submitted_by,
        stage,
        stage_updated_at,
        root_batch_id,
        is_draft,
        deleted_at,
        NOW()
      FROM batch_archives
      WHERE created_at < $1
      ORDER BY created_at
      RETURNING batch_id`,
      [cutoffIso]
    );

    if (!insertResult.rowCount) {
      await client.query('ROLLBACK');
      console.log('[archive-old-batches] No batches met the cutoff. Nothing archived.');
      return;
    }

    const batchIds = insertResult.rows.map((row) => row.batch_id);
    await client.query('DELETE FROM batch_archives WHERE batch_id = ANY($1::uuid[])', [batchIds]);
    await client.query('COMMIT');
    console.log(`[archive-old-batches] Archived ${insertResult.rowCount} batches.`);
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
    console.error('[archive-old-batches] Failed to archive batches:', err.message);
    await pool.end();
    process.exit(1);
  });

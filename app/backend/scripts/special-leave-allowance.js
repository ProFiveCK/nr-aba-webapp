#!/usr/bin/env node
// Brings Special leave balances down to the yearly allowance in the current leave policy.
// Staff brought across from the earlier leave setup kept its larger Special balance until
// their next anniversary; this removes the extra days now, as a correction on their account.
//
// Usage: node scripts/special-leave-allowance.js [--apply]
//
// Without --apply it only lists what would change. Safe to run again: an account already at
// the allowance is left alone. On the live stack:
//
//   docker exec ron-aba-backend-prod node scripts/special-leave-allowance.js
import { pool } from '../src/db.js';
import { alignSpecialLeave, plainDays } from '../src/services/governmentLeaveSpecialAllowance.js';

function table(headers, rows) {
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map(row => String(row[i]).length)));
  const line = cells => `  ${cells.map((cell, i) => String(cell).padEnd(widths[i])).join('  ')}`.trimEnd();
  return [line(headers), line(widths.map(width => '-'.repeat(width))), ...rows.map(line)].join('\n');
}
const section = (title, rows, headers, cells) => { if (rows.length) console.log(`\n${title} (${rows.length})\n${table(headers, rows.map(cells))}`); };
const who = row => [row.display_name, row.department || '-'];
const year = row => `${row.period_start} to ${row.period_end}`;

async function run() {
  const apply = process.argv.includes('--apply');
  const report = await alignSpecialLeave(pool, { apply });
  const rows = status => report.rows.filter(row => row.status === status);
  const days = `${plainDays(report.allowance)} days`;
  console.log(`Special leave allowance: ${days} a service year (${report.policy_label}), as at ${report.as_of}`);
  console.log(`Staff with a Special balance: ${report.rows.length}; already at or under ${days}: ${rows('within').length}`);

  const numbers = row => [plainDays(row.credited), plainDays(row.used), plainDays(row.held), plainDays(row.balance)];
  section(apply ? 'Reduced to the allowance' : 'Above the allowance, to be reduced', apply ? report.corrected : rows('reduce'),
    ['Name', 'Department', 'Leave year', 'Credited', 'Taken', 'Pending', apply ? 'Balance before' : 'Balance now', 'Balance after'],
    row => [...who(row), year(row), ...numbers(row), plainDays(row.balance_after)]);
  section('Already taken or applied for more than the allowance, nothing left to remove', rows('nothing_left'),
    ['Name', 'Department', 'Leave year', 'Credited', 'Taken', 'Pending', 'Balance'], row => [...who(row), year(row), ...numbers(row)]);
  section('Leave year has ended and is waiting to renew, not changed here', rows('year_ended'),
    ['Name', 'Department', 'Leave year ended', 'Balance', 'Special balance schedule'], row => [...who(row), row.period_end, plainDays(row.balance), row.scheduled ? 'yes' : 'none']);
  section('No Special balance schedule, so it will not reset on the anniversary', report.rows.filter(row => !row.scheduled && row.status !== 'year_ended'),
    ['Name', 'Department', 'Leave year ends'], row => [...who(row), row.period_end]);
  section(`Not on the current leave setup, Special shows above ${days}, not changed here`, report.earlier_setup,
    ['Name', 'Department', 'Balance'], row => [...who(row), plainDays(row.balance)]);

  const pending = rows('reduce').length;
  if (apply) console.log(`\n${report.corrected.length} balance(s) corrected.`);
  else console.log(pending ? `\nPreview only, nothing was changed. Run again with --apply to reduce these ${pending} balance(s).` : '\nNothing to change.');
}

run()
  .then(() => pool.end())
  .catch(async err => {
    console.error('[special-leave-allowance] Failed:', err.message);
    await pool.end();
    process.exit(1);
  });

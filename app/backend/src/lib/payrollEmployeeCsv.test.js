import assert from 'node:assert/strict';
import test from 'node:test';
import { isImportDate, parsePayrollCsv } from './payrollEmployeeCsv.js';

const header = 'payroll_employee_id,display_name,status,department_name';
test('Payroll CSV preserves text identifiers, BOM, quoted commas and escaped quotes', () => {
  const { rows } = parsePayrollCsv(`\uFEFF${header}\r\n000123-A,"Jane, ""JJ""",active,Finance\r\n`);
  assert.equal(rows[0].data.payroll_employee_id, '000123-A');
  assert.equal(rows[0].data.display_name, 'Jane, "JJ"');
  assert.deepEqual(rows[0].errors, []);
});
test('duplicate IDs block both rows; malformed cells cannot silently shift columns', () => {
  const { rows } = parsePayrollCsv(`${header}\n001,One,active,Finance\n001,Two,active,Finance,extra`);
  assert.ok(rows.every((row) => row.errors.some((error) => error.includes('more than once'))));
  assert.ok(rows[1].errors.some((error) => error.includes('number of cells')));
  for (const csv of [`${header}\n001,"Unclosed,active,Finance`, `${header}\n001,"Name"x,active,Finance`, `${header},password\n001,One,active,Finance,x`, `${header},display_name\n001,One,active,Finance,One`]) {
    assert.throws(() => parsePayrollCsv(csv), { status: 400 });
  }
});
test('real dates and explicit categories/flags are required for appointment data', () => {
  assert.equal(isImportDate('2024-02-29'), true);
  for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '01/10/2026']) assert.equal(isImportDate(value), false);
  const { rows } = parsePayrollCsv(`${header},employment_category,appointment_start,is_intern,counts_for_service\n001,One,active,Finance,temporary,2026-01-01,true,\n002,Two,ACTIVE,Finance,unknown,2026-02-30,yes,1`);
  assert.deepEqual(rows[0].errors, []);
  assert.equal(rows[0].data.counts_for_service, '');
  assert.equal(rows[1].errors.length, 4);
});
test('oversized uploads and more than 3,000 employee rows are rejected', () => {
  assert.throws(() => parsePayrollCsv('x'.repeat(2 * 1024 * 1024 + 1)), { status: 400 });
  assert.throws(() => parsePayrollCsv(`${header}\n${Array.from({ length: 3001 }, (_, i) => `${i},Employee ${i},active,Finance`).join('\n')}`), { status: 400 });
});

import { badRequest } from './serviceError.js';

export const PAYROLL_IMPORT_COLUMNS = [
  'payroll_employee_id', 'display_name', 'status', 'department_name', 'division_name',
  'email', 'position_title', 'employment_category', 'appointment_start', 'appointment_end',
  'is_teacher', 'is_intern', 'counts_for_service', 'appointment_reference', 'work_pattern_name', 'manager_payroll_id',
];
const REQUIRED = ['payroll_employee_id', 'display_name', 'status', 'department_name'];
const CATEGORIES = ['permanent', 'probationary', 'temporary', 'contract', 'casual', 'unknown'];
export const PAYROLL_IMPORT_MAX_ROWS = 3000;
export const PAYROLL_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export function isImportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2200) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Strict CSV parsing is authoritative on the server. IDs are never coerced to
// numbers; malformed quotes/columns cannot silently shift fields into an ID.
export function parsePayrollCsv(text) {
  if (typeof text !== 'string' || !text.trim()) throw badRequest('Choose a non-empty UTF-8 CSV file.');
  if (Buffer.byteLength(text, 'utf8') > PAYROLL_IMPORT_MAX_BYTES) throw badRequest('Payroll CSV files must be 2 MiB or smaller.');
  const source = text.replace(/^\uFEFF/, '');
  const records = [];
  let cells = [], field = '', quoted = false, closed = false, started = false;
  const pushCell = () => { cells.push(field); field = ''; closed = false; started = false; };
  const pushRecord = () => {
    pushCell();
    if (cells.some((cell) => cell.trim())) records.push(cells);
    cells = [];
    if (records.length > PAYROLL_IMPORT_MAX_ROWS + 1) throw badRequest(`Import at most ${PAYROLL_IMPORT_MAX_ROWS} employees per batch.`);
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === ',') pushCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      pushRecord();
    } else if (char === '"' && !started && !closed) { quoted = true; started = true; }
    else {
      if (char === '"' || closed) throw badRequest('CSV quotes are malformed. Use the downloaded template and export as CSV.');
      field += char;
      started = true;
    }
    if (field.length > 1000 || cells.length > PAYROLL_IMPORT_COLUMNS.length) throw badRequest('A CSV field or row is too large.');
  }
  if (quoted) throw badRequest('A CSV quoted field was not closed.');
  if (field || cells.length || closed) pushRecord();
  if (records.length < 2) throw badRequest('The CSV needs a header and at least one employee row.');
  const headers = records.shift().map((header) => header.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw badRequest('CSV headers must not be duplicated.');
  if (headers.some((header) => !PAYROLL_IMPORT_COLUMNS.includes(header))) throw badRequest('CSV headers must match the Payroll employee template. Leave balances and login credentials are not imported here.');
  if (REQUIRED.some((header) => !headers.includes(header))) throw badRequest(`Required CSV columns: ${REQUIRED.join(', ')}.`);
  const seen = new Set(), duplicates = new Set();
  const rows = records.map((record, index) => {
    const data = Object.fromEntries(headers.map((header, col) => [header, (record[col] || '').trim()]));
    const errors = [], warnings = [];
    if (record.length !== headers.length) errors.push('The number of cells does not match the header.');
    for (const required of REQUIRED) if (!data[required]) errors.push(`${required} is required.`);
    for (const [fieldName, max] of [['payroll_employee_id', 100], ['display_name', 200], ['department_name', 60], ['division_name', 60], ['email', 254], ['position_title', 120], ['appointment_reference', 200], ['manager_payroll_id', 100]]) {
      if (data[fieldName]?.length > max || /[\u0000-\u001f\u007f]/.test(data[fieldName] || '')) errors.push(`${fieldName} is too long or contains a control character.`);
    }
    if (data.status && !['active', 'inactive'].includes(data.status)) errors.push('status must be active or inactive.');
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('email must be an individual email address.');
    const hasPeriod = ['employment_category', 'appointment_start', 'appointment_end', 'is_teacher', 'is_intern', 'counts_for_service', 'appointment_reference', 'work_pattern_name'].some((key) => data[key]);
    if (hasPeriod) {
      if (!CATEGORIES.includes(data.employment_category)) errors.push('Provide an employment_category from the template.');
      if (!isImportDate(data.appointment_start || '')) errors.push('appointment_start must be a real YYYY-MM-DD date.');
      if (data.appointment_end && !isImportDate(data.appointment_end)) errors.push('appointment_end must be a real YYYY-MM-DD date.');
      if (data.appointment_end && data.appointment_end < data.appointment_start) errors.push('An appointment cannot end before it starts.');
      for (const flag of ['is_teacher', 'is_intern', 'counts_for_service']) {
        if (data[flag] && !['true', 'false'].includes(data[flag])) errors.push(`${flag} must be true, false or blank.`);
      }
      if (data.employment_category === 'unknown') warnings.push('Employment category needs HR determination before policy activation.');
    } else warnings.push('No appointment classification or service history supplied; HR review is needed before policy activation.');
    if (data.manager_payroll_id === data.payroll_employee_id && data.manager_payroll_id) errors.push('An employee cannot be their own manager.');
    if (seen.has(data.payroll_employee_id)) duplicates.add(data.payroll_employee_id);
    seen.add(data.payroll_employee_id);
    return { row_number: index + 2, data, has_period: hasPeriod, errors, warnings };
  });
  for (const row of rows) if (duplicates.has(row.data.payroll_employee_id)) row.errors.push('Payroll ID appears more than once in this file.');
  return { headers, rows };
}

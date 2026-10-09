import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { withTransaction } from '../lib/transaction.js';
import { badRequest, notFound, ServiceError } from '../lib/serviceError.js';
import { normalizeNameKey } from '../lib/names.js';
import { isImportDate, parsePayrollCsv } from '../lib/payrollEmployeeCsv.js';
import { recordAudit } from './auditService.js';
import { newEmployeeLeaveRegime } from './governmentLeaveDefaults.js';

const conflict = (message) => new ServiceError(409, message);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identityFields = ['id', 'display_name', 'position_title', 'email', 'status', 'reviewer_id', 'department_id', 'division_id', 'department_code', 'division_code', 'manager_id'];
const reasonFor = (value) => {
  if (typeof value !== 'string' || value.trim().length < 10 || value.length > 1000) throw badRequest('Record a review reason of 10–1,000 characters.');
  return value.trim();
};

async function contextFor(db) {
  // Execute one query at a time when using a transaction client.
  const employees = await db.query(`SELECT ${identityFields.join(', ')} FROM hr_employees ORDER BY id`);
  const identifiers = await db.query("SELECT id, employee_id, external_id FROM hr_employee_external_ids WHERE source = 'techone_payroll' ORDER BY external_id");
  const periods = await db.query('SELECT * FROM hr_employee_service_periods ORDER BY employee_id, start_date, id');
  const departments = await db.query('SELECT id, name FROM hr_departments ORDER BY id');
  const divisions = await db.query('SELECT id, department_id, name FROM hr_divisions ORDER BY id');
  const patterns = await db.query('SELECT * FROM hr_work_patterns ORDER BY id');
  const byEmployee = new Map(employees.rows.map((row) => [row.id, row]));
  const byExternalId = new Map(identifiers.rows.map((row) => [row.external_id, row.employee_id]));
  const names = new Map(), emails = new Map(), periodsByEmployee = new Map(), idsByEmployee = new Map();
  for (const employee of employees.rows) {
    const key = normalizeNameKey(employee.display_name);
    names.set(key, [...(names.get(key) || []), employee]);
    if (employee.email) emails.set(employee.email.toLowerCase(), [...(emails.get(employee.email.toLowerCase()) || []), employee]);
  }
  for (const period of periods.rows) periodsByEmployee.set(period.employee_id, [...(periodsByEmployee.get(period.employee_id) || []), period]);
  for (const id of identifiers.rows) idsByEmployee.set(id.employee_id, [...(idsByEmployee.get(id.employee_id) || []), id]);
  return { byEmployee, byExternalId, names, emails, periodsByEmployee, idsByEmployee,
    departments: departments.rows, divisions: divisions.rows, patterns: patterns.rows };
}

function placement(data, ctx) {
  const department = ctx.departments.find((row) => row.name.toLowerCase() === data.department_name.toLowerCase());
  const division = data.division_name && ctx.divisions.find((row) => row.department_id === department?.id && row.name.toLowerCase() === data.division_name.toLowerCase());
  const pattern = data.work_pattern_name && ctx.patterns.find((row) => row.name.toLowerCase() === data.work_pattern_name.toLowerCase());
  return { department: department || null, division: division || null, pattern: pattern || null };
}

function expectedHash(row, ctx) {
  const employee = row.decision === 'update' ? ctx.byEmployee.get(row.target_employee_id) : null;
  const place = placement(row.input.data, ctx);
  const managerId = ctx.byExternalId.get(row.input.data.manager_payroll_id);
  const manager = managerId ? ctx.byEmployee.get(managerId) : null;
  return digest({ employee: employee || null, manager: manager || null, identifiers: employee ? ctx.idsByEmployee.get(employee.id) || [] : [],
    periods: employee ? ctx.periodsByEmployee.get(employee.id) || [] : [], ...place });
}

function candidates(data, ctx) {
  const matches = [...(ctx.names.get(normalizeNameKey(data.display_name)) || []), ...(ctx.emails.get(data.email?.toLowerCase()) || [])];
  return [...new Map(matches.map((row) => [row.id, row])).values()].slice(0, 20)
    .map(({ id, display_name, department_code, status }) => ({ id, display_name, department_code, status,
      external_ids: (ctx.idsByEmployee.get(id) || []).map((entry) => ({ external_id: entry.external_id })) }));
}

function wantedPeriod(input, ctx) {
  if (!input.has_period) return null;
  const data = input.data;
  return { start_date: data.appointment_start, end_date: data.appointment_end || null,
    employment_category: data.employment_category, is_teacher: data.is_teacher === 'true', is_intern: data.is_intern === 'true',
    counts_for_service: data.counts_for_service ? data.counts_for_service === 'true' : null,
    work_pattern_id: placement(data, ctx).pattern?.id || null, appointment_reference: data.appointment_reference || null };
}

function servicePlan(row, ctx) {
  const wanted = wantedPeriod(row.input, ctx);
  if (!wanted) return { wanted: null, identical: false, overlap: false };
  const existing = ctx.periodsByEmployee.get(row.target_employee_id) || [];
  const identical = existing.some((period) => Object.keys(wanted).every((key) => period[key] === wanted[key]));
  const overlap = !identical && existing.some((period) => period.start_date <= (wanted.end_date || '9999-12-31') && (period.end_date || '9999-12-31') >= wanted.start_date);
  return { wanted, identical, overlap };
}

function proposedProfile(row, ctx, managerId) {
  const data = row.input.data, place = placement(data, ctx), before = ctx.byEmployee.get(row.target_employee_id);
  return { display_name: data.display_name, status: data.status,
    department_id: place.department?.id || null, division_id: place.division?.id || null,
    department_code: place.department?.name || null, division_code: place.division?.name || null,
    position_title: data.position_title || before?.position_title || null,
    email: before?.reviewer_id ? before.email : data.email || before?.email || null,
    manager_id: data.manager_payroll_id ? managerId : before?.manager_id || null };
}

function evaluate(rows, ctx) {
  const selected = rows.filter((row) => ['create', 'update'].includes(row.decision));
  const targetCounts = new Map(), importsById = new Map();
  for (const row of selected) {
    targetCounts.set(row.target_employee_id, (targetCounts.get(row.target_employee_id) || 0) + 1);
    importsById.set(row.input.data.payroll_employee_id, row);
  }
  const managers = new Map([...ctx.byEmployee.values()].map((employee) => [employee.id, employee.manager_id]));
  const output = rows.map((row) => {
    const data = row.input.data, errors = [...row.input.errors], warnings = [...row.input.warnings];
    const place = placement(data, ctx);
    if (!place.department) errors.push('Department is not in Policies. Add/map it before importing.');
    if (data.division_name && !place.division) errors.push('Division is not listed under this department.');
    if (data.work_pattern_name && !place.pattern) errors.push('Work pattern is not in the approved list.');
    if (row.decision === 'review') errors.push('HR must choose a verified existing record, confirm a distinct new employee, or skip this row.');
    if (row.decision === 'update' && !ctx.byEmployee.has(row.target_employee_id)) errors.push('The selected employee no longer exists. Preview again.');
    if (row.decision === 'create' && ctx.byEmployee.has(row.target_employee_id)) errors.push('The proposed employee ID already exists. Preview again.');
    if (row.decision === 'create' && !row.review_reason && candidates(data, ctx).length) errors.push('A possible duplicate now exists. HR must confirm the identity before creating a record.');
    const owner = ctx.byExternalId.get(data.payroll_employee_id);
    if (owner && owner !== row.target_employee_id && row.decision !== 'review') errors.push('This Payroll ID is already verified against another employee.');
    if (targetCounts.get(row.target_employee_id) > 1) errors.push('Two selected rows target the same employee. Import one current appointment per employee.');
    if (servicePlan(row, ctx).overlap) errors.push('Appointment data overlaps a different service record. HR must resolve the history first.');
    if (row.snapshot_hash && expectedHash(row, ctx) !== row.snapshot_hash) errors.push('Employee, identity, service or organisation data changed since review. Refresh this preview.');
    let managerId = null;
    if (data.manager_payroll_id) {
      managerId = importsById.get(data.manager_payroll_id)?.target_employee_id || ctx.byExternalId.get(data.manager_payroll_id) || null;
      if (!managerId) errors.push('Manager Payroll ID is unresolved or its import row is skipped.');
      if (managerId === row.target_employee_id) errors.push('An employee cannot be their own manager.');
      if (ctx.byEmployee.get(managerId)?.status === 'inactive') warnings.push('The proposed manager is inactive; verify the reporting line.');
      if (row.decision !== 'skip') managers.set(row.target_employee_id, managerId);
    }
    if (data.status === 'inactive') warnings.push('This explicitly marks the employee inactive and revokes linked sessions when changed.');
    if (row.decision === 'update' && ctx.byEmployee.get(row.target_employee_id)?.reviewer_id && data.email) warnings.push('Linked login email is retained. Account contact changes require separate verification.');
    const profile = proposedProfile(row, ctx, managerId), before = ctx.byEmployee.get(row.target_employee_id);
    const changes = before ? Object.keys(profile).filter((key) => profile[key] !== before[key]).map((field) => ({ field, before: before[field], after: profile[field] })) : [];
    const service = servicePlan(row, ctx);
    return { ...row, target_employee_name: before?.display_name || null, errors, warnings, changes, service_action: service.wanted ? service.identical ? 'retained' : 'add' : 'not_supplied',
      manager_id: managerId, potential_matches: row.decision === 'review' || errors.some((error) => error.includes('possible duplicate')) ? candidates(data, ctx) : [],
      state: row.decision === 'skip' ? 'skipped' : errors.length ? 'blocked' : 'ready' };
  });
  // Check the proposed graph, including reporting lines already in the portal.
  const cyclic = new Set(), complete = new Set();
  for (const start of managers.keys()) {
    const path = [], visited = new Map();
    let current = start;
    while (current && !complete.has(current)) {
      if (visited.has(current)) { for (const id of path.slice(visited.get(current))) cyclic.add(id); break; }
      visited.set(current, path.length); path.push(current); current = managers.get(current);
    }
    for (const id of path) complete.add(id);
  }
  for (const row of output) if (row.decision !== 'skip' && cyclic.has(row.target_employee_id)) {
    row.errors.push('The proposed reporting line creates a manager cycle. Resolve or skip the affected rows.');
    row.state = 'blocked';
  }
  return output;
}

async function storedRows(db, batchId) {
  return (await db.query('SELECT * FROM hr_employee_import_rows WHERE batch_id = $1 ORDER BY row_number', [batchId])).rows;
}

async function batchFor(db, batchId, locked = false) {
  const { rows: [batch] } = await db.query(`SELECT * FROM hr_employee_import_batches WHERE id = $1 ${locked ? 'FOR UPDATE' : ''}`, [batchId]);
  if (!batch) throw notFound('Import batch not found.');
  return batch;
}

function summary(rows) {
  return { ready: rows.filter((row) => row.state === 'ready').length, blocked: rows.filter((row) => row.state === 'blocked').length,
    skipped: rows.filter((row) => row.state === 'skipped').length, create: rows.filter((row) => row.state === 'ready' && row.decision === 'create').length,
    update: rows.filter((row) => row.state === 'ready' && row.decision === 'update').length };
}

export async function readPayrollImport(pool, batchId, { page = 1, filter = 'all' } = {}) {
  const batch = await batchFor(pool, batchId);
  const stored = await storedRows(pool, batchId);
  const rows = batch.status === 'applied' ? stored.map((row) => ({ ...row, errors: row.input.errors, warnings: row.input.warnings,
    changes: [], service_action: 'recorded', potential_matches: [], state: row.decision === 'skip' ? 'skipped' : 'applied' })) : evaluate(stored, await contextFor(pool));
  const filtered = filter === 'all' ? rows : rows.filter((row) => row.state === filter);
  return { batch, summary: summary(rows), rows: filtered.slice((page - 1) * 50, page * 50).map(({ snapshot_hash: _snapshot, input, ...rest }) => ({ ...rest, data: input.data })),
    page, page_size: 50, total: filtered.length, filter };
}

export async function previewPayrollImport(pool, { csv, fileName, exportDate, actor }) {
  if (!isImportDate(exportDate)) throw badRequest('Provide the Payroll export date as YYYY-MM-DD.');
  const parsed = parsePayrollCsv(csv);
  const hash = createHash('sha256').update(csv, 'utf8').digest('hex');
  const batchId = await withTransaction(pool, async (client) => {
    const { rows: [batch] } = await client.query(`INSERT INTO hr_employee_import_batches
      (source_hash, file_name, export_date, row_count, created_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (source, contract_version, source_hash, export_date) DO NOTHING RETURNING id`,
    [hash, basename(fileName || 'payroll-employees.csv').slice(0, 200), exportDate, parsed.rows.length, actor.id]);
    if (!batch) return (await client.query('SELECT id FROM hr_employee_import_batches WHERE source_hash = $1 AND export_date = $2 AND contract_version = 1', [hash, exportDate])).rows[0].id;
    const ctx = await contextFor(client);
    const duplicateNames = new Map();
    for (const row of parsed.rows) duplicateNames.set(normalizeNameKey(row.data.display_name), (duplicateNames.get(normalizeNameKey(row.data.display_name)) || 0) + 1);
    const rows = parsed.rows.map((input) => {
      const target = ctx.byExternalId.get(input.data.payroll_employee_id);
      const decision = target ? 'update' : candidates(input.data, ctx).length || duplicateNames.get(normalizeNameKey(input.data.display_name)) > 1 ? 'review' : 'create';
      const row = { row_number: input.row_number, input, decision, target_employee_id: target || (decision === 'create' ? randomUUID() : null) };
      return { ...row, snapshot_hash: decision === 'review' ? null : expectedHash(row, ctx) };
    });
    // One bounded insert for up to 3,000 rows; avoid 3,000 preview round trips.
    await client.query(`INSERT INTO hr_employee_import_rows (batch_id, row_number, input, decision, target_employee_id, snapshot_hash)
      SELECT $1, x.row_number, x.input, x.decision, x.target_employee_id, x.snapshot_hash
      FROM jsonb_to_recordset($2::jsonb) AS x(row_number int, input jsonb, decision text, target_employee_id uuid, snapshot_hash text)`, [batch.id, JSON.stringify(rows)]);
    await recordAudit({ client, actor, action: 'hr.employee.import.previewed', entityType: 'hr_employee_import_batch', entityId: batch.id,
      after: { source_hash: hash, export_date: exportDate, row_count: rows.length } });
    return batch.id;
  });
  return readPayrollImport(pool, batchId);
}

export async function reconcilePayrollImportRow(pool, { batchId, rowNumber, decision, employeeId, reason, actor, revision }) {
  const reviewReason = reasonFor(reason);
  if (!['create', 'update', 'skip'].includes(decision)) throw badRequest('Choose a new employee, a verified existing employee, or skip.');
  await withTransaction(pool, async (client) => {
    const batch = await batchFor(client, batchId, true);
    if (batch.status !== 'preview' || batch.revision !== revision) throw conflict('The import changed or was applied. Refresh before reviewing.');
    const { rows: [row] } = await client.query('SELECT * FROM hr_employee_import_rows WHERE batch_id = $1 AND row_number = $2', [batchId, rowNumber]);
    if (!row) throw notFound('Import row not found.');
    const ctx = await contextFor(client);
    const owner = ctx.byExternalId.get(row.input.data.payroll_employee_id);
    const target = decision === 'update' ? employeeId : decision === 'create' ? randomUUID() : null;
    if (decision === 'update' && !ctx.byEmployee.has(target)) throw badRequest('Choose an existing employee from the directory.');
    if (decision !== 'skip' && owner && owner !== target) throw conflict('A verified Payroll ID cannot be reassigned by import. Resolve its identity separately.');
    const updated = { ...row, decision, target_employee_id: target };
    await client.query(`UPDATE hr_employee_import_rows SET decision = $3, target_employee_id = $4, snapshot_hash = $5,
      review_reason = $6, reviewed_by = $7, reviewed_at = NOW() WHERE batch_id = $1 AND row_number = $2`,
    [batchId, rowNumber, decision, target, decision === 'skip' ? null : expectedHash(updated, ctx), reviewReason, actor.id]);
    await client.query('UPDATE hr_employee_import_batches SET revision = revision + 1 WHERE id = $1', [batchId]);
    await recordAudit({ client, actor, action: 'hr.employee.import.row.reviewed', entityType: 'hr_employee_import_batch', entityId: batchId,
      after: { row_number: rowNumber, decision, employee_id: target, reason: reviewReason } });
  });
  return readPayrollImport(pool, batchId);
}

export async function refreshPayrollImport(pool, { batchId, actor, revision }) {
  await withTransaction(pool, async (client) => {
    const batch = await batchFor(client, batchId, true);
    if (batch.status !== 'preview' || batch.revision !== revision) throw conflict('The import changed or was applied. Reload it first.');
    const ctx = await contextFor(client), rows = await storedRows(client, batchId);
    for (const row of rows) if (['create', 'update'].includes(row.decision)) {
      // Refresh never changes identity decisions. A new competing Payroll ID
      // remains a conflict; HR must explicitly reconcile it again.
      await client.query('UPDATE hr_employee_import_rows SET snapshot_hash = $3 WHERE batch_id = $1 AND row_number = $2', [batchId, row.row_number, expectedHash(row, ctx)]);
    }
    await client.query('UPDATE hr_employee_import_batches SET revision = revision + 1 WHERE id = $1', [batchId]);
    await recordAudit({ client, actor, action: 'hr.employee.import.refreshed', entityType: 'hr_employee_import_batch', entityId: batchId, after: { previous_revision: revision } });
  });
  return readPayrollImport(pool, batchId);
}

export async function applyPayrollImport(pool, { batchId, revision, reviewNote, actor }) {
  const note = reasonFor(reviewNote);
  return withTransaction(pool, async (client) => {
    // Serialize import application, then lock existing targets in stable order.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-payroll-employee-import'))");
    const batch = await batchFor(client, batchId, true);
    if (batch.status === 'applied') return batch.result;
    if (batch.revision !== revision) throw conflict('The preview changed. Review the current revision before applying.');
    const rows = await storedRows(client, batchId);
    const newRegime = await newEmployeeLeaveRegime(client);
    // The small government employee master is locked in ID order so reporting
    // line edits cannot create a cycle between validation and the batch write.
    await client.query('SELECT id FROM hr_employees ORDER BY id FOR UPDATE');
    await client.query('SELECT id FROM hr_departments ORDER BY id FOR SHARE');
    await client.query('SELECT id FROM hr_divisions ORDER BY id FOR SHARE');
    await client.query('SELECT id FROM hr_work_patterns ORDER BY id FOR SHARE');
    const ctx = await contextFor(client), evaluated = evaluate(rows, ctx);
    if (evaluated.some((row) => row.state === 'blocked')) throw conflict('Resolve every blocked row or explicitly skip it before applying. No employees were changed.');
    const result = { batch_id: batchId, created: 0, updated: 0, unchanged: 0, skipped: 0, service_periods_added: 0 };
    for (const row of evaluated) {
      if (row.decision === 'skip') {
        result.skipped++;
        await client.query("UPDATE hr_employee_import_rows SET applied_outcome = 'skipped' WHERE batch_id = $1 AND row_number = $2", [batchId, row.row_number]);
        continue;
      }
      const data = row.input.data, before = ctx.byEmployee.get(row.target_employee_id);
      const profile = proposedProfile(row, ctx, row.manager_id);
      const changed = !before || Object.keys(profile).some((key) => profile[key] !== before[key]);
      if (row.decision === 'create') {
        // Manager FKs are written after all newly referenced employees exist.
        await client.query(`INSERT INTO hr_employees (id, display_name, status, department_id, division_id, department_code, division_code, position_title, email, leave_policy_regime)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [row.target_employee_id, profile.display_name, profile.status, profile.department_id,
          profile.division_id, profile.department_code, profile.division_code, profile.position_title, profile.email, newRegime]);
        result.created++;
      } else if (changed) {
        await client.query(`UPDATE hr_employees SET display_name=$2,status=$3,department_id=$4,division_id=$5,department_code=$6,
          division_code=$7,position_title=$8,email=$9,updated_at=NOW() WHERE id=$1`, [row.target_employee_id, profile.display_name, profile.status,
          profile.department_id, profile.division_id, profile.department_code, profile.division_code, profile.position_title, profile.email]);
        if (before.status !== profile.status && before.reviewer_id) await client.query('DELETE FROM reviewer_sessions WHERE reviewer_id = $1', [before.reviewer_id]);
        result.updated++;
      } else result.unchanged++;
      await client.query('UPDATE hr_employee_import_rows SET applied_outcome = $3 WHERE batch_id = $1 AND row_number = $2',
        [batchId, row.row_number, row.decision === 'create' ? 'created' : changed ? 'updated' : 'unchanged']);
      const { rows: ids } = await client.query(`INSERT INTO hr_employee_external_ids (employee_id, source, external_id, verified_by, reason)
        VALUES ($1,'techone_payroll',$2,$3,$4) ON CONFLICT (source, external_id) DO UPDATE SET external_id = EXCLUDED.external_id
        WHERE hr_employee_external_ids.employee_id = EXCLUDED.employee_id RETURNING id`,
      [row.target_employee_id, data.payroll_employee_id, actor.id, row.review_reason || note]);
      if (!ids.length) throw conflict('A Payroll ID was assigned elsewhere during review. Refresh and reconcile the conflict.');
      const plan = servicePlan(row, ctx);
      if (plan.wanted && !plan.identical) {
        const p = plan.wanted;
        await client.query(`INSERT INTO hr_employee_service_periods (employee_id,start_date,end_date,employment_category,is_teacher,is_intern,
          counts_for_service,work_pattern_id,appointment_reference,recorded_by,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [row.target_employee_id,p.start_date,p.end_date,p.employment_category,p.is_teacher,p.is_intern,p.counts_for_service,
          p.work_pattern_id,p.appointment_reference,actor.id,`Payroll import ${batchId}: ${row.review_reason || note}`]);
        result.service_periods_added++;
      }
      await recordAudit({ client, actor, action: 'hr.employee.import.applied', entityType: 'hr_employee', entityId: row.target_employee_id,
        before: before || null, after: { ...profile, payroll_employee_id: data.payroll_employee_id, ...(row.decision==='create'?{leave_policy_regime:newRegime}:{}) },
        metadata: { batch_id: batchId, source_hash: batch.source_hash, export_date: batch.export_date, row_number: row.row_number, review_reason: row.review_reason || note } });
    }
    for (const row of evaluated) if (row.decision !== 'skip' && row.input.data.manager_payroll_id) {
      await client.query('UPDATE hr_employees SET manager_id = $2, updated_at = NOW() WHERE id = $1 AND manager_id IS DISTINCT FROM $2::uuid', [row.target_employee_id, row.manager_id]);
    }
    await client.query(`UPDATE hr_employee_import_batches SET status='applied',applied_by=$2,applied_at=NOW(),review_note=$3,result=$4 WHERE id=$1`, [batchId,actor.id,note,result]);
    await recordAudit({ client, actor, action: 'hr.employee.import.completed', entityType: 'hr_employee_import_batch', entityId: batchId, after: result });
    return result;
  });
}

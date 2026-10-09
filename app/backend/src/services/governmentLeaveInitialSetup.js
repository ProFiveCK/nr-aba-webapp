import { ServiceError } from '../lib/serviceError.js';
import { withTransaction } from '../lib/transaction.js';
import { CODES, dayNumber, fingerprint } from '../lib/governmentLeaveRules.js';
import { isCentralHr } from './hrAccess.js';
import { assertCentral, today } from './governmentLeaveWorkflow.js';
import { resolvedPublishedPoliciesSql } from './governmentLeavePolicyTransitions.js';
import { managementReason } from './employeeManagement.js';
import { recordAudit } from './auditService.js';

const fail = (message, status = 409) => { throw new ServiceError(status, message); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPERATIONAL_NOTE = 'This records the initial policy and type mapping and only the selected exact organisation matches. Existing workflows, balances, managers, logins and eligibility remain unchanged. Government enrolment, certified openings and employee activation require their separate reviewed steps.';
const MEDICAL_WARNING = 'Retain every historical sick balance separately. Old inactive Sick and the two active certificate pools may overlap; mapping does not add, combine or convert them into a Government medical opening.';
const quoteIdentifier = name => `"${name.replaceAll('"', '""')}"`;

export async function initGovernmentLeaveInitialSetupSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS hr_gov_initial_setups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','deleted','adopted')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), plan JSONB NOT NULL, source_hash TEXT NOT NULL,
      summary JSONB NOT NULL, prepared_by UUID NOT NULL REFERENCES reviewers(id), updated_by UUID NOT NULL REFERENCES reviewers(id),
      reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      adopted_by UUID REFERENCES reviewers(id), adopted_at TIMESTAMPTZ, adoption_hash TEXT, adoption_result JSONB
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_gov_initial_setup_single_adoption ON hr_gov_initial_setups((TRUE)) WHERE status='adopted';
    CREATE TABLE IF NOT EXISTS hr_gov_initial_setup_revisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), setup_id UUID NOT NULL REFERENCES hr_gov_initial_setups(id), revision INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('created','updated','deleted','adopted')), plan JSONB NOT NULL, source_hash TEXT NOT NULL,
      summary JSONB NOT NULL, actor_id UUID NOT NULL REFERENCES reviewers(id), reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(setup_id,revision,action)
    );
    CREATE OR REPLACE FUNCTION hr_gov_initial_setup_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' OR OLD.status='adopted' THEN RAISE EXCEPTION 'Adopted initial setup is immutable; use the subsequent governed workflows'; END IF;
        RETURN NEW;
      END;
    $$;
    DROP TRIGGER IF EXISTS hr_gov_initial_setup_immutable ON hr_gov_initial_setups;
    CREATE TRIGGER hr_gov_initial_setup_immutable BEFORE UPDATE OR DELETE ON hr_gov_initial_setups FOR EACH ROW EXECUTE FUNCTION hr_gov_initial_setup_immutable();
    DROP TRIGGER IF EXISTS hr_gov_initial_setup_revision_immutable ON hr_gov_initial_setup_revisions;
    CREATE TRIGGER hr_gov_initial_setup_revision_immutable BEFORE UPDATE OR DELETE ON hr_gov_initial_setup_revisions FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable();
  `);
}

async function authorized(client, user) {
  if (!isCentralHr(user)) fail('Central HR administration is required.', 403);
  await assertCentral(client, user);
}
const actorFor = (user, actor) => ({ id: user.id, email: user.email, ip: actor?.ip });
function normalizedPlan(data = {}) {
  if (data.policy_id != null && !UUID.test(data.policy_id)) fail('Select a published policy.', 400);
  const start = data.start_date || today();
  try { dayNumber(start); } catch { fail('Use a valid start date (YYYY-MM-DD).', 400); }
  const mappings = data.mappings ?? [];
  const ids = data.adopt_employee_ids ?? [];
  if (!Array.isArray(mappings) || mappings.length > 500 || !Array.isArray(ids) || ids.length > 2000) fail('Review at most 500 leave types and 2,000 placement selections per setup.', 400);
  const seen = new Set();
  const normalizedMappings = mappings.map(mapping => {
    if (!mapping || !UUID.test(mapping.leave_type_id)) fail('Select a retained leave type.', 400);
    const typeId = mapping.leave_type_id.toLowerCase();
    if (seen.has(typeId)) fail('Select each retained leave type only once.', 400);
    seen.add(typeId);
    const code = mapping.code ?? null;
    if (code !== null && code !== 'retain_history' && !CODES.includes(code)) fail('Choose a supported Government type or retain history.', 400);
    return { leave_type_id: typeId, code };
  }).sort((a, b) => a.leave_type_id.localeCompare(b.leave_type_id));
  if (ids.some(id => !UUID.test(id))) fail('Select valid employee records for exact organisation matching.', 400);
  const normalizedIds = ids.map(id => id.toLowerCase());
  if (new Set(normalizedIds).size !== ids.length) fail('Select distinct employee records for exact organisation matching.', 400);
  return { policy_id: data.policy_id?.toLowerCase() || null, start_date: start, mappings: normalizedMappings, adopt_employee_ids: normalizedIds.sort() };
}
function revision(value) { if (!Number.isInteger(value) || value < 1 || value > 2147483646) fail('Reload the setup revision.', 400); return value; }
function hashRequired(hash) { if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) fail('Preview the current source before saving or adopting.', 400); }
function suggestedCode(type) {
  const name = type.name.toLowerCase();
  if (!type.is_active) return 'retain_history';
  return ({ annual: 'recreation', 'sick (with mc)': 'medical', 'sick (without mc)': 'medical', special: 'special',
    official: 'official', 'leave without pay': 'lwop', furlough: 'furlough', maternity: 'maternity', paternity: 'paternity', adoption: 'adoption', 'long service': 'long_service' })[name] || null;
}
function policyView(policy) {
  if (!policy) return null;
  const { id, label, effective_from, effective_to, original_effective_to, replaced_by_policy_id, rules, source_reference, authority_reference,
    evaluator_version, published_at, reason } = policy;
  return { id, label, effective_from, effective_to, original_effective_to, replaced_by_policy_id, rules, source_reference,
    authority_reference, evaluator_version, published_at, note: reason, status: 'published' };
}

// Hash source records in the database. Clinical text, documents, credentials and
// remuneration are never selected into the setup response or persisted draft.
async function sourceTables(client) {
  const core = ['hr_employees', 'hr_departments', 'hr_divisions', 'hr_leave_types', 'hr_leave_balances', 'hr_leave_applications',
    'hr_employee_external_ids', 'hr_employee_service_periods', 'hr_employee_account_links', 'hr_work_patterns', 'hr_approval_assignments',
    'hr_access_scopes', 'reviewers', 'reviewer_capabilities'];
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'hr_gov_%' AND tablename NOT IN ('hr_gov_initial_setups','hr_gov_initial_setup_revisions') ORDER BY tablename");
  return [...new Set([...core, ...rows.map(row => row.tablename)])].sort();
}
async function sourceHashes(client, tables) {
  const queries = tables.map((name, index) => {
    // Table names originate exclusively in our fixed list and PostgreSQL catalog.
    const rowHash = "md5((to_jsonb(t)-'final_pdf'-'content'-'data'-'bytes')::text)";
    return `SELECT $${index + 1}::text AS name,count(*)::int AS records,md5(COALESCE(string_agg(${rowHash},'' ORDER BY ${rowHash}),'')) AS hash FROM ${quoteIdentifier(name)} t`;
  });
  const { rows } = await client.query(`SELECT * FROM (${queries.join(' UNION ALL ')}) source ORDER BY name`, tables);
  const { rows: settings } = await client.query("SELECT to_char(accrual_anchor_date,'YYYY-MM-DD') AS accrual_anchor_date FROM reviewer_settings WHERE id=TRUE");
  return { tables: rows, settings };
}
function placementFor(employee, departments, divisions) {
  const departmentMatches = employee.department_id ? departments.filter(d => d.id === employee.department_id)
    : departments.filter(d => d.name.toLowerCase() === employee.department_code?.toLowerCase());
  const department = departmentMatches.length === 1 ? departmentMatches[0] : null;
  const divisionMatches = employee.division_id ? divisions.filter(d => d.id === employee.division_id && d.department_id === department?.id)
    : divisions.filter(d => d.department_id === department?.id && d.name.toLowerCase() === employee.division_code?.toLowerCase());
  const division = divisionMatches.length === 1 ? divisionMatches[0] : null;
  const conflict = !!employee.division_id && !division;
  const changesDepartment = !employee.department_id && !!department && !conflict;
  const changesDivision = !employee.division_id && !!division && !conflict;
  const canAdopt = changesDepartment || changesDivision;
  const matchStatus = employee.department_id && employee.division_id && !conflict ? 'verified'
    : department && division && !conflict ? 'exact' : department && !conflict ? 'partial' : 'unmatched';
  return { employee_id: employee.id, department_id: department?.id || null, division_id: division?.id || null,
    department_name: department?.name || null, division_name: division?.name || null, match_status: matchStatus, can_adopt: canAdopt,
    changes_department: changesDepartment, changes_division: changesDivision,
    issue: conflict ? 'The verified division does not belong to the matched department. Resolve placement separately.'
      : !department ? 'No unique exact retained department match.' : !division ? 'No unique exact division match within this department; division remains unverified.' : null };
}
function groupsFor(employees) {
  const groups = new Map();
  for (const employee of employees) {
    const p = employee.placement;
    const groupData = { retained_department: employee.department_code, retained_division: employee.division_code,
      department_id: p.department_id, division_id: p.division_id, match_status: p.match_status, can_adopt: p.can_adopt };
    const key = fingerprint(groupData);
    if (!groups.has(key)) groups.set(key, { key, ...groupData, department_name: p.department_name, division_name: p.division_name,
      issue: p.issue, employee_count: 0, employee_ids: [] });
    const group = groups.get(key); group.employee_count += 1; group.employee_ids.push(employee.id);
  }
  return [...groups.values()];
}
async function loadSource(client, startDate, tables = null, includeHashes = true) {
  const { rows: policies } = await client.query(resolvedPublishedPoliciesSql);
  const { rows: departments } = await client.query('SELECT id,name FROM hr_departments ORDER BY id');
  const { rows: divisions } = await client.query('SELECT id,department_id,name FROM hr_divisions ORDER BY id');
  const { rows: types } = await client.query(`SELECT id,name,description,default_days,is_accruable,requires_note,is_active,
    accrual_days_per_fortnight,reset_period,max_balance,requires_attachment,attachment_label FROM hr_leave_types ORDER BY name,id`);
  const { rows: balances } = await client.query(`SELECT b.id,b.employee_id,b.leave_type_id,t.name AS leave_type_name,b.year,b.balance,b.pending
    FROM hr_leave_balances b JOIN hr_leave_types t ON t.id=b.leave_type_id ORDER BY b.employee_id,b.year,b.leave_type_id,b.id`);
  const { rows: applicationCounts } = await client.query('SELECT leave_type_id,status,count(*)::int AS records FROM hr_leave_applications GROUP BY leave_type_id,status ORDER BY leave_type_id,status');
  const { rows: employees } = await client.query(`SELECT e.id,e.display_name,e.status,e.leave_policy_regime AS regime,e.reviewer_id,
    e.manager_id,m.display_name AS manager_name,e.department_code,e.division_code,e.department_id,e.division_id,
    to_char(e.join_date,'YYYY-MM-DD') AS join_date,e.leave_entitled,
    COALESCE((SELECT json_agg(json_build_object('source',x.source,'external_id',x.external_id) ORDER BY x.source,x.external_id) FROM hr_employee_external_ids x WHERE x.employee_id=e.id),'[]'::json) AS external_ids,
    to_jsonb(p) AS current_service_period,
    EXISTS(SELECT 1 FROM hr_gov_service_bases b WHERE b.employee_id=e.id AND b.effective_from<=$1) AS has_service_basis
    FROM hr_employees e LEFT JOIN hr_employees m ON m.id=e.manager_id
    LEFT JOIN LATERAL (SELECT employment_category,counts_for_service,work_pattern_id,is_teacher,is_intern,
      to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date
      FROM hr_employee_service_periods WHERE employee_id=e.id AND start_date<=$1 AND (end_date IS NULL OR end_date>=$1)
      ORDER BY start_date DESC,id LIMIT 1) p ON TRUE ORDER BY lower(e.display_name),e.id`, [startDate]);
  const byEmployee = new Map();
  for (const balance of balances) { if (!byEmployee.has(balance.employee_id)) byEmployee.set(balance.employee_id, []); byEmployee.get(balance.employee_id).push({ ...balance, proposed_target: null }); }
  const prepared = employees.map(employee => {
    const missing = [];
    if (!employee.external_ids.some(x => x.source === 'techone_payroll')) missing.push('Verified Payroll ID');
    if (!employee.department_id || !employee.division_id) missing.push('Verified managed placement');
    if (!employee.current_service_period) missing.push('Verified appointment and employment category');
    if (employee.current_service_period?.employment_category === 'unknown') missing.push('Employment category determination');
    if (employee.current_service_period?.counts_for_service == null) missing.push('Credited-service determination');
    if (!employee.current_service_period?.work_pattern_id) missing.push('Verified work pattern');
    if (!employee.has_service_basis) missing.push('Certified continuous-service basis');
    if (!employee.reviewer_id) missing.push('Verified login link');
    return { ...employee, missing_facts: missing, balances: byEmployee.get(employee.id) || [], placement: placementFor(employee, departments, divisions) };
  });
  const leaveTypes = types.map(type => ({ ...type, suggested_code: suggestedCode(type),
    balance_records: balances.filter(b => b.leave_type_id === type.id).length,
    application_records: applicationCounts.filter(a => a.leave_type_id === type.id).reduce((n, a) => n + a.records, 0),
    warning: type.name.toLowerCase().includes('sick') ? MEDICAL_WARNING : null }));
  const summary = { employees: employees.length, active_employees: employees.filter(e => e.status === 'active').length,
    legacy_employees: employees.filter(e => e.regime === 'legacy').length, government_employees: employees.filter(e => e.regime === 'government').length,
    linked_logins: employees.filter(e => !!e.reviewer_id).length, balances: balances.length,
    applications: applicationCounts.reduce((n, a) => n + a.records, 0), pending_applications: applicationCounts.filter(a => a.status === 'pending').reduce((n, a) => n + a.records, 0),
    leave_types: types.length, matched_placement_employees: prepared.filter(e => e.placement.can_adopt).length,
    unmatched_placement_employees: prepared.filter(e => e.placement.match_status === 'unmatched').length };
  return { policies: policies.map(policyView), leave_types: leaveTypes, employees: prepared, summary, placement_groups: groupsFor(prepared),
    hashes: includeHashes ? await sourceHashes(client, tables || await sourceTables(client)) : null };
}
function previewFrom(source, plan) {
  const policy = source.policies.find(p => p.id === plan.policy_id) || null;
  const supplied = new Map(plan.mappings.map(m => [m.leave_type_id, m.code]));
  const selected = new Set(plan.adopt_employee_ids);
  const blockers = [];
  if (!policy) blockers.push('Select a published policy.');
  else if (policy.effective_from > plan.start_date || policy.effective_to < plan.start_date) blockers.push('The selected published policy does not govern the chosen start date.');
  const mappings = source.leave_types.map(type => ({ ...type, leave_type_id: type.id, code: supplied.get(type.id) ?? null,
    target_rules: supplied.get(type.id) && supplied.get(type.id) !== 'retain_history' ? policy?.rules || null : null, proposed_target: null }));
  for (const mapping of mappings) if (mapping.code === null) blockers.push(`Decide how to retain or map ${mapping.name}.`);
  for (const mapping of plan.mappings) if (!source.leave_types.some(type => type.id === mapping.leave_type_id)) blockers.push('A selected leave type no longer exists. Refresh the source.');
  const placements = source.employees.filter(e => selected.has(e.id)).map(e => ({ ...e.placement, display_name: e.display_name,
    retained_department: e.department_code, retained_division: e.division_code }));
  if (placements.length !== selected.size) blockers.push('One or more selected employee records no longer exist.');
  for (const placement of placements) if (!placement.can_adopt) blockers.push(`${placement.display_name}: no unique exact placement change is available.`);
  return { source_hash: fingerprint({ version: 1, plan, source: source.hashes }), plan, policy, summary: source.summary,
    mappings, placement_groups: source.placement_groups, placements, blockers, ready_to_adopt: blockers.length === 0,
    operational_note: OPERATIONAL_NOTE, balances_converted: false, employees_activated: false };
}
async function readWork(pool, user, work) {
  return withTransaction(pool, async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await authorized(client, user);
    return work(client);
  });
}
async function setupRows(client) {
  const { rows: [adopted] } = await client.query("SELECT * FROM hr_gov_initial_setups WHERE status='adopted'");
  const { rows: [draft] } = await client.query("SELECT * FROM hr_gov_initial_setups WHERE status='draft' ORDER BY updated_at DESC,id DESC LIMIT 1");
  return { adopted: adopted || null, draft: draft || null };
}
export async function initialSetupState(pool, { user, startDate = today() }) {
  try { dayNumber(startDate); } catch { fail('Use a valid start date.', 400); }
  return readWork(pool, user, async client => {
    const source = await loadSource(client, startDate);
    const { adopted, draft } = await setupRows(client);
    const selected = source.policies.find(p => p.effective_from <= startDate && p.effective_to >= startDate);
    const defaultPlan = { policy_id: selected?.id || null, start_date: startDate,
      mappings: source.leave_types.map(type => ({ leave_type_id: type.id, code: null })), adopt_employee_ids: [] };
    const latestDraft = draft ? { ...draft, freshness: previewFrom(source, draft.plan).source_hash === draft.source_hash ? 'current' : 'stale' } : null;
    return { as_of: today(), start_date: startDate, policies: source.policies, selected_policy_id: selected?.id || null,
      summary: source.summary, leave_types: source.leave_types, placement_groups: source.placement_groups,
      latest_draft: latestDraft, adopted, default_plan: defaultPlan, operational_note: OPERATIONAL_NOTE };
  });
}
export async function initialSetupEmployees(pool, { user, page = 1, search = '', startDate = today() }) {
  if (!Number.isInteger(page) || page < 1 || page > 100000 || typeof search !== 'string' || search.length > 100) fail('Use a valid employee page and search.', 400);
  try { dayNumber(startDate); } catch { fail('Use a valid start date.', 400); }
  return readWork(pool, user, async client => {
    const source = await loadSource(client, startDate, null, false);
    const term = search.trim().toLowerCase();
    const rows = source.employees.filter(e => !term || [e.display_name, e.department_code, e.division_code, ...e.external_ids.map(x => x.external_id)].some(value => value?.toLowerCase().includes(term)));
    return { employees: rows.slice((page - 1) * 50, page * 50), total: rows.length, page, page_size: 50 };
  });
}
export async function previewInitialSetup(pool, { user, data }) {
  const plan = normalizedPlan(data);
  return readWork(pool, user, async client => previewFrom(await loadSource(client, plan.start_date), plan));
}
async function lockSetup(client) { await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-government-initial-setup'))"); }
async function notAdopted(client) {
  if ((await client.query("SELECT 1 FROM hr_gov_initial_setups WHERE status='adopted'")).rowCount) fail('Initial setup has already been adopted. Use the subsequent governed workflows.');
}
async function recordRevision(client, row, action, actor, reason) {
  await client.query(`INSERT INTO hr_gov_initial_setup_revisions(setup_id,revision,action,plan,source_hash,summary,actor_id,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [row.id, row.revision, action, row.plan, row.source_hash, row.summary, actor.id, reason]);
  await recordAudit({ client, actor, action: `hr.gov.initial_setup.${action}`, entityType: 'hr_gov_initial_setup', entityId: row.id,
    after: { revision: row.revision, status: row.status, source_hash: row.source_hash, summary: row.summary, reason } });
}
export async function saveInitialSetupDraft(pool, { user, actor, data, id = null }) {
  const plan = normalizedPlan(data), reason = managementReason(data.reason); hashRequired(data.source_hash);
  if (id) revision(data.expected_revision);
  return withTransaction(pool, async client => {
    await authorized(client, user); await lockSetup(client); await notAdopted(client);
    let before = null;
    if (id) {
      ({ rows: [before] } = await client.query('SELECT * FROM hr_gov_initial_setups WHERE id=$1 FOR UPDATE', [id]));
      if (!before) fail('Initial setup draft not found.', 404);
      if (before.status !== 'draft' || before.revision !== data.expected_revision) fail('The draft changed or was deleted. Reload before editing.');
    }
    const preview = previewFrom(await loadSource(client, plan.start_date), plan);
    if (preview.source_hash !== data.source_hash) fail('Source records or setup choices changed after preview. Refresh and preview again.');
    const verifiedActor = actorFor(user, actor);
    const query = id ? `UPDATE hr_gov_initial_setups SET revision=revision+1,plan=$2,source_hash=$3,summary=$4,updated_by=$5,reason=$6,updated_at=NOW() WHERE id=$1 RETURNING *`
      : `INSERT INTO hr_gov_initial_setups(id,plan,source_hash,summary,prepared_by,updated_by,reason) VALUES(COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5,$5,$6) RETURNING *`;
    const { rows: [row] } = await client.query(query, [id, plan, preview.source_hash, preview.summary, verifiedActor.id, reason]);
    await recordRevision(client, row, id ? 'updated' : 'created', verifiedActor, reason);
    return { ...row, freshness: 'current', blockers: preview.blockers, ready_to_adopt: preview.ready_to_adopt };
  });
}
export async function deleteInitialSetupDraft(pool, { user, actor, id, data }) {
  revision(data.expected_revision); const reason = managementReason(data.reason);
  return withTransaction(pool, async client => {
    await authorized(client, user); await lockSetup(client); await notAdopted(client);
    const { rows: [before] } = await client.query('SELECT * FROM hr_gov_initial_setups WHERE id=$1 FOR UPDATE', [id]);
    if (!before) fail('Initial setup draft not found.', 404);
    if (before.status !== 'draft' || before.revision !== data.expected_revision) fail('The draft changed or was deleted. Reload before deleting.');
    const verifiedActor = actorFor(user, actor);
    const { rows: [row] } = await client.query("UPDATE hr_gov_initial_setups SET status='deleted',revision=revision+1,updated_by=$2,updated_at=NOW(),reason=$3 WHERE id=$1 RETURNING *", [id, verifiedActor.id, reason]);
    await recordRevision(client, row, 'deleted', verifiedActor, reason); return row;
  });
}
export async function adoptInitialSetup(pool, { user, actor, id, data }) {
  revision(data.expected_revision); hashRequired(data.source_hash); const reason = managementReason(data.reason);
  const requestHash = fingerprint({ id, expected_revision: data.expected_revision, source_hash: data.source_hash, reason });
  return withTransaction(pool, async client => {
    if (!isCentralHr(user)) fail('Central HR administration is required.', 403);
    await lockSetup(client);
    const { rows: [draft] } = await client.query('SELECT * FROM hr_gov_initial_setups WHERE id=$1 FOR UPDATE', [id]);
    if (!draft) fail('Initial setup draft not found.', 404);
    if (draft.status === 'adopted') {
      await authorized(client, user);
      if (draft.adoption_hash !== requestHash) fail('This setup was already adopted with a different reviewed request.');
      return { ...draft, idempotent: true, operational_note: OPERATIONAL_NOTE };
    }
    await notAdopted(client);
    if (draft.status !== 'draft' || draft.revision !== data.expected_revision || draft.source_hash !== data.source_hash) fail('The draft or reviewed source changed. Reload and preview again.');
    // Briefly freeze the sources used by the reviewed snapshot. Concurrent
    // accrual, application or placement changes cannot race the final check.
    const tables = await sourceTables(client);
    await client.query(`LOCK TABLE ${tables.map(quoteIdentifier).join(',')},reviewer_settings IN SHARE ROW EXCLUSIVE MODE`);
    await authorized(client, user);
    const preview = previewFrom(await loadSource(client, draft.plan.start_date, tables), draft.plan);
    if (preview.source_hash !== draft.source_hash) fail('Source records changed after this draft was reviewed. Refresh the source and save a new revision.');
    if (!preview.ready_to_adopt) fail(preview.blockers.join(' '));
    const verifiedActor = actorFor(user, actor), changes = [];
    for (const placement of [...preview.placements].sort((a, b) => a.employee_id.localeCompare(b.employee_id))) {
      const { rows: [before] } = await client.query('SELECT id,department_id,division_id FROM hr_employees WHERE id=$1', [placement.employee_id]);
      const { rows: [after] } = await client.query(`UPDATE hr_employees SET department_id=COALESCE(department_id,$2::uuid),division_id=COALESCE(division_id,$3::uuid)
        WHERE id=$1 RETURNING id,department_id,division_id`, [placement.employee_id, placement.department_id, placement.division_id]);
      changes.push({ employee_id: after.id, before, after });
      await recordAudit({ client, actor: verifiedActor, action: 'hr.employee.initial_setup.placement_adopted', entityType: 'hr_employee', entityId: after.id,
        before, after, metadata: { setup_id: draft.id, reason, exact_retained_name_match: true } });
    }
    const adoptionResult = { placement_changes: changes, retained_summary: preview.summary, balances_converted: false, employees_activated: false };
    const { rows: [row] } = await client.query(`UPDATE hr_gov_initial_setups SET status='adopted',adopted_by=$2,adopted_at=NOW(),updated_by=$2,updated_at=NOW(),
      adoption_hash=$3,adoption_result=$4 WHERE id=$1 RETURNING *`, [id, verifiedActor.id, requestHash, adoptionResult]);
    await recordRevision(client, row, 'adopted', verifiedActor, reason);
    return { ...row, idempotent: false, operational_note: OPERATIONAL_NOTE };
  });
}

import {calendarCoverageRequired,calendarFallbackNotice} from '../lib/governmentLeaveCalendarRules.js';
import { governmentLeaveMedicalSummary } from './governmentLeaveMedicalSummary.js';
import { ServiceError } from '../lib/serviceError.js';
import { COMMON_CODES, serviceFacts } from '../lib/governmentLeaveRules.js';
import { CASE_CODES, caseLevels } from '../lib/governmentLeaveCaseRules.js';
import { canAccessEmployee, isCentralHr } from './hrAccess.js';
import { loadContext } from './governmentLeave.js';
import { bindingIssue, configurationFor, effectiveOffices, today } from './governmentLeaveWorkflow.js';
import { assertCutoverResolved } from './governmentLeaveCutover.js';
import { serviceCorrectionIssue } from './employeeServiceCorrections.js';
import { approvalRouteFor } from './governmentLeaveApprovalRoutes.js';
import { resolvedPublishedPoliciesSql } from './governmentLeavePolicyTransitions.js';

const item = (key, label, ready, detail) => ({ key, label, status: ready ? 'ready' : 'missing', detail });

/** Preview actual dated offices without creating a request or binding a stage. */
export async function employeeGovernmentRoute(client, employee) {
  const request = { employee_id: employee.id, submitted_by: employee.reviewer_id,
    department_id: employee.department_id, division_id: employee.division_id };
  const codes = [...COMMON_CODES, ...CASE_CODES];
  const commonRoutes=new Map();
  for(const code of COMMON_CODES)commonRoutes.set(code,await approvalRouteFor(client,employee.department_id,code));
  const levelsFor = code => COMMON_CODES.includes(code) ? commonRoutes.get(code).stages.map(s=>s.level) : caseLevels(code);
  const levels = ['division', ...([...commonRoutes.values()].some(r=>r.stages.some(s=>s.level==='parent_division'))?['parent_division']:[]), 'department', 'hr_verifier', 'relevant_secretary', 'minister', 'chief_secretary'];
  const stages = [];
  for (const level of levels) {
    const offices = await effectiveOffices(client, request, level);
    const office = offices.length === 1 ? offices[0] : null;
    let issue = !office ? 'Exactly one effective officeholder must be assigned.' : await bindingIssue(client, request,
      { level, binding: { ...office, assignment_id: office.id } });
    if (level === 'division' && !employee.division_id) issue = 'Employee division is unverified.';
    if (['division', 'parent_division', 'department', 'relevant_secretary', 'minister'].includes(level) && !employee.department_id) issue = 'Employee department is unverified.';
    stages.push({ level, label:commonRoutes.get('recreation').stages.find(s=>s.level===level)?.label||null, approver_employee_id: office?.approver_employee_id || null, approver_name: office?.approver_name || null,
      issue, conditional: ['relevant_secretary', 'minister'].includes(level), applies_to: codes.filter(code => levelsFor(code).includes(level)) });
  }
  return { ready: COMMON_CODES.every(code=>stages.filter(s=>levelsFor(code).includes(s.level)).every(s=>!s.issue)),
    as_of: today(), stages, routes: codes.map(code => ({ code, levels: levelsFor(code),
      ready: stages.filter(stage => levelsFor(code).includes(stage.level)).every(stage => !stage.issue) })) };
}

/** Read-only employee context. No identity provisioning, balance seeding or conversion. */
export async function employeeLeaveArrangements(client, { user, employeeId }) {
  if (!isCentralHr(user) && user?.permissions?.hr_staff_manage !== true) throw new ServiceError(403, 'HR employee management access is required.');
  if (!(await canAccessEmployee(client, user, employeeId, 'hr_staff_manage'))) throw new ServiceError(404, 'Employee not found.');
  const { rows: [employee] } = await client.query(`SELECT e.id,e.leave_policy_regime,e.leave_entitled,e.status,e.reviewer_id,e.department_id,e.division_id,e.department_code,e.division_code,
    e.manager_id,m.display_name AS manager_name,r.account_type,r.status AS account_status,r.onboarding_state,
    e.ineligible_reason,e.study_leave_start,e.study_leave_end,e.eligibility_note,e.join_date
    ${isCentralHr(user) && user.permissions?.hr_pay_view === true ? ',e.daily_rate' : ''}
    FROM hr_employees e LEFT JOIN hr_employees m ON m.id=e.manager_id LEFT JOIN reviewers r ON r.id=e.reviewer_id WHERE e.id=$1`, [employeeId]);
  if (!employee) throw new ServiceError(404, 'Employee not found.');
  const asOf = today();
  const managerVisible = !employee.manager_id || await canAccessEmployee(client, user, employee.manager_id, 'hr_staff_manage');
  const result = { employee_id: employeeId, regime: employee.leave_policy_regime, account_type: employee.account_type,
    as_of: asOf, historical_preserved: true, account_status: employee.account_status, onboarding_state: employee.onboarding_state,
    reporting_manager: { employee_id: managerVisible ? employee.manager_id : null,
      name: managerVisible ? employee.manager_name : 'Outside your assigned scope — contact central HR',
      description: 'Nominated reporting manager. Legacy approval also depends on current manager/HR permissions and organisation scope; this is not a unique final approver.' },
    legacy: null, government: null, preparation: [], restricted: !isCentralHr(user) };
  // Staff-directory access alone does not grant balance, clinical or central preparation access.
  if (result.restricted) return result;

  const context = await loadContext(client, employeeId);
  const config = await configurationFor(client, employeeId);
  const { rows: policies } = await client.query(`SELECT id,name,description,default_days,is_accruable,requires_note,is_active,
    accrual_days_per_fortnight,reset_period,max_balance,requires_attachment,attachment_label FROM hr_leave_types ORDER BY name,id`);
  const { rows: balances } = await client.query(`SELECT b.id,b.leave_type_id,t.name AS leave_type_name,b.year,b.balance,b.pending,b.last_reset_at
    FROM hr_leave_balances b JOIN hr_leave_types t ON t.id=b.leave_type_id WHERE b.employee_id=$1 ORDER BY b.year DESC,t.name,b.id`, [employeeId]);
  const { rows: [settings] } = await client.query("SELECT to_char(accrual_anchor_date,'YYYY-MM-DD') AS accrual_anchor_date FROM reviewer_settings WHERE id=TRUE");
  const { rows: legacyCounts } = await client.query('SELECT status,count(*)::int AS count FROM hr_leave_applications WHERE employee_id=$1 GROUP BY status ORDER BY status', [employeeId]);
  const { rows: governmentCounts } = await client.query('SELECT status,count(*)::int AS count FROM hr_gov_requests WHERE employee_id=$1 GROUP BY status ORDER BY status', [employeeId]);
  const { rows: identifiers } = await client.query("SELECT external_id FROM hr_employee_external_ids WHERE employee_id=$1 AND source='techone_payroll'", [employeeId]);
  const { rows: openings } = await client.query(`SELECT id,code,status,amount,to_char(as_of,'YYYY-MM-DD') AS as_of,
    to_char(period_start,'YYYY-MM-DD') AS period_start,to_char(period_end,'YYYY-MM-DD') AS period_end
    FROM hr_gov_openings WHERE employee_id=$1 ORDER BY as_of,id`, [employeeId]);
  const year = Number(asOf.slice(0, 4));
  const legacyOperational = employee.leave_policy_regime === 'legacy' && employee.account_type !== 'employee' && employee.status === 'active' && employee.leave_entitled;
  result.legacy = { operational: legacyOperational,
    leave_entitled: employee.leave_entitled, ineligible_reason: employee.ineligible_reason, study_leave_start: employee.study_leave_start,
    study_leave_end: employee.study_leave_end, eligibility_note: employee.eligibility_note, join_date: employee.join_date,
    ...(user.permissions?.hr_pay_view === true ? { daily_rate: employee.daily_rate } : {}), balances, policies, settings: settings || { accrual_anchor_date: null }, application_counts: legacyCounts,
    effective_balances: legacyOperational ? policies.filter(type => type.is_active).map(type => {
      const stored = balances.find(balance => balance.leave_type_id === type.id && balance.year === year);
      return { leave_type_id: type.id, leave_type_name: type.name, year, balance: stored?.balance ?? (type.is_accruable ? '0.00' : type.default_days),
        pending: stored?.pending ?? '0.00', source: stored ? 'stored' : 'legacy_default' };
    }) : balances.filter(balance => balance.year === year).map(balance => ({ ...balance, source: 'stored' })) };
  const policy = context.policies.find(p => p.effective_from <= asOf && p.effective_to >= asOf);
  let facts;
  try { facts = serviceFacts(context, asOf); } catch { facts = { issues: ['Service facts cannot currently be evaluated. Central HR must review the certified history.'] }; }
  const period = context.periods.find(p => p.start_date <= asOf && (!p.end_date || p.end_date >= asOf));
  const basis = facts.basis;
  const pattern = context.patterns.find(p => p.id === period?.work_pattern_id);
  const patternReady = basis?.schedule_mode === 'roster' ? context.rosters.some(r => r.day === asOf)
    : !!pattern && !!pattern.hours_per_day && context.pattern_approvals.some(a => a.work_pattern_id === pattern.id);
  const currentEntitlements = context.entitlements.filter(e => e.period_start === facts.period_start && e.period_end === facts.period_end && e.as_of <= asOf);
  let cutoverIssue = null;
  try { await assertCutoverResolved(client, employeeId, { activation: true }); } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    cutoverIssue = error.message;
  }
  const correctionIssue = await serviceCorrectionIssue(client, employeeId, config?.recorded_at);
  const route = await employeeGovernmentRoute(client, employee);
  const enabled = config?.enabled_codes || [];
  const activationStatus = !config ? 'not_activated' : enabled.length ? 'active' : 'paused';
  const enrolled = employee.leave_policy_regime === 'government';
  const missingEnabledOpenings = enabled.filter(code => !(code === 'recreation' && period?.is_teacher) && !currentEntitlements.some(e => e.code === code));
  const eligibilityReview = !period || ['unknown', 'casual', 'probationary'].includes(period.employment_category);
  const openingReadiness = COMMON_CODES.map(code => {
    const discretionary = code === 'recreation' && period?.is_teacher;
    const certified = currentEntitlements.some(e => e.code === code);
    return { code, required_for_enabled_type: enabled.includes(code) && !discretionary, certified,
      status: discretionary ? 'case_review' : certified ? 'ready' : enabled.includes(code) ? 'missing' : 'not_enabled',
      detail: discretionary ? 'Teacher recreation requires an authorised discretionary case; ordinary Recreation opening is not a universal prerequisite.'
        : certified ? 'Opening is certified for the current service year.' : enabled.includes(code) ? 'Certify an opening for this enabled type.' : 'No opening is required until this common leave type is selected for activation.' };
  });
  result.government = {
    policy: policy ? { id: policy.id, label: policy.label, effective_from: policy.effective_from, effective_to: policy.effective_to, rules: policy.rules } : null,
    entitlements: context.entitlements.map(({ id, code, period_start, period_end, as_of, balance, held, available }) => ({ id, code, period_start, period_end, as_of, balance, held, available })),
    openings, opening_readiness: openingReadiness, application_counts: governmentCounts,
    medical_tracking: await governmentLeaveMedicalSummary(client, { employeeId, context, config, asOf }),
    activation: { status: activationStatus, enabled_codes: enabled, configuration_id: config?.id || null, approved_at: config?.approved_at || null },
    applicability: COMMON_CODES.map(code => ({ code, enrolled, enabled: enrolled && enabled.includes(code),
      opening_certified: currentEntitlements.some(e => e.code === code), eligibility_status: eligibilityReview ? 'needs_review' : 'request_evaluation',
      detail: code === 'recreation' && period?.is_teacher ? 'Teacher recreation requires an authorised discretionary case.' : 'Eligibility is checked for the actual requested dates, service and evidence.' })),
    route,
    operational_status: !enrolled ? (employee.account_type === 'employee' ? 'Employee account requires Government preparation; legacy applications are unavailable.' : 'Existing leave arrangements retained; Government policy publication does not change this employee’s regime.')
      : activationStatus === 'not_activated' ? 'Government preparation — applications unavailable until activation.'
        : activationStatus === 'paused' ? 'Government applications paused by the latest approved configuration.'
          : `Government configuration activated for ${enabled.join(', ')}. Each application still requires current eligibility, evidence and approvals.`,
  };
  result.preparation = [
    item('identity', 'Verified Payroll ID', identifiers.length > 0, identifiers.length ? identifiers.map(i => i.external_id).join(', ') : 'Verify the TechOne Payroll ID against the employee record.'),
    item('placement', 'Department and division', !!employee.department_id && !!employee.division_id, employee.department_id && employee.division_id ? 'Managed department and division are recorded.' : `Retained department: ${employee.department_code || 'not recorded'}; retained division: ${employee.division_code || 'not recorded'}. Explicitly verify managed department and division; retained names do not establish placement.`),
    item('account', 'Linked employee login', !!employee.reviewer_id && employee.account_status === 'active' && employee.onboarding_state === 'ready', 'A current linked account must complete onboarding before employee self-service.'),
    item('service', 'Certified service basis', !facts.issues.length && !!period, facts.issues.join(' ') || (period ? `Current appointment: ${period.employment_category}. Confirm applicable legal terms and credited service.` : 'Verify the current appointment.')),
    { key: 'eligibility', label: 'Leave eligibility', status: 'needs_review', detail: eligibilityReview ? 'The recorded employment category requires an authorised determination of applicable legal terms. Certified service facts remain recorded.' : 'Eligibility is evaluated for the selected leave type and actual request dates; recorded service facts alone do not grant leave.' },
    item('pattern', 'Verified work pattern', patternReady, basis?.schedule_mode === 'roster' ? 'Published roster conversions must cover every requested date, including off-duty dates.' : 'A weekly work pattern needs an approved policy-day conversion.'),
    item('calendar', calendarCoverageRequired(context) ? 'Required holiday calendar' : 'Holiday calendar (optional)', !calendarCoverageRequired(context) || context.calendars.some(c => c.effective_from <= asOf && c.effective_to >= asOf), calendarCoverageRequired(context) ? 'Calendar coverage is checked again for every requested date.' : calendarFallbackNotice),
    item('policy', 'Effective Government policy', !!policy, policy ? `${policy.label}: ${policy.effective_from} to ${policy.effective_to}.` : 'No published Government policy covers today.'),
    item('enrolment', 'Government enrolment', enrolled, enrolled ? 'Government regime is recorded; activation remains a separate approval.' : 'Existing regime is retained. Enrolment requires an explicit reviewed change.'),
    { key: 'openings', label: 'Government openings by leave type', status: !enabled.length ? 'needs_review' : missingEnabledOpenings.length ? 'missing' : 'ready',
      detail: !enabled.length ? 'Review openings for the types selected for activation. All three common types are not a universal prerequisite.'
        : missingEnabledOpenings.length ? `Enabled types without a current certified opening: ${missingEnabledOpenings.join(', ')}. Retained balances are not automatically converted.`
          : 'Required openings for enabled common leave types are certified. Teacher recreation remains a discretionary case.' },
    item('reconciliation', 'Retained leave reconciliation', !cutoverIssue && !correctionIssue, cutoverIssue || correctionIssue || 'No retained-cutover or subsequent service-correction blocker was found; verify the migration and activation evidence.'),
    item('approvals', 'Government approval offices', route.ready, 'Division, department, HR verifier, relevant Secretary for applicable leave, and Chief Secretary must be current. Minister is required for its specified case.'),
    item('activation', 'Approved activation', enrolled && activationStatus === 'active', !enrolled ? 'Publication of policy or configuration alone does not enrol the employee.' : activationStatus === 'active' ? `Enabled: ${enabled.join(', ')}. Actual request eligibility is checked separately.` : activationStatus === 'paused' ? 'Latest approved configuration pauses common leave applications.' : 'An independent officer must approve the prepared activation configuration.'),
  ];
  return result;
}


/** Aggregate configuration usage only; never exposes individual employee records. */
export async function employeeLeavePolicyUsage(client, { user }) {
  if (!isCentralHr(user)) throw new ServiceError(403, 'Central HR administration is required.');
  const asOf = today();
  const { rows: [counts] } = await client.query(`SELECT
    count(*) FILTER (WHERE e.status='active')::int AS active_employees,
    count(*) FILTER (WHERE e.status<>'active')::int AS inactive_employees,
    count(*) FILTER (WHERE e.status='active' AND e.leave_policy_regime='legacy' AND r.account_type IS DISTINCT FROM 'employee' AND e.leave_entitled)::int AS legacy_operational,
    count(*) FILTER (WHERE e.status='active' AND e.leave_policy_regime='legacy' AND r.account_type='employee')::int AS legacy_employee_account_blocked,
    count(*) FILTER (WHERE e.status='active' AND e.leave_policy_regime='legacy' AND r.account_type IS DISTINCT FROM 'employee' AND NOT e.leave_entitled)::int AS legacy_not_entitled,
    count(*) FILTER (WHERE e.status='active' AND e.leave_policy_regime='government' AND c.id IS NULL)::int AS government_awaiting_activation,
    count(*) FILTER (WHERE e.status='active' AND e.leave_policy_regime='government' AND cardinality(c.enabled_codes)>0)::int AS government_active,
    count(*) FILTER (WHERE e.status='active' AND e.leave_policy_regime='government' AND cardinality(c.enabled_codes)=0)::int AS government_paused
    FROM hr_employees e LEFT JOIN reviewers r ON r.id=e.reviewer_id
    LEFT JOIN LATERAL (SELECT id,enabled_codes FROM hr_gov_workflow_configs WHERE employee_id=e.id AND status='published' ORDER BY approved_at DESC,id DESC LIMIT 1) c ON TRUE`);
  const { rows: [initialSetup] } = await client.query("SELECT count(*)>0 AS adopted,max(adopted_at) AS adopted_at FROM hr_gov_initial_setups WHERE status='adopted'");
  const { rows: policies } = await client.query(resolvedPublishedPoliciesSql);
  const summary = p => p ? { id: p.id, label: p.label, effective_from: p.effective_from, effective_to: p.effective_to,
    published_at: p.published_at, rules: p.rules, timing: p.effective_from > asOf ? 'future' : p.effective_to < asOf ? 'past' : 'current' } : null;
  const latest = [...policies].sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0) || b.id.localeCompare(a.id))[0];
  return { as_of: asOf, population: 'active_employees', counts, initial_setup: initialSetup,
    current_policy: summary(policies.find(p => p.effective_from <= asOf && p.effective_to >= asOf)),
    latest_published_policy: summary(latest), next_policy: summary(policies.find(p => p.effective_from > asOf)),
    activation_note: 'Active counts describe the latest published employee configuration, not request eligibility. Publishing a policy does not enrol or activate employees.' };
}

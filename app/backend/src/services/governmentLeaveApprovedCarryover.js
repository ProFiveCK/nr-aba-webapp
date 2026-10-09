import { ServiceError } from '../lib/serviceError.js';
import { calculateEvaluation, dayNumber, decimal, fingerprint, serviceFacts, units } from '../lib/governmentLeaveRules.js';
import { loadContext, postMovement } from './governmentLeave.js';
import { generateLeaveApplicationPdf } from './leaveApplicationPdf.js';
import { recordAudit } from './auditService.js';

const fail = message => { throw new ServiceError(409, message); };
async function source(client, id) {
  return (await client.query(`SELECT a.*, to_char(a.start_date,'YYYY-MM-DD') AS start_date,
    to_char(a.end_date,'YYYY-MM-DD') AS end_date, t.name AS leave_type_name,
    r.display_name AS approver_name FROM hr_leave_applications a
    JOIN hr_leave_types t ON t.id=a.leave_type_id LEFT JOIN reviewers r ON r.id=a.reviewed_by
    WHERE a.id=$1`, [id])).rows[0];
}

// Existing grants carry their original authority. The current calculation is
// used only to locate their already-approved days, never to approve them again.
export async function approvedCarryoverPlan(client, state, cutover, enabledCodes) {
  const result = [];
  for (const retained of state.retained_legacy_leave.filter(r => r.status === 'approved')) {
    const application = await source(client, retained.id);
    const code = state.initial_setup?.mappings.find(m => m.leave_type_id === application.leave_type_id)?.code;
    if (!enabledCodes.includes(code)) fail(`The approved ${application.leave_type_name} application needs its individual leave-type reconciliation.`);
    if (!application.reviewed_by || !application.reviewed_at) fail('The existing approved application needs its recorded approver and approval date.');
    if (application.start_date < cutover) fail('The approved absence crosses the transfer date. Review its taken and remaining days individually.');
    const facts = serviceFacts(state.context, cutover);
    const context = { ...state.context, entitlements: [{ id: 'approved-carryover', code,
      period_start: facts.period_start, period_end: facts.period_end, as_of: facts.period_start,
      available: '1000000', balance: '1000000', held: '0' }] };
    const evaluation = calculateEvaluation(context, { code, start_date: application.start_date,
      end_date: application.end_date, notice_date: application.start_date,
      certificate_available: true, justification_available: true });
    if (evaluation.segments.length !== dayNumber(application.end_date) - dayNumber(application.start_date) + 1 ||
      units(evaluation.charge) !== units(application.days) ||
      evaluation.segments.some(s => units(s.charge) > 0n && !s.entitlement_id)) {
      fail('The approved application’s recorded days need individual schedule reconciliation. Its approval and balance remain unchanged.');
    }
    result.push({ legacy_request_id: application.id, portal_request_id: application.id,
      action: 'carry_approved', code, reference: 'Carry existing approved leave and its previously deducted credit',
      start_date: application.start_date, end_date: application.end_date, days: application.days,
      approved_by: application.reviewed_by, approved_by_name: application.payroll_form_snapshot?.approved_by_name || application.approver_name,
      approved_at: application.reviewed_at, source_hash: fingerprint(application),
      legacy_hash: fingerprint(retained), evaluation });
  }
  return result;
}

export async function carryApprovedApplications(client, { employee, configurationId, dispositions, actor, cutover }) {
  const result = [];
  for (const carried of dispositions.filter(d => d.action === 'carry_approved')) {
    const application = await source(client, carried.legacy_request_id);
    if (application.status !== 'approved' || fingerprint(application) !== carried.source_hash) fail('The approved application changed after transfer review. Preview it again.');
    const context = await loadContext(client, employee.id);
    const entitlement = context.entitlements.find(e => e.code === carried.code && e.period_start <= cutover && e.period_end >= application.end_date);
    if (!entitlement) fail('The carried approved application needs its transferred entitlement.');
    const evaluation = { ...carried.evaluation, issues: [], eligible_for_preview: true,
      approval_preserved: true, balance_already_deducted: true,
      allocations: [{ entitlement_id: entitlement.id, amount: decimal(units(application.days)) }],
      segments: carried.evaluation.segments.map(s => ({ ...s, entitlement_id: entitlement.id })) };
    const legacyApproval = { application_id: application.id, approved_by: application.reviewed_by,
      approved_by_name: carried.approved_by_name, approved_at: application.reviewed_at,
      balance_already_deducted: true, payroll_form_snapshot: application.payroll_form_snapshot };
    const snapshot = { regime: 'government', legacy_approval: legacyApproval, config_id: configurationId,
      employee: { id: employee.id, name: employee.display_name, department_id: employee.department_id, division_id: employee.division_id },
      input: { code: carried.code, start_date: application.start_date, end_date: application.end_date,
        reason: application.reason }, evaluation };
    const grant = { ...snapshot, id: application.id, code: carried.code, start_date: application.start_date,
      end_date: application.end_date, charge: application.days, reason: application.reason,
      submitted_at: application.applied_at, granted_at: application.reviewed_at, stages: [] };
    const form = { ...application.payroll_form_snapshot, id: application.id,
      employee_name: application.payroll_form_snapshot?.employee_name || employee.display_name,
      leave_type_name: application.payroll_form_snapshot?.leave_type_name || application.leave_type_name,
      approved_by_name: carried.approved_by_name, start_date: application.start_date,
      end_date: application.end_date, days: Number(application.days), reason: application.reason,
      applied_at: application.applied_at, approved_at: application.reviewed_at,
      approval_snapshot_available: !!application.payroll_form_snapshot };
    const pdf = await generateLeaveApplicationPdf(form);
    await client.query(`INSERT INTO hr_gov_reservation_requests(id,employee_id,payload_hash,evaluation_snapshot,status,recorded_at,completed_at)
      VALUES($1,$2,$3,$4,'consumed',$5,$6)`, [application.id, employee.id, fingerprint(snapshot), evaluation, application.applied_at, application.reviewed_at]);
    await client.query(`INSERT INTO hr_gov_requests(id,employee_id,config_id,code,start_date,end_date,reason,medical_mode,
      payload_hash,application_snapshot,department_id,division_id,reservation_id,charge,status,submitted_by,submitted_at,completed_at,grant_snapshot,final_pdf)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$1,$13,'approved',$14,$15,$16,$17,$18)`,
    [application.id, employee.id, configurationId, carried.code, application.start_date, application.end_date,
      application.reason, carried.code === 'medical' ? (/without/i.test(application.leave_type_name) ? 'exemption' : 'certificate') : 'not_applicable',
      fingerprint(snapshot), snapshot, employee.department_id, employee.division_id, application.days,
      employee.reviewer_id, application.applied_at, application.reviewed_at, grant, Buffer.from(pdf)]);
    // The opening is the remaining balance, already net of this grant. These
    // two matching postings have zero net effect and retain the original use
    // for any later authorised shortening/cancellation to refund correctly.
    const posting = { entitlementId: entitlement.id, effectiveDate: cutover,
      sourceReference: `legacy-approved:${application.id}`, actor,
      reason: 'Carry the previously deducted approved leave without changing remaining credit.' };
    await postMovement(client, { ...posting, kind: 'correction', amount: application.days, eventKey: `legacy-paid:${application.id}` });
    await postMovement(client, { ...posting, kind: 'use', amount: decimal(-units(application.days)), eventKey: `use:${application.id}:${entitlement.id}` });
    await recordAudit({ client, actor, action: 'hr.gov.approved_leave.carried', entityType: 'hr_gov_request', entityId: application.id,
      after: { legacy_approval: legacyApproval, code: carried.code, days: application.days, balance_change: '0.000000' } });
    result.push({ legacy_request_id: application.id, request_id: application.id, code: carried.code, days: application.days, status: 'approved' });
  }
  return result;
}

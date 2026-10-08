import { decimal, units, dayNumber } from '../lib/governmentLeaveRules.js';
import { loadContext } from './governmentLeave.js';
import { configurationFor } from './governmentLeaveWorkflow.js';
import { effectiveAbsenceSql, effectiveEndSql } from './governmentLeaveCases.js';

const currentDate = () => new Date(Date.now() + 12 * 3600000).toISOString().slice(0, 10);
const zero = () => ({ approved: 0n, pending: 0n, baseline: 0n });
const validDate = value => { try { dayNumber(value); return true; } catch { return false; } };
const positiveCharge = value => { try { const amount = units(value); return amount > 0n ? amount : null; } catch { return null; } };

/**
 * Pure projection of a single certified medical service year. Baseline usage
 * precedes the opening; Government usage starts at it. Neither is another pool.
 */
export function medicalTrackingFromRecords({ context, config, records, asOf = currentDate(), approveRequestId = null }) {
  const issues = [];
  const candidates = context.entitlements.filter(e => e.code === 'medical' && e.period_start <= asOf && e.period_end >= asOf && e.as_of <= asOf);
  const account = candidates.length === 1 ? candidates[0] : null;
  if (!account) issues.push(candidates.length ? 'More than one Medical opening covers this date; HR must reconcile the certified periods.' : 'No certified Government Medical opening covers this date. Retained legacy sick balances remain separate.');
  const policy = context.policies.find(p => p.effective_from <= asOf && p.effective_to >= asOf);
  if (!policy) issues.push('No published Government policy covers this tracking date.');
  const annualDays = policy ? positiveCharge(policy.rules?.medical_annual_days) : null;
  const limit = Number.isInteger(policy?.rules?.medical_uncertified_occasions) && policy.rules.medical_uncertified_occasions >= 0 ? policy.rules.medical_uncertified_occasions : null;
  if (policy && (annualDays === null || limit === null)) issues.push('The governing Medical quantum or uncertified-occasion limit needs review.');
  if (!config || config.status !== 'published') issues.push('Medical history has no published employee configuration.');
  let baselineReviewed = !!account && config?.status === 'published' && config.medical_period_start === account.period_start
    && config.medical_as_of === account.as_of && Array.isArray(config.medical_history);
  if (config && !baselineReviewed) issues.push('Review Medical history against this opening service year and cutover date.');
  const certified = zero(), uncertified = zero();
  const occasions = { approved: 0, pending: 0, baseline: 0 };
  const history = [];
  if (baselineReviewed) {
    const baseline = config.medical_history;
    const valid = baseline.every((row, index) => validDate(row.start_date) && validDate(row.end_date)
      && row.period_start === account.period_start && row.start_date >= account.period_start
      && row.end_date >= row.start_date && row.end_date < account.as_of && typeof row.uncertified === 'boolean'
      && (!row.uncertified || row.start_date === row.end_date) && positiveCharge(row.charge) !== null
      && !baseline.slice(0, index).some(prior => prior.start_date <= row.end_date && prior.end_date >= row.start_date));
    if (!valid) { baselineReviewed = false; issues.push('The recorded Medical baseline contains incomplete or overlapping charges; HR must review it before using allowance totals.'); }
    else for (const [index, row] of baseline.entries()) {
      const amount = units(row.charge), mode = row.uncertified ? 'exemption' : 'certificate';
      (row.uncertified ? uncertified : certified).baseline += amount;
      if (row.uncertified) occasions.baseline += 1;
      history.push({ id: `baseline:${config.id}:${index}`, status: 'baseline', start_date: row.start_date, end_date: row.end_date,
        mode, days: decimal(amount), source: 'baseline' });
    }
  }
  let governmentComplete = !!account;
  if (account) for (const record of records) {
    if (!['approved', 'pending'].includes(record.status)) continue;
    const status = record.id === approveRequestId ? 'approved' : record.status;
    const mode = record.mode;
    // The query already applies authoritative cancellation/early-return effects.
    const from = [record.start_date, account.period_start, account.as_of].sort().at(-1);
    const to = [record.end_date, account.period_end].sort()[0];
    if (from > to) continue;
    if (!['certificate', 'exemption'].includes(mode) || !Array.isArray(record.segments)) {
      governmentComplete = false; issues.push('A Government Medical application has no complete retained charge breakdown.'); continue;
    }
    let amount = 0n, matchingSegments = 0, malformed = false;
    for (const segment of record.segments) {
      if (!validDate(segment.date)) { malformed = true; continue; }
      if (segment.date < from || segment.date > to) continue;
      if (segment.entitlement_id !== account.id || (segment.service_period_start && segment.service_period_start !== account.period_start)) continue;
      try { const charge = units(segment.charge); if (charge < 0n) malformed = true; else { amount += charge; matchingSegments += 1; } }
      catch { malformed = true; }
    }
    if (malformed || !matchingSegments) {
      governmentComplete = false; issues.push('A Government Medical application needs its certified period and retained charge segments reconciled.'); continue;
    }
    if (amount === 0n) continue;
    (mode === 'exemption' ? uncertified : certified)[status] += amount;
    // A verified roster shift can charge two policy days, but is one occasion.
    if (mode === 'exemption') occasions[status] += 1;
    history.push({ id: record.id, status, start_date: from, end_date: to, mode, days: decimal(amount), source: 'government' });
  }
  const committed = baselineReviewed && governmentComplete ? occasions.baseline + occasions.approved + occasions.pending : null;
  if (committed !== null && limit !== null && committed > limit) issues.push('Recorded uncertified occasions exceed the governing limit; HR must reconcile the history.');
  const bucket = values => ({ approved_days: governmentComplete ? decimal(values.approved) : null,
    pending_days: governmentComplete ? decimal(values.pending) : null, baseline_days: baselineReviewed ? decimal(values.baseline) : null });
  const sorted = history.sort((a, b) => b.start_date.localeCompare(a.start_date) || a.id.localeCompare(b.id));
  return { configured: !!account && baselineReviewed && governmentComplete && !!policy && annualDays !== null && limit !== null,
    period_start: account?.period_start || null, period_end: account?.period_end || null, annual_days: annualDays === null ? null : decimal(annualDays),
    shared: account ? { balance: account.balance, held: account.held, available: account.available } : null,
    certified: bucket(certified), uncertified: { ...bucket(uncertified),
      approved_occasions: governmentComplete ? occasions.approved : null, pending_occasions: governmentComplete ? occasions.pending : null,
      baseline_occasions: baselineReviewed ? occasions.baseline : null, limit,
      committed_occasions: committed, remaining_occasions: committed === null || limit === null ? null : Math.max(0, limit - committed) },
    baseline_reviewed: baselineReviewed, issues: [...new Set(issues)], history: sorted.slice(0, 100), history_total: sorted.length, history_truncated: sorted.length > 100 };
}

/** Internal read helper: callers enforce employee scope before invoking it. */
export async function governmentLeaveMedicalSummary(client, options) {
  const { employeeId, asOf = currentDate(), approveRequestId = null } = options;
  dayNumber(asOf);
  const context = options.context || await loadContext(client, employeeId);
  const config = Object.hasOwn(options, 'config') ? options.config : await configurationFor(client, employeeId);
  const accounts = context.entitlements.filter(e => e.code === 'medical' && e.period_start <= asOf && e.period_end >= asOf && e.as_of <= asOf);
  let records = [];
  if (accounts.length === 1) {
    const account = accounts[0];
    ({ rows: records } = await client.query(`SELECT r.id,r.status,to_char(r.start_date,'YYYY-MM-DD') AS start_date,
      to_char(${effectiveEndSql()},'YYYY-MM-DD') AS end_date,r.medical_mode AS mode,
      CASE WHEN r.status='approved' THEN COALESCE(r.grant_snapshot->'evaluation'->'segments',r.application_snapshot->'evaluation'->'segments')
        ELSE r.application_snapshot->'evaluation'->'segments' END AS segments
      FROM hr_gov_requests r WHERE r.employee_id=$1 AND r.code='medical' AND r.status IN ('pending','approved')
        AND ${effectiveAbsenceSql()} AND r.start_date<=$3 AND ${effectiveEndSql()}>=$2 ORDER BY r.start_date,r.id`,
    [employeeId, account.as_of, account.period_end]));
  }
  return medicalTrackingFromRecords({ context, config, records, asOf, approveRequestId });
}

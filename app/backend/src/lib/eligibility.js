import { parseDateOnly, toIsoDate } from './leaveDates.js';

export const INELIGIBLE_REASONS = ['temporary', 'intern', 'study_leave'];

const dateOrNull = (value) => {
  const parsed = parseDateOnly(value);
  return parsed ? toIsoDate(parsed) : null;
};

/**
 * Settles the eligibility fields of a staff record as a whole.
 *
 * Someone eligible carries no reason. Someone not eligible must say why, and
 * study leave is a period away, so it needs a start date; the return date may
 * be left open until it is known. Returns `{ values }` to store, or `{ error }`.
 */
export function resolveEligibility(state) {
  const cleared = { ineligible_reason: null, study_leave_start: null, study_leave_end: null, eligibility_note: null };
  if (state.leave_entitled !== false) return { values: cleared };

  const reason = state.ineligible_reason;
  if (!INELIGIBLE_REASONS.includes(reason)) {
    return { error: 'Choose why this person is not eligible for annual leave.' };
  }
  const note = String(state.eligibility_note ?? '').trim() || null;
  if (reason !== 'study_leave') return { values: { ...cleared, ineligible_reason: reason, eligibility_note: note } };

  const start = dateOrNull(state.study_leave_start);
  const end = dateOrNull(state.study_leave_end);
  if (!start) return { error: 'Enter the date study leave starts.' };
  if (end && end < start) return { error: 'The return date must be on or after the date study leave starts.' };
  return { values: { ineligible_reason: reason, study_leave_start: start, study_leave_end: end, eligibility_note: note } };
}

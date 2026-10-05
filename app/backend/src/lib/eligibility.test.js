import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { resolveEligibility } from './eligibility.js';

describe('resolveEligibility', () => {
  test('an eligible person carries no reason, dates or note', () => {
    const { values } = resolveEligibility({
      leave_entitled: true, ineligible_reason: 'intern', study_leave_start: '2026-10-01', eligibility_note: 'old',
    });
    assert.deepEqual(values, {
      ineligible_reason: null, study_leave_start: null, study_leave_end: null, eligibility_note: null,
    });
  });

  test('someone not eligible must say why', () => {
    assert.match(resolveEligibility({ leave_entitled: false }).error, /Choose why/);
    assert.match(resolveEligibility({ leave_entitled: false, ineligible_reason: 'holiday' }).error, /Choose why/);
  });

  test('temporary and intern staff keep a note but no study dates', () => {
    const { values } = resolveEligibility({
      leave_entitled: false, ineligible_reason: 'temporary', study_leave_start: '2026-10-01', eligibility_note: '  Contract  ',
    });
    assert.deepEqual(values, {
      ineligible_reason: 'temporary', study_leave_start: null, study_leave_end: null, eligibility_note: 'Contract',
    });
  });

  test('study leave needs a start date, and may leave the return open', () => {
    assert.match(resolveEligibility({ leave_entitled: false, ineligible_reason: 'study_leave' }).error, /starts/);
    const { values } = resolveEligibility({
      leave_entitled: false, ineligible_reason: 'study_leave', study_leave_start: '2026-10-01', study_leave_end: null,
    });
    assert.equal(values.study_leave_start, '2026-10-01');
    assert.equal(values.study_leave_end, null);
  });

  test('the return date cannot be before the start', () => {
    const result = resolveEligibility({
      leave_entitled: false, ineligible_reason: 'study_leave', study_leave_start: '2026-10-01', study_leave_end: '2026-09-30',
    });
    assert.match(result.error, /on or after/);
  });
});

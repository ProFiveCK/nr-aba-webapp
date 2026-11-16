import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { LeaveRequestReview } from './LeaveRequestReview';
import type { LeaveReviewSummary } from './LeaveRequestReview';
import { requestedLeave } from './requestedLeave';

const parental: LeaveReviewSummary = { checked_at: '2026-11-16T01:00:00Z', periods: [], issues: ['Allowed through 2026-11-25. Review the application dates before approval.'],
    parental: { requested_days: 16, allowance_days: 14, allowed_days: 14, expected_end: '2026-11-25', valid: false,
        pay_segments: [{ start_date: '2026-11-12', end_date: '2026-11-27', salary_percent: '100' }], pay_issue: null } };

it('labels a parental absence with calendar duration even when its balance charge is zero', () => {
    expect(requestedLeave({ code: 'paternity', start_date: '2026-11-12', end_date: '2026-11-27', charge: '0', requested_working_days: 12 })).toBe('12 working days');
    expect(requestedLeave({ code: 'recreation', start_date: '2026-11-12', end_date: '2026-11-27', charge: '12' })).toBe('12 days');
    expect(requestedLeave({ code: 'medical', start_date: '2026-11-12', end_date: '2026-11-12', charge: '0.5', duration_unit: 'hours', hours: '3.5' })).toBe('3.5 hours · 0.5 days');
});
it('puts the requested period, allowance, excess and pay in the review summary', () => {
    const html = renderToStaticMarkup(<LeaveRequestReview review={parental} status="pending" />);
    for (const text of ['Requested', 'Entitlement for this event', '2 days over entitlement', '100% salary', 'weekends and public holidays', 'Recreation and Medical balances are unchanged', 'Review the application dates', 'Allowed through 25/11/2026']) expect(html).toContain(text);
    expect(html).not.toContain('0 days');
});
it('does not imply full pay when service or parental details are not determined', () => {
    const html = renderToStaticMarkup(<LeaveRequestReview review={{ ...parental, parental: { ...parental.parental!, pay_segments: [], pay_issue: 'Review appointment history.' } }} status="pending" />);
    expect(html).toContain('Not determined: Review appointment history.');expect(html).not.toContain('100% salary');
});
it('keeps the already reserved amount in remaining availability and labels unknown balances', () => {
    const review: LeaveReviewSummary = { checked_at: parental.checked_at, parental: null, issues: [], periods: [{ entitlement_id: 'a', period_start: '2026-01-01', period_end: '2026-12-31', request_charge: '2', balance: '20', available: '15', request_held: '2', other_held: '3', available_before_request: '17', available_after_approval: '15' }] };
    let html = renderToStaticMarkup(<LeaveRequestReview review={review} status="pending" />);
    for (const text of ['17 days', '15 days', 'Other pending reservations', 'does not deduct the days twice']) expect(html).toContain(text);
    review.periods[0].available_after_approval = null;
    html = renderToStaticMarkup(<LeaveRequestReview review={review} status="pending" />);expect(html).toContain('Not determined');
    html = renderToStaticMarkup(<LeaveRequestReview review={review} status="approved" />);expect(html).toContain('Currently available');expect(html).not.toContain('Available after approval');
});

it('shows service-year paternity usage and availability alongside requested working days', () => {
    const review: LeaveReviewSummary = {...parental, issues: [], paternity: {unit: 'working_days', as_of: '2026-11-16', periods: [{period_start: '2026-05-01', period_end: '2027-04-30', allowance_days: 10, requested_days: 4, approved_days: 3, pending_days: 5, available_before_request: 6, available_after_approval: 2, available_days: 2}]}};
    const html = renderToStaticMarkup(<LeaveRequestReview review={review} status="pending" />);
    for (const text of ['10 working days per employee service year','Requested working days','4 days','6 days','2 days','01/05/2026','30/04/2027','Recorded approved usage']) expect(html).toContain(text);
    expect(html).not.toContain('Calendar days include');
});

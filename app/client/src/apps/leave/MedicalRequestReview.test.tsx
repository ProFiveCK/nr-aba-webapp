import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MedicalRequestReview } from './MedicalRequestReview';
import type { MedicalReview } from './MedicalRequestReview';

const review: MedicalReview = {
    checked_at: '2026-10-22T04:00:00Z', issues: [],
    periods: [{ entitlement_id: 'medical', request_charge: '1', request_held: '1', other_held: '1', request_occasion_included: true,
        tracking: { configured: true, period_start: '2026-01-01', period_end: '2026-12-31', annual_days: '10',
            shared: { balance: '10', held: '2', available: '8' }, certified: { approved_days: '0', pending_days: '0', baseline_days: '0' },
            uncertified: { approved_days: '0', pending_days: '2', baseline_days: '0', approved_occasions: 0, pending_occasions: 2, baseline_occasions: 0, limit: 3, committed_occasions: 2, remaining_occasions: 1 },
            baseline_reviewed: true, issues: [] } }],
};

it('explains reserved days and occasions without deducting the application twice', () => {
    const html = renderToStaticMarkup(<MedicalRequestReview review={review} status="pending" />);
    for (const text of ['Reserved by this application', 'Other pending holds', 'does not deduct it twice', 'included in the pending non-MC occasions', '01/01/2026', '1 remaining', 'available <strong>8</strong>']) expect(html).toContain(text);
    expect(html).not.toContain('Medical usage history');
});

it('shows missing history as unknown and displays balance reconciliation warnings', () => {
    const period = review.periods[0];
    const unknown = { ...review, issues: ['Reconcile the pending reservation.'], periods: [{ ...period,
        tracking: { ...period.tracking, configured: false, baseline_reviewed: false,
            uncertified: { ...period.tracking.uncertified, committed_occasions: null, remaining_occasions: null, baseline_occasions: null }, issues: ['Review Medical history.'] } }] };
    const html = renderToStaticMarkup(<MedicalRequestReview review={unknown} status="pending" />);
    for (const text of ['Reconcile the pending reservation.', 'Review Medical history.', 'Not determined', 'unknown']) expect(html).toContain(text);
    expect(html).not.toContain('3 remaining');
});

it('labels an approved request charge as retained and explains the balance already includes deductions', () => {
    const html = renderToStaticMarkup(<MedicalRequestReview review={{ ...review, periods: [{ ...review.periods[0], request_held: '0' }] }} status="approved" />);
    expect(html).toContain('includes posted deductions');
    expect(html).toContain('submitted charge above is retained');
    expect(html).not.toContain('Approval converts the reservation');
});

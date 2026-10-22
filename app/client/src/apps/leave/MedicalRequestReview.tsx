import { formatDateTime } from '../../lib/date';
import { MedicalTracking } from './MedicalTracking';
import type { MedicalTrackingTotals } from './MedicalTracking';
import { leaveDays } from './leaveBalances';

export type MedicalReview = {
    checked_at: string;
    issues: string[];
    periods: { entitlement_id: string; request_charge: string; request_held: string; other_held: string; request_occasion_included: boolean; tracking: MedicalTrackingTotals }[];
};
const policyDays = (value: string) => `${leaveDays(value)} ${Number(value) === 1 ? 'day' : 'days'}`;

export function MedicalRequestReview({ review, status }: { review: MedicalReview; status: string }) {
    return <section aria-label="Medical balance for this application" className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <h4 className="font-semibold">Medical balance for this application</h4>
        <p className="text-sm text-gray-600">Latest balances for the service year charged by this request · checked {formatDateTime(review.checked_at)}. Final approval checks eligibility and balances again.</p>
        {review.issues.map(issue => <p key={issue} role="alert" className="text-sm text-amber-800">{issue}</p>)}
        {review.periods.map(period => <div key={period.entitlement_id} className="space-y-3">
            <p className="text-sm">Available after all pending holds: <strong>{period.tracking.shared ? policyDays(period.tracking.shared.available) : 'Not determined'}</strong></p>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div><dt>Submitted charge in this service year</dt><dd className="font-semibold">{policyDays(period.request_charge)}</dd></div>
                <div><dt>Reserved by this application</dt><dd className="font-semibold">{policyDays(period.request_held)}</dd></div>
                <div><dt>Other pending holds</dt><dd className="font-semibold">{policyDays(period.other_held)}</dd></div>
            </dl>
            {status === 'pending' && Number(period.request_held) > 0 && <p className="text-sm">Available days below already exclude this application’s reservation. Approval converts the reservation into a deduction; it does not deduct it twice.{period.request_occasion_included && ' This application is also included in the pending non-MC occasions below.'}</p>}
            {status === 'approved' && <p className="text-sm">The balance below includes posted deductions and any approved returns. The submitted charge above is retained for reference.</p>}
            <MedicalTracking tracking={period.tracking} legacy={false} />
        </div>)}
    </section>;
}

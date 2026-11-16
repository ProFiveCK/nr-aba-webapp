import { formatDate, formatDateTime } from '../../lib/date';
import { leaveDays } from './leaveBalances';

export type LeaveReviewSummary = {
    checked_at: string; issues: string[];
    parental: null | { requested_days: number; allowance_days: number; allowed_days: number; expected_end: string; valid: boolean;
        pay_segments: { start_date: string; end_date: string; salary_percent: string }[]; pay_issue: string | null };
    periods: { entitlement_id: string; period_start: string; period_end: string; request_charge: string; balance: string; available: string;
        request_held: string; other_held: string | null; available_before_request: string | null; available_after_approval: string | null }[];
};
const days = (value: string | number | null) => value === null ? 'Not determined' : `${leaveDays(value)} ${Number(value) === 1 ? 'day' : 'days'}`;

export function LeaveRequestReview({ review, status }: { review: LeaveReviewSummary; status: string }) {
    const parental = review.parental, pending = status === 'pending';
    const excess = parental ? Math.max(0, parental.requested_days - parental.allowed_days) : 0;
    return <section aria-label="Request and entitlement summary" className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <h4 className="font-semibold">{parental ? 'Request and parental entitlement' : 'Request and leave balance'}</h4>
        {parental ? <>
            <dl className="grid gap-3 sm:grid-cols-3">
                <div><dt className="text-sm text-gray-600">Requested</dt><dd className="text-xl font-semibold tabular-nums">{parental.requested_days} <span className="text-sm font-normal">calendar days</span></dd></div>
                <div><dt className="text-sm text-gray-600">{parental.allowed_days < parental.allowance_days ? 'Allowed to employment end' : 'Entitlement for this event'}</dt><dd className="text-xl font-semibold tabular-nums">{parental.allowed_days} <span className="text-sm font-normal">calendar days</span></dd></div>
                <div><dt className="text-sm text-gray-600">Date check</dt><dd className={`font-semibold ${pending && !parental.valid ? 'text-amber-900' : 'text-gray-900'}`}>{pending ? excess ? `${excess} ${excess === 1 ? 'day' : 'days'} over entitlement` : parental.valid ? 'Within allowed period' : 'Dates need review' : 'Original application'}</dd></div>
            </dl>
            <p className="text-sm text-gray-700">Calendar days include weekends and public holidays. This is a separate parental entitlement; Recreation and Medical balances are unchanged.</p>
        </> : review.periods.map(period => <div key={period.entitlement_id} className="space-y-3">
            <p className="text-xs text-gray-600">Service year: {formatDate(period.period_start)} to {formatDate(period.period_end)}</p>
            <dl className="grid gap-3 sm:grid-cols-3">
                <div><dt className="text-sm text-gray-600">{pending ? 'Available before this application' : 'Currently available'}</dt><dd className="text-xl font-semibold tabular-nums">{days(pending ? period.available_before_request : period.available)}</dd></div>
                <div><dt className="text-sm text-gray-600">{pending ? 'Requested from this year' : 'Original requested charge'}</dt><dd className="text-xl font-semibold tabular-nums">{days(period.request_charge)}</dd></div>
                {pending && <div><dt className="text-sm text-gray-600">Available after approval</dt><dd className="text-xl font-semibold tabular-nums">{days(period.available_after_approval)}</dd></div>}
            </dl>
            <p className="text-sm text-gray-700">Posted balance: <strong>{days(period.balance)}</strong> · Reserved by this application: <strong>{days(period.request_held)}</strong> · Other pending reservations: <strong>{days(period.other_held)}</strong>.</p>
        </div>)}
        {review.issues.map(issue => <p key={issue} role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{issue.replace(/\b\d{4}-\d{2}-\d{2}\b/g, date => formatDate(date))}</p>)}
        {parental && <div className="space-y-1 border-t border-blue-200 pt-3 text-sm"><h5 className="font-semibold">{pending ? 'Pay preview for the submitted dates' : 'Recorded pay treatment'}</h5>{parental.pay_issue ? <p className="text-amber-900">Not determined: {parental.pay_issue}</p> : parental.pay_segments.map(segment => <p key={segment.start_date}>{formatDate(segment.start_date)} to {formatDate(segment.end_date)} · <strong>{leaveDays(segment.salary_percent)}% salary</strong></p>)}{pending && <p className="text-gray-600">Based on recorded service and submitted parental details. Confirm the details below; final approval recalculates pay.</p>}</div>}
        {!parental && !!review.periods.length && <p className="text-sm text-gray-600">{pending ? 'Available figures allow for other pending reservations. Approval converts this application’s reservation into a deduction; it does not deduct the days twice.' : 'Current balances already include posted deductions and any approved returns. The original requested charge is shown for reference.'}</p>}
        <p className="text-xs text-gray-500">Checked {formatDateTime(review.checked_at)}{pending ? ' · Final approval checks the latest records again.' : ''}</p>
    </section>;
}

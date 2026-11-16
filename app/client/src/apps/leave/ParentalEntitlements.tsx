import { formatDate } from '../../lib/date';
import { governmentLabel } from './governmentWorkflowTypes';

export type ParentalEntitlementSummary = {
    as_of: string; status: 'conditional' | 'unavailable' | 'review_required'; reason: string; six_month_service_date: string | null;
    items: { code: string; calendar_days: number; maximum: boolean; event: string; conditions: string }[];
};

export function ParentalEntitlements({ summary }: { summary: ParentalEntitlementSummary }) {
    const conditional = summary.status === 'conditional';
    return <section aria-label="Parental leave entitlements" className="space-y-3 border-t border-gray-200 pt-5">
        <div><h4 className="text-lg font-semibold">Parental leave entitlements</h4><p className="mt-1 text-sm text-gray-600">These allowances apply to each qualifying event. They do not accrue, carry forward, or need an opening balance.</p></div>
        <div className={`rounded-lg p-3 text-sm ${conditional ? 'bg-blue-50 text-blue-900' : 'bg-amber-50 text-amber-900'}`}>
            <p className="font-semibold">{conditional ? 'Eligibility checked per event' : summary.status === 'unavailable' ? 'Unavailable under the current appointment' : 'Eligibility needs review'}</p>
            <p className="mt-1">{summary.reason}</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">{summary.items.map(item => <article key={item.code} className="app-panel space-y-2 p-4">
            <h5 className="font-semibold">{governmentLabel(item.code)}</h5>
            <p className="text-2xl font-semibold tabular-nums text-brand">{item.maximum && <span className="text-sm font-normal">Up to </span>}{item.calendar_days} <span className="text-sm font-normal">calendar days</span></p>
            <p className="text-sm font-medium">{item.event}</p><p className="text-sm text-gray-600">{item.conditions}</p>
        </article>)}</div>
        <p className="text-sm text-gray-600">Calendar days include weekends and public holidays. Actual dates, appointment coverage and pay are checked when the application is reviewed.</p>
        <p className="text-sm text-gray-600">{summary.six_month_service_date ? `Six-month service milestone: ${formatDate(summary.six_month_service_date)}. ` : 'Six-month service milestone: not determined. '}Pay depends on credited service at the leave dates and the applicable parental details.</p>
    </section>;
}

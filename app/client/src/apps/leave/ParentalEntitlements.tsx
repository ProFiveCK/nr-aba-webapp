import type { PaternityBalance } from './LeaveRequestReview';
import { formatDate } from '../../lib/date';
import { governmentLabel } from './governmentWorkflowTypes';

export type ParentalEntitlementSummary = {
    paternity?: PaternityBalance | null; paternity_issue?: string | null; as_of: string; status: 'conditional' | 'unavailable' | 'review_required'; reason: string; six_month_service_date: string | null;
    items: { code: string; calendar_days: number | null; working_days?: number | null; maximum: boolean; event: string; conditions: string }[];
};

export function ParentalEntitlements({ summary }: { summary: ParentalEntitlementSummary }) {
    const conditional = summary.status === 'conditional';
    return <section aria-label="Parental leave entitlements" className="space-y-3 border-t border-gray-200 pt-5">
        <div><h4 className="text-lg font-semibold">Parental leave entitlements</h4><p className="mt-1 text-sm text-gray-600">Paternity leave renews each service year. Maternity and Adoption apply per qualifying event. These entitlements do not accrue or carry forward.</p></div>
        <div className={`rounded-lg p-3 text-sm ${conditional ? 'bg-blue-50 text-blue-900' : 'bg-amber-50 text-amber-900'}`}>
            <p className="font-semibold">{conditional ? 'Eligibility checked per event' : summary.status === 'unavailable' ? 'Unavailable under the current appointment' : 'Eligibility needs review'}</p>
            <p className="mt-1">{summary.reason}</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">{summary.items.map(item => <article key={item.code} className="app-panel space-y-2 p-4">
            <h5 className="font-semibold">{governmentLabel(item.code)}</h5>
            <p className="text-2xl font-semibold tabular-nums text-brand">{item.maximum && <span className="text-sm font-normal">Up to </span>}{item.working_days ?? item.calendar_days} <span className="text-sm font-normal">{item.working_days ? 'working days' : 'calendar days'}</span></p>
            <p className="text-sm font-medium">{item.event}</p>{item.code === 'paternity' && <>
                {summary.paternity?.periods.map(period => <div key={period.period_start} className="space-y-1 rounded-lg bg-blue-50 p-3 text-sm">
                    <p className="font-semibold">Available: {period.available_days} working days</p><p>Approved: {period.approved_days} · Pending: {period.pending_days}</p>
                    <p className="text-xs text-gray-600">{formatDate(period.period_start)} to {formatDate(period.period_end)}</p>
                </div>)}
                {summary.paternity_issue && <p className="text-sm text-amber-900">Balance not determined: {summary.paternity_issue}</p>}
            </>}<p className="text-sm text-gray-600">{item.conditions}</p>
        </article>)}</div>
        <p className="text-sm text-gray-600">Paternity working days exclude off-duty dates and public holidays. Maternity and Adoption calendar days include them. Balances use recorded applications; reconcile earlier leave taken outside this module with HR.</p>
        <p className="text-sm text-gray-600">{summary.six_month_service_date ? `Six-month service milestone: ${formatDate(summary.six_month_service_date)}. ` : 'Six-month service milestone: not determined. '}Pay depends on credited service at the leave dates and the applicable parental details.</p>
    </section>;
}

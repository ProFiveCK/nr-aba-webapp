import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, Users, ShieldCheck, Clock3, UserRoundCog, WalletCards } from 'lucide-react';
import { Button } from '../../components/Ui';
import { formatDate } from '../../lib/date';
import { reviewRecordLabel } from './reviewRecordNames';
import type { LeavePolicyUsage } from './leaveSetup';

const settings = [
    { view: 'policies', title: 'Policy & calendars', detail: 'Leave entitlements, public holidays and working schedules.', icon: CalendarDays },
    { view: 'organisation', title: 'Organisation & approvers', detail: 'Departments, reporting structure and approval routes.', icon: Users },
    { view: 'accrual', title: 'Balance schedules', detail: 'Review employee access and approved automatic balance updates.', icon: Clock3 },
    { view: 'access', title: 'HR access', detail: 'Assign the people who can manage employee records.', icon: ShieldCheck },
    { view: 'accounts', title: 'Employee accounts', detail: 'Create secure employee logins and manage account access.', icon: UserRoundCog },
    { view: 'payroll', title: 'Payroll instructions', detail: 'Prepare approved leave instructions and record reconciliation.', icon: WalletCards },
];

export function LeaveSetupStatus({ usage, onOpen }: { usage: LeavePolicyUsage; onOpen: (view: string) => void }) {
    const navigate = useNavigate();
    const needsReview = usage.counts.government_awaiting_activation + usage.counts.government_paused;
    return <section className="space-y-6" aria-label="Leave settings overview">
        <div className="app-panel space-y-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0"><h3 className="text-lg font-semibold text-gray-950">Leave management</h3><p className="mt-1 max-w-2xl text-sm text-gray-600">Add employees directly, confirm their appointment and balances, and manage leave through the approved policy.</p></div>
                <Button variant="secondary" onClick={() => void navigate('/leave/employees')}>Manage employees <ArrowRight className="h-4 w-4" aria-hidden="true"/></Button>
            </div>
            <dl className="grid gap-3 sm:grid-cols-3">
                {[[usage.counts.active_employees, 'Active employees'], [needsReview, 'Access needs review'], [usage.counts.government_missing_job_plans, 'Balance schedules to review']].map(([count, label]) => <div key={label} className="rounded-xl bg-gray-50 p-4"><dt className="text-sm text-gray-600">{label}</dt><dd className="mt-2 text-3xl font-semibold tabular-nums text-gray-950">{count}</dd></div>)}
            </dl>
            {usage.current_policy ? <p className="text-sm text-gray-600">Current policy: <strong className="text-gray-900">{reviewRecordLabel(usage.current_policy.label)}</strong> · {formatDate(usage.current_policy.effective_from)} to {formatDate(usage.current_policy.effective_to)}.</p> : <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">No published policy covers today. Review Policy &amp; calendars before enabling leave applications.</p>}
            <p className="text-sm text-gray-600">Automatic balance updates: <strong className={usage.schedulers.government ? 'text-green-800' : 'text-amber-800'}>{usage.schedulers.government ? 'Enabled' : 'Not enabled'}</strong>. {usage.schedulers.government ? 'Approved schedules update balances when they are due.' : 'Review schedules and contact the system administrator to enable automatic updates.'}</p>
            {needsReview > 0 && <p className="text-sm text-gray-600">Review the appointment, balance and access settings in each affected <Link className="font-medium text-brand underline" to="/leave/employees">employee record</Link>.</p>}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {settings.map(({ view, title, detail, icon: Icon }) => <button key={view} type="button" onClick={() => onOpen(view)} className="app-panel group flex h-full items-start gap-4 p-5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
                <span className="rounded-xl bg-blue-50 p-3 text-brand"><Icon className="h-5 w-5" aria-hidden="true"/></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold text-gray-950">{title}</span><span className="mt-1.5 block text-sm leading-6 text-gray-600">{detail}</span></span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-gray-400 group-hover:text-brand" aria-hidden="true"/>
            </button>)}
        </div>
        <p className="text-sm text-gray-600">Use <Link className="font-medium text-brand underline" to="/leave/approvals">Approvals</Link> for daily decisions. <button type="button" className="font-medium text-brand underline" onClick={() => onOpen('workflow')}>Open application follow-ups</button> for outstanding HR work.</p>
    </section>;
}

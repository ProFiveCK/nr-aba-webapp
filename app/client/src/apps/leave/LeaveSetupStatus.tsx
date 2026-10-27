import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, Users, ShieldCheck, Settings2 } from 'lucide-react';
import type { LeavePolicyUsage } from './leaveSetup';

const settings = [
    { view: 'policies', title: 'Policy & calendars', detail: 'Leave entitlements, public holidays and working schedules.', icon: CalendarDays },
    { view: 'organisation', title: 'Organisation & approvers', detail: 'Departments, reporting structure and approval routes.', icon: Users },
    { view: 'access', title: 'Administration access', detail: 'Assign the people who can manage employee records.', icon: ShieldCheck },
    { view: 'advanced', title: 'Advanced maintenance', detail: 'Balance schedules, bulk employee accounts and payroll reconciliation.', icon: Settings2 },
];

/** Settings tiles, plus a warning only when something needs action. */
export function LeaveSetupStatus({ usage, onOpen }: { usage: LeavePolicyUsage; onOpen: (view: string) => void }) {
    const needsReview = usage.counts.government_awaiting_activation + usage.counts.government_paused + usage.counts.legacy_awaiting_migration;
    const warning = 'rounded-lg bg-amber-50 p-3 text-sm text-amber-900';
    return <section className="space-y-4" aria-label="Leave settings overview">
        {!usage.current_policy && <p role="status" className={warning}>No published policy covers today. Review Policy &amp; calendars before enabling leave applications.</p>}
        {!usage.schedulers.government && <p className={warning}>Automatic balance updates are not enabled. Contact the system administrator to enable them.</p>}
        {needsReview > 0 && <p className={warning}>{needsReview} {needsReview === 1 ? 'employee needs' : 'employees need'} setup review. <Link className="font-medium underline" to="/leave/employees">Open Employees</Link> and filter by Needs attention.</p>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {settings.map(({ view, title, detail, icon: Icon }) => <button key={view} type="button" onClick={() => onOpen(view)} className="app-panel group flex h-full items-start gap-4 p-5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
                <span className="rounded-xl bg-blue-50 p-3 text-brand"><Icon className="h-5 w-5" aria-hidden="true"/></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold text-gray-950">{title}</span><span className="mt-1.5 block text-sm leading-6 text-gray-600">{detail}</span></span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-gray-400 group-hover:text-brand" aria-hidden="true"/>
            </button>)}
        </div>
    </section>;
}

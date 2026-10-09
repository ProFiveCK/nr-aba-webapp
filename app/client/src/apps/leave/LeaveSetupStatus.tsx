import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Ui';
import { formatDate } from '../../lib/date';
import { reviewRecordLabel } from './reviewRecordNames';
import { leaveSetupSteps, nextLeaveSetupView } from './leaveSetup';
import type { LeavePolicyUsage } from './leaveSetup';

export function LeaveSetupStatus({ usage, onOpen }: { usage: LeavePolicyUsage; onOpen: (view: string) => void }) {
    const navigate = useNavigate();
    function open(view: string) { if (view === 'employees') void navigate('/leave/employees'); else onOpen(view); }
    const remaining = usage.counts.legacy_awaiting_migration;
    return <section className="space-y-5" aria-label="Leave setup progress">
        <div className="app-panel space-y-4 p-5 sm:p-6">
            <div><h2 className="text-xl font-semibold text-gray-950">One leave policy for everyone</h2>
                <p className="mt-2 max-w-3xl text-sm text-gray-600">The Government policy governs leave after staff are moved onto it. Moving staff carries their recorded balances forward and starts the Government approval route. Follow the steps below to finish setup.</p></div>
            <dl className="grid gap-4 sm:grid-cols-3">
                {[[usage.counts.government_active, 'Using Government leave'], [remaining, 'Awaiting staff transfer'], [usage.counts.government_awaiting_activation + usage.counts.government_paused, 'Need activation or are paused']].map(([count, label]) => <div key={label} className="rounded-lg bg-gray-50 p-4"><dt className="text-sm text-gray-600">{label}</dt><dd className="mt-1 text-3xl font-semibold text-brand">{count}</dd></div>)}
            </dl>
            {usage.current_policy && <p className="text-sm text-gray-700">Policy: <strong>{reviewRecordLabel(usage.current_policy.label)}</strong> · {formatDate(usage.current_policy.effective_from)} to {formatDate(usage.current_policy.effective_to)}.</p>}
            {remaining > 0 ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The old calculations still serve {remaining} staff awaiting transfer. Complete their staff transfer below to replace those calculations. Historical records stay available.</p> : <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">No leave-entitled active staff remain on the old calculations.</p>}
            {usage.counts.government_awaiting_activation + usage.counts.government_paused > 0 && <p className="text-sm text-gray-700">For staff in Government setup who still need activation, open their <Link className="font-semibold text-brand underline" to="/leave/employees">employee record</Link> and review Balance &amp; setup changes.</p>}
            {usage.counts.legacy_excluded_contracts > 0 && <p className="text-xs text-gray-500">{usage.counts.legacy_excluded_contracts} Contract staff with no leave entitlement are listed separately under Staff transfer for review.</p>}
            <Button onClick={() => open(nextLeaveSetupView(usage))}>Continue setup</Button>
        </div>
        <ol className="space-y-3">
            {leaveSetupSteps(usage).map((step, index) => <li key={step.view} className="app-panel flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-brand">{index + 1}</span><div className="min-w-0"><h3 className="font-semibold text-gray-900">{step.label}</h3><p className="mt-1 break-words text-sm text-gray-600">{reviewRecordLabel(step.detail)}</p></div></div>
                <Button variant="secondary" onClick={() => open(step.view)}>{step.ready === true ? 'Review' : step.ready === null ? 'Manage approvers' : 'Set up'}</Button>
            </li>)}
        </ol>
        <p className="text-sm text-gray-600">For daily work, use <Link className="font-semibold text-brand underline" to="/leave/employees">Employees</Link> to check a person’s balances and <Link className="font-semibold text-brand underline" to="/leave/approvals">Approvals</Link> to decide requests. Setup is only needed when policy, staff or schedules change.</p>
    </section>;
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/date';
import { Button, LoadingState, Pager } from '../../components/Ui';
import { currentLeaveEntitlements } from './currentLeaveEntitlements';
import { governmentLabel } from './governmentWorkflowTypes';
import { reviewRecordLabel } from './reviewRecordNames';
import { useAuth } from '../../contexts/useAuth';

export type LeaveAccountBalance = {
    id: string; code: string; period_start: string; period_end: string; as_of: string;
    days_in: string; days_out: string; balance: string; held: string; available: string;
    policy_label: string; rules: Record<string, string | number>;
};
type Movement = {
    id: string; entitlement_id: string; code: string; kind: string; amount: string;
    effective_date: string; recorded_at: string; period_start: string; period_end: string;
    reason: string; source_reference: string; running_balance: string;
};
type Account = {
    employee: { id: string; display_name: string; leave_policy_regime: string; leave_entitled: boolean };
    accounts: LeaveAccountBalance[]; movements: Movement[]; total: number; page_size: number; as_of: string;
};
import { leaveDays } from './leaveBalances';
const movementLabels: Record<string, string> = {
    opening: 'Opening balance', grant: 'Leave credited', accrual: 'Leave earned', use: 'Approved leave deduction',
    expiry: 'Expired leave', correction: 'Balance correction', reversal: 'Reversal / returned leave',
};

export function LeaveAccount({ employeeId, refreshVersion = 0, initiallyExpanded = false, compact = false }: { employeeId: string; refreshVersion?: number; initiallyExpanded?: boolean; compact?: boolean }) {
    const { user } = useAuth();
    const [expanded, setExpanded] = useState(initiallyExpanded);
    const [result, setResult] = useState<{ key: string; data: Account | null; error: string } | null>(null);
    const [accountId, setAccountId] = useState('');
    const [page, setPage] = useState(0);
    const [version, setVersion] = useState(0);
    const requestKey = `${employeeId}|${accountId}|${page}|${version}|${refreshVersion}`;
    const loading = result?.key !== requestKey;
    const data = result?.data || null;
    const error = loading ? '' : result?.error;
    useEffect(() => {
        let live = true;
        const query = new URLSearchParams({ page: String(page + 1) });
        if (accountId) query.set('entitlement_id', accountId);
        void apiClient.get<Account>(`/hr/government/employees/${employeeId}/account?${query}`).then(result => {
            if (live) setResult({ key: requestKey, data: result, error: '' });
        }).catch((err: Error) => { if (live) setResult({ key: requestKey, data: null, error: err.message }); });
        return () => { live = false; };
    }, [employeeId, accountId, page, requestKey]);
    const current = currentLeaveEntitlements(data?.accounts || [], data?.as_of);
    return <section className="space-y-4" aria-label="Leave balance account">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-lg font-semibold">{compact?'Leave balances':data ? `${reviewRecordLabel(data.employee.display_name)} · Balances & movements` : 'Balances & movements'}</h3>{!compact&&<p className="mt-1 text-sm text-gray-600">Credits minus deductions give the balance. Pending holds are then subtracted to show available days.</p>}</div>
            <Button variant="secondary" disabled={loading} onClick={() => setVersion(v => v + 1)}>{compact?'Refresh':'Refresh balances'}</Button>
        </div>
        {error && <p role="alert" className="app-panel p-4 text-sm text-red-700">{error}</p>}
        {loading ? <LoadingState label="Loading leave account…" /> : data && <>
            {data.employee.leave_policy_regime !== 'government' ? <p role="status" className="app-panel p-4 text-sm text-amber-900">{data.employee.leave_entitled === false ? 'No current leave entitlement is recorded. Ask HR to review any appointment changes.' : 'This employee’s leave setup needs review before current policy balances are available.'}{user?.permissions?.hr_admin && <> <Link className="font-semibold underline" to="/leave/settings?view=rollout">Review staff setup</Link>.</>}</p> : <>
                <p className="text-sm text-gray-500">As at {formatDate(data.as_of)} · All figures are in days.</p>
                {!current.length && <p className="app-panel p-4 text-sm text-gray-600">No certified balance is available yet. Ask HR to complete the employee’s balance setup.</p>}
                <div className={compact?'grid grid-cols-3 gap-2 sm:gap-3':'grid gap-4 xl:grid-cols-3'}>{compact?current.map(balance=><article key={balance.id} className="app-panel leave-balance-card space-y-2 p-3"><h4 className="text-xs font-semibold sm:text-sm">{governmentLabel(balance.code)}</h4><p className="text-2xl font-semibold tabular-nums text-brand">{leaveDays(balance.available)} <span className="block text-xs font-normal text-gray-600">days available</span></p><p className="text-xs text-gray-600">Pending: {leaveDays(balance.held)}</p></article>):current.map(balance => <article key={balance.id} className="app-panel space-y-3 p-4">
                    <div><h4 className="font-semibold">{governmentLabel(balance.code)}</h4><p className="text-xs text-gray-500">{formatDate(balance.period_start)} to {formatDate(balance.period_end)}</p></div>
                    <p className="text-3xl font-semibold tabular-nums text-brand">{leaveDays(balance.available)} <span className="text-sm font-normal text-gray-600">available</span></p>
                    <dl className="space-y-1 text-sm">{[['Credits (in)', balance.days_in], ['Deductions (out)', balance.days_out], ['Balance', balance.balance], ['Pending holds', balance.held]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-gray-600">{label}</dt><dd className="font-medium tabular-nums">{leaveDays(value)}</dd></div>)}</dl>
                    {balance.period_end < data.as_of && <p role="status" className="text-sm text-amber-800">Previous service year. HR must review renewal before these days can be used for new dates.</p>}
                    <Button variant="secondary" onClick={() => { setAccountId(balance.id); setPage(0); setExpanded(true); }}>View {governmentLabel(balance.code).toLowerCase()} movements</Button>
                </article>)}</div>
            </>}
            <details className="app-panel p-4" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">Leave movements — in & out ({data.total})</summary><div className="mt-4 space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3"><div><h4 className="font-semibold">Leave movements — in & out</h4><p className="mt-1 text-sm text-gray-600">Newest recorded entries first. Running balances are separate for each leave type and service year.</p></div>
                    <label className="text-sm font-medium text-gray-700">Leave account<select className="mt-1 block max-w-full rounded-lg border border-gray-300 bg-white px-3 py-2" value={accountId} onChange={e => { setAccountId(e.target.value); setPage(0); }}><option value="">All leave types & years</option>{data.accounts.map(account => <option key={account.id} value={account.id}>{governmentLabel(account.code)} · {formatDate(account.period_start)} to {formatDate(account.period_end)}{account.as_of > data.as_of ? ' · Future opening' : ''}</option>)}</select></label>
                </div>
                <div className="hidden overflow-x-auto md:block"><table className="min-w-full text-left text-sm"><thead className="border-b border-gray-200 text-gray-600"><tr>{['Effective date', 'Leave / entry', 'In', 'Out', 'Balance after entry', 'Explanation'].map(label => <th key={label} className="whitespace-nowrap px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody>{data.movements.map(movement => <tr key={movement.id} className="border-b border-gray-100 align-top">
                    <td className="whitespace-nowrap px-3 py-3">{formatDate(movement.effective_date)}<p className="mt-1 text-xs text-gray-500">Recorded {formatDateTime(movement.recorded_at)}</p></td>
                    <td className="px-3 py-3"><p className="font-medium">{governmentLabel(movement.code)}</p><p>{movementLabels[movement.kind] || governmentLabel(movement.kind)}</p><p className="mt-1 whitespace-nowrap text-xs text-gray-500">{formatDate(movement.period_start)} – {formatDate(movement.period_end)}</p></td>
                    <td className="px-3 py-3 tabular-nums text-green-800">{Number(movement.amount) > 0 ? leaveDays(movement.amount) : '—'}</td>
                    <td className="px-3 py-3 tabular-nums text-red-700">{Number(movement.amount) < 0 ? leaveDays(-Number(movement.amount)) : '—'}</td>
                    <td className="px-3 py-3 font-medium tabular-nums">{leaveDays(movement.running_balance)}</td>
                    <td className="min-w-60 break-words px-3 py-3"><p>{movement.reason}</p><p className="mt-1 text-xs text-gray-500">Reference: {movement.source_reference}</p></td>
                </tr>)}</tbody></table></div>
                <div className="space-y-3 md:hidden">{data.movements.map(movement => <article key={movement.id} className="space-y-3 rounded-lg border border-gray-200 p-3 text-sm">
                    <div><h5 className="font-semibold">{governmentLabel(movement.code)} · {movementLabels[movement.kind] || governmentLabel(movement.kind)}</h5><p className="mt-1 text-gray-600">{formatDate(movement.effective_date)}</p><p className="text-xs text-gray-500">Service year: {formatDate(movement.period_start)} – {formatDate(movement.period_end)}</p></div>
                    <dl className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3">{[['In', Number(movement.amount) > 0 ? leaveDays(movement.amount) : '—'], ['Out', Number(movement.amount) < 0 ? leaveDays(-Number(movement.amount)) : '—'], ['Balance after', leaveDays(movement.running_balance)]].map(([label, value]) => <div key={label}><dt className="text-xs text-gray-600">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value}</dd></div>)}</dl>
                    <p className="break-words">{movement.reason}</p><p className="break-words text-xs text-gray-500">Reference: {movement.source_reference}<br />Recorded {formatDateTime(movement.recorded_at)}</p>
                </article>)}</div>
                {!data.movements.length && <p className="text-sm text-gray-500">No movements recorded for this selection.</p>}
                <Pager page={page} pageCount={Math.ceil(data.total / data.page_size)} total={data.total} pageSize={data.page_size} setPage={setPage} />
                <p className="text-sm text-gray-600">Pending applications reserve days without posting a deduction. Final approval posts the deduction; rejection or cancellation releases the hold. Approved amendments may return days as a separate entry.</p>
            </div></details>
            <details className="app-panel p-4"><summary className="cursor-pointer text-sm font-semibold">How leave is calculated</summary><div className="mt-3 space-y-3 text-sm text-gray-600">
                <p>The opening is the certified starting balance, including agreed credits carried forward at transfer. Later credits, earned leave, deductions, expiry and corrections are recorded above with their reference. Previous service years remain separate accounts.</p>
                <p>Leave charges follow the policy effective on the requested dates, verified service and work schedule, and the approved holiday calendar. The date check on each application shows its calculated charge.</p>
                {current.map(account => <p key={account.id}><strong>{governmentLabel(account.code)}</strong> · Opening policy: {reviewRecordLabel(account.policy_label)}. Annual policy amount: {leaveDays(account.rules[`${account.code}_annual_days`])} days.{account.code === 'recreation' && <> Balance cap: {leaveDays(account.rules.recreation_cap_days)} days. Earned leave is posted through the approved accrual schedule, including any proration and cap.</>}</p>)}
                <p>Policy amounts describe the rules; available balances come from certified entries and pending holds. HR can review service, renewal and accrual setup when a balance needs attention.</p>
            </div></details>
        </>}
    </section>;
}

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../../lib/api';
import { formatDate } from '../../../lib/date';
import { Button, LoadingState, Pager } from '../../../components/Ui';
import { useAuth } from '../../../contexts/useAuth';
import { LeaveAccount } from '../LeaveAccount';
import { leaveDays } from '../leaveBalances';
import type { LeaveAccountBalance } from '../LeaveAccount';
import { reviewRecordLabel } from '../reviewRecordNames';

type StaffBalances = {
    employees: { id: string; display_name: string; department_name: string | null; division_name: string | null;
        leave_status: string; balances: LeaveAccountBalance[] }[];
    total: number; page_size: number; as_of: string;
};
const statusLabels: Record<string, string> = { active: 'Active', setup_required: 'Setup needs review', not_entitled: 'No leave entitlement', activation_required: 'Awaiting activation', paused: 'Paused' };

export function Balances() {
    const { user } = useAuth();
    const [params, setParams] = useSearchParams();
    const employeeId = params.get('employee');
    const [result, setResult] = useState<{ key: string; data: StaffBalances | null; error: string } | null>(null);
    const [query, setQuery] = useState(''), [search, setSearch] = useState('');
    const [page, setPage] = useState(0), [version, setVersion] = useState(0);
    const requestKey = `${search}|${page}|${version}`;
    const loading = result?.key !== requestKey;
    const data = result?.data || null;
    const error = loading ? '' : result?.error;
    useEffect(() => {
        if (employeeId) return;
        let live = true;
        void apiClient.get<StaffBalances>(`/hr/government/balances?${new URLSearchParams({ search, page: String(page + 1) })}`)
            .then(result => { if (live) setResult({ key: requestKey, data: result, error: '' }); }).catch((err: Error) => { if (live) setResult({ key: requestKey, data: null, error: err.message }); });
        return () => { live = false; };
    }, [employeeId, search, page, requestKey]);
    if (employeeId) return <div className="space-y-4"><Button variant="ghost" onClick={() => { const next = new URLSearchParams(params); next.delete('employee'); setParams(next); }}>← Staff balances</Button><LeaveAccount key={employeeId} employeeId={employeeId} initiallyExpanded />{(user?.permissions?.hr_admin || user?.permissions?.hr_staff_manage) && <Link className="text-sm font-semibold text-brand underline" to={`/leave/employees?employee=${employeeId}&section=arrangements`}>Open employee details & approvers</Link>}</div>;
    return <div className="space-y-4">
        <div><h2 className="text-xl font-semibold">Staff balances</h2><p className="mt-1 text-sm text-gray-600">Available leave under the current policy. Open an account to see every credit and deduction.</p></div>
        <form className="app-panel flex flex-wrap items-end gap-3 p-4" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(0); }}>
            <label className="min-w-48 flex-1 text-sm font-medium text-gray-700">Search staff or department<input className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or department" /></label>
            <Button type="submit">Search</Button><Button variant="secondary" disabled={loading} onClick={() => setVersion(v => v + 1)}>Refresh</Button>
        </form>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {loading ? <LoadingState label="Loading staff balances…" /> : data && <>
            <p className="text-sm text-gray-500">{data.total} active staff within your access · As at {formatDate(data.as_of)} · Figures are available days after pending holds.</p>
            <div className="app-panel"><div className="hidden overflow-x-auto md:block"><table className="min-w-full text-left text-sm"><thead className="border-b border-gray-200 bg-gray-50"><tr>{['Employee', 'Recreation', 'Medical', 'Special', 'Status', 'Account'].map(label => <th key={label} className="px-4 py-3 font-medium text-gray-600">{label}</th>)}</tr></thead><tbody>{data.employees.map(employee => <tr key={employee.id} className="border-b border-gray-100">
                <td className="px-4 py-3"><p className="font-semibold">{reviewRecordLabel(employee.display_name)}</p><p className="text-xs text-gray-500">{reviewRecordLabel(employee.department_name || 'No department')}{employee.division_name && ` / ${reviewRecordLabel(employee.division_name)}`}</p></td>
                {['recreation', 'medical', 'special'].map(code => { const balance = employee.balances.find(b => b.code === code); return <td key={code} className="px-4 py-3 tabular-nums">{balance ? <>{leaveDays(balance.available)}{Number(balance.held) > 0 && <p className="text-xs text-gray-500">{leaveDays(balance.held)} held</p>}{balance.period_end < data.as_of && <p className="text-xs text-amber-800">Renewal needs review</p>}</> : '—'}</td>; })}
                <td className="px-4 py-3 text-gray-600">{statusLabels[employee.leave_status] || employee.leave_status}</td>
                <td className="px-4 py-3"><Link className="whitespace-nowrap font-semibold text-brand underline" aria-label={`View leave account for ${employee.display_name}`} to={`/leave/balances?employee=${employee.id}`}>View account</Link></td>
            </tr>)}</tbody></table></div><div className="divide-y divide-gray-100 md:hidden">{data.employees.map(employee => <article key={employee.id} className="space-y-3 p-4"><div><h3 className="font-semibold">{reviewRecordLabel(employee.display_name)}</h3><p className="text-sm text-gray-600">{reviewRecordLabel(employee.department_name || 'No department')}{employee.division_name && ` / ${reviewRecordLabel(employee.division_name)}`}</p></div><dl className="grid grid-cols-3 gap-2 text-sm">{['recreation', 'medical', 'special'].map(code => { const balance = employee.balances.find(b => b.code === code); return <div key={code}><dt className="capitalize text-gray-600">{code}</dt><dd className="mt-1 font-semibold tabular-nums">{balance ? leaveDays(balance.available) : '—'}</dd>{balance && Number(balance.held) > 0 && <p className="text-xs text-gray-500">{leaveDays(balance.held)} held</p>}{balance && balance.period_end < data.as_of && <p className="text-xs text-amber-800">Review renewal</p>}</div>; })}</dl><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-gray-600">{statusLabels[employee.leave_status] || employee.leave_status}</p><Link className="font-semibold text-brand underline" aria-label={`View leave account for ${employee.display_name}`} to={`/leave/balances?employee=${employee.id}`}>View account</Link></div></article>)}</div>{!data.employees.length && <p className="p-4 text-sm text-gray-500">No staff match this search within your assigned access.</p>}<div className="px-3"><Pager page={page} pageCount={Math.ceil(data.total / data.page_size)} total={data.total} pageSize={data.page_size} setPage={setPage} /></div></div>
            <p className="text-sm text-gray-600">A dash means no certified balance is available. HR should review setup before leave is used.</p>
        </>}
    </div>;
}

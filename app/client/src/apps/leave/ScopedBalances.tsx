import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { csvCell } from '../../lib/csv';
import { formatDate } from '../../lib/date';
import { Button, LoadingState } from '../../components/Ui';
import { ActionDialog, Field, inputClass } from './ManagementFields';
import { value } from './managementForm';
import type { StaffBalanceRow, StaffBalancesResponse } from './staffTypes';

export function ScopedBalances() {
    const [report, setReport] = useState<StaffBalancesResponse | null>(null);
    const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [employee, setEmployee] = useState<StaffBalanceRow | null>(null);
    const load = useCallback(async () => {
        setBusy(true); setError('');
        try {
            const [balances, leaveTypes] = await Promise.all([
                apiClient.get<StaffBalancesResponse>('/hr/employees/balances'),
                apiClient.get<{ id: string; name: string }[]>('/hr/leave-types'),
            ]);
            setReport(balances); setTypes(leaveTypes);
        } catch (failure) { setError((failure as Error).message); }
        finally { setBusy(false); }
    }, []);
    useEffect(() => { void load(); }, [load]);

    function exportBalances() {
        if (!report) return;
        const rows = [
            ['Employee', 'Department', 'Division', ...report.leave_types],
            ...report.employees.map(row => [row.display_name, row.department_code || '', row.division_code || '',
                ...report.leave_types.map(name => {
                    const entry = row.balances[name];
                    return entry ? String(entry.balance - entry.pending) : '';
                })]),
        ];
        const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = `leave-balances-${report.as_of || report.year}.csv`; link.click(); URL.revokeObjectURL(url);
    }
    return <section className="space-y-5">
        <div className="app-panel flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
            <div><h2 className="text-xl font-semibold">Employee balances</h2>
                <p className="mt-1 text-sm text-gray-600">Current balances within your assigned departments and divisions{report?.as_of ? ` · ${formatDate(report.as_of)}` : ''}.</p>
            </div>
            <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => void load()}>Refresh</Button><Button variant="secondary" disabled={!report || busy || Boolean(error)} onClick={exportBalances}>Download CSV</Button></div>
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {busy ? <LoadingState label="Loading employee balances…"/> : !error && <>
            <p className="text-sm text-gray-500">{report?.employees.length || 0} active employees. Available days exclude pending applications. A dash means no balance is recorded.</p>
            {!report?.employees.length && <p className="app-panel p-6 text-sm text-gray-500">No active employees are visible under your balance assignments.</p>}
            {report?.employees.map(row => {
                const names = row.can_adjust_balance === true
                    ? Object.keys(row.balances)
                    : [...new Set(['Recreation', 'Medical', 'Special', ...Object.keys(row.balances)])];
                return <article key={row.id} className="app-panel space-y-4 p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><h3 className="font-semibold">{row.display_name}</h3><p className="mt-1 text-sm text-gray-500">{row.department_code} / {row.division_code || 'No division'}</p></div>
                    {row.can_adjust_balance === true && <Button variant="secondary" onClick={() => setEmployee(row)}>Correct balance</Button>}
                </div>
                {!names.length && <p className="text-sm text-gray-500">No balances have been recorded for this employee.</p>}
                <dl className="grid gap-3 sm:grid-cols-3">{names.map(name => {
                    const entry = row.balances[name];
                    return <div key={name} className="rounded-xl border border-gray-200 bg-gray-50 p-4"><dt className="text-sm text-gray-600">{name}</dt>
                        <dd className="mt-2 text-2xl font-semibold tabular-nums">{entry ? Number((entry.balance - entry.pending).toFixed(2)) : '—'}</dd>
                        <p className="mt-1 text-xs text-gray-500">{entry ? `days available${entry.pending ? ` · ${Number(entry.pending)} awaiting approval` : ''}` : 'Not recorded'}</p>
                    </div>;
                })}</dl>
                {!row.can_adjust_balance && <p className="text-sm text-gray-500">Contact central HR to record a certified balance correction or complete missing balances.</p>}
            </article>; })}
        </>}
        {employee?.can_adjust_balance === true && <ActionDialog title="Record balance correction" description={employee.display_name} onClose={() => setEmployee(null)} onSave={async form => {
            await apiClient.post('/hr/adjustments', { employee_id: employee.id, leave_type_id: value(form, 'leave_type_id'), amount: Number(value(form, 'amount')), year: report?.year, reason: value(form, 'reason') });
            setEmployee(null); await load();
        }}>
            <p className="text-sm text-gray-600">Enter the verified change and its reason. The correction is retained in the employee’s balance history.</p>
            <Field label="Leave type"><select className={inputClass} name="leave_type_id" required><option value="">Choose leave type</option>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></Field>
            <Field label="Days to add or subtract"><input type="number" className={inputClass} name="amount" step="0.01" required/></Field>
        </ActionDialog>}
    </section>;
}

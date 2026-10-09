import { AustralianDateInput } from '../../../components/AustralianDateInput';
import {GovernmentActivity} from '../GovernmentActivity';
import { useState } from 'react';
import { apiClient } from '../../../lib/api';
import { useToast } from '../../../contexts/useToast';
import { EmptyState } from '../../../components/Ui';
import { toIsoDate } from '../../../lib/date';
import { csvCell } from '../../../lib/csv';

interface ReportRow {
    employee_name: string;
    department_code: string | null;
    leave_type_name: string;
    total_days: string;
    applications: string;
}

function defaultRange() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: toIsoDate(first), to: toIsoDate(last) };
}

export function Report() {
    const { addToast } = useToast();
    const initial = defaultRange();
    const [from, setFrom] = useState(initial.from);
    const [to, setTo] = useState(initial.to);
    const [rows, setRows] = useState<ReportRow[] | null>(null);
    const [loading, setLoading] = useState(false);

    const run = async () => {
        setLoading(true);
        try {
            const data = await apiClient.get<{ rows: ReportRow[] }>(`/hr/report?from=${from}&to=${to}`);
            setRows(data?.rows || []);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to build the report.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const downloadCsv = () => {
        if (!rows?.length) return;
        const header = ['Employee', 'Department', 'Leave type', 'Days', 'Applications'];
        const body = rows.map((row) => [
            row.employee_name, row.department_code || '', row.leave_type_name, row.total_days, row.applications,
        ]);
        const csv = [header, ...body].map((line) => line.map(csvCell).join(',')).join('\r\n');

        // Byte-order mark so Excel reads the file as UTF-8.
        const bom = String.fromCharCode(0xfeff);
        const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `leave-report-${from}-to-${to}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const totalDays = rows?.reduce((sum, row) => sum + Number(row.total_days), 0) ?? 0;

    return (
        <div className="space-y-4"><div><h2 className="text-xl font-semibold">Leave report</h2><p className="mt-1 text-sm text-gray-600">Choose the dates to view approved leave and download the report.</p></div>
            <form className="flex flex-wrap items-end gap-3 app-panel p-4" onSubmit={e => e.preventDefault()}>
                <label className="text-sm">
                    <span className="mb-1 block font-medium text-gray-700">Period from</span>
                    <AustralianDateInput aria-label="Period from" required value={from} onChange={(e) => setFrom(e.target.value)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </label>
                <label className="text-sm">
                    <span className="mb-1 block font-medium text-gray-700">to</span>
                    <AustralianDateInput aria-label="Period through" required value={to} min={from} onChange={(e) => setTo(e.target.value)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </label>
            </form>

            <GovernmentActivity from={from} to={to} details/>
            <details className="app-panel p-4"><summary className="cursor-pointer text-sm font-semibold text-gray-600">Earlier records from before staff transfer</summary><div className="mt-4 space-y-4"><div className="flex flex-wrap gap-2"><button type="button" disabled={loading} onClick={()=>void run()} className="toolbar-button">{loading?'Building…':'Load earlier records'}</button>{rows&&rows.length>0&&<button type="button" className="toolbar-button" onClick={downloadCsv}>Download earlier CSV</button>}</div>
            {rows === null ? (
                <div className="app-panel p-4">
                    <EmptyState title="Choose a period" detail="Approved leave in the period is totalled per person and leave type." />
                </div>
            ) : rows.length === 0 ? (
                <div className="app-panel p-4">
                    <EmptyState title="No approved leave in this period" />
                </div>
            ) : (
                <div className="overflow-x-auto app-panel">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className="px-4 py-2">Employee</th>
                                <th className="px-4 py-2">Dept</th>
                                <th className="px-4 py-2">Leave type</th>
                                <th className="px-4 py-2 text-right">Days</th>
                                <th className="px-4 py-2 text-right">Applications</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {rows.map((row, index) => (
                                <tr key={`${row.employee_name}-${row.leave_type_name}-${index}`}>
                                    <td className="px-4 py-2 font-medium text-gray-900">{row.employee_name}</td>
                                    <td className="px-4 py-2 text-gray-600">{row.department_code || '—'}</td>
                                    <td className="px-4 py-2 text-gray-600">{row.leave_type_name}</td>
                                    <td className="px-4 py-2 text-right text-gray-900">{row.total_days}</td>
                                    <td className="px-4 py-2 text-right text-gray-600">{row.applications}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-gray-50 text-sm font-semibold text-gray-900">
                            <tr>
                                <td className="px-4 py-2" colSpan={3}>Total</td>
                                <td className="px-4 py-2 text-right">{totalDays}</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
            </div></details>
        </div>
    );
}

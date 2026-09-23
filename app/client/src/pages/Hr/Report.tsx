import { useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { EmptyState } from '../../components/Ui';
import { toIsoDate } from '../../lib/date';

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

/** Quotes a CSV field so commas, quotes and newlines survive Excel. */
function csvCell(value: unknown): string {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
        <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <label className="text-sm">
                    <span className="mb-1 block font-medium text-zinc-700">Period from</span>
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                        className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
                </label>
                <label className="text-sm">
                    <span className="mb-1 block font-medium text-zinc-700">to</span>
                    <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
                        className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
                </label>
                <button type="button" onClick={run} disabled={loading}
                    className="rounded-md bg-[#002B7F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#001f5c] disabled:opacity-50">
                    {loading ? 'Building…' : 'Run report'}
                </button>
                {rows !== null && rows.length > 0 && (
                    <button type="button" onClick={downloadCsv}
                        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
                        Download CSV
                    </button>
                )}
            </div>

            {rows === null ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <EmptyState title="Choose a period" detail="Approved leave in the period is totalled per person and leave type." />
                </div>
            ) : rows.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <EmptyState title="No approved leave in this period" />
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
                    <table className="min-w-full text-sm">
                        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                            <tr>
                                <th className="px-4 py-2">Employee</th>
                                <th className="px-4 py-2">Dept</th>
                                <th className="px-4 py-2">Leave type</th>
                                <th className="px-4 py-2 text-right">Days</th>
                                <th className="px-4 py-2 text-right">Applications</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {rows.map((row, index) => (
                                <tr key={`${row.employee_name}-${row.leave_type_name}-${index}`}>
                                    <td className="px-4 py-2 font-medium text-zinc-900">{row.employee_name}</td>
                                    <td className="px-4 py-2 text-zinc-600">{row.department_code || '—'}</td>
                                    <td className="px-4 py-2 text-zinc-600">{row.leave_type_name}</td>
                                    <td className="px-4 py-2 text-right text-zinc-900">{row.total_days}</td>
                                    <td className="px-4 py-2 text-right text-zinc-600">{row.applications}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-zinc-50 text-sm font-semibold text-zinc-900">
                            <tr>
                                <td className="px-4 py-2" colSpan={3}>Total</td>
                                <td className="px-4 py-2 text-right">{totalDays}</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </div>
    );
}

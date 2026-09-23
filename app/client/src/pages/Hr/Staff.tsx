import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { EmptyState, LoadingState } from '../../components/Ui';
import { formatDate } from '../../features/hr/types';
import type { Employee, LeaveBalance, LeaveType } from '../../features/hr/types';

const FIXED_COLUMNS = ['display_name', 'department_code', 'join_date'];

/** Normalise a join_date (string or Date) to a `YYYY-MM-DD` value for an
 *  `<input type="date">`. Extracts the date part verbatim for strings so a
 *  timezone shift can never move the day. */
function toDateInputValue(value: string | Date | null): string {
    if (!value) return '';
    if (typeof value === 'string') {
        const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
        if (match) return match[1];
    }
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

type ViewMode = 'directory' | 'report';
type LoginFilter = 'all' | 'linked' | 'unlinked';

interface ImportRow {
    display_name: string;
    department_code: string;
    join_date: string;
    balances: Record<string, number>;
}

interface ImportResult {
    created: { id: string; display_name: string }[];
    skipped: { display_name: string; reason: string }[];
}

interface StaffBalanceEntry {
    balance: number;
    pending: number;
}

interface StaffBalanceRow {
    id: string;
    display_name: string;
    department_code: string | null;
    reviewer_id: string | null;
    email: string | null;
    balances: Record<string, StaffBalanceEntry>;
}

interface StaffBalancesResponse {
    year: number;
    leave_types: string[];
    employees: StaffBalanceRow[];
}

/** Minimal RFC4180 parser: quoted fields, escaped "" inside quotes, CRLF/LF. */
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    const pushField = () => { row.push(field); field = ''; };
    const pushRow = () => { pushField(); rows.push(row); row = []; };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            pushField();
        } else if (c === '\n') {
            pushRow();
        } else if (c === '\r') {
            // skip; \n (if present) ends the row
        } else {
            field += c;
        }
    }
    if (field.length || row.length) pushRow();
    return rows.filter((r) => r.some((cell) => cell.trim().length));
}

function csvCell(value: unknown): string {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-zinc-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900">{value}</p>
            {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
        </div>
    );
}

// Every staff member against every active leave type, visible without
// clicking into each person individually. Sticky header and name column so
// a long roster stays orientable while scrolling either direction.
function BalancesReport({
    report, loading, onOpenEmployee, onExport, onRefresh,
}: {
    report: StaffBalancesResponse | null;
    loading: boolean;
    onOpenEmployee: (id: string) => void;
    onExport: () => void;
    onRefresh: () => void;
}) {
    if (loading && !report) return <LoadingState label="Loading balances…" />;
    if (!report || !report.employees.length) {
        return (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <EmptyState title="No active staff yet" detail="Balances appear here once staff records exist." />
            </div>
        );
    }
    return (
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
                <div>
                    <h2 className="text-sm font-semibold text-zinc-900">
                        Leave balances — {report.year} ({report.employees.length} active staff)
                    </h2>
                    <p className="text-xs text-zinc-500">Available days (balance minus pending), every staff member at once.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onRefresh}
                        className="rounded-full border border-zinc-300 p-1.5 text-zinc-500 hover:bg-zinc-50"
                        aria-label="Refresh"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={onExport}
                        className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                    >
                        Export CSV
                    </button>
                </div>
            </div>
            <div className="max-h-[70vh] overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                    <thead>
                        <tr>
                            <th className="sticky left-0 top-0 z-20 border-b border-r border-zinc-200 bg-zinc-50 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                Name
                            </th>
                            <th className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                Dept
                            </th>
                            {report.leave_types.map((t) => (
                                <th
                                    key={t}
                                    className="sticky top-0 z-10 whitespace-nowrap border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500"
                                >
                                    {t}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {report.employees.map((e) => (
                            <tr key={e.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => onOpenEmployee(e.id)}>
                                <td className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-zinc-100 bg-white px-4 py-2 font-medium text-zinc-900">
                                    {e.display_name}
                                    {!e.reviewer_id && (
                                        <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                            no login
                                        </span>
                                    )}
                                </td>
                                <td className="border-b border-zinc-100 px-3 py-2 text-zinc-600">{e.department_code || '—'}</td>
                                {report.leave_types.map((t) => {
                                    const entry = e.balances[t];
                                    const available = entry ? entry.balance - entry.pending : 0;
                                    return (
                                        <td
                                            key={t}
                                            className={`border-b border-zinc-100 px-3 py-2 text-right tabular-nums ${
                                                available < 0 ? 'font-semibold text-red-600' : available === 0 ? 'text-zinc-400' : 'text-zinc-800'
                                            }`}
                                        >
                                            {available}
                                            {entry && entry.pending > 0 && (
                                                <span className="ml-1 text-[10px] font-normal text-amber-600">({entry.pending}p)</span>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function Staff() {
    const { addToast } = useToast();
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [types, setTypes] = useState<LeaveType[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<ViewMode>('directory');
    const [search, setSearch] = useState('');
    const [loginFilter, setLoginFilter] = useState<LoginFilter>('all');
    const [deptFilter, setDeptFilter] = useState('all');

    const [selected, setSelected] = useState<Employee | null>(null);
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [adjustType, setAdjustType] = useState('');
    const [adjustAmount, setAdjustAmount] = useState('');
    const [adjustReason, setAdjustReason] = useState('');
    const [saving, setSaving] = useState(false);

    const [showAddForm, setShowAddForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [newDept, setNewDept] = useState('');
    const [newManagerId, setNewManagerId] = useState('');
    const [newJoinDate, setNewJoinDate] = useState('');
    const [creating, setCreating] = useState(false);

    const [showImport, setShowImport] = useState(false);
    const [importRows, setImportRows] = useState<ImportRow[]>([]);
    const [importFileName, setImportFileName] = useState('');
    const [importParseError, setImportParseError] = useState('');
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [report, setReport] = useState<StaffBalancesResponse | null>(null);
    const [reportLoading, setReportLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [staff, leaveTypes] = await Promise.all([
                apiClient.get<Employee[]>('/hr/employees'),
                apiClient.get<LeaveType[]>('/hr/leave-types'),
            ]);
            setEmployees(staff || []);
            setTypes(leaveTypes || []);
            if (leaveTypes?.length && !adjustType) setAdjustType(leaveTypes[0].id);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to load staff.', 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast, adjustType]);

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadReport = useCallback(async () => {
        setReportLoading(true);
        try {
            const data = await apiClient.get<StaffBalancesResponse>('/hr/employees/balances');
            setReport(data);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to load the balances report.', 'error');
        } finally {
            setReportLoading(false);
        }
    }, [addToast]);

    useEffect(() => {
        if (viewMode === 'report' && !report && !reportLoading) loadReport();
    }, [viewMode, report, reportLoading, loadReport]);

    const departmentOptions = useMemo(
        () => Array.from(new Set(employees.map((e) => e.department_code || 'Unassigned'))).sort(),
        [employees]
    );
    const noLoginCount = useMemo(() => employees.filter((e) => !e.reviewer_id).length, [employees]);
    const avgTenureYears = useMemo(() => {
        const withJoinDate = employees.filter((e) => e.join_date);
        if (!withJoinDate.length) return null;
        const totalYears = withJoinDate.reduce((sum, e) => {
            const years = (Date.now() - new Date(e.join_date as string).getTime()) / (365.25 * 24 * 3600 * 1000);
            return sum + years;
        }, 0);
        return totalYears / withJoinDate.length;
    }, [employees]);

    const filteredEmployees = useMemo(() => {
        const q = search.trim().toLowerCase();
        return employees.filter((e) => {
            if (loginFilter === 'linked' && !e.reviewer_id) return false;
            if (loginFilter === 'unlinked' && e.reviewer_id) return false;
            if (deptFilter !== 'all' && (e.department_code || 'Unassigned') !== deptFilter) return false;
            if (q && !e.display_name.toLowerCase().includes(q) && !(e.email || '').toLowerCase().includes(q)) return false;
            return true;
        });
    }, [employees, search, loginFilter, deptFilter]);

    const openEmployee = async (employee: Employee) => {
        setSelected(employee);
        setBalances([]);
        try {
            const data = await apiClient.get<{ balances: LeaveBalance[] }>(`/hr/employees/${employee.id}/balances`);
            setBalances(data?.balances || []);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to load balances.', 'error');
        }
    };

    const openEmployeeById = (id: string) => {
        const employee = employees.find((e) => e.id === id);
        if (employee) openEmployee(employee);
    };

    const setManager = async (employee: Employee, managerId: string) => {
        try {
            await apiClient.put(`/hr/employees/${employee.id}`, { manager_id: managerId || null });
            setSelected((prev) => (prev && prev.id === employee.id ? { ...prev, manager_id: managerId || null } : prev));
            addToast('Reporting line updated.', 'success');
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to update the reporting line.', 'error');
        }
    };

    const setLeaveEntitled = async (employee: Employee, entitled: boolean) => {
        try {
            await apiClient.put(`/hr/employees/${employee.id}`, { leave_entitled: entitled });
            setSelected((prev) => (prev && prev.id === employee.id ? { ...prev, leave_entitled: entitled } : prev));
            addToast(entitled ? 'Staff marked as entitled to leave.' : 'Staff marked as not entitled to leave.', 'success');
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to update leave entitlement.', 'error');
        }
    };

    const setJoinDate = async (employee: Employee, date: string) => {
        try {
            await apiClient.put(`/hr/employees/${employee.id}`, { join_date: date || null });
            setSelected((prev) => (prev && prev.id === employee.id ? { ...prev, join_date: date || null } : prev));
            addToast('Joining date updated.', 'success');
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to update the joining date.', 'error');
        }
    };

    const downloadTemplate = () => {
        const header = [...FIXED_COLUMNS, ...types.map((t) => t.name)];
        const example = ['Jane Example', '16', '2024-01-15', ...types.map(() => '')];
        const csv = [header, example].map((line) => line.map(csvCell).join(',')).join('\r\n');
        const bom = String.fromCharCode(0xfeff);
        const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'staff-import-template.csv';
        link.click();
        URL.revokeObjectURL(url);
    };

    const exportReport = () => {
        if (!report) return;
        const header = ['Name', 'Department', 'Login', ...report.leave_types];
        const rows = report.employees.map((e) => [
            e.display_name,
            e.department_code || '',
            e.reviewer_id ? (e.email || 'Linked') : 'No login',
            ...report.leave_types.map((t) => {
                const entry = e.balances[t];
                return entry ? entry.balance - entry.pending : 0;
            }),
        ]);
        const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
        const bom = String.fromCharCode(0xfeff);
        const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `leave-balances-${report.year}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleImportFile = async (file: File) => {
        setImportParseError('');
        setImportResult(null);
        setImportFileName(file.name);
        try {
            const text = await file.text();
            const table = parseCsv(text);
            if (table.length < 2) throw new Error('The file has no data rows.');
            const header = table[0].map((h) => h.trim());
            const nameIdx = header.findIndex((h) => h.toLowerCase() === 'display_name');
            if (nameIdx === -1) throw new Error('Missing a "display_name" column.');
            const deptIdx = header.findIndex((h) => h.toLowerCase() === 'department_code');
            const joinIdx = header.findIndex((h) => h.toLowerCase() === 'join_date');
            const typeCols = header
                .map((h, i) => ({ h, i }))
                .filter(({ i }) => i !== nameIdx && i !== deptIdx && i !== joinIdx);

            const rows: ImportRow[] = table.slice(1)
                .filter((r) => r[nameIdx]?.trim())
                .map((r) => {
                    const balances: Record<string, number> = {};
                    for (const { h, i } of typeCols) {
                        const raw = (r[i] || '').trim();
                        if (raw !== '') {
                            const num = Number(raw);
                            if (Number.isFinite(num)) balances[h] = num;
                        }
                    }
                    return {
                        display_name: r[nameIdx].trim(),
                        department_code: deptIdx >= 0 ? (r[deptIdx] || '').trim() : '',
                        join_date: joinIdx >= 0 ? (r[joinIdx] || '').trim() : '',
                        balances,
                    };
                });
            if (!rows.length) throw new Error('No rows with a name were found.');
            setImportRows(rows);
        } catch (err) {
            setImportRows([]);
            setImportParseError((err as Error)?.message || 'Unable to read this file.');
        }
    };

    const confirmImport = async () => {
        setImporting(true);
        try {
            const result = await apiClient.post<ImportResult>('/hr/employees/import', {
                rows: importRows.map((r) => ({
                    display_name: r.display_name,
                    department_code: r.department_code || null,
                    join_date: r.join_date || null,
                    balances: r.balances,
                })),
            });
            setImportResult(result);
            setImportRows([]);
            setImportFileName('');
            if (fileInputRef.current) fileInputRef.current.value = '';
            setReport(null);
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Import failed.', 'error');
        } finally {
            setImporting(false);
        }
    };

    // Creates a leave/HR record ahead of a portal login existing. It starts
    // unlinked; use User Management to attach a login once the account
    // exists, or it links itself the first time that person opens Leave.
    const createEmployee = async () => {
        if (!newName.trim()) {
            addToast('Enter a name.', 'error');
            return;
        }
        setCreating(true);
        try {
            await apiClient.post('/hr/employees', {
                display_name: newName.trim(),
                department_code: newDept.trim() || null,
                manager_id: newManagerId || null,
                join_date: newJoinDate || null,
            });
            addToast('Staff record created. Link a login for them in User Management when their account is ready.', 'success');
            setNewName('');
            setNewDept('');
            setNewManagerId('');
            setNewJoinDate('');
            setShowAddForm(false);
            setReport(null);
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to create the staff record.', 'error');
        } finally {
            setCreating(false);
        }
    };

    const adjust = async () => {
        if (!selected) return;
        const amount = Number(adjustAmount);
        if (!amount) {
            addToast('Enter a non-zero adjustment.', 'error');
            return;
        }
        if (adjustReason.trim().length < 3) {
            addToast('A reason is required for every adjustment.', 'error');
            return;
        }
        setSaving(true);
        try {
            await apiClient.post('/hr/adjustments', {
                employee_id: selected.id,
                leave_type_id: adjustType,
                amount,
                reason: adjustReason.trim(),
            });
            addToast('Balance adjusted.', 'success');
            setAdjustAmount('');
            setAdjustReason('');
            setReport(null);
            await openEmployee(selected);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to adjust the balance.', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <LoadingState label="Loading staff…" />;

    return (
        <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi label="Total staff" value={String(employees.length)} />
                <Kpi
                    label="No login yet"
                    value={String(noLoginCount)}
                    hint={noLoginCount ? 'Link one from User Management' : 'Everyone is linked'}
                />
                <Kpi label="Departments" value={String(departmentOptions.length)} />
                <Kpi label="Avg. tenure" value={avgTenureYears === null ? '—' : `${avgTenureYears.toFixed(1)}y`} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
                <div className="flex items-center gap-1 rounded-full bg-zinc-100 p-1">
                    <button
                        type="button"
                        onClick={() => setViewMode('directory')}
                        className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                            viewMode === 'directory' ? 'bg-[#002B7F] text-white' : 'text-zinc-600 hover:bg-white'
                        }`}
                    >
                        Directory
                    </button>
                    <button
                        type="button"
                        onClick={() => setViewMode('report')}
                        className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                            viewMode === 'report' ? 'bg-[#002B7F] text-white' : 'text-zinc-600 hover:bg-white'
                        }`}
                    >
                        Balances report
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => { setShowImport((s) => !s); setShowAddForm(false); }}
                        className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                    >
                        {showImport ? 'Cancel' : 'Import from spreadsheet'}
                    </button>
                    <button
                        type="button"
                        onClick={() => { setShowAddForm((s) => !s); setShowImport(false); }}
                        className="rounded-full bg-[#002B7F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#001f5c]"
                    >
                        {showAddForm ? 'Cancel' : '+ Add staff'}
                    </button>
                </div>
            </div>

            {showImport && (
                <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <p className="text-xs text-zinc-500">
                        Bulk-create staff records (each starts with no login — link one in User Management, or it
                        links itself the first time that person opens Leave). Download the template, fill it in,
                        and upload it back here.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={downloadTemplate}
                            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                        >
                            Download CSV template
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv,text/csv"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleImportFile(file);
                            }}
                            className="text-sm"
                        />
                    </div>
                    {importParseError && <p className="text-sm text-red-600">{importParseError}</p>}

                    {importRows.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-sm font-medium text-zinc-800">
                                {importFileName}: {importRows.length} row{importRows.length === 1 ? '' : 's'} ready to import
                            </p>
                            <div className="max-h-56 overflow-auto rounded-md border border-zinc-200 bg-white">
                                <table className="min-w-full text-sm">
                                    <thead className="sticky top-0 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                                        <tr>
                                            <th className="px-3 py-1.5">Name</th>
                                            <th className="px-3 py-1.5">Dept</th>
                                            <th className="px-3 py-1.5">Joined</th>
                                            <th className="px-3 py-1.5">Balances set</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100">
                                        {importRows.map((r, i) => (
                                            <tr key={i}>
                                                <td className="px-3 py-1.5 text-zinc-900">{r.display_name}</td>
                                                <td className="px-3 py-1.5 text-zinc-600">{r.department_code || '—'}</td>
                                                <td className="px-3 py-1.5 text-zinc-600">{r.join_date || '—'}</td>
                                                <td className="px-3 py-1.5 text-zinc-600">
                                                    {Object.keys(r.balances).length
                                                        ? Object.entries(r.balances).map(([k, v]) => `${k}: ${v}`).join(', ')
                                                        : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <button
                                type="button"
                                onClick={confirmImport}
                                disabled={importing}
                                className="rounded-md bg-[#002B7F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#001f5c] disabled:opacity-50"
                            >
                                {importing ? 'Importing…' : `Confirm import (${importRows.length})`}
                            </button>
                        </div>
                    )}

                    {importResult && (
                        <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm">
                            <p className="font-medium text-emerald-700">{importResult.created.length} staff record(s) created.</p>
                            {importResult.skipped.length > 0 && (
                                <div className="mt-2">
                                    <p className="font-medium text-amber-700">{importResult.skipped.length} skipped:</p>
                                    <ul className="mt-1 list-inside list-disc text-zinc-600">
                                        {importResult.skipped.map((s, i) => (
                                            <li key={i}>{s.display_name} — {s.reason}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {showAddForm && (
                <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <p className="text-xs text-zinc-500">
                        Creates a leave record ahead of their login existing. Link it to an account in
                        User Management once it's set up, or it links itself the first time they open Leave.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="Full name"
                            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                        />
                        <input
                            type="text"
                            value={newDept}
                            onChange={(e) => setNewDept(e.target.value)}
                            placeholder="Department code, e.g. 16"
                            maxLength={10}
                            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                        />
                        <select
                            value={newManagerId}
                            onChange={(e) => setNewManagerId(e.target.value)}
                            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                        >
                            <option value="">Reports to — none —</option>
                            {employees.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>{candidate.display_name}</option>
                            ))}
                        </select>
                        <input
                            type="date"
                            value={newJoinDate}
                            onChange={(e) => setNewJoinDate(e.target.value)}
                            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={createEmployee}
                        disabled={creating}
                        className="rounded-md bg-[#002B7F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#001f5c] disabled:opacity-50"
                    >
                        {creating ? 'Creating…' : 'Create staff record'}
                    </button>
                </div>
            )}

            {viewMode === 'report' ? (
                <BalancesReport
                    report={report}
                    loading={reportLoading}
                    onOpenEmployee={openEmployeeById}
                    onExport={exportReport}
                    onRefresh={() => { setReport(null); loadReport(); }}
                />
            ) : (
                <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3">
                        <h2 className="mr-auto text-sm font-semibold text-zinc-900">
                            Staff ({filteredEmployees.length}{filteredEmployees.length !== employees.length ? ` of ${employees.length}` : ''})
                        </h2>
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search name or email"
                                className="rounded-md border border-zinc-300 py-1.5 pl-8 pr-3 text-sm"
                            />
                        </div>
                        <select
                            value={loginFilter}
                            onChange={(e) => setLoginFilter(e.target.value as LoginFilter)}
                            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                        >
                            <option value="all">All logins</option>
                            <option value="linked">Linked</option>
                            <option value="unlinked">No login</option>
                        </select>
                        <select
                            value={deptFilter}
                            onChange={(e) => setDeptFilter(e.target.value)}
                            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                        >
                            <option value="all">All departments</option>
                            {departmentOptions.map((d) => (
                                <option key={d} value={d}>{d}</option>
                            ))}
                        </select>
                    </div>
                    {filteredEmployees.length ? (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                                    <tr>
                                        <th className="px-4 py-2">Name</th>
                                        <th className="px-4 py-2">Login</th>
                                        <th className="px-4 py-2">Dept</th>
                                        <th className="px-4 py-2">Joined</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {filteredEmployees.map((employee) => (
                                        <tr
                                            key={employee.id}
                                            className={`cursor-pointer hover:bg-zinc-50 ${selected?.id === employee.id ? 'bg-zinc-50' : ''}`}
                                            onClick={() => openEmployee(employee)}
                                        >
                                            <td className="px-4 py-2">
                                                <span className="font-medium text-zinc-900">{employee.display_name}</span>
                                                {employee.leave_entitled === false && (
                                                    <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">no leave</span>
                                                )}
                                                {employee.status === 'inactive' && (
                                                    <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">inactive</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2">
                                                {employee.reviewer_id ? (
                                                    <span className="text-zinc-600">{employee.email || 'Linked'}</span>
                                                ) : (
                                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                                        No login
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 text-zinc-600">{employee.department_code || '—'}</td>
                                            <td className="px-4 py-2 text-zinc-600">{formatDate(employee.join_date)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="p-4">
                            <EmptyState
                                title={employees.length ? 'No staff match these filters' : 'No staff records yet'}
                                detail={employees.length ? 'Try clearing the search or filters.' : 'A record is created the first time someone opens the Leave app.'}
                            />
                        </div>
                    )}
                </div>
            )}

            {selected && (
                <div className="fixed inset-0 z-50 flex justify-end">
                    <div className="absolute inset-0 bg-zinc-900/40" onClick={() => setSelected(null)} />
                    <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
                            <div>
                                <h2 className="text-base font-semibold text-zinc-900">{selected.display_name}</h2>
                                <p className="text-xs text-zinc-500">
                                    {selected.department_code ? `Dept ${selected.department_code}` : 'No department'}
                                    {' · '}
                                    {selected.reviewer_id ? (selected.email || 'Linked login') : 'No login'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelected(null)}
                                className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                                aria-label="Close"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="flex-1 space-y-5 p-5">
                            <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3">
                                <span className="text-sm text-zinc-700">
                                    Entitled to leave
                                    <span className="mt-0.5 block text-xs text-zinc-500">
                                        Off means they accrue nothing and cannot apply.
                                    </span>
                                </span>
                                <input
                                    type="checkbox"
                                    checked={selected.leave_entitled !== false}
                                    onChange={(e) => setLeaveEntitled(selected, e.target.checked)}
                                    className="h-4 w-4"
                                />
                            </label>

                            <div className="space-y-2">
                                <h3 className="text-sm font-semibold text-zinc-900">Reporting line</h3>
                                <select
                                    value={selected.manager_id || ''}
                                    onChange={(e) => setManager(selected, e.target.value)}
                                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                                >
                                    <option value="">Reports to — none —</option>
                                    {employees
                                        .filter((candidate) => candidate.id !== selected.id)
                                        .map((candidate) => (
                                            <option key={candidate.id} value={candidate.id}>
                                                {candidate.display_name}
                                            </option>
                                        ))}
                                </select>
                            </div>

                            <div className="space-y-2">
                                <h3 className="text-sm font-semibold text-zinc-900">Joining date</h3>
                                <input
                                    type="date"
                                    value={toDateInputValue(selected.join_date)}
                                    onChange={(e) => setJoinDate(selected, e.target.value)}
                                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                                />
                            </div>

                            <div>
                                <h3 className="text-sm font-semibold text-zinc-900">Balances</h3>
                                {balances.length ? (
                                    <ul className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                                        {balances.map((balance) => {
                                            const available = Number(balance.balance) - Number(balance.pending);
                                            return (
                                                <li key={balance.id} className="flex items-center justify-between px-3 py-2 text-sm">
                                                    <span className="text-zinc-600">{balance.leave_type_name}</span>
                                                    <span className={`font-medium ${available < 0 ? 'text-red-600' : 'text-zinc-900'}`}>
                                                        {available}
                                                        {Number(balance.pending) > 0 && (
                                                            <span className="ml-1 text-xs font-normal text-amber-600">
                                                                ({balance.pending} pending)
                                                            </span>
                                                        )}
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                ) : (
                                    <p className="mt-2 text-sm text-zinc-500">No balances for this year yet.</p>
                                )}
                            </div>

                            <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                                <h3 className="text-sm font-semibold text-zinc-900">Adjust balance</h3>
                                <p className="text-xs text-zinc-500">
                                    Use a negative amount to deduct. Every adjustment is kept with its reason.
                                </p>
                                <select
                                    value={adjustType}
                                    onChange={(e) => setAdjustType(e.target.value)}
                                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                                >
                                    {types.map((type) => (
                                        <option key={type.id} value={type.id}>{type.name}</option>
                                    ))}
                                </select>
                                <input
                                    type="number"
                                    step="0.5"
                                    value={adjustAmount}
                                    onChange={(e) => setAdjustAmount(e.target.value)}
                                    placeholder="e.g. 2 or -1.5"
                                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                                />
                                <textarea
                                    value={adjustReason}
                                    onChange={(e) => setAdjustReason(e.target.value)}
                                    rows={2}
                                    placeholder="Reason (required)"
                                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={adjust}
                                    disabled={saving}
                                    className="w-full rounded-md bg-[#002B7F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#001f5c] disabled:opacity-50"
                                >
                                    {saving ? 'Saving…' : 'Apply adjustment'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

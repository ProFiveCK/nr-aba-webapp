import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { useAuth } from '../../contexts/useAuth';
import { useConfirm } from '../../contexts/useConfirm';
import { EmptyState, LoadingState, StatTile } from '../../components/Ui';
import { formatDate } from '../../features/hr/types';
import { toDateInputValue } from '../../lib/date';
import { csvCell, parseCsv } from '../../features/hr/csv';
import { BalancesReport } from '../../features/hr/BalancesReport';
import type {
    ImportResult,
    ImportRow,
    StaffBalancesResponse,
} from '../../features/hr/staffTypes';
import type { Employee, LeaveBalance, LeaveType } from '../../features/hr/types';

const FIXED_COLUMNS = ['display_name', 'department_code', 'join_date'];

type ViewMode = 'directory' | 'report';
type LoginFilter = 'all' | 'linked' | 'unlinked';
type EmployeeDraft = {
    departmentCode: string;
    managerId: string;
    joinDate: string;
    leaveEntitled: boolean;
    dailyRate: string;
};

function draftFor(employee: Employee): EmployeeDraft {
    return {
        departmentCode: employee.department_code || '',
        managerId: employee.manager_id || '',
        joinDate: toDateInputValue(employee.join_date),
        leaveEntitled: employee.leave_entitled !== false,
        dailyRate: String(employee.daily_rate ?? ''),
    };
}

export function Staff() {
    const { addToast } = useToast();
    const { confirm } = useConfirm();
    const { user } = useAuth();
    // Only an administrator may see or set what someone is paid; the API
    // enforces it too and withholds the field from everyone else.
    const canSeePay = user?.permissions?.hr_admin === true;
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [types, setTypes] = useState<LeaveType[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<ViewMode>('directory');
    const [search, setSearch] = useState('');
    const [loginFilter, setLoginFilter] = useState<LoginFilter>('all');
    const [deptFilter, setDeptFilter] = useState('all');

    const [selected, setSelected] = useState<Employee | null>(null);
    const [draft, setDraft] = useState<EmployeeDraft | null>(null);
    const [savingDetails, setSavingDetails] = useState(false);
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [balancesLoading, setBalancesLoading] = useState(false);
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
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);
    const dialogRef = useRef<HTMLElement | null>(null);
    const selectedId = selected?.id;

    useEffect(() => {
        if (!selectedId) return;
        const previousOverflow = document.body.style.overflow;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        document.body.style.overflow = 'hidden';
        closeButtonRef.current?.focus();
        return () => {
            document.body.style.overflow = previousOverflow;
            previousFocus?.focus();
        };
    }, [selectedId]);

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
        setDraft(draftFor(employee));
        setBalances([]);
        setBalancesLoading(true);
        setAdjustAmount('');
        setAdjustReason('');
        try {
            const data = await apiClient.get<{ balances: LeaveBalance[] }>(`/hr/employees/${employee.id}/balances`);
            setBalances(data?.balances || []);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to load balances.', 'error');
        } finally {
            setBalancesLoading(false);
        }
    };

    const openEmployeeById = (id: string) => {
        const employee = employees.find((e) => e.id === id);
        if (employee) openEmployee(employee);
    };

    const detailsDirty = selected && draft
        ? Object.entries(draftFor(selected)).some(([key, value]) => draft[key as keyof EmployeeDraft] !== value)
        : false;

    const closeEditor = async () => {
        if (savingDetails || saving) return;
        if ((detailsDirty || adjustAmount || adjustReason) && !(await confirm('Discard your unsaved employee changes?'))) return;
        setSelected(null);
        setDraft(null);
    };

    const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            void closeEditor();
        }
        if (event.key !== 'Tab' || !dialogRef.current) return;
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    const saveDetails = async (event: FormEvent) => {
        event.preventDefault();
        if (!selected || !draft) return;
        const updates: Record<string, string | number | boolean | null> = {};
        const departmentCode = draft.departmentCode.trim();
        if (departmentCode.length > 10) {
            addToast('Department code must be 10 characters or fewer.', 'error');
            return;
        }
        if (departmentCode !== (selected.department_code || '')) updates.department_code = departmentCode || null;
        if (draft.managerId !== (selected.manager_id || '')) updates.manager_id = draft.managerId || null;
        if (draft.joinDate !== toDateInputValue(selected.join_date)) updates.join_date = draft.joinDate || null;
        if (draft.leaveEntitled !== (selected.leave_entitled !== false)) updates.leave_entitled = draft.leaveEntitled;
        if (canSeePay && draft.dailyRate !== String(selected.daily_rate ?? '')) {
            const rate = draft.dailyRate.trim() === '' ? null : Number(draft.dailyRate);
            if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100000)) {
                addToast('Enter a daily rate between 0 and 100,000, or leave it blank.', 'error');
                return;
            }
            updates.daily_rate = rate;
        }
        if (!Object.keys(updates).length) {
            setDraft(draftFor(selected));
            return;
        }
        setSavingDetails(true);
        try {
            const updated = await apiClient.put<Employee>(`/hr/employees/${selected.id}`, updates);
            setSelected(updated);
            setDraft(draftFor(updated));
            setEmployees((current) => current.map((employee) => employee.id === updated.id ? updated : employee));
            addToast('Employee details saved.', 'success');
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to save employee details.', 'error');
        } finally {
            setSavingDetails(false);
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
        if (detailsDirty) {
            addToast('Save employee details before adjusting a balance.', 'error');
            return;
        }
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
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Total staff" value={String(employees.length)} />
                <StatTile
                    label="No login yet"
                    value={String(noLoginCount)}
                    hint={noLoginCount ? 'Link one from User Management' : 'Everyone is linked'}
                />
                <StatTile label="Departments" value={String(departmentOptions.length)} />
                <StatTile label="Avg. tenure" value={avgTenureYears === null ? '—' : `${avgTenureYears.toFixed(1)}y`} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 app-panel p-3">
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
                <div className="flex w-full flex-col gap-2 min-[360px]:w-auto min-[360px]:flex-row">
                    <button
                        type="button"
                        onClick={() => { setShowImport((s) => !s); setShowAddForm(false); }}
                        className="whitespace-nowrap rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                    >
                        {showImport ? 'Cancel' : 'Import from spreadsheet'}
                    </button>
                    <button
                        type="button"
                        onClick={() => { setShowAddForm((s) => !s); setShowImport(false); }}
                        className="whitespace-nowrap rounded-full bg-[#002B7F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#001f5c]"
                    >
                        {showAddForm ? 'Cancel' : '+ Add staff'}
                    </button>
                </div>
            </div>

            {showImport && (
                <div className="space-y-3 app-panel p-4">
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
                <div className="space-y-2 app-panel p-4">
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
                <div className="app-panel">
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

            {selected && draft && (
                <div className="fixed inset-0 z-50 flex justify-end" onKeyDown={handleEditorKeyDown}>
                    <button type="button" className="absolute inset-0 bg-slate-950/55" onClick={() => void closeEditor()} aria-label="Close employee editor" />
                    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="employee-editor-title" className="relative flex h-dvh w-full max-w-2xl flex-col bg-[#f4f6fa] shadow-2xl sm:my-4 sm:h-[calc(100dvh-2rem)] sm:rounded-2xl">
                        <header className="flex shrink-0 items-start justify-between gap-4 bg-[#002B7F] px-5 py-5 text-white sm:rounded-t-2xl sm:px-7">
                            <div className="flex min-w-0 items-center gap-4">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 text-lg font-bold" aria-hidden="true">
                                    {selected.display_name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">Employee record</p>
                                    <h2 id="employee-editor-title" className="truncate text-xl font-bold tracking-tight">{selected.display_name}</h2>
                                    <p className="truncate text-sm text-blue-100">{selected.reviewer_id ? (selected.email || 'Linked login') : 'No portal login linked'}</p>
                                </div>
                            </div>
                            <button ref={closeButtonRef} type="button" onClick={() => void closeEditor()} className="rounded-lg border border-white/25 p-2 text-white hover:bg-white/10" aria-label="Close employee editor">
                                <X className="h-5 w-5" />
                            </button>
                        </header>

                        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-7">
                            <form id="employee-details-form" onSubmit={saveDetails} className="app-panel space-y-5 p-5 sm:p-6">
                                <div>
                                    <h3 className="text-lg font-semibold text-slate-950">Employment details</h3>
                                    <p className="mt-1 text-sm text-slate-500">Update the reporting line and leave settings, then save them together.</p>
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <label className="text-sm font-medium text-slate-700">
                                        Department code
                                        <input
                                            type="text"
                                            maxLength={10}
                                            value={draft.departmentCode}
                                            onChange={(event) => setDraft({ ...draft, departmentCode: event.target.value })}
                                            placeholder="Unassigned"
                                            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#002B7F] focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>
                                    <label className="text-sm font-medium text-slate-700">
                                        Joining date
                                        <input
                                            type="date"
                                            value={draft.joinDate}
                                            onChange={(event) => setDraft({ ...draft, joinDate: event.target.value })}
                                            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#002B7F] focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>
                                </div>
                                <label className="block text-sm font-medium text-slate-700">
                                    Reports to
                                    <select
                                        value={draft.managerId}
                                        onChange={(event) => setDraft({ ...draft, managerId: event.target.value })}
                                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#002B7F] focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    >
                                        <option value="">No manager assigned</option>
                                        {employees.filter((candidate) => candidate.id !== selected.id).map((candidate) => (
                                            <option key={candidate.id} value={candidate.id}>{candidate.display_name}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex items-center justify-between gap-4 rounded-xl border border-blue-100 bg-[#f5f8ff] p-4">
                                    <span>
                                        <span className="block text-sm font-semibold text-[#002B7F]">Entitled to leave</span>
                                        <span className="mt-1 block text-xs leading-5 text-slate-600">If turned off, this person cannot accrue or apply for leave.</span>
                                    </span>
                                    <input type="checkbox" checked={draft.leaveEntitled} onChange={(event) => setDraft({ ...draft, leaveEntitled: event.target.checked })} className="h-5 w-5 shrink-0 accent-[#002B7F]" />
                                </label>
                                {canSeePay && (
                                    <label className="block text-sm font-medium text-slate-700">
                                        Daily rate
                                        <input
                                            type="number"
                                            min={0}
                                            max={100000}
                                            step="0.01"
                                            value={draft.dailyRate}
                                            onChange={(event) => setDraft({ ...draft, dailyRate: event.target.value })}
                                            placeholder="Not recorded"
                                            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#002B7F] focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                        <span className="mt-1.5 block text-xs font-normal leading-5 text-slate-500">Used for leave liability. Leave blank if the rate is unknown.</span>
                                    </label>
                                )}
                            </form>

                            <section className="app-panel p-5 sm:p-6">
                                <h3 className="text-lg font-semibold text-slate-950">Leave balances</h3>
                                <p className="mt-1 text-sm text-slate-500">Available days after pending requests.</p>
                                {balancesLoading ? (
                                    <p className="mt-4 text-sm text-slate-500" role="status">Loading balances…</p>
                                ) : balances.length ? (
                                    <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
                                        {balances.map((balance) => {
                                            const available = Number(balance.balance) - Number(balance.pending);
                                            return (
                                                <li key={balance.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                                                    <span className="text-slate-600">{balance.leave_type_name}</span>
                                                    <span className={`font-medium ${available < 0 ? 'text-red-600' : 'text-zinc-900'}`}>
                                                        {available} days
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
                                    <p className="mt-4 text-sm text-slate-500">No balances for this year yet.</p>
                                )}
                            </section>

                            <section className="app-panel space-y-3 p-5 sm:p-6">
                                <h3 className="text-lg font-semibold text-slate-950">Adjust a balance</h3>
                                <p className="text-sm text-slate-500">
                                    Use a negative amount to deduct. Every adjustment is kept with its reason.
                                </p>
                                {detailsDirty && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Save employee details before adjusting a balance.</p>}
                                <label className="block text-sm font-medium text-slate-700">Leave type
                                <select
                                    value={adjustType}
                                    onChange={(e) => setAdjustType(e.target.value)}
                                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                                >
                                    {types.map((type) => (
                                        <option key={type.id} value={type.id}>{type.name}</option>
                                    ))}
                                </select>
                                </label>
                                <label className="block text-sm font-medium text-slate-700">Days to add or deduct
                                <input
                                    type="number"
                                    step="0.5"
                                    value={adjustAmount}
                                    onChange={(e) => setAdjustAmount(e.target.value)}
                                    placeholder="e.g. 2 or -1.5"
                                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                                />
                                </label>
                                <label className="block text-sm font-medium text-slate-700">Reason
                                <textarea
                                    value={adjustReason}
                                    onChange={(e) => setAdjustReason(e.target.value)}
                                    rows={2}
                                    placeholder="Why is this adjustment needed?"
                                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                                />
                                </label>
                                <button
                                    type="button"
                                    onClick={adjust}
                                    disabled={saving || detailsDirty}
                                    className="w-full rounded-lg border border-[#002B7F] bg-white px-4 py-2.5 text-sm font-semibold text-[#002B7F] hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {saving ? 'Saving…' : 'Apply adjustment'}
                                </button>
                            </section>
                        </div>
                        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:rounded-b-2xl sm:px-7">
                            <p className="text-xs text-slate-500">{detailsDirty ? 'You have unsaved changes' : 'All employee details saved'}</p>
                            <div className="flex w-full gap-2 sm:w-auto">
                                <button type="button" onClick={() => void closeEditor()} disabled={savingDetails || saving} className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:flex-none">Close</button>
                                <button type="submit" form="employee-details-form" disabled={!detailsDirty || savingDetails} className="flex-1 rounded-lg bg-[#002B7F] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#174495] disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none">{savingDetails ? 'Saving…' : 'Save changes'}</button>
                            </div>
                        </footer>
                    </section>
                </div>
            )}
        </div>
    );
}

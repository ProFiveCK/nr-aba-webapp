import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { EmptyState, LoadingState } from '../../components/Ui';
import { formatDate } from '../../features/hr/types';
import type { Employee, LeaveBalance, LeaveType } from '../../features/hr/types';

export function Staff() {
    const { addToast } = useToast();
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [types, setTypes] = useState<LeaveType[]>([]);
    const [loading, setLoading] = useState(true);
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

    const setManager = async (employee: Employee, managerId: string) => {
        try {
            await apiClient.put(`/hr/employees/${employee.id}`, { manager_id: managerId || null });
            addToast('Reporting line updated.', 'success');
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to update the reporting line.', 'error');
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
            await openEmployee(selected);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to adjust the balance.', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <LoadingState label="Loading staff…" />;

    return (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
                    <h2 className="text-sm font-semibold text-zinc-900">Staff ({employees.length})</h2>
                    <button
                        type="button"
                        onClick={() => setShowAddForm((s) => !s)}
                        className="rounded-full bg-[#002B7F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#001f5c]"
                    >
                        {showAddForm ? 'Cancel' : '+ Add staff'}
                    </button>
                </div>
                {showAddForm && (
                    <div className="space-y-2 border-b border-zinc-200 bg-zinc-50 p-4">
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
                {employees.length ? (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                                <tr>
                                    <th className="px-4 py-2">Name</th>
                                    <th className="px-4 py-2">Login</th>
                                    <th className="px-4 py-2">Dept</th>
                                    <th className="px-4 py-2">Reports to</th>
                                    <th className="px-4 py-2">Joined</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {employees.map((employee) => (
                                    <tr
                                        key={employee.id}
                                        className={`cursor-pointer hover:bg-zinc-50 ${selected?.id === employee.id ? 'bg-zinc-50' : ''}`}
                                        onClick={() => openEmployee(employee)}
                                    >
                                        <td className="px-4 py-2">
                                            <span className="font-medium text-zinc-900">{employee.display_name}</span>
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
                                        <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                                            <select
                                                value={employee.manager_id || ''}
                                                onChange={(e) => setManager(employee, e.target.value)}
                                                className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
                                            >
                                                <option value="">— none —</option>
                                                {employees
                                                    .filter((candidate) => candidate.id !== employee.id)
                                                    .map((candidate) => (
                                                        <option key={candidate.id} value={candidate.id}>
                                                            {candidate.display_name}
                                                        </option>
                                                    ))}
                                            </select>
                                        </td>
                                        <td className="px-4 py-2 text-zinc-600">{formatDate(employee.join_date)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="p-4">
                        <EmptyState
                            title="No staff records yet"
                            detail="A record is created the first time someone opens the Leave app."
                        />
                    </div>
                )}
            </div>

            <div className="space-y-4">
                <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <h2 className="text-sm font-semibold text-zinc-900">
                        {selected ? `${selected.display_name} — balances` : 'Balances'}
                    </h2>
                    {!selected ? (
                        <p className="mt-2 text-sm text-zinc-500">Select a staff member to see their balances.</p>
                    ) : balances.length ? (
                        <ul className="mt-2 space-y-1 text-sm">
                            {balances.map((balance) => (
                                <li key={balance.id} className="flex justify-between">
                                    <span className="text-zinc-600">{balance.leave_type_name}</span>
                                    <span className="font-medium text-zinc-900">
                                        {Number(balance.balance) - Number(balance.pending)}
                                        {Number(balance.pending) > 0 && (
                                            <span className="ml-1 text-xs font-normal text-amber-600">
                                                ({balance.pending} pending)
                                            </span>
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="mt-2 text-sm text-zinc-500">No balances for this year yet.</p>
                    )}
                </div>

                {selected && (
                    <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                        <h2 className="text-sm font-semibold text-zinc-900">Adjust balance</h2>
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
                )}
            </div>
        </div>
    );
}

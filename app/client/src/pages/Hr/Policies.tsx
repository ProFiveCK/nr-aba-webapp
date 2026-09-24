import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { useConfirm } from '../../contexts/useConfirm';
import { LoadingState } from '../../components/Ui';
import type { LeaveType, ResetPeriod } from '../../features/hr/types';
import { PublicHolidays } from '../../features/hr/PublicHolidays';

const RESET_OPTIONS: { value: ResetPeriod; label: string }[] = [
    { value: 'none', label: 'Never reset' },
    { value: 'financial_year', label: 'End of financial year' },
    { value: 'anniversary', label: 'Service anniversary' },
];

interface EditDraft {
    name: string;
    default_days: string;
    accrual_days_per_fortnight: string;
    reset_period: ResetPeriod;
    requires_note: boolean;
    is_accruable: boolean;
    is_active: boolean;
}

function resetLabel(value: ResetPeriod): string {
    return RESET_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function YesNo({ value }: { value: boolean }) {
    return <span className={value ? 'text-zinc-700' : 'text-zinc-400'}>{value ? 'Yes' : 'No'}</span>;
}

export function Policies() {
    const { addToast } = useToast();
    const { confirm } = useConfirm();
    const [types, setTypes] = useState<LeaveType[]>([]);
    const [loading, setLoading] = useState(true);

    const [name, setName] = useState('');
    const [defaultDays, setDefaultDays] = useState('');
    const [accrualPerFortnight, setAccrualPerFortnight] = useState('');
    const [resetPeriod, setResetPeriod] = useState<ResetPeriod>('none');
    const [requiresNote, setRequiresNote] = useState(false);
    const [isAccruable, setIsAccruable] = useState(false);
    const [saving, setSaving] = useState(false);
    const [runningAccrual, setRunningAccrual] = useState(false);
    const [anchorDate, setAnchorDate] = useState('');
    const [savingAnchor, setSavingAnchor] = useState(false);

    const [editing, setEditing] = useState<LeaveType | null>(null);
    const [draft, setDraft] = useState<EditDraft | null>(null);
    const [savingEdit, setSavingEdit] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [policies, accrualSettings] = await Promise.all([
                apiClient.get<LeaveType[]>('/hr/policies'),
                apiClient.get<{ accrual_anchor_date: string | null }>('/hr/accrual/settings'),
            ]);
            setTypes(policies || []);
            setAnchorDate(accrualSettings?.accrual_anchor_date || '');
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to load leave policies.', 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast]);

    useEffect(() => {
        load();
    }, [load]);

    const create = async () => {
        if (!name.trim()) {
            addToast('Give the leave type a name.', 'error');
            return;
        }
        setSaving(true);
        try {
            await apiClient.post('/hr/policies', {
                name: name.trim(),
                default_days: Number(defaultDays) || 0,
                accrual_days_per_fortnight: Number(accrualPerFortnight) || 0,
                reset_period: resetPeriod,
                requires_note: requiresNote,
                is_accruable: isAccruable,
            });
            addToast('Leave type created.', 'success');
            setName('');
            setDefaultDays('');
            setAccrualPerFortnight('');
            setResetPeriod('none');
            setRequiresNote(false);
            setIsAccruable(false);
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to create the leave type.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const remove = async (type: LeaveType) => {
        if (!(await confirm(`Delete "${type.name}"? This is only allowed while the leave type has never been used.`))) {
            return;
        }
        try {
            await apiClient.delete(`/hr/policies/${type.id}`);
            addToast('Leave type deleted.', 'success');
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to delete the leave type.', 'error');
        }
    };

    const runAccrual = async () => {
        setRunningAccrual(true);
        try {
            const result = await apiClient.post<{ message: string }>('/hr/accrual/run', {});
            addToast(result?.message || 'Accrual complete.', 'success');
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to run accrual.', 'error');
        } finally {
            setRunningAccrual(false);
        }
    };

    const saveAnchor = async () => {
        setSavingAnchor(true);
        try {
            await apiClient.put('/hr/accrual/settings', { accrual_anchor_date: anchorDate || null });
            addToast('Accrual schedule saved. It will now run every fortnight from that date.', 'success');
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to save the accrual schedule.', 'error');
        } finally {
            setSavingAnchor(false);
        }
    };

    const openEdit = (type: LeaveType) => {
        setEditing(type);
        setDraft({
            name: type.name,
            default_days: type.default_days,
            accrual_days_per_fortnight: type.accrual_days_per_fortnight,
            reset_period: type.reset_period,
            requires_note: type.requires_note,
            is_accruable: type.is_accruable,
            is_active: type.is_active,
        });
    };

    const saveEdit = async () => {
        if (!editing || !draft) return;
        if (!draft.name.trim()) {
            addToast('Give the leave type a name.', 'error');
            return;
        }
        setSavingEdit(true);
        try {
            await apiClient.put(`/hr/policies/${editing.id}`, {
                name: draft.name.trim(),
                default_days: Number(draft.default_days) || 0,
                accrual_days_per_fortnight: Number(draft.accrual_days_per_fortnight) || 0,
                reset_period: draft.reset_period,
                requires_note: draft.requires_note,
                is_accruable: draft.is_accruable,
                is_active: draft.is_active,
            });
            addToast('Leave type saved.', 'success');
            setEditing(null);
            setDraft(null);
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to save the leave type.', 'error');
        } finally {
            setSavingEdit(false);
        }
    };

    if (loading) return <LoadingState label="Loading leave policies…" />;

    return (
        <div className="space-y-4">
            <PublicHolidays />

            <div className="space-y-3 app-panel p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-semibold text-zinc-900">Fortnightly accrual</h2>
                        <p className="mt-1 text-xs text-zinc-500">
                            Payroll runs every fortnight. Accrual runs automatically every two weeks from the first
                            date below, crediting accruable leave types and applying any due balance resets.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={runAccrual}
                        disabled={runningAccrual}
                        className="rounded-md bg-[#E8842C] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#d4761f] disabled:opacity-50"
                    >
                        {runningAccrual ? 'Running…' : 'Run now'}
                    </button>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                    <label className="text-sm">
                        <span className="mb-1 block font-medium text-zinc-700">First accrual date</span>
                        <input
                            type="date"
                            value={anchorDate}
                            onChange={(e) => setAnchorDate(e.target.value)}
                            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={saveAnchor}
                        disabled={savingAnchor}
                        className="rounded-md bg-[#002B7F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#001f5c] disabled:opacity-50"
                    >
                        {savingAnchor ? 'Saving…' : 'Save schedule'}
                    </button>
                </div>
            </div>

            <div className="app-panel">
                <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-900">Leave types</h2>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                            <tr>
                                <th className="px-4 py-2">Name</th>
                                <th className="px-4 py-2">Days / year</th>
                                <th className="px-4 py-2">Accrual / fortnight</th>
                                <th className="px-4 py-2">Reset</th>
                                <th className="px-4 py-2">Reason required</th>
                                <th className="px-4 py-2">Accruable</th>
                                <th className="px-4 py-2">Active</th>
                                <th className="px-4 py-2" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {types.map((type) => (
                                <tr key={type.id}>
                                    <td className="px-4 py-2 font-medium text-zinc-900">{type.name}</td>
                                    <td className="px-4 py-2 text-zinc-600">{type.default_days}</td>
                                    <td className="px-4 py-2 text-zinc-600">{type.accrual_days_per_fortnight}</td>
                                    <td className="px-4 py-2 text-zinc-600">{resetLabel(type.reset_period)}</td>
                                    <td className="px-4 py-2"><YesNo value={type.requires_note} /></td>
                                    <td className="px-4 py-2"><YesNo value={type.is_accruable} /></td>
                                    <td className="px-4 py-2"><YesNo value={type.is_active} /></td>
                                    <td className="px-4 py-2 text-right whitespace-nowrap">
                                        <button
                                            type="button"
                                            onClick={() => openEdit(type)}
                                            className="text-sm font-medium text-[#002B7F] hover:underline"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => remove(type)}
                                            disabled={(type.usage_count ?? 0) > 0}
                                            title={(type.usage_count ?? 0) > 0 ? 'This type is in use and cannot be deleted. Deactivate it instead.' : 'Delete'}
                                            className="ml-3 text-sm font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-zinc-300"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="space-y-3 app-panel p-4">
                <h2 className="text-sm font-semibold text-zinc-900">Add a leave type</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Name, e.g. Study Leave"
                        className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                    />
                    <input
                        type="number"
                        step="0.5"
                        value={defaultDays}
                        onChange={(e) => setDefaultDays(e.target.value)}
                        placeholder="Days per year"
                        className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                    />
                    <input
                        type="number"
                        step="0.25"
                        value={accrualPerFortnight}
                        onChange={(e) => setAccrualPerFortnight(e.target.value)}
                        placeholder="Accrual days per fortnight (accruable types only)"
                        disabled={!isAccruable}
                        className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100"
                    />
                    <select
                        value={resetPeriod}
                        onChange={(e) => setResetPeriod(e.target.value as ResetPeriod)}
                        className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                    >
                        {RESET_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-zinc-700">
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={requiresNote} onChange={(e) => setRequiresNote(e.target.checked)} />
                        Reason required
                    </label>
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={isAccruable} onChange={(e) => setIsAccruable(e.target.checked)} />
                        Accruable
                    </label>
                </div>
                <button
                    type="button"
                    onClick={create}
                    disabled={saving}
                    className="rounded-md bg-[#002B7F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#001f5c] disabled:opacity-50"
                >
                    {saving ? 'Saving…' : 'Create leave type'}
                </button>
            </div>

            {editing && draft && (
                <div className="fixed inset-0 z-50 flex justify-end">
                    <div className="absolute inset-0 bg-zinc-900/40" onClick={() => { setEditing(null); setDraft(null); }} />
                    <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
                            <h2 className="text-base font-semibold text-zinc-900">Edit {editing.name}</h2>
                            <button
                                type="button"
                                onClick={() => { setEditing(null); setDraft(null); }}
                                className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                                aria-label="Close"
                            >
                                ×
                            </button>
                        </div>
                        <div className="flex-1 space-y-4 p-5">
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-zinc-700">Name</span>
                                <input
                                    value={draft.name}
                                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-zinc-700">Days per year</span>
                                <input
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    value={draft.default_days}
                                    onChange={(e) => setDraft({ ...draft, default_days: e.target.value })}
                                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-zinc-700">Accrual days per fortnight</span>
                                <input
                                    type="number"
                                    step="0.25"
                                    min="0"
                                    value={draft.accrual_days_per_fortnight}
                                    disabled={!draft.is_accruable}
                                    onChange={(e) => setDraft({ ...draft, accrual_days_per_fortnight: e.target.value })}
                                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100"
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-zinc-700">Reset</span>
                                <select
                                    value={draft.reset_period}
                                    onChange={(e) => setDraft({ ...draft, reset_period: e.target.value as ResetPeriod })}
                                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                                >
                                    {RESET_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </label>
                            <div className="space-y-2 text-sm text-zinc-700">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={draft.requires_note}
                                        onChange={(e) => setDraft({ ...draft, requires_note: e.target.checked })}
                                    />
                                    Reason required
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={draft.is_accruable}
                                        onChange={(e) => setDraft({ ...draft, is_accruable: e.target.checked })}
                                    />
                                    Accruable
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={draft.is_active}
                                        onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                                    />
                                    Active
                                </label>
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-4">
                            <button
                                type="button"
                                onClick={() => { setEditing(null); setDraft(null); }}
                                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={saveEdit}
                                disabled={savingEdit}
                                className="rounded-md bg-[#002B7F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#001f5c] disabled:opacity-50"
                            >
                                {savingEdit ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

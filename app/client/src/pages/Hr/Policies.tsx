import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { useConfirm } from '../../contexts/useConfirm';
import { LoadingState } from '../../components/Ui';
import type { LeaveType, ResetPeriod } from '../../features/hr/types';

const RESET_OPTIONS: { value: ResetPeriod; label: string }[] = [
    { value: 'none', label: 'Never reset' },
    { value: 'financial_year', label: 'End of financial year' },
    { value: 'anniversary', label: 'Service anniversary' },
];

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

    const update = async (type: LeaveType, patch: Record<string, unknown>) => {
        try {
            await apiClient.put(`/hr/policies/${type.id}`, patch);
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to update the leave type.', 'error');
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

    if (loading) return <LoadingState label="Loading leave policies…" />;

    return (
        <div className="space-y-4">
            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
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

            <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
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
                                    <td className="px-4 py-2">
                                        <input
                                            defaultValue={type.name}
                                            onBlur={(e) => {
                                                const value = e.target.value.trim();
                                                if (value && value !== type.name) update(type, { name: value });
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') e.currentTarget.blur();
                                            }}
                                            className="w-full min-w-40 rounded-md border border-zinc-300 px-2 py-1 font-medium text-zinc-900"
                                        />
                                    </td>
                                    <td className="px-4 py-2">
                                        <input
                                            type="number"
                                            step="0.5"
                                            min="0"
                                            defaultValue={type.default_days}
                                            onBlur={(e) => {
                                                const value = Number(e.target.value);
                                                if (Number.isFinite(value) && value !== Number(type.default_days)) {
                                                    update(type, { default_days: value });
                                                }
                                            }}
                                            className="w-20 rounded-md border border-zinc-300 px-2 py-1 text-zinc-600"
                                        />
                                    </td>
                                    <td className="px-4 py-2">
                                        <input
                                            type="number"
                                            step="0.25"
                                            min="0"
                                            defaultValue={type.accrual_days_per_fortnight}
                                            disabled={!type.is_accruable}
                                            onBlur={(e) => {
                                                const value = Number(e.target.value);
                                                if (Number.isFinite(value) && value !== Number(type.accrual_days_per_fortnight)) {
                                                    update(type, { accrual_days_per_fortnight: value });
                                                }
                                            }}
                                            className="w-20 rounded-md border border-zinc-300 px-2 py-1 text-zinc-600 disabled:bg-zinc-100 disabled:text-zinc-400"
                                        />
                                    </td>
                                    <td className="px-4 py-2">
                                        <select
                                            value={type.reset_period}
                                            onChange={(e) => update(type, { reset_period: e.target.value })}
                                            className="rounded-md border border-zinc-300 px-2 py-1 text-zinc-600"
                                        >
                                            {RESET_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="px-4 py-2">
                                        <input
                                            type="checkbox"
                                            checked={type.requires_note}
                                            onChange={(e) => update(type, { requires_note: e.target.checked })}
                                        />
                                    </td>
                                    <td className="px-4 py-2">
                                        <input
                                            type="checkbox"
                                            checked={type.is_accruable}
                                            onChange={(e) => update(type, { is_accruable: e.target.checked })}
                                        />
                                    </td>
                                    <td className="px-4 py-2">
                                        <input
                                            type="checkbox"
                                            checked={type.is_active}
                                            onChange={(e) => update(type, { is_active: e.target.checked })}
                                        />
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        <button
                                            type="button"
                                            onClick={() => remove(type)}
                                            disabled={(type.usage_count ?? 0) > 0}
                                            title={(type.usage_count ?? 0) > 0 ? 'This type is in use and cannot be deleted. Deactivate it instead.' : 'Delete'}
                                            className="text-sm font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-zinc-300"
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

            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
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
        </div>
    );
}

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { LoadingState } from '../../components/Ui';
import type { LeaveType } from '../../features/hr/types';

export function Policies() {
    const { addToast } = useToast();
    const [types, setTypes] = useState<LeaveType[]>([]);
    const [loading, setLoading] = useState(true);
    const [name, setName] = useState('');
    const [defaultDays, setDefaultDays] = useState('');
    const [requiresNote, setRequiresNote] = useState(false);
    const [isAccruable, setIsAccruable] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setTypes((await apiClient.get<LeaveType[]>('/hr/policies')) || []);
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
                requires_note: requiresNote,
                is_accruable: isAccruable,
            });
            addToast('Leave type created.', 'success');
            setName('');
            setDefaultDays('');
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

    if (loading) return <LoadingState label="Loading leave policies…" />;

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
                <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-900">Leave types</h2>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                            <tr>
                                <th className="px-4 py-2">Name</th>
                                <th className="px-4 py-2">Days / year</th>
                                <th className="px-4 py-2">Reason required</th>
                                <th className="px-4 py-2">Accruable</th>
                                <th className="px-4 py-2">Active</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {types.map((type) => (
                                <tr key={type.id}>
                                    <td className="px-4 py-2 font-medium text-zinc-900">{type.name}</td>
                                    <td className="px-4 py-2 text-zinc-600">{type.default_days}</td>
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

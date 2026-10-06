import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { useConfirm } from '../../contexts/useConfirm';
import { Card, CardHeading, LoadingState } from '../../components/Ui';
import type { OrgDepartment } from './types';

/** The departments and divisions staff records are chosen from. */
export function OrgUnits({ onChanged }: { onChanged?: () => void } = {}) {
    const { addToast } = useToast();
    const { confirm } = useConfirm();
    const [departments, setDepartments] = useState<OrgDepartment[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [newDepartment, setNewDepartment] = useState('');
    const [newDivisions, setNewDivisions] = useState<Record<string, string>>({});

    const load = useCallback(async () => {
        try {
            setDepartments((await apiClient.get<OrgDepartment[]>('/hr/org-units')) || []);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to load departments.', 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast]);

    useEffect(() => {
        load();
    }, [load]);

    const run = async (action: () => Promise<unknown>, success: string) => {
        setSaving(true);
        try {
            await action();
            addToast(success, 'success');
            await load();
            onChanged?.();
            return true;
        } catch (err) {
            addToast((err as Error)?.message || 'That change could not be saved.', 'error');
            return false;
        } finally {
            setSaving(false);
        }
    };

    const addDepartment = async () => {
        const name = newDepartment.trim();
        if (!name) {
            addToast('Give the department a name.', 'error');
            return;
        }
        if (await run(() => apiClient.post('/hr/departments', { name }), 'Department added.')) setNewDepartment('');
    };

    const addDivision = async (department: OrgDepartment) => {
        const name = (newDivisions[department.id] || '').trim();
        if (!name) {
            addToast('Give the division a name.', 'error');
            return;
        }
        const added = await run(
            () => apiClient.post(`/hr/departments/${department.id}/divisions`, { name }),
            'Division added.'
        );
        if (added) setNewDivisions((current) => ({ ...current, [department.id]: '' }));
    };

    const removeDepartment = async (department: OrgDepartment) => {
        if (!(await confirm(`Remove the department "${department.name}"?`))) return;
        await run(() => apiClient.delete(`/hr/departments/${department.id}`), 'Department removed.');
    };

    const removeDivision = async (departmentName: string, division: { id: string; name: string }) => {
        if (!(await confirm(`Remove the division "${division.name}" from ${departmentName}?`))) return;
        await run(() => apiClient.delete(`/hr/divisions/${division.id}`), 'Division removed.');
    };

    return (
        <Card>
            <CardHeading
                title="Departments and divisions"
                subtitle="Staff records choose from these lists. A division belongs to one department. Anything still assigned to staff cannot be removed."
            />

            <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="min-w-0 flex-1 basis-48 text-sm">
                    <span className="mb-1 block font-medium text-gray-700">New department</span>
                    <input
                        type="text"
                        value={newDepartment}
                        maxLength={60}
                        placeholder="Finance"
                        onChange={(e) => setNewDepartment(e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
                <button
                    type="button"
                    onClick={addDepartment}
                    disabled={saving}
                    className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                >
                    Add department
                </button>
            </div>

            {loading ? (
                <LoadingState label="Loading departments…" />
            ) : departments.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">No departments yet. Add one so it can be chosen on staff records.</p>
            ) : (
                <ul className="mt-4 divide-y divide-gray-100">
                    {departments.map((department) => (
                        <li key={department.id} className="py-3">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-semibold text-gray-900">{department.name}</span>
                                <button
                                    type="button"
                                    onClick={() => removeDepartment(department)}
                                    disabled={saving}
                                    className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                                >
                                    Remove department
                                </button>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                {department.divisions.length === 0 && (
                                    <span className="text-xs text-gray-500">No divisions</span>
                                )}
                                {department.divisions.map((division) => (
                                    <span
                                        key={division.id}
                                        className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 py-1 pl-3 pr-1.5 text-xs text-gray-800"
                                    >
                                        {division.name}
                                        <button
                                            type="button"
                                            onClick={() => removeDivision(department.name, division)}
                                            disabled={saving}
                                            aria-label={`Remove ${division.name}`}
                                            className="rounded-full px-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-800 disabled:opacity-50"
                                        >
                                            ×
                                        </button>
                                    </span>
                                ))}
                            </div>
                            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                                <input
                                    type="text"
                                    value={newDivisions[department.id] || ''}
                                    maxLength={60}
                                    placeholder="New division"
                                    aria-label={`New division in ${department.name}`}
                                    onChange={(e) => setNewDivisions((current) => ({ ...current, [department.id]: e.target.value }))}
                                    className="min-w-0 flex-1 basis-48 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => addDivision(department)}
                                    disabled={saving}
                                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                >
                                    Add division
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}

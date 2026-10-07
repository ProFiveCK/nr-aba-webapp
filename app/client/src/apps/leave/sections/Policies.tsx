import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../../lib/api';
import { useToast } from '../../../contexts/useToast';
import { useConfirm } from '../../../contexts/useConfirm';
import { Button, LoadingState, Modal, ModalActions } from '../../../components/Ui';
import type { LeaveType, ResetPeriod } from '../types';
import { PublicHolidays } from '../PublicHolidays';
import { OrgUnits } from '../OrgUnits';
import { GovernmentFoundation } from '../GovernmentFoundation';

const RESET_OPTIONS: { value: ResetPeriod; label: string }[] = [
    { value: 'none', label: 'Never reset' },
    { value: 'financial_year', label: 'End of financial year' },
    { value: 'anniversary', label: 'Service anniversary' },
];

interface EditDraft {
    name: string;
    default_days: string;
    accrual_days_per_fortnight: string;
    max_balance: string;
    reset_period: ResetPeriod;
    is_accruable: boolean;
    is_active: boolean;
    requires_attachment: boolean;
    attachment_label: string;
}

function resetLabel(value: ResetPeriod): string {
    return RESET_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function YesNo({ value }: { value: boolean }) {
    return <span className={value ? 'text-gray-700' : 'text-gray-400'}>{value ? 'Yes' : 'No'}</span>;
}

function HistoricalPolicySettings() {
    const { addToast } = useToast();
    const { confirm } = useConfirm();
    const [types, setTypes] = useState<LeaveType[]>([]);
    const [loading, setLoading] = useState(true);

    const [name, setName] = useState('');
    const [defaultDays, setDefaultDays] = useState('');
    const [accrualPerFortnight, setAccrualPerFortnight] = useState('');
    const [maxBalance, setMaxBalance] = useState('');
    const [resetPeriod, setResetPeriod] = useState<ResetPeriod>('none');
    const [isAccruable, setIsAccruable] = useState(false);
    const [requiresAttachment, setRequiresAttachment] = useState(false);
    const [attachmentLabel, setAttachmentLabel] = useState('');
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
                max_balance: maxBalance.trim() === '' ? null : Number(maxBalance),
                reset_period: resetPeriod,
                is_accruable: isAccruable,
                requires_attachment: requiresAttachment,
                attachment_label: requiresAttachment ? attachmentLabel.trim() || null : null,
            });
            addToast('Leave type created.', 'success');
            setName('');
            setDefaultDays('');
            setAccrualPerFortnight('');
            setMaxBalance('');
            setResetPeriod('none');
            setIsAccruable(false);
            setRequiresAttachment(false);
            setAttachmentLabel('');
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
            max_balance: type.max_balance ?? '',
            reset_period: type.reset_period,
            is_accruable: type.is_accruable,
            is_active: type.is_active,
            requires_attachment: type.requires_attachment === true,
            attachment_label: type.attachment_label ?? '',
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
                max_balance: String(draft.max_balance).trim() === '' ? null : Number(draft.max_balance),
                reset_period: draft.reset_period,
                is_accruable: draft.is_accruable,
                is_active: draft.is_active,
                requires_attachment: draft.requires_attachment,
                attachment_label: draft.requires_attachment ? draft.attachment_label.trim() || null : null,
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

            <OrgUnits />

            <div className="space-y-3 app-panel p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-semibold text-gray-900">Fortnightly accrual</h2>
                        <p className="mt-1 text-xs text-gray-500">
                            Payroll runs every fortnight. Accrual runs automatically every two weeks from the first
                            date below, crediting accruable leave types and applying any due balance resets.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={runAccrual}
                        disabled={runningAccrual}
                        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-hover disabled:opacity-50"
                    >
                        {runningAccrual ? 'Running…' : 'Run now'}
                    </button>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                    <label className="text-sm">
                        <span className="mb-1 block font-medium text-gray-700">First accrual date</span>
                        <input
                            type="date"
                            value={anchorDate}
                            onChange={(e) => setAnchorDate(e.target.value)}
                            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={saveAnchor}
                        disabled={savingAnchor}
                        className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                    >
                        {savingAnchor ? 'Saving…' : 'Save schedule'}
                    </button>
                </div>
            </div>

            <div className="app-panel">
                <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Leave types</h2>
                <p className="px-4 pt-3 text-sm text-gray-600">
                    Every leave application requires an explanation. A type with a document required will not accept
                    an application until the named document is attached — the invitation for official leave, the
                    certificate for sick leave with an M/C.
                </p>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className="px-4 py-2">Name</th>
                                <th className="px-4 py-2">Days / year</th>
                                <th className="px-4 py-2">Accrual / fortnight</th>
                                <th className="px-4 py-2">Max balance</th>
                                <th className="px-4 py-2">Reset</th>
                                <th className="px-4 py-2">Accruable</th>
                                <th className="px-4 py-2">Document required</th>
                                <th className="px-4 py-2">Active</th>
                                <th className="px-4 py-2" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {types.map((type) => (
                                <tr key={type.id}>
                                    <td className="px-4 py-2 font-medium text-gray-900">{type.name}</td>
                                    <td className="px-4 py-2 text-gray-600">{type.default_days}</td>
                                    <td className="px-4 py-2 text-gray-600">{type.accrual_days_per_fortnight}</td>
                                    <td className="px-4 py-2 text-gray-600">{type.max_balance ?? 'No limit'}</td>
                                    <td className="px-4 py-2 text-gray-600">{resetLabel(type.reset_period)}</td>
                                    <td className="px-4 py-2"><YesNo value={type.is_accruable} /></td>
                                    <td className="px-4 py-2 text-gray-600">
                                        {type.requires_attachment
                                            ? (type.attachment_label?.trim() || 'Yes')
                                            : <span className="text-gray-400">No</span>}
                                    </td>
                                    <td className="px-4 py-2"><YesNo value={type.is_active} /></td>
                                    <td className="px-4 py-2 text-right whitespace-nowrap">
                                        <button
                                            type="button"
                                            onClick={() => openEdit(type)}
                                            className="text-sm font-medium text-brand hover:underline"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => remove(type)}
                                            disabled={(type.usage_count ?? 0) > 0}
                                            title={(type.usage_count ?? 0) > 0 ? 'This type is in use and cannot be deleted. Deactivate it instead.' : 'Delete'}
                                            className="ml-3 text-sm font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-300"
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
                <h2 className="text-sm font-semibold text-gray-900">Add a leave type</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Name, e.g. Study Leave"
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                    <input
                        type="number"
                        step="0.5"
                        value={defaultDays}
                        onChange={(e) => setDefaultDays(e.target.value)}
                        placeholder="Days per year"
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                    <input
                        type="number"
                        step="0.25"
                        value={accrualPerFortnight}
                        onChange={(e) => setAccrualPerFortnight(e.target.value)}
                        placeholder="Accrual days per fortnight (accruable types only)"
                        disabled={!isAccruable}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                    />
                    <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={maxBalance}
                        onChange={(e) => setMaxBalance(e.target.value)}
                        placeholder="Maximum balance in days (blank = no limit)"
                        disabled={!isAccruable}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                    />
                    <select
                        value={resetPeriod}
                        onChange={(e) => setResetPeriod(e.target.value as ResetPeriod)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                        {RESET_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-gray-700">
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={isAccruable} onChange={(e) => setIsAccruable(e.target.checked)} />
                        Accruable
                    </label>
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={requiresAttachment}
                            onChange={(e) => setRequiresAttachment(e.target.checked)}
                        />
                        Requires a supporting document
                    </label>
                </div>
                {requiresAttachment && (
                    <input
                        value={attachmentLabel}
                        onChange={(e) => setAttachmentLabel(e.target.value)}
                        maxLength={200}
                        placeholder="Name the document, e.g. Invitation letter from the partner organisation"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm sm:max-w-xl"
                    />
                )}
                <button
                    type="button"
                    onClick={create}
                    disabled={saving}
                    className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                >
                    {saving ? 'Saving…' : 'Create leave type'}
                </button>
            </div>

            {editing && draft && (
                <Modal
                    title={`Edit ${editing.name}`}
                    onClose={() => { setEditing(null); setDraft(null); }}
                    closeDisabled={savingEdit}
                    placement="right"
                >
                        <div className="space-y-4">
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-gray-700">Name</span>
                                <input
                                    value={draft.name}
                                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-gray-700">Days per year</span>
                                <input
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    value={draft.default_days}
                                    onChange={(e) => setDraft({ ...draft, default_days: e.target.value })}
                                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-gray-700">Accrual days per fortnight</span>
                                <input
                                    type="number"
                                    step="0.25"
                                    min="0"
                                    value={draft.accrual_days_per_fortnight}
                                    disabled={!draft.is_accruable}
                                    onChange={(e) => setDraft({ ...draft, accrual_days_per_fortnight: e.target.value })}
                                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-gray-700">Maximum balance (days)</span>
                                <input
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    value={draft.max_balance}
                                    disabled={!draft.is_accruable}
                                    placeholder="No limit"
                                    onChange={(e) => setDraft({ ...draft, max_balance: e.target.value })}
                                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                                />
                                <span className="mt-1 block text-xs text-gray-500">Accrual stops once a balance reaches this. Leave blank for no limit.</span>
                            </label>
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-gray-700">Reset</span>
                                <select
                                    value={draft.reset_period}
                                    onChange={(e) => setDraft({ ...draft, reset_period: e.target.value as ResetPeriod })}
                                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                >
                                    {RESET_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </label>
                            <div className="space-y-2 text-sm text-gray-700">
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
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={draft.requires_attachment}
                                        onChange={(e) => setDraft({ ...draft, requires_attachment: e.target.checked })}
                                    />
                                    Requires a supporting document
                                </label>
                            </div>
                            {draft.requires_attachment && (
                                <label className="block text-sm">
                                    <span className="mb-1 block font-medium text-gray-700">Document to attach</span>
                                    <input
                                        value={draft.attachment_label}
                                        onChange={(e) => setDraft({ ...draft, attachment_label: e.target.value })}
                                        maxLength={200}
                                        placeholder="e.g. Medical certificate"
                                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                    />
                                    <span className="mt-1 block text-xs text-gray-500">
                                        Named on the application form so the applicant knows what to attach. Changing
                                        this does not affect applications already submitted.
                                    </span>
                                </label>
                            )}
                        </div>
                        <ModalActions>
                            <Button variant="secondary" onClick={() => { setEditing(null); setDraft(null); }} disabled={savingEdit}>Cancel</Button>
                            <Button onClick={saveEdit} loading={savingEdit}>{savingEdit ? 'Saving…' : 'Save'}</Button>
                        </ModalActions>
                </Modal>
            )}
        </div>
    );
}

export function Policies() {
    const [historical, setHistorical] = useState(false);
    return <div className="space-y-5">
        <p className="text-sm text-gray-600">Shared government rules, public holidays and work schedules. Employee balances are managed under Employees.</p>
        <details className="text-sm text-gray-600">
            <summary className="cursor-pointer font-medium">How to review Policies</summary>
            <div className="mt-3 space-y-2">
                <p>Read the configured rules and dates below first. Preparing or publishing a new government version is an HR configuration step.</p>
                <ul className="list-disc space-y-1 pl-5">
                    <li><strong>Leave rules:</strong> eligibility, allowances, balance limits and notice periods.</li>
                    <li><strong>Public holidays:</strong> approved dates used when calculating a leave application.</li>
                    <li><strong>Weekly work schedules:</strong> normal working days and paid hours, linked to employees under Employees.</li>
                </ul>
                <p>A Demo badge means made-up review data. “Synthetic” and package numbers in the original references are internal build labels. Demo publication or verification does not represent government sign-off.</p>
                <p>After checking this page, open Employees → Employee list, then Existing leave records or Government balances &amp; service. Approvals is where authorised officers decide submitted applications, with Chief Secretary as final approver.</p>
                <p>For live setup: verify Payroll identities and service records, assign the actual approvers, publish signed rules and Gazette calendars, then independently certify opening balances and activate a small pilot group.</p>
            </div>
        </details>
        <GovernmentFoundation view="policies" />
        <details className="border-t border-gray-200 pt-4" onToggle={e => setHistorical(e.currentTarget.open)}>
            <summary className="cursor-pointer text-sm font-medium text-gray-600">Existing leave policy settings</summary>
            <p className="my-3 text-sm text-gray-500">These settings support the existing leave records. Government leave uses the approved effective versions above once configured.</p>
            {historical && <HistoricalPolicySettings />}
        </details>
    </div>;
}

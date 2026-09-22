import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { useConfirm } from '../../contexts/useConfirm';
import { EmptyState, LoadingState } from '../../components/Ui';
import {
    calculateWorkingDays,
    formatDate,
    STATUS_STYLES,
} from '../../features/hr/types';
import type { LeaveApplication, LeaveType, MyLeaveResponse } from '../../features/hr/types';

export function MyLeave() {
    const { addToast } = useToast();
    const { confirm } = useConfirm();
    const [summary, setSummary] = useState<MyLeaveResponse | null>(null);
    const [types, setTypes] = useState<LeaveType[]>([]);
    const [applications, setApplications] = useState<LeaveApplication[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const [leaveTypeId, setLeaveTypeId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [reason, setReason] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [me, leaveTypes, leaves] = await Promise.all([
                apiClient.get<MyLeaveResponse>('/hr/me'),
                apiClient.get<LeaveType[]>('/hr/leave-types'),
                apiClient.get<LeaveApplication[]>('/hr/leaves'),
            ]);
            setSummary(me);
            setTypes(leaveTypes || []);
            setApplications(leaves || []);
            if (!leaveTypeId && leaveTypes?.length) setLeaveTypeId(leaveTypes[0].id);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to load your leave.', 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast, leaveTypeId]);

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const selectedType = types.find((t) => t.id === leaveTypeId);
    const previewDays = calculateWorkingDays(startDate, endDate);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (previewDays <= 0) {
            addToast('The selected dates contain no working days.', 'error');
            return;
        }
        setSubmitting(true);
        try {
            await apiClient.post('/hr/leaves', {
                leave_type_id: leaveTypeId,
                start_date: startDate,
                end_date: endDate,
                reason: reason.trim() || null,
            });
            addToast('Leave application submitted.', 'success');
            setStartDate('');
            setEndDate('');
            setReason('');
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to submit your application.', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const archive = async (application: LeaveApplication) => {
        try {
            await apiClient.post(`/hr/leaves/${application.id}/archive`);
            addToast('Application archived.', 'success');
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to archive the application.', 'error');
        }
    };

    const cancel = async (application: LeaveApplication) => {
        if (!(await confirm(`Cancel your ${application.leave_type_name} leave application?`))) return;
        try {
            await apiClient.post(`/hr/leaves/${application.id}/cancel`);
            addToast('Application cancelled.', 'success');
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to cancel the application.', 'error');
        }
    };

    if (loading) return <LoadingState label="Loading your leave…" />;

    return (
        <div className="space-y-4">
            {/* Balances */}
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold text-zinc-900">
                        Leave balances {summary ? `— ${summary.year}` : ''}
                    </h2>
                    {summary?.manager && (
                        <p className="text-xs text-zinc-500">Approver: {summary.manager.display_name}</p>
                    )}
                </div>
                {summary?.balances.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {summary.balances.map((balance) => {
                            const available = Number(balance.balance) - Number(balance.pending);
                            return (
                                <div key={balance.id} className="rounded-lg border border-zinc-200 p-3">
                                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                                        {balance.leave_type_name}
                                    </p>
                                    <p className="mt-1 text-2xl font-semibold text-zinc-900">{available}</p>
                                    <p className="text-xs text-zinc-500">
                                        days available
                                        {Number(balance.pending) > 0 && ` · ${balance.pending} pending`}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-sm text-zinc-500">
                        No balances yet — they are created the first time you apply for each leave type.
                    </p>
                )}
            </div>

            {/* Apply */}
            <form onSubmit={submit} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-zinc-900">Apply for leave</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                    <label className="text-sm">
                        <span className="mb-1 block font-medium text-zinc-700">Leave type</span>
                        <select
                            value={leaveTypeId}
                            onChange={(e) => setLeaveTypeId(e.target.value)}
                            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                            required
                        >
                            {types.map((type) => (
                                <option key={type.id} value={type.id}>{type.name}</option>
                            ))}
                        </select>
                    </label>
                    <label className="text-sm">
                        <span className="mb-1 block font-medium text-zinc-700">From</span>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                            required
                        />
                    </label>
                    <label className="text-sm">
                        <span className="mb-1 block font-medium text-zinc-700">To</span>
                        <input
                            type="date"
                            value={endDate}
                            min={startDate || undefined}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                            required
                        />
                    </label>
                </div>

                <label className="block text-sm">
                    <span className="mb-1 block font-medium text-zinc-700">
                        Reason {selectedType?.requires_note && <span className="text-red-600">(required)</span>}
                    </span>
                    <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                        placeholder={selectedType?.requires_note ? `${selectedType.name} leave requires a reason` : 'Optional'}
                        required={selectedType?.requires_note}
                    />
                </label>

                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="submit"
                        disabled={submitting || previewDays <= 0}
                        className="rounded-md bg-[#E8842C] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#d4761f] disabled:opacity-50"
                    >
                        {submitting ? 'Submitting…' : 'Submit application'}
                    </button>
                    {startDate && endDate && (
                        <p className="text-sm text-zinc-600">
                            {previewDays > 0
                                ? `${previewDays} working day${previewDays === 1 ? '' : 's'} (weekends excluded)`
                                : 'No working days in this range'}
                        </p>
                    )}
                </div>
            </form>

            {/* History */}
            <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
                <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-900">
                    My applications
                </h2>
                {applications.length ? (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                                <tr>
                                    <th className="px-4 py-2">Type</th>
                                    <th className="px-4 py-2">Dates</th>
                                    <th className="px-4 py-2">Days</th>
                                    <th className="px-4 py-2">Status</th>
                                    <th className="px-4 py-2">Decision</th>
                                    <th className="px-4 py-2" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {applications.map((application) => (
                                    <tr key={application.id}>
                                        <td className="px-4 py-2 font-medium text-zinc-900">{application.leave_type_name}</td>
                                        <td className="px-4 py-2 text-zinc-600">
                                            {formatDate(application.start_date)} – {formatDate(application.end_date)}
                                        </td>
                                        <td className="px-4 py-2 text-zinc-600">{application.days}</td>
                                        <td className="px-4 py-2">
                                            <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[application.status]}`}>
                                                {application.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2 text-zinc-600">
                                            {application.reviewer_note || (application.reviewed_at ? '—' : '')}
                                        </td>
                                        <td className="px-4 py-2 text-right">
                                            {application.status === 'pending' && (
                                                <button
                                                    type="button"
                                                    onClick={() => cancel(application)}
                                                    className="text-sm font-medium text-red-600 hover:underline"
                                                >
                                                    Cancel
                                                </button>
                                            )}
                                            {(application.status === 'cancelled' || application.status === 'rejected') && (
                                                <button
                                                    type="button"
                                                    onClick={() => archive(application)}
                                                    className="text-sm font-medium text-zinc-500 hover:underline"
                                                    title="Hide this from your list. Balances are unaffected."
                                                >
                                                    Archive
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="p-4">
                        <EmptyState title="No leave applications yet" detail="Your applications will appear here." />
                    </div>
                )}
            </div>
        </div>
    );
}

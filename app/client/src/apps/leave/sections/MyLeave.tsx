import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { apiClient } from '../../../lib/api';
import { useToast } from '../../../contexts/useToast';
import { useConfirm } from '../../../contexts/useConfirm';
import { EmptyState, LoadingState } from '../../../components/Ui';
import { printApprovedLeaveForm } from '../payrollForm';
import {
    calculateWorkingDays,
    formatDate,
    STATUS_STYLES,
} from '../types';
import {
    LEAVE_ATTACHMENT_ACCEPT,
    LEAVE_ATTACHMENT_MAX_BYTES,
    LEAVE_ATTACHMENT_MAX_FILES,
    formatFileSize,
} from '../leaveAttachments';
import { LeaveAttachmentLinks } from '../LeaveAttachmentLinks';
import type { LeaveApplication, LeaveType, MyLeaveResponse, PublicHoliday } from '../types';

export function MyLeave() {
    const { addToast } = useToast();
    const { confirm } = useConfirm();
    const [summary, setSummary] = useState<MyLeaveResponse | null>(null);
    const [types, setTypes] = useState<LeaveType[]>([]);
    const [applications, setApplications] = useState<LeaveApplication[]>([]);
    const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
    const [calendarAvailable, setCalendarAvailable] = useState(true);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [statusFilter, setStatusFilter] = useState('all');

    const [leaveTypeId, setLeaveTypeId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [reason, setReason] = useState('');
    const [documents, setDocuments] = useState<File[]>([]);
    // Bumped to rebuild the file input, which cannot be cleared by state alone.
    const [documentsKey, setDocumentsKey] = useState(0);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(false);
        try {
            const [me, leaveTypes, leaves] = await Promise.all([
                apiClient.get<MyLeaveResponse>('/hr/me'),
                apiClient.get<LeaveType[]>('/hr/leave-types'),
                apiClient.get<LeaveApplication[]>('/hr/leaves'),
            ]);
            setSummary(me);
            setTypes(leaveTypes || []);
            setApplications(leaves || []);

            // Fetched separately and allowed to fail: the calendar refines the
            // day count, it is not what the page is for. Folding it into the
            // Promise.all above would let one missing endpoint — an older
            // backend during a deploy — take the whole page down.
            try {
                setHolidays((await apiClient.get<PublicHoliday[]>('/hr/public-holidays')) || []);
                setCalendarAvailable(true);
            } catch {
                setHolidays([]);
                setCalendarAvailable(false);
            }
            setLeaveTypeId((current) => current || leaveTypes?.[0]?.id || '');
        } catch (err) {
            setLoadError(true);
            addToast((err as Error)?.message || 'Unable to load your leave.', 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast]);

    useEffect(() => {
        load();
    }, [load]);

    const notEntitled = summary?.employee.leave_entitled === false;
    // The preview is exact only when the public holiday calendar loaded.
    const holidayDates = useMemo(() => new Set(holidays.map((h) => h.holiday_date)), [holidays]);
    const previewDays = calculateWorkingDays(startDate, endDate, holidayDates);
    const holidaysInRange = useMemo(
        () => (startDate && endDate
            ? holidays.filter((h) => h.holiday_date >= startDate && h.holiday_date <= endDate)
            : []),
        [holidays, startDate, endDate]
    );
    const selectedType = types.find((type) => type.id === leaveTypeId);
    // Official leave rests on the partner's invitation, certified sick leave on
    // the certificate: without the document there is nothing to approve, so the
    // form asks for it before it will submit. The server enforces the same rule.
    const documentRequired = selectedType?.requires_attachment === true;
    const documentLabel = selectedType?.attachment_label?.trim() || 'a supporting document';
    const documentMissing = documentRequired && documents.length === 0;
    const selectedBalance = summary?.balances.find((b) => b.leave_type_id === leaveTypeId);
    const availableDays = selectedBalance ? Number(selectedBalance.balance) - Number(selectedBalance.pending) : 0;
    const insufficient = calendarAvailable && previewDays > 0 && previewDays > availableDays;
    const visibleApplications = statusFilter === 'all'
        ? applications
        : applications.filter((application) => application.status === statusFilter);
    const pendingCount = applications.filter((application) => application.status === 'pending').length;

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!reason.trim()) {
            addToast('Explain the reason for your leave.', 'error');
            return;
        }
        if (previewDays <= 0) {
            addToast('The selected dates contain no working days.', 'error');
            return;
        }
        if (documentMissing) {
            addToast(`Attach ${documentLabel} before submitting.`, 'error');
            return;
        }
        setSubmitting(true);
        try {
            const fields = {
                leave_type_id: leaveTypeId,
                start_date: startDate,
                end_date: endDate,
                reason: reason.trim(),
            };
            // Only an application carrying documents is sent as multipart; the
            // ordinary one stays plain JSON, as it has always been.
            if (documents.length) {
                const form = new FormData();
                for (const [field, value] of Object.entries(fields)) form.append(field, value);
                for (const file of documents) form.append('documents', file);
                await apiClient.upload('/hr/leaves', form);
            } else {
                await apiClient.post('/hr/leaves', fields);
            }
            addToast('Leave application submitted.', 'success');
            setStartDate('');
            setEndDate('');
            setReason('');
            setDocuments([]);
            setDocumentsKey((key) => key + 1);
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

    const printForm = async (application: LeaveApplication) => {
        try {
            await printApprovedLeaveForm(application.id);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to prepare the leave PDF.', 'error');
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
    if (loadError) return (
        <div className="app-panel p-6">
            <EmptyState title="Your leave could not be loaded" detail="Please try again to see your current balances and applications." />
            <button type="button" onClick={() => load()} className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Try again</button>
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2a5ba5]">Employee self service</p>
                    <h2 className="mt-1 text-xl font-bold text-gray-950">My leave</h2>
                    <p className="mt-1 text-sm text-gray-500">Check your balance, plan time away and track decisions.</p>
                </div>
                {pendingCount > 0 && <span className="rounded-full bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900">{pendingCount} awaiting approval</span>}
            </div>
            {notEntitled && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    You are not currently entitled to leave, so no balance is available and applications are disabled.
                    Contact your administrator if this looks incorrect.
                </div>
            )}

            {/* Balances */}
            <div className="app-panel p-5 sm:p-6">
                <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-lg font-semibold text-gray-950">
                        Leave balances {summary ? `— ${summary.year}` : ''}
                    </h3>
                    {summary?.manager && (
                        <p className="text-xs text-gray-500">Approver: {summary.manager.display_name}</p>
                    )}
                </div>
                {summary?.balances.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {summary.balances.map((balance) => {
                            const available = Number(balance.balance) - Number(balance.pending);
                            return (
                                <div key={balance.leave_type_id} className="rounded-xl border border-blue-100 bg-[#f5f8ff] p-4">
                                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                        {balance.leave_type_name}
                                    </p>
                                    <p className="mt-2 text-3xl font-bold tabular-nums text-brand">{available}</p>
                                    <p className="text-xs text-gray-500">
                                        days available
                                        {Number(balance.pending) > 0 && ` · ${balance.pending} pending`}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-sm text-gray-500">
                        No balances yet — they are created the first time you apply for each leave type.
                    </p>
                )}
            </div>

            {/* Apply */}
            {!notEntitled && (
            <form onSubmit={submit} className="app-panel space-y-5 p-5 sm:p-6">
                <div>
                    <h3 className="text-lg font-semibold text-gray-950">Apply for leave</h3>
                    <p className="mt-1 text-sm text-gray-500">Choose your leave type and dates. Working days are calculated before you submit.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="text-sm">
                        <span className="mb-1 block font-medium text-gray-700">Leave type</span>
                        <select
                            value={leaveTypeId}
                            onChange={(e) => setLeaveTypeId(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-blue-100"
                            required
                        >
                            {types.map((type) => (
                                <option key={type.id} value={type.id}>{type.name}</option>
                            ))}
                        </select>
                    </label>
                    <label className="text-sm">
                        <span className="mb-1 block font-medium text-gray-700">From</span>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-blue-100"
                            required
                        />
                    </label>
                    <label className="text-sm">
                        <span className="mb-1 block font-medium text-gray-700">To</span>
                        <input
                            type="date"
                            value={endDate}
                            min={startDate || undefined}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-blue-100"
                            required
                        />
                    </label>
                </div>

                <label className="block text-sm">
                    <span className="mb-1 block font-medium text-gray-700">
                        Explanation / reason <span className="text-red-600">(required)</span>
                    </span>
                    <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-blue-100"
                        placeholder="Explain why you are applying for leave"
                        maxLength={2000}
                        required
                    />
                    <span className="mt-1 block text-xs text-gray-500">This explanation appears on the approved form for the personnel file.</span>
                </label>

                <label className="block text-sm">
                    <span className="mb-1 block font-medium text-gray-700">
                        Supporting documents{' '}
                        {documentRequired
                            ? <span className="text-red-600">(required)</span>
                            : <span className="font-normal text-gray-500">(optional)</span>}
                    </span>
                    {documentRequired && (
                        <span className="mb-2 block rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
                            {selectedType?.name} leave requires {documentLabel}. Attach it here — your approver
                            needs to see it before this can be granted.
                        </span>
                    )}
                    <input
                        key={documentsKey}
                        type="file"
                        multiple
                        accept={LEAVE_ATTACHMENT_ACCEPT}
                        onChange={(e) => {
                            const chosen = Array.from(e.target.files ?? []);
                            const tooBig = chosen.find((file) => file.size > LEAVE_ATTACHMENT_MAX_BYTES);
                            if (tooBig) {
                                addToast(`"${tooBig.name}" is larger than ${formatFileSize(LEAVE_ATTACHMENT_MAX_BYTES)}.`, 'error');
                                return;
                            }
                            if (chosen.length > LEAVE_ATTACHMENT_MAX_FILES) {
                                addToast(`Attach at most ${LEAVE_ATTACHMENT_MAX_FILES} documents.`, 'error');
                                return;
                            }
                            setDocuments(chosen);
                        }}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700"
                    />
                    <span className="mt-1 block text-xs text-gray-500">
                        PDF, JPG, PNG or Word, up to {formatFileSize(LEAVE_ATTACHMENT_MAX_BYTES)} each.
                        {documents.length > 0 && ` Attached: ${documents.map((file) => file.name).join(', ')}.`}
                    </span>
                </label>

                <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-5">
                    <button
                        type="submit"
                        disabled={submitting || previewDays <= 0 || insufficient || documentMissing}
                        className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {submitting ? 'Submitting…' : 'Submit application'}
                    </button>
                    {startDate && endDate && calendarAvailable && (
                        <p className={`text-sm ${insufficient ? 'font-medium text-red-600' : 'text-gray-600'}`}>
                            {insufficient
                                ? `Insufficient balance: ${previewDays} working day${previewDays === 1 ? '' : 's'} requested, ${availableDays} available.`
                                : previewDays > 0
                                    ? `${previewDays} working day${previewDays === 1 ? '' : 's'} (weekends${holidaysInRange.length ? ' and public holidays' : ''} excluded)`
                                    : 'No working days in this range'}
                        </p>
                    )}
                </div>
                {documentMissing && (
                    <p className="text-sm font-medium text-red-600">Attach {documentLabel} to enable Submit.</p>
                )}
                {!calendarAvailable && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        Public holidays could not be loaded. The final working day count and balance will be checked when you submit.
                    </p>
                )}
                {holidaysInRange.length > 0 && (
                    <p className="text-xs text-gray-500">
                        Not charged as leave: {holidaysInRange.map((h) => `${formatDate(h.holiday_date)} (${h.name})`).join(', ')}
                    </p>
                )}
            </form>
            )}

            {/* History */}
            <div className="app-panel overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-6">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-950">My applications</h3>
                        <p className="text-sm text-gray-500">Follow each request from submission to decision.</p>
                    </div>
                    <label className="text-sm text-gray-600">Status{' '}
                        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="ml-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                            <option value="all">All</option>
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                            <option value="cancelled">Cancelled</option>
                        </select>
                    </label>
                </div>
                {applications.length ? (
                    visibleApplications.length ? <>
                    <div className="divide-y divide-gray-100 md:hidden">
                        {visibleApplications.map((application) => (
                            <article key={application.id} className="space-y-3 p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <h4 className="font-semibold text-gray-950">{application.leave_type_name}</h4>
                                        <p className="mt-1 text-sm text-gray-600">{formatDate(application.start_date)} – {formatDate(application.end_date)}</p>
                                    </div>
                                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[application.status]}`}>{application.status}</span>
                                </div>
                                <p className="text-sm text-gray-600">{application.days} working days</p>
                                <LeaveAttachmentLinks application={application} onError={(message) => addToast(message, 'error')} />
                                {application.reviewer_note && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{application.reviewer_note}</p>}
                                {application.status === 'approved' && <button type="button" onClick={() => void printForm(application)} className="text-sm font-semibold text-brand">Open approved leave PDF</button>}
                                {application.status === 'pending' && <button type="button" onClick={() => cancel(application)} className="text-sm font-semibold text-red-700">Cancel request</button>}
                                {(application.status === 'cancelled' || application.status === 'rejected') && <button type="button" onClick={() => archive(application)} className="text-sm font-semibold text-gray-600">Archive</button>}
                            </article>
                        ))}
                    </div>
                    <div className="hidden overflow-x-auto md:block">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="px-4 py-2">Type</th>
                                    <th className="px-4 py-2">Dates</th>
                                    <th className="px-4 py-2">Days</th>
                                    <th className="px-4 py-2">Status</th>
                                    <th className="px-4 py-2">Decision</th>
                                    <th className="px-4 py-2" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {visibleApplications.map((application) => (
                                    <tr key={application.id}>
                                        <td className="px-4 py-2 font-medium text-gray-900">
                                            {application.leave_type_name}
                                            <LeaveAttachmentLinks application={application} onError={(message) => addToast(message, 'error')} />
                                        </td>
                                        <td className="px-4 py-2 text-gray-600">
                                            {formatDate(application.start_date)} – {formatDate(application.end_date)}
                                        </td>
                                        <td className="px-4 py-2 text-gray-600">{application.days}</td>
                                        <td className="px-4 py-2">
                                            <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[application.status]}`}>
                                                {application.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2 text-gray-600">
                                            {application.reviewer_note || (application.reviewed_at ? '—' : '')}
                                        </td>
                                        <td className="px-4 py-2 text-right">
                                            {application.status === 'approved' && (
                                                <button type="button" onClick={() => void printForm(application)} className="text-sm font-medium text-brand hover:underline">
                                                    Open approved leave PDF
                                                </button>
                                            )}
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
                                                    className="text-sm font-medium text-gray-500 hover:underline"
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
                    </> : <div className="p-5"><EmptyState title="No applications match this status" detail="Choose another status to see more requests." /></div>
                ) : (
                    <div className="p-4">
                        <EmptyState title="No leave applications yet" detail="Your applications will appear here." />
                    </div>
                )}
            </div>
        </div>
    );
}

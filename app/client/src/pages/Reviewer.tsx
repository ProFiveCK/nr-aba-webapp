import { useState, useEffect, useMemo, useCallback } from 'react';
import { apiClient } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import type { BatchDetail, BatchStage } from './MyBatches/types';
import type { HeaderData, Transaction as GeneratorTransaction } from './Generator/types';
import {
    downloadBase64File,
    formatIsoDateTime,
    formatMoney,
    formatPdNumber,
    formatBatchCode,
    getBatchStageBadgeClasses,
    toBase64,
} from '../lib/utils';
import { CREDIT_CODE_SET, CREDIT_TXN_CODES, HEADER_PRESETS, STAGE_META, STAGE_TRANSITIONS } from '../lib/constants';
import { buildAbaFile } from '../lib/generator-utils';

interface ReviewerProps {
    onTabChange?: (tab: string) => void;
}

interface ArchiveEntry {
    code: string;
    root_batch_id: string;
    department_code: string | null;
    file_name: string | null;
    created_at: string;
    stage: BatchStage;
    stage_updated_at: string | null;
    pd_number: string | null;
    submitted_email: string | null;
    submitted_by: number | null;
    is_draft: boolean;
    transactions?: BatchDetail['transactions'];
}

interface ReviewEvent {
    id: number;
    reviewer: string | null;
    status: string;
    comments: string | null;
    created_at: string;
    stage?: string | null;
    metadata?: Record<string, unknown> | null;
}

const ARCHIVE_LIMIT = 40;
type DecisionType = 'approved' | 'rejected';

type PayloadTransaction = {
    bsb?: string;
    account?: string;
    amount?: number | string;
    cents?: number;
    accountTitle?: string;
    lodgementRef?: string;
    txnCode?: string;
};

export function Reviewer({ onTabChange }: ReviewerProps) {
    const { user } = useAuth();
    const { addToast } = useToast();
    const [showFullArchive, setShowFullArchive] = useState(false);
    const [archives, setArchives] = useState<ArchiveEntry[]>([]);
    const [archivesLoading, setArchivesLoading] = useState(true);
    const [archivesError, setArchivesError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    const [selectedBatch, setSelectedBatch] = useState<BatchDetail | null>(null);
    const [reviewHistory, setReviewHistory] = useState<ReviewEvent[]>([]);
    const [detailError, setDetailError] = useState('');
    const [detailLoading, setDetailLoading] = useState(false);

    const [comments, setComments] = useState('');
    const [notifySubmitter, setNotifySubmitter] = useState(true);
    const [actionError, setActionError] = useState('');
    const [actionLoading, setActionLoading] = useState(false);
    const [valueDateModalOpen, setValueDateModalOpen] = useState(false);
    const [valueDateProc, setValueDateProc] = useState('');
    const [valueDateDesc, setValueDateDesc] = useState('');
    const [valueDateRemitter, setValueDateRemitter] = useState('');
    const [valueDateLoading, setValueDateLoading] = useState(false);
    const [valueDateError, setValueDateError] = useState('');

    const fetchArchives = useCallback(async (full: boolean) => {
        setArchivesLoading(true);
        setArchivesError('');
        try {
            const query = full ? '/archives?scope=all' : `/archives?limit=${ARCHIVE_LIMIT}`;
            const data = await apiClient.get<ArchiveEntry[]>(query);
            setArchives(Array.isArray(data) ? data : []);
        } catch (err) {
            const message = (err as Error)?.message || 'Failed to load archives.';
            setArchivesError(message);
            setArchives([]);
        } finally {
            setArchivesLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchArchives(showFullArchive);
    }, [fetchArchives, showFullArchive]);

    const filteredArchives = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return archives;
        return archives.filter((archive) => {
            const meta = archive.transactions as Record<string, unknown> | undefined;
            const preparedBy = (meta?.prepared_by as string) || '';
            const haystack = [
                archive.code,
                archive.pd_number,
                archive.department_code,
                archive.submitted_email,
                archive.stage,
                preparedBy,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            const compactTerm = term.replace(/[^a-z0-9]/g, '');
            const compactHaystack = haystack.replace(/[^a-z0-9]/g, '');
            return haystack.includes(term) || compactHaystack.includes(compactTerm);
        });
    }, [archives, searchTerm]);

    const loadBatch = useCallback(
        async (rawCode: string, silent = false) => {
            const trimmed = rawCode.trim();
            if (!trimmed) {
                if (!silent) setDetailError('Select a batch from the archive below.');
                return;
            }
            const formatted = formatBatchCode(trimmed);
            setDetailLoading(true);
            if (!silent) setDetailError('');
            try {
                const batch = await apiClient.get<BatchDetail>(`/batches/${encodeURIComponent(formatted)}`);
                const history = await apiClient.get<ReviewEvent[]>(`/reviews/${batch.batch_id}`);
                setDetailError('');
                setSelectedBatch(batch);
                setReviewHistory(Array.isArray(history) ? history : []);
                setComments('');
                setNotifySubmitter(true);
                setActionError('');
            } catch (err) {
                const message = (err as Error)?.message || 'Unable to load batch.';
                if (!silent) setDetailError(message);
                if (!silent) {
                    setSelectedBatch(null);
                    setReviewHistory([]);
                }
            } finally {
                setDetailLoading(false);
            }
        },
        []
    );

    const handleArchiveSelect = (code: string) => loadBatch(code);

    const stage = selectedBatch?.stage || 'submitted';
    const stageInfo = STAGE_META[stage] || { label: stage, classes: 'bg-gray-100 text-gray-700' };
    const baseTransitions = STAGE_TRANSITIONS[stage as keyof typeof STAGE_TRANSITIONS] || { approve: false, reject: false };
    const isReviewerRole = user?.role === 'admin' || user?.role === 'reviewer';
    const canApprove = !!baseTransitions.approve;
    const canReject = stage === 'approved' ? Boolean(isReviewerRole) : !!baseTransitions.reject;

    const submitDecision = async (next: DecisionType) => {
        if (!selectedBatch) return;
        const trimmedComments = comments.trim();
        if (next === 'rejected' && !trimmedComments) {
            setActionError('Provide a reason when rejecting a batch.');
            return;
        }
        setActionLoading(true);
        setActionError('');
        try {
            await apiClient.patch(`/batches/${encodeURIComponent(selectedBatch.code)}/stage`, {
                stage: next,
                comments: trimmedComments || undefined,
                notify: next === 'rejected' ? notifySubmitter : undefined,
            });
            await fetchArchives(showFullArchive);
            await loadBatch(selectedBatch.code, true);
            setComments('');
        } catch (err) {
            setActionError((err as Error)?.message || 'Unable to record decision.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleDownloadAba = () => {
        if (!selectedBatch?.file_base64) {
            setDetailError('ABA file becomes available once the batch is approved.');
            return;
        }
        const filename = selectedBatch.file_name || `${formatBatchCode(selectedBatch.code)}.aba`;
        downloadBase64File(selectedBatch.file_base64, filename);
    };

    const handleOpenInReader = () => {
        if (!selectedBatch?.file_base64) {
            setDetailError('ABA file becomes available once the batch is approved.');
            return;
        }
        localStorage.setItem('aba_reader_import', selectedBatch.file_base64);
        onTabChange?.('reader');
    };

    const metrics = selectedBatch?.transactions?.metrics;
    const duplicates = selectedBatch?.transactions?.duplicates as { sets?: number; rows?: number } | undefined;
    const payloadHeader = selectedBatch?.transactions?.payload?.header as Record<string, unknown> | undefined;
    const payloadTransactions = selectedBatch?.transactions?.payload?.transactions as PayloadTransaction[] | undefined;
    const traceBsb = (payloadHeader?.trace_bsb as string | undefined) || '';
    const traceAcct = (payloadHeader?.trace_acct as string | undefined) || '';
    const balanceBsb = (payloadHeader?.balance_bsb as string | undefined) || '';
    const balanceAcct = (payloadHeader?.balance_acct as string | undefined) || '';
    const presetMatch = useMemo(() => {
        const traceDigits = normalizeBsb(traceBsb);
        const traceAcctDigits = normalizeAccount(traceAcct);
        const balanceDigits = normalizeBsb(balanceBsb);
        const balanceAcctDigits = normalizeAccount(balanceAcct);
        if (!traceDigits && !traceAcctDigits && !balanceDigits && !balanceAcctDigits) return null;
        for (const [name, preset] of Object.entries(HEADER_PRESETS)) {
            const presetTraceDigits = normalizeBsb(preset.trace_bsb);
            const presetTraceAcctDigits = normalizeAccount(preset.trace_acct);
            const presetBalDigits = normalizeBsb(preset.balance_bsb);
            const presetBalAcctDigits = normalizeAccount(preset.balance_acct);
            const matchesTrace =
                traceDigits &&
                traceAcctDigits &&
                traceDigits === presetTraceDigits &&
                traceAcctDigits === presetTraceAcctDigits;
            const matchesBal =
                balanceDigits &&
                balanceAcctDigits &&
                balanceDigits === presetBalDigits &&
                balanceAcctDigits === presetBalAcctDigits;
            if (matchesTrace || matchesBal) {
                return { name, preset };
            }
        }
        return null;
    }, [traceBsb, traceAcct, balanceBsb, balanceAcct]);
    const detailRows = useMemo(() => {
        if (!selectedBatch) return [];
        const rows: { label: string; value: string }[] = [
            { label: 'PD Number', value: selectedBatch.pd_number ? formatPdNumber(selectedBatch.pd_number) : '—' },
            { label: 'Department', value: selectedBatch.department_code || '—' },
            { label: 'Submitted By', value: selectedBatch.submitted_email || '—' },
            { label: 'Created', value: formatIsoDateTime(selectedBatch.created_at) },
            { label: 'Transactions', value: String(metrics?.transactionCount ?? '—') },
            { label: 'Total Credits', value: formatMoney(metrics?.creditsCents ?? null) },
        ];
        if (presetMatch) rows.push({ label: 'Bank preset', value: presetMatch.name });
        if (duplicates && (duplicates.sets || duplicates.rows)) {
            rows.push({
                label: 'Duplicate sets',
                value: `${duplicates.sets ?? 0} set(s) • ${duplicates.rows ?? 0} row(s)`,
            });
        }
        const processingDateValue = (payloadHeader?.proc as string | undefined) || '';
        if (processingDateValue) rows.push({ label: 'Processing date', value: processingDateValue });
        return rows;
    }, [selectedBatch, metrics, duplicates, payloadHeader, presetMatch]);

    const openValueDateModal = () => {
        if (!payloadHeader) return;
        const headerProc = typeof payloadHeader['proc'] === 'string' ? (payloadHeader['proc'] as string) : '';
        const headerDesc = typeof payloadHeader['desc'] === 'string' ? (payloadHeader['desc'] as string) : '';
        const headerRemitter = typeof payloadHeader['remitter'] === 'string' ? (payloadHeader['remitter'] as string) : '';
        setValueDateProc(headerProc);
        setValueDateDesc(headerDesc);
        setValueDateRemitter(headerRemitter);
        setValueDateError('');
        setValueDateModalOpen(true);
    };

    const handleValueDateSubmit = async () => {
        if (!selectedBatch || !payloadHeader) return;
        const trimmedProc = valueDateProc.trim();
        if (!/^\d{6}$/.test(trimmedProc)) {
            setValueDateError('Processing date must be DDMMYY (6 digits).');
            return;
        }
        const normalizedTransactions = normalizePayloadTransactions(payloadTransactions);
        if (!normalizedTransactions.length) {
            setValueDateError('Original transaction payload not available.');
            return;
        }
        const headerData = buildHeaderDataFromPayload(payloadHeader);
        headerData.proc = trimmedProc;
        const sanitizedDesc = valueDateDesc.trim().slice(0, 12);
        const sanitizedRemitter = valueDateRemitter.trim().slice(0, 16);
        if (sanitizedDesc) headerData.desc = sanitizedDesc;
        if (sanitizedRemitter) headerData.remitter = sanitizedRemitter;
        try {
            setValueDateLoading(true);
            const abaText = buildAbaFile(headerData, normalizedTransactions);
            const abaBase64 = toBase64(abaText);
            await apiClient.patch(`/batches/${encodeURIComponent(selectedBatch.code)}/value-date`, {
                proc: trimmedProc,
                desc: sanitizedDesc || undefined,
                remitter: sanitizedRemitter || undefined,
                aba_content: abaBase64,
            });
            addToast('Processing date updated successfully.', 'success');
            setValueDateModalOpen(false);
            await loadBatch(selectedBatch.code, true);
        } catch (err) {
            setValueDateError((err as Error)?.message || 'Unable to update processing date.');
        } finally {
            setValueDateLoading(false);
        }
    };

    return (
        <>
        <div className="space-y-6">
            <section className="bg-white shadow rounded-2xl p-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Reviewer Tools</h1>
                        <p className="text-sm text-gray-600">Review batches, inspect their ABA payloads, and keep the audit trail current.</p>
                    </div>
                </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div className="space-y-6">
                    <section className="bg-white shadow rounded-2xl p-6 min-h-[360px]">
                        <div className="space-y-1">
                            <h2 className="text-lg font-semibold text-gray-900">Batch Details</h2>
                            <p className="text-sm text-gray-500">Select a batch from the archive to populate the details below.</p>
                        </div>
                        {detailError && <p className="mt-2 text-sm text-red-600">{detailError}</p>}
                        {detailLoading ? (
                            <div className="mt-6 flex h-40 items-center justify-center text-gray-500">Loading batch…</div>
                        ) : !selectedBatch ? (
                            <p className="mt-6 text-sm text-gray-500">No batch selected yet. Use the archive below to load one.</p>
                        ) : (
                            <div className="mt-6 space-y-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="text-sm text-gray-500">Batch Code</p>
                                        <h3 className="text-xl font-semibold text-gray-900">{formatBatchCode(selectedBatch.code)}</h3>
                                    </div>
                                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${stageInfo.classes}`}>
                                        {stageInfo.label}
                                    </span>
                                </div>
                                {detailRows.length > 0 && (
                                    <div className="rounded-xl border border-gray-100 bg-white/80">
                                        {detailRows.map((row) => (
                                            <div key={row.label} className="grid grid-cols-1 gap-1 border-t border-gray-100 px-4 py-3 text-sm text-gray-700 first:border-t-0 sm:grid-cols-[160px_minmax(0,1fr)]">
                                                <dt className="text-gray-500">{row.label}</dt>
                                                <dd className="font-medium text-gray-900">{row.value}</dd>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={handleDownloadAba}
                                        className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-amber-400"
                                    >
                                        Download ABA
                                    </button>
                                    <button
                                        onClick={handleOpenInReader}
                                        className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                    >
                                        Open in Reader
                                    </button>
                                    {payloadHeader && isReviewerRole && (
                                        <button
                                            onClick={openValueDateModal}
                                            className="rounded-md border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50"
                                        >
                                            Adjust processing date
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </section>

                    <section className="bg-white shadow rounded-2xl p-6">
                        <h3 className="text-lg font-semibold text-gray-900">Reviewer History</h3>
                        {reviewHistory.length === 0 ? (
                            <p className="mt-2 text-sm text-gray-500">No reviewer activity recorded yet.</p>
                        ) : (
                            <ol className="mt-4 space-y-3 text-sm text-gray-700">
                                {reviewHistory.map((event) => (
                                    <li key={event.id} className="rounded-lg border border-gray-200 p-3">
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold">{event.reviewer || 'Reviewer'}</span>
                                            <span className="text-xs text-gray-500">{formatIsoDateTime(event.created_at)}</span>
                                        </div>
                                        <p className="text-xs uppercase tracking-wide text-gray-500">{event.stage || event.status}</p>
                                        {event.comments && <p className="mt-1 text-gray-700">{event.comments}</p>}
                                    </li>
                                ))}
                            </ol>
                        )}
                    </section>
                </div>

                <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-indigo-50 p-6 shadow">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-indigo-900">Record Decision</h3>
                        {selectedBatch && (
                            <span className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Action Required</span>
                        )}
                    </div>
                    {!selectedBatch ? (
                        <p className="mt-3 text-sm text-indigo-700">Select a batch to enable reviewer actions.</p>
                    ) : (
                        <div className="mt-4 space-y-4">
                            <div>
                                <label className="text-sm font-medium text-gray-700" htmlFor="reviewer-comments">
                                    Reviewer comments
                                </label>
                                <textarea
                                    id="reviewer-comments"
                                    rows={4}
                                    value={comments}
                                    onChange={(e) => setComments(e.target.value)}
                                    className="mt-1 w-full rounded-md border border-indigo-200 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    placeholder="Add context for your decision…"
                                />
                            </div>
                            {selectedBatch.stage === 'approved' && isReviewerRole && (
                                <p className="rounded-md bg-white/70 px-3 py-2 text-xs text-gray-600">
                                    This batch was previously approved. You can revert it to <strong>rejected</strong> if further changes are required.
                                </p>
                            )}
                            {selectedBatch && comments.trim() === '' && (
                                <p className="text-xs text-gray-500">Comments are optional when approving, but required when rejecting.</p>
                            )}
                            {decisionHint(canApprove, canReject)}
                            <div className="flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={() => submitDecision('approved')}
                                    disabled={!canApprove || actionLoading}
                                    className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {actionLoading ? 'Saving…' : 'Approve Batch'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => submitDecision('rejected')}
                                    disabled={!canReject || actionLoading}
                                    className="flex-1 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {actionLoading ? 'Saving…' : 'Reject Batch'}
                                </button>
                            </div>
                            {selectedBatch.stage === 'rejected' && (
                                <p className="text-xs text-gray-500">
                                    Need to leave an internal note? Add it to the comments above and click <strong>Approve</strong> once the batch is ready again.
                                </p>
                            )}
                            {decisionHintMessage(actionError)}
                            {selectedBatch && user?.role === 'admin' && (
                                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                    <input
                                        type="checkbox"
                                        checked={notifySubmitter}
                                        onChange={(e) => setNotifySubmitter(e.target.checked)}
                                    />
                                    Email submitter when rejecting
                                </label>
                            )}
                        </div>
                    )}
                </section>
            </div>

            <section className="bg-white shadow rounded-2xl p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">Recent Archives</h2>
                        <p className="text-sm text-gray-500">
                            {showFullArchive ? 'Full archive view' : 'Showing latest entries'} · {filteredArchives.length} of {archives.length}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <input
                            type="search"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search code or PD#"
                            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <button
                            type="button"
                            onClick={() => setShowFullArchive((prev) => !prev)}
                            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            {showFullArchive ? 'Show recent only' : 'Load full archive'}
                        </button>
                        <button
                            type="button"
                            onClick={() => fetchArchives(showFullArchive)}
                            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            Refresh
                        </button>
                    </div>
                </div>
                {archivesError && <p className="mt-3 text-sm text-red-600">{archivesError}</p>}
                <div className="mt-4 overflow-hidden rounded-xl border border-gray-100">
                    <div className="max-h-[420px] overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                                <tr>
                                    <th className="px-3 py-2">Code</th>
                                    <th className="px-3 py-2">Stage</th>
                                    <th className="px-3 py-2">PD#</th>
                                    <th className="px-3 py-2">Department</th>
                                    <th className="px-3 py-2">Prepared</th>
                                    <th className="px-3 py-2">Submitted</th>
                                    <th className="px-3 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {archivesLoading ? (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                                            Loading archives…
                                        </td>
                                    </tr>
                                ) : filteredArchives.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                                            {searchTerm ? 'No archives match your search.' : 'No archives available yet.'}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredArchives.map((archive) => {
                                        const formattedCode = formatBatchCode(archive.code);
                                        const badge = getBatchStageBadgeClasses(archive.stage);
                                        const isSelected = selectedBatch?.code === archive.code;
                                        const meta = archive.transactions as Record<string, unknown> | undefined;
                                        const preparedBy = (meta?.prepared_by as string) || '—';
                                        return (
                                            <tr key={archive.code} className={isSelected ? 'bg-indigo-50/60' : undefined}>
                                                <td className="px-3 py-2 font-mono text-indigo-600">{formattedCode}</td>
                                                <td className="px-3 py-2">
                                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badge}`}>
                                                        {STAGE_META[archive.stage]?.label || archive.stage}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2">{archive.pd_number ? formatPdNumber(archive.pd_number) : '—'}</td>
                                                <td className="px-3 py-2">{archive.department_code || '—'}</td>
                                                <td className="px-3 py-2">{preparedBy}</td>
                                                <td className="px-3 py-2 text-sm text-gray-500">{formatIsoDateTime(archive.created_at)}</td>
                                                <td className="px-3 py-2 text-right">
                                                    <button
                                                        onClick={() => handleArchiveSelect(archive.code)}
                                                        className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
                                                    >
                                                        View
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>
        </div>

        {valueDateModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4 py-6" onClick={() => setValueDateModalOpen(false)}>
                <div
                    className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-start justify-between">
                        <div>
                            <h3 className="text-xl font-semibold text-gray-900">Adjust processing date</h3>
                            <p className="text-sm text-gray-500 mt-1">
                                Update the value date the bank will use. Enter DDMMYY (six digits) and optionally adjust the description or remitter.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setValueDateModalOpen(false)}
                            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                        >
                            ×
                        </button>
                    </div>

                    <div className="mt-4 space-y-3">
                        <label className="text-sm font-medium text-gray-700">
                            Processing date (DDMMYY)
                            <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                value={valueDateProc}
                                onChange={(e) => setValueDateProc(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder="e.g. 150325"
                            />
                        </label>
                        <label className="text-sm font-medium text-gray-700">
                            Description (optional, max 12 chars)
                            <input
                                type="text"
                                maxLength={12}
                                value={valueDateDesc}
                                onChange={(e) => setValueDateDesc(e.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                        </label>
                        <label className="text-sm font-medium text-gray-700">
                            Remitter (optional, max 16 chars)
                            <input
                                type="text"
                                maxLength={16}
                                value={valueDateRemitter}
                                onChange={(e) => setValueDateRemitter(e.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                        </label>
                        {valueDateError && <p className="text-sm text-rose-600">{valueDateError}</p>}
                        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end pt-2">
                            <button
                                type="button"
                                onClick={() => setValueDateModalOpen(false)}
                                className="rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                disabled={valueDateLoading}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleValueDateSubmit}
                                disabled={valueDateLoading}
                                className="rounded-full bg-amber-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-amber-400 disabled:opacity-60"
                            >
                                {valueDateLoading ? 'Saving…' : 'Update date'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
        </>
    );
}

function normalizeBsb(value?: string) {
    if (!value) return '';
    return value.replace(/[^0-9]/g, '').slice(0, 6);
}

function normalizeAccount(value?: string) {
    if (!value) return '';
    return value.replace(/[^0-9]/g, '').slice(0, 16);
}

function decisionHint(canApprove: boolean, canReject: boolean) {
    if (!canApprove && !canReject) {
        return <p className="text-xs text-gray-500">This batch is locked; no further actions are available.</p>;
    }
    if (!canApprove) {
        return <p className="text-xs text-gray-500">Approval is not available from the current stage.</p>;
    }
    if (!canReject) {
        return <p className="text-xs text-gray-500">Rejection is not available from the current stage.</p>;
    }
    return null;
}

function decisionHintMessage(actionError: string) {
    return actionError ? <p className="text-sm text-rose-600">{actionError}</p> : null;
}

function normalizePayloadTransactions(items?: PayloadTransaction[]): GeneratorTransaction[] {
    if (!Array.isArray(items)) return [];
    return items
        .map((tx) => {
            const rawCode = (tx.txnCode || '53').toString();
            const creditCode = CREDIT_CODE_SET.has(rawCode as typeof CREDIT_TXN_CODES[number])
                ? (rawCode as typeof CREDIT_TXN_CODES[number])
                : '53';
            const numericAmount =
                typeof tx.amount === 'number'
                    ? tx.amount
                    : typeof tx.amount === 'string'
                    ? Number(tx.amount)
                    : undefined;
            const centsAmount = typeof tx.cents === 'number' ? tx.cents / 100 : undefined;
            const amount = centsAmount ?? numericAmount ?? 0;
            return {
                bsb: tx.bsb || '',
                account: tx.account || '',
                amount,
                accountTitle: tx.accountTitle || '',
                lodgementRef: tx.lodgementRef || '',
                txnCode: creditCode,
            };
        })
        .filter((tx) => tx.bsb && tx.account && tx.amount > 0);
}

function buildHeaderDataFromPayload(payloadHeader?: Record<string, unknown>): HeaderData {
    const preset = HEADER_PRESETS['CBA-RON'];
    const fallbackProc = typeof preset.proc === 'string' ? preset.proc : '';
    const getString = (key: string, fallback: string) => {
        if (!payloadHeader) return fallback;
        const value = payloadHeader[key];
        if (typeof value === 'string' || typeof value === 'number') return String(value);
        return fallback;
    };
    const getBoolean = (key: string, fallback: boolean) => {
        if (!payloadHeader) return fallback;
        const value = payloadHeader[key];
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['true', 't', '1', 'yes', 'y'].includes(normalized)) return true;
            if (['false', 'f', '0', 'no', 'n'].includes(normalized)) return false;
        }
        return fallback;
    };
    return {
        fi: getString('fi', preset.fi),
        reel: getString('reel', preset.reel),
        user: getString('user', preset.user),
        apca: getString('apca', preset.apca),
        desc: getString('desc', preset.desc),
        proc: getString('proc', fallbackProc),
        trace_bsb: getString('trace_bsb', preset.trace_bsb),
        trace_acct: getString('trace_acct', preset.trace_acct),
        remitter: getString('remitter', preset.remitter),
        balance_required: getBoolean('balance_required', Boolean(preset.balance_required)),
        balance_txn_code: getString('balance_txn_code', preset.balance_txn_code || '13'),
        balance_bsb: getString('balance_bsb', preset.balance_bsb),
        balance_acct: getString('balance_acct', preset.balance_acct),
        balance_title: getString('balance_title', preset.balance_title),
    };
}

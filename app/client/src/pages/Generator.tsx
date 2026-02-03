import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { HeaderForm } from './Generator/HeaderForm';
import { TransactionTable } from './Generator/TransactionTable';
import { TransactionToolbar } from './Generator/TransactionToolbar';
import { ValidationAlerts } from './Generator/ValidationAlerts';
import type { Transaction, HeaderData, SortState, BatchMetrics } from './Generator/types';
import { HEADER_PRESETS } from '../lib/constants';
import { formatMoney, toBase64, downloadBase64File, formatBatchCode } from '../lib/utils';
import { parseTransactionsFromCSV, exportTransactionsToCSV, buildAbaFile, recomputeDuplicates } from '../lib/generator-utils';
import { refreshActiveBlacklist, findBlockedTransactions, getBlockedIndexSet } from '../lib/blacklist';
import { apiClient } from '../lib/api';

const generateRootBatchId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    
    // Fallback: Generate a valid UUID v4 manually
    // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const hex = '0123456789abcdef';
    let uuid = '';
    for (let i = 0; i < 36; i++) {
        if (i === 8 || i === 13 || i === 18 || i === 23) {
            uuid += '-';
        } else if (i === 14) {
            uuid += '4'; // Version 4
        } else if (i === 19) {
            uuid += hex[(Math.random() * 4 | 8)]; // Variant bits (10xx)
        } else {
            uuid += hex[Math.random() * 16 | 0];
        }
    }
    return uuid;
};
interface PendingBatch {
    base64: string;
    filename: string;
    localId: string;
    summary: {
        transactions: number;
        creditsCents: number;
        duplicateSets: number;
        duplicateRows: number;
    };
}

interface CommitFormState {
    deptCode: string;
    paymentReference: string;
    useManualReference: boolean;
    manualReference: string;
    notes: string;
}

const INITIAL_COMMIT_FORM: CommitFormState = {
    deptCode: '',
    paymentReference: '',
    useManualReference: false,
    manualReference: '',
    notes: '',
};

export function Generator() {
    const { user } = useAuth();
    const { addToast } = useToast();
    const [rootBatchId, setRootBatchId] = React.useState(() => {
        if (typeof window === 'undefined') return generateRootBatchId();
        const stored = localStorage.getItem('aba-root-batch-id');
        // Validate stored UUID format (must match backend UUID_REGEX)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (stored && uuidRegex.test(stored)) {
            return stored;
        }
        // Invalid or missing - generate new one
        return generateRootBatchId();
    });
    const [headerData, setHeaderData] = React.useState<HeaderData>(() => {
        // Try to load from localStorage first
        try {
            const stored = localStorage.getItem('aba-header');
            if (stored) {
                const savedHeader = JSON.parse(stored);
                // Merge with preset to ensure all fields are present
                const presetKey = (savedHeader.__preset || 'CBA-RON') as keyof typeof HEADER_PRESETS;
                const preset = HEADER_PRESETS[presetKey];
                return {
                    fi: preset.fi,
                    reel: preset.reel,
                    user: savedHeader.user || preset.user,
                    apca: preset.apca,
                    desc: savedHeader.desc || preset.desc,
                    proc: savedHeader.proc || '',
                    trace_bsb: preset.trace_bsb,
                    trace_acct: preset.trace_acct,
                    remitter: savedHeader.remitter || preset.remitter,
                    balance_required: preset.balance_required,
                    balance_txn_code: preset.balance_txn_code,
                    balance_bsb: preset.balance_bsb,
                    balance_acct: preset.balance_acct,
                    balance_title: preset.balance_title,
                };
            }
        } catch (err) {
            console.warn('Failed to load header from localStorage', err);
        }

        // Default to CBA-RON preset
        const preset = HEADER_PRESETS['CBA-RON'];
        return {
            fi: preset.fi,
            reel: preset.reel,
            user: preset.user,
            apca: preset.apca,
            desc: preset.desc,
            proc: '',
            trace_bsb: preset.trace_bsb,
            trace_acct: preset.trace_acct,
            remitter: preset.remitter,
            balance_required: preset.balance_required,
            balance_txn_code: preset.balance_txn_code,
            balance_bsb: preset.balance_bsb,
            balance_acct: preset.balance_acct,
            balance_title: preset.balance_title,
        };
    });

    const [transactions, setTransactions] = React.useState<Transaction[]>(() => {
        // Try to load from localStorage
        try {
            const stored = localStorage.getItem('aba-transactions');
            if (stored) {
                const savedTxs = JSON.parse(stored);
                // Ensure all transactions have correct txnCode
                return savedTxs.map((tx: Transaction) => ({ ...tx, txnCode: '53' }));
            }
        } catch (err) {
            console.warn('Failed to load transactions from localStorage', err);
        }
        return [];
    });
    const [searchTerm, setSearchTerm] = React.useState('');
    const [sortState, setSortState] = React.useState<SortState>({ key: null, direction: 'asc' });
    const [pendingBatch, setPendingBatch] = React.useState<PendingBatch | null>(null);
    const [commitForm, setCommitForm] = React.useState<CommitFormState>({ ...INITIAL_COMMIT_FORM });
    const [commitError, setCommitError] = React.useState('');
    const [commitLoading, setCommitLoading] = React.useState(false);
    const [commitSuccess, setCommitSuccess] = React.useState<{ code: string; filename: string; base64: string } | null>(null);
    const [showClearConfirm, setShowClearConfirm] = React.useState(false);

    // Persist root batch ID
    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        if (rootBatchId) {
            localStorage.setItem('aba-root-batch-id', rootBatchId);
        }
    }, [rootBatchId]);

    // Check for imported data from Reader on mount
    React.useEffect(() => {
        try {
            const importData = localStorage.getItem('aba_generator_import');
            if (importData) {
                const importedTransactions = JSON.parse(importData);
                if (Array.isArray(importedTransactions) && importedTransactions.length > 0) {
                    // Confirm overwrite if we already have data
                    if (transactions.length > 0) {
                        if (!confirm(`Found ${importedTransactions.length} transactions imported from Reader. Overwrite current data?`)) {
                            localStorage.removeItem('aba_generator_import');
                            return;
                        }
                    }

                    setTransactions(importedTransactions);
                    // Clear the import flag
                    localStorage.removeItem('aba_generator_import');
                }
            }
        } catch (err) {
            console.warn('Failed to load imported data', err);
            localStorage.removeItem('aba_generator_import');
        }
    }, []);

    // Save header data to localStorage whenever it changes
    React.useEffect(() => {
        try {
            const toSave = {
                ...headerData,
                __preset: 'CBA-RON', // Track which preset was used
            };
            localStorage.setItem('aba-header', JSON.stringify(toSave));
        } catch (err) {
            console.warn('Failed to save header to localStorage', err);
        }
    }, [headerData]);

    // Save transactions to localStorage whenever they change
    React.useEffect(() => {
        try {
            localStorage.setItem('aba-transactions', JSON.stringify(transactions));
        } catch (err) {
            console.warn('Failed to save transactions to localStorage', err);
        }
    }, [transactions]);

    // Load blacklist on component mount
    React.useEffect(() => {
        refreshActiveBlacklist().catch((err) => {
            console.warn('Failed to load blacklist:', err);
        });
    }, []); // Run once on mount

    const closeCommitModal = () => {
        setPendingBatch(null);
        setCommitForm({ ...INITIAL_COMMIT_FORM });
        setCommitError('');
        setCommitLoading(false);
    };

    const handleCommitFieldChange = <K extends keyof CommitFormState>(field: K, value: CommitFormState[K]) => {
        setCommitForm((prev) => ({ ...prev, [field]: value }));
    };

    // Placeholder handlers
    const handleAddRow = () => {
        setTransactions([
            ...transactions,
            { bsb: '', account: '', amount: 0, accountTitle: '', lodgementRef: '', txnCode: '53' },
        ]);
    };

    const handleClearAll = () => {
        if (transactions.length === 0) return;
        setShowClearConfirm(true);
    };

    const confirmClearAll = () => {
        setTransactions([]);
        setShowClearConfirm(false);
    };

    const cancelClearAll = () => {
        setShowClearConfirm(false);
    };

    const handleTransactionUpdate = (index: number, field: keyof Transaction, value: string | number) => {
        const updated = [...transactions];
        updated[index] = { ...updated[index], [field]: value };
        setTransactions(updated);
    };

    const handleDeleteRow = (index: number) => {
        setTransactions(transactions.filter((_, i) => i !== index));
    };

    const handleSortChange = (key: SortState['key']) => {
        setSortState((prev: SortState) => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
        }));
    };

    const handleImportCSV = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            const text = await file.text();
            const { transactions: imported, errors } = parseTransactionsFromCSV(text);

            if (errors.length > 0) {
                alert(`Import completed with ${errors.length} error(s):\n\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...and ${errors.length - 5} more` : ''}`);
            }

            if (imported.length > 0) {
                setTransactions([...transactions, ...imported]);
            }
        };
        input.click();
    };

    const handleExportCSV = () => {
        const csv = exportTransactionsToCSV(transactions);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleApplyBulkLodgement = (ref: string) => {
        setTransactions(transactions.map((tx) => ({ ...tx, lodgementRef: ref })));
    };

    const handleGenerateABA = async () => {
        if (transactions.length === 0) {
            addToast('Add at least one transaction before generating.', 'error');
            return;
        }

        if (blockedAccounts.length > 0) {
            addToast(
                `Remove ${blockedAccounts.length} blocked account${blockedAccounts.length === 1 ? '' : 's'} before continuing.`,
                'error'
            );
            return;
        }

        if (missingLodgementRefs.length > 0) {
            addToast(
                `Cannot proceed: ${missingLodgementRefs.length} transaction${missingLodgementRefs.length === 1 ? '' : 's'} missing lodgement references.`,
                'error'
            );
            return;
        }

        try {
            const abaContent = buildAbaFile(headerData, transactions);
            const base64 = toBase64(abaContent);
            const filename = `ABA_${headerData.desc || 'BATCH'}_${new Date().toISOString().slice(0, 10)}.aba`;
            const localId = crypto?.randomUUID?.() ?? `batch-${Date.now()}`;

            setPendingBatch({
                base64,
                filename,
                localId,
                summary: {
                    transactions: metrics.transactionCount,
                    creditsCents: metrics.creditsCents,
                    duplicateSets: duplicateGroups.length,
                    duplicateRows: duplicateIndexSet.size,
                },
            });
            setCommitForm({ ...INITIAL_COMMIT_FORM, deptCode: autoDeptCode });
            setCommitError('');
        } catch (error) {
            addToast((error as Error)?.message || 'Unable to generate ABA payload.', 'error');
        }
    };

    // Calculate metrics
    const metrics: BatchMetrics = React.useMemo(() => {
        let creditsCents = 0;
        let transactionCount = 0;
        transactions.forEach((tx) => {
            const amount = parseFloat(String(tx.amount));
            if (!isNaN(amount) && amount > 0) {
                creditsCents += Math.round(amount * 100);
                transactionCount++;
            }
        });
        return { creditsCents, debitsCents: creditsCents, transactionCount };
    }, [transactions]);

    // Validation and duplicate detection
    const { duplicateGroups, duplicateIndexSet } = React.useMemo(
        () => recomputeDuplicates(transactions),
        [transactions]
    );

    const blockedAccounts = React.useMemo(
        () => findBlockedTransactions(transactions),
        [transactions]
    );

    const blockedIndexSet = React.useMemo(
        () => getBlockedIndexSet(transactions),
        [transactions]
    );

    const missingLodgementRefs = transactions.filter((tx) => !tx.lodgementRef || !tx.lodgementRef.trim());

    const canUseManualReference = user?.role === 'admin' || user?.role === 'reviewer';
    const autoDeptCode = (user?.department_code || '').slice(0, 2);
    const mustProvideDept = user?.role === 'user';
    const canEditDeptCode = user?.role !== 'user';

    const handleCommitBatch = async () => {
        if (!pendingBatch) return;
        setCommitError('');

        const deptCodeRaw = commitForm.deptCode.trim();
        const deptCodeNormalized = deptCodeRaw.replace(/\D/g, '').slice(0, 2);
        const deptCode = deptCodeNormalized;
        if (mustProvideDept) {
            if (deptCode.length !== 2) {
                setCommitError('Enter the two-digit Department Head FMIS code.');
                return;
            }
        } else if (deptCodeRaw && deptCode.length !== 2) {
            setCommitError('Department code (if provided) must be two digits.');
            return;
        }

        let pdNumber: string | null = null;
        if (commitForm.useManualReference && canUseManualReference) {
            const manual = commitForm.manualReference.trim().toUpperCase();
            if (!/^(?=.*\d)[A-Z0-9-]{4,16}$/.test(manual)) {
                setCommitError('Manual references must be 4–16 characters (A–Z, numbers, hyphen) and include at least one digit.');
                return;
            }
            pdNumber = manual;
        } else {
            const paymentRef = commitForm.paymentReference.trim();
            if (!/^\d{6}$/.test(paymentRef)) {
                setCommitError('Payment reference must be the six-digit FMIS PD number.');
                return;
            }
            pdNumber = paymentRef;
        }

        if (!commitForm.useManualReference || !canUseManualReference) {
            try {
                const rootQuery = rootBatchId ? `?root_batch_id=${encodeURIComponent(rootBatchId)}` : '';
                const pdCheckPath = `/pd/${encodeURIComponent(pdNumber)}${rootQuery}`;
                await apiClient.get(pdCheckPath);
            } catch (checkError) {
                const status = (checkError as { status?: number })?.status;
                if (status === 404) {
                    console.warn('PD duplication check endpoint unavailable; continuing without remote validation.');
                } else {
                    setCommitError((checkError as Error)?.message || 'This PD number has already been used.');
                    return;
                }
            }
        }

        setCommitLoading(true);
        try {
            const preparedBy = user?.display_name || user?.email || 'ABA User';
            const payload = {
                aba_content: pendingBatch.base64,
                pd_number: pdNumber,
                dept_code: deptCode || undefined,
                root_batch_id: rootBatchId || undefined,
                metadata: {
                    metrics,
                    generated_at: new Date().toISOString(),
                    prepared_by: preparedBy,
                    department_code: deptCode || null,
                    notes: commitForm.notes.trim() || null,
                    manual_reference: commitForm.useManualReference && canUseManualReference ? true : false,
                    payload: {
                        header: headerData,
                        transactions: transactions.map((tx) => ({
                            bsb: tx.bsb || '',
                            account: tx.account || '',
                            amount: Number(tx.amount || 0),
                            accountTitle: tx.accountTitle || '',
                            lodgementRef: tx.lodgementRef || '',
                            txnCode: '53',
                        })),
                    },
                },
                suggested_file_name: pendingBatch.filename,
            };

            const response = await apiClient.post<{ code: string; batch_id: number; file_name: string }>('/batches', payload);
            const successInfo = {
                code: response.code,
                filename: pendingBatch.filename,
                base64: pendingBatch.base64,
            };
            localStorage.removeItem('aba-header');
            localStorage.removeItem('aba-transactions');
            localStorage.removeItem('aba-root-batch-id');
            setTransactions([]);
            setRootBatchId(generateRootBatchId());
            closeCommitModal();
            setCommitSuccess(successInfo);
            addToast(`Batch ${response.code} committed for review.`, 'success');
        } catch (error) {
            const message = (error as Error)?.message || 'Unable to commit batch.';
            if (/pd/i.test(message) && /duplicate/i.test(message)) {
                setCommitError('This PD number already exists. Please request a new PD from FMIS before committing again.');
            } else {
                setCommitError(message);
            }
        } finally {
            setCommitLoading(false);
        }
    };

    const handleDownloadCommittedAba = () => {
        if (!commitSuccess) return;
        downloadBase64File(commitSuccess.base64, commitSuccess.filename);
    };

    const handleDownloadDuplicates = () => {
        if (duplicateIndexSet.size === 0) return;

        const duplicates = transactions.filter((_, idx) => duplicateIndexSet.has(idx));
        if (duplicates.length === 0) return;

        const csvContent = exportTransactionsToCSV(duplicates);
        const base64 = toBase64(csvContent);
        downloadBase64File(base64, 'duplicates.csv');
    };

    return (
        <>
        <div className="space-y-6">
            <section className="rounded-2xl bg-white p-6 shadow space-y-6">
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-bold text-gray-900">Generator</h1>
                    <p className="text-sm text-gray-600">Prepare treasury headers, manage transaction payloads, and produce ABA files for submission.</p>
                </div>
                <HeaderForm headerData={headerData} onHeaderChange={setHeaderData} />
            </section>

            <section className="rounded-2xl bg-white p-6 shadow space-y-4">
                <div className="flex flex-col gap-1">
                    <h2 className="text-lg font-semibold text-gray-900">Transactions</h2>
                    <p className="text-sm text-gray-500">Import, review, and edit the payment lines that will be included in the ABA file.</p>
                </div>
                <TransactionToolbar
                    onImportCSV={handleImportCSV}
                    onExportCSV={handleExportCSV}
                    onAddRow={handleAddRow}
                    onClearAll={handleClearAll}
                    onApplyBulkLodgement={handleApplyBulkLodgement}
                    onSearchChange={setSearchTerm}
                    searchTerm={searchTerm}
                />
                <TransactionTable
                    transactions={transactions}
                    searchTerm={searchTerm}
                    sortState={sortState}
                    onTransactionUpdate={handleTransactionUpdate}
                    onDeleteRow={handleDeleteRow}
                    onSortChange={handleSortChange}
                    duplicateIndexSet={duplicateIndexSet}
                    blockedIndexSet={blockedIndexSet}
                />
                <p className="text-sm font-semibold text-gray-700">
                    Transactions: {metrics.transactionCount} · Credits: {formatMoney(metrics.creditsCents)} · Debits: {formatMoney(metrics.debitsCents)}
                </p>
                <ValidationAlerts
                    blockedAccounts={blockedAccounts}
                    missingLodgementRefs={missingLodgementRefs}
                    duplicateCount={duplicateIndexSet.size}
                    onDownloadDuplicates={handleDownloadDuplicates}
                />
            </section>

            <section className="rounded-2xl bg-white p-6 shadow text-center space-y-3">
                <div>
                    <p className="text-sm text-gray-600">Generate the ABA file once validation issues are cleared.</p>
                </div>
                <button
                    onClick={handleGenerateABA}
                    disabled={transactions.length === 0}
                    className="inline-flex items-center justify-center rounded-full bg-green-600 px-6 py-2 text-base font-semibold text-white shadow hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Generate ABA File
                </button>
                <p className="text-xs text-gray-500">For assistance email Treasury support on <a href="mailto:fmis@naurufinance.info" className="underline">fmis@naurufinance.info</a>.</p>
            </section>
        </div>

        {pendingBatch && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4 py-6">
                <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
                    <div className="flex items-start justify-between">
                        <div>
                            <h3 className="text-2xl font-semibold text-gray-900">Commit Batch for Review</h3>
                            <p className="mt-1 text-xs text-gray-500">Local batch ID: {pendingBatch.localId}</p>
                        </div>
                        <button
                            type="button"
                            className="text-gray-500 hover:text-gray-700"
                            onClick={closeCommitModal}
                            disabled={commitLoading}
                        >
                            ✕
                        </button>
                    </div>

                    <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                        <p className="text-sm font-semibold text-gray-900">Batch summary</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                            <li>Transactions: {pendingBatch.summary.transactions}</li>
                            <li>Total credits: {formatMoney(pendingBatch.summary.creditsCents)}</li>
                            <li>Total debits: {formatMoney(0)}</li>
                            <li>
                                Duplicate sets: {pendingBatch.summary.duplicateSets} (rows affected: {pendingBatch.summary.duplicateRows})
                            </li>
                        </ul>
                        <p className="mt-3 text-xs text-gray-500">
                            Download link appears after the batch is committed, so the archive always matches what was submitted.
                        </p>
                    </div>

                    <div className="mt-4 space-y-4">
                        <label className="text-sm font-medium text-gray-700">
                            Department Head FMIS code {mustProvideDept ? '(first 2 digits)' : '(optional)'}
                            <input
                                type="text"
                                inputMode="numeric"
                                maxLength={2}
                                value={commitForm.deptCode}
                                onChange={(e) => handleCommitFieldChange('deptCode', e.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder="e.g. 12"
                                disabled={commitLoading || (!canEditDeptCode && !!autoDeptCode)}
                            />
                            {!canEditDeptCode && mustProvideDept && (
                                <p className="mt-1 text-xs text-gray-500">Auto-filled from your profile. Contact an administrator to change.</p>
                            )}
                            {!mustProvideDept && (
                                <p className="mt-1 text-xs text-gray-500">Leave blank if this batch is not tied to a single department.</p>
                            )}
                        </label>

                        <label className="text-sm font-medium text-gray-700">
                            Payment reference (PD#)
                            <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                pattern="\d{6}"
                                title="Enter the six-digit FMIS PD number"
                                value={commitForm.paymentReference}
                                onChange={(e) => handleCommitFieldChange('paymentReference', e.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder="123456"
                                disabled={commitLoading || (commitForm.useManualReference && canUseManualReference)}
                            />
                        </label>

                        {canUseManualReference && (
                            <div className="rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
                                <label className="flex items-center gap-2 font-medium">
                                    <input
                                        type="checkbox"
                                        checked={commitForm.useManualReference}
                                        onChange={(e) => handleCommitFieldChange('useManualReference', e.target.checked)}
                                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                        disabled={commitLoading}
                                    />
                                    Use manual reference
                                </label>
                                {commitForm.useManualReference && (
                                    <input
                                        type="text"
                                        value={commitForm.manualReference}
                                        onChange={(e) => handleCommitFieldChange('manualReference', e.target.value)}
                                        className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                        placeholder="Urgent-1234"
                                        disabled={commitLoading}
                                    />
                                )}
                                <p className="mt-1 text-xs text-gray-500">
                                    For urgent payments not yet in FMIS. 4–16 characters (A–Z, numbers, hyphen) and must include at least one digit.
                                </p>
                            </div>
                        )}

                        <label className="text-sm font-medium text-gray-700">
                            Prepared by
                            <input
                                type="text"
                                value={user?.display_name || user?.email || 'ABA User'}
                                className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
                                readOnly
                            />
                        </label>

                        <label className="text-sm font-medium text-gray-700">
                            Notes (optional)
                            <textarea
                                rows={3}
                                value={commitForm.notes}
                                onChange={(e) => handleCommitFieldChange('notes', e.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder="Reference or comments"
                                disabled={commitLoading}
                            />
                        </label>

                        {commitError && <p className="text-sm text-rose-600">{commitError}</p>}

                        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={closeCommitModal}
                                disabled={commitLoading}
                                className="rounded-full border border-gray-300 px-6 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleCommitBatch}
                                disabled={commitLoading}
                                className="rounded-full bg-amber-500 px-6 py-2 text-sm font-semibold text-white shadow hover:bg-amber-400 disabled:opacity-60"
                            >
                                {commitLoading ? 'Committing…' : 'Commit Batch'}
                            </button>
                        </div>
                        <p className="text-center text-xs text-gray-500">Notifications about this batch will be sent to fmis@finance.gov.nr.</p>
                    </div>
                </div>
            </div>
        )}

        {commitSuccess && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4 py-6">
                <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Batch committed</p>
                            <h3 className="text-2xl font-semibold text-gray-900">
                                {formatBatchCode(commitSuccess.code)}
                            </h3>
                            <p className="mt-1 text-sm text-gray-600">
                                Your batch has been submitted to Treasury for review. Please save a copy of the ABA file for your records.
                            </p>
                        </div>
                        <button
                            type="button"
                            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                            onClick={() => setCommitSuccess(null)}
                        >
                            ×
                        </button>
                    </div>
                    <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={handleDownloadCommittedAba}
                            className="rounded-full bg-amber-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-amber-400"
                        >
                            Download ABA file
                        </button>
                        <button
                            type="button"
                            onClick={() => setCommitSuccess(null)}
                            className="rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        )}

        {showClearConfirm && (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/60 px-4 py-6" onClick={cancelClearAll}>
                <div
                    className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-start justify-between">
                        <div>
                            <h3 className="text-2xl font-semibold text-gray-900">Clear all transactions?</h3>
                            <p className="mt-1 text-sm text-gray-600">
                                This will remove every row from the current batch. You can re-import a CSV or add new rows afterwards.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={cancelClearAll}
                            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                        >
                            ×
                        </button>
                    </div>
                    <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={cancelClearAll}
                            className="rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={confirmClearAll}
                            className="rounded-full bg-rose-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-rose-500"
                        >
                            Yes, clear all
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );

}

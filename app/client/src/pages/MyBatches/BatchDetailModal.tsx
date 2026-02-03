import type { BatchDetail } from './types';
import { formatIsoDateTime, formatPdNumber, getBatchStageBadgeClasses, getBatchStageMetadata } from '../../lib/utils';
import { useToast } from '../../contexts/ToastContext';

interface BatchDetailModalProps {
    batch: BatchDetail | null;
    onClose: () => void;
}

export function BatchDetailModal({ batch, onClose }: BatchDetailModalProps) {
    if (!batch) return null;

    const { addToast } = useToast();
    const stageMetadata = getBatchStageMetadata(batch.stage);
    const badgeClasses = getBatchStageBadgeClasses(batch.stage);
    const canLoadInGenerator =
        batch.stage === 'rejected' && Boolean(batch.transactions?.payload?.transactions?.length);

    const handleLoadIntoGenerator = () => {
        const payload = batch.transactions?.payload;
        if (!payload || !Array.isArray(payload.transactions) || !payload.transactions.length || !payload.header) {
            addToast('This batch does not include the original transaction payload.', 'error');
            return;
        }

        try {
            const headerPayload = { ...(payload.header as Record<string, unknown>) };
            if (!headerPayload.__preset) {
                headerPayload.__preset = 'CBA-RON';
            }
            localStorage.setItem('aba-header', JSON.stringify(headerPayload));
            localStorage.setItem('aba-transactions', JSON.stringify(payload.transactions));
            if (batch.root_batch_id) {
                localStorage.setItem('aba-root-batch-id', batch.root_batch_id);
            }
            localStorage.setItem(
                'aba-generator-source',
                JSON.stringify({
                    code: batch.code,
                    loaded_at: new Date().toISOString(),
                })
            );
            addToast('Batch loaded into Generator. Switch to the Generator tab to fix and resubmit.', 'success');
            onClose();
        } catch (err) {
            console.error(err);
            addToast('Unable to load this batch into the Generator.', 'error');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={onClose}>
            <div
                className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-auto m-4"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-4">
                        <h2 className="text-2xl font-bold text-gray-900">
                            Batch {batch.code}
                        </h2>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-600 text-2xl"
                            aria-label="Close"
                        >
                            ×
                        </button>
                    </div>

                    {/* Batch Details */}
                    <div className="space-y-4">
                        {/* Status Badge */}
                        <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${badgeClasses}`}>
                                {stageMetadata.label}
                            </span>
                            {batch.is_draft && (
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-indigo-100 text-indigo-800">
                                    Draft
                                </span>
                            )}
                        </div>

                        {/* Metadata Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="font-semibold text-gray-700">PD Number:</span>
                                <span className="ml-2 text-gray-900">
                                    {batch.pd_number ? formatPdNumber(batch.pd_number) : 'N/A'}
                                </span>
                            </div>
                            <div>
                                <span className="font-semibold text-gray-700">Department:</span>
                                <span className="ml-2 text-gray-900">{batch.department_code || 'N/A'}</span>
                            </div>
                            <div>
                                <span className="font-semibold text-gray-700">Created:</span>
                                <span className="ml-2 text-gray-900">{formatIsoDateTime(batch.created_at)}</span>
                            </div>
                            <div>
                                <span className="font-semibold text-gray-700">Last Updated:</span>
                                <span className="ml-2 text-gray-900">
                                    {formatIsoDateTime(batch.stage_updated_at || batch.created_at)}
                                </span>
                            </div>
                            <div>
                                <span className="font-semibold text-gray-700">File Name:</span>
                                <span className="ml-2 text-gray-900 font-mono text-xs">{batch.file_name}</span>
                            </div>
                            <div>
                                <span className="font-semibold text-gray-700">Batch ID:</span>
                                <span className="ml-2 text-gray-900 font-mono text-xs">
                                    {batch.root_batch_id || 'N/A'}
                                </span>
                            </div>
                            {batch.checksum && (
                                <div className="md:col-span-2">
                                    <span className="font-semibold text-gray-700">Checksum:</span>
                                    <span className="ml-2 text-gray-900 font-mono text-xs break-all">
                                        {batch.checksum}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Metrics */}
                        {batch.transactions?.metrics && (
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="text-sm font-semibold text-gray-800 mb-2">Batch Metrics</h4>
                                <div className="grid grid-cols-3 gap-4 text-sm">
                                    <div>
                                        <div className="text-gray-600">Transactions</div>
                                        <div className="text-lg font-semibold text-gray-900">
                                            {batch.transactions.metrics.transactionCount}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-gray-600">Credits</div>
                                        <div className="text-lg font-semibold text-gray-900">
                                            ${(batch.transactions.metrics.creditsCents / 100).toFixed(2)}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-gray-600">Debits</div>
                                        <div className="text-lg font-semibold text-gray-900">
                                            ${(batch.transactions.metrics.debitsCents / 100).toFixed(2)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Activity History */}
                        <div>
                            <h4 className="text-sm font-semibold text-gray-800 mb-3">Activity History</h4>
                            {batch.history && batch.history.length > 0 ? (
                                <ol className="space-y-3 text-sm border-l-2 border-gray-200 pl-4">
                                    {batch.history.map((event, idx) => (
                                        <li key={idx} className="relative">
                                            <div className="absolute -left-[1.3rem] top-1.5 w-3 h-3 bg-gray-400 rounded-full border-2 border-white" />
                                            <div className="font-medium text-gray-900">
                                                {formatIsoDateTime(event.created_at)} • {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
                                            </div>
                                            <div className="text-gray-600">by {event.reviewer || 'System'}</div>
                                            {event.comments && (
                                                <div className="mt-1 text-gray-700 bg-gray-50 rounded px-3 py-2 border-l-2 border-gray-300">
                                                    {event.comments}
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ol>
                            ) : (
                                <p className="text-sm text-gray-500">No activity recorded yet.</p>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:justify-end mt-6 pt-4 border-t border-gray-200">
                        {canLoadInGenerator && (
                            <button
                                onClick={handleLoadIntoGenerator}
                                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-500 font-medium"
                            >
                                Load in Generator
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 font-medium"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

import { useState } from 'react';
import { formatMoney, formatDate } from '../../lib/utils';
import type { BatchDetail } from '../MyBatches/types';

interface ReviewModalProps {
    batch: BatchDetail;
    onClose: () => void;
    onDecision: (id: string, decision: 'approved' | 'rejected', notes?: string) => Promise<void>;
}

export function ReviewModal({ batch, onClose, onDecision }: ReviewModalProps) {
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [action, setAction] = useState<'approve' | 'reject' | null>(null);

    const handleSubmit = async () => {
        if (!action) return;
        setIsSubmitting(true);
        try {
            await onDecision(batch.root_batch_id, action === 'approve' ? 'approved' : 'rejected', notes);
            onClose();
        } catch (error) {
            console.error('Failed to submit decision:', error);
            alert('Failed to submit decision. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const transactions = batch.transactions?.payload?.transactions || [];
    const metrics = batch.transactions?.metrics;

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={onClose}></div>

                <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

                <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
                    <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                        <div className="sm:flex sm:items-start">
                            <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                                <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                                    Review Batch: {batch.code}
                                </h3>
                                <div className="mt-2">
                                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-500 mb-4 bg-gray-50 p-3 rounded">
                                        <div>
                                            <span className="font-medium">Submitted By:</span> {batch.submitted_email || 'Unknown'}
                                        </div>
                                        <div>
                                            <span className="font-medium">Date:</span> {formatDate(batch.created_at)}
                                        </div>
                                        <div>
                                            <span className="font-medium">Total Amount:</span> {formatMoney(metrics?.creditsCents)}
                                        </div>
                                        <div>
                                            <span className="font-medium">Transaction Count:</span> {metrics?.transactionCount || 0}
                                        </div>
                                    </div>

                                    <h4 className="font-medium text-gray-900 mb-2">Transactions</h4>
                                    <div className="overflow-x-auto border border-gray-200 rounded-md max-h-60 overflow-y-auto">
                                        <table className="min-w-full divide-y divide-gray-200">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">BSB</th>
                                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Account</th>
                                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ref</th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white divide-y divide-gray-200">
                                                {transactions.length > 0 ? (
                                                    transactions.map((tx, idx) => (
                                                        <tr key={idx}>
                                                            <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{tx.bsb}</td>
                                                            <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{tx.account}</td>
                                                            <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{tx.accountTitle}</td>
                                                            <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 text-right">{formatMoney(tx.amount * 100)}</td>
                                                            <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{tx.lodgementRef}</td>
                                                        </tr>
                                                    ))
                                                ) : (
                                                    <tr>
                                                        <td colSpan={5} className="px-3 py-4 text-center text-sm text-gray-500">
                                                            No transaction details available.
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="mt-4">
                                        <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
                                            Review Notes (Optional)
                                        </label>
                                        <textarea
                                            id="notes"
                                            rows={3}
                                            className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 mt-1 block w-full sm:text-sm border border-gray-300 rounded-md"
                                            placeholder="Add any comments about this batch..."
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                        {!action ? (
                            <>
                                <button
                                    type="button"
                                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-green-600 text-base font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 sm:ml-3 sm:w-auto sm:text-sm"
                                    onClick={() => setAction('approve')}
                                >
                                    Approve Batch
                                </button>
                                <button
                                    type="button"
                                    className="mt-3 w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                    onClick={() => setAction('reject')}
                                >
                                    Reject Batch
                                </button>
                                <button
                                    type="button"
                                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                    onClick={onClose}
                                >
                                    Cancel
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    className={`w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm ${action === 'approve' ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500' : 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                                        }`}
                                    onClick={handleSubmit}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? 'Submitting...' : `Confirm ${action === 'approve' ? 'Approval' : 'Rejection'}`}
                                </button>
                                <button
                                    type="button"
                                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                    onClick={() => setAction(null)}
                                    disabled={isSubmitting}
                                >
                                    Back
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

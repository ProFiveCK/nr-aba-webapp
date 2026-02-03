import type { Transaction } from './types';

interface ValidationAlertsProps {
    blockedAccounts: Transaction[];
    missingLodgementRefs: Transaction[];
    duplicateCount: number;
    onDownloadDuplicates?: () => void;
}

export function ValidationAlerts({
    blockedAccounts,
    missingLodgementRefs,
    duplicateCount,
    onDownloadDuplicates,
}: ValidationAlertsProps) {
    if (blockedAccounts.length === 0 && missingLodgementRefs.length === 0 && duplicateCount === 0) {
        return null;
    }

    return (
        <div className="space-y-2 mt-2">
            {/* Blocked Accounts Warning */}
            {blockedAccounts.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <h4 className="text-sm font-semibold text-red-800 mb-1">⚠️ Blocked Accounts Detected</h4>
                    <div className="text-xs text-red-700 space-y-1">
                        {blockedAccounts.slice(0, 5).map((tx, i) => (
                            <div key={i}>
                                • {tx.bsb} / {tx.account} - {tx.accountTitle || 'No title'}
                            </div>
                        ))}
                        {blockedAccounts.length > 5 && (
                            <div className="text-red-600 font-medium">
                                ...and {blockedAccounts.length - 5} more blocked accounts
                            </div>
                        )}
                    </div>
                    <p className="text-xs text-red-600 mt-2">
                        Remove or correct these accounts before generating the ABA file.
                    </p>
                </div>
            )}

            {/* Missing Lodgement References */}
            {missingLodgementRefs.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-md p-3">
                    <h4 className="text-sm font-semibold text-orange-800 mb-1">⚠️ Missing Lodgement References</h4>
                    <div className="text-xs text-orange-700">
                        {missingLodgementRefs.length} transaction(s) missing lodgement references
                    </div>
                    <p className="text-xs text-orange-600 mt-2">
                        All transactions require a Lodgement Reference before generating the ABA file.
                    </p>
                </div>
            )}

            {/* Duplicate Transactions */}
            {duplicateCount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex items-center justify-between gap-4">
                    <div>
                        <p className="font-semibold text-amber-800 text-sm">
                            Duplicate rows detected: {duplicateCount} duplicate transaction(s)
                        </p>
                        <p className="text-xs text-amber-700 mt-1">
                            Resolve duplicates to ensure each payment is unique.
                        </p>
                    </div>
                    {onDownloadDuplicates && (
                        <button
                            onClick={onDownloadDuplicates}
                            className="shrink-0 px-3 py-1.5 bg-white border border-amber-300 text-amber-800 text-xs font-medium rounded hover:bg-amber-100 transition-colors"
                        >
                            Download Duplicates
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

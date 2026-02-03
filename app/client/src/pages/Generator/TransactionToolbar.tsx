import React from 'react';

interface TransactionToolbarProps {
    onImportCSV: () => void;
    onExportCSV: () => void;
    onAddRow: () => void;
    onClearAll: () => void;
    onApplyBulkLodgement: (ref: string) => void;
    onSearchChange: (term: string) => void;
    searchTerm: string;
}

export function TransactionToolbar({
    onImportCSV,
    onExportCSV,
    onAddRow,
    onClearAll,
    onApplyBulkLodgement,
    onSearchChange,
    searchTerm,
}: TransactionToolbarProps) {
    const [bulkRef, setBulkRef] = React.useState('');

    const handleApplyBulk = () => {
        if (bulkRef.trim()) {
            onApplyBulkLodgement(bulkRef.trim());
            setBulkRef('');
        }
    };

    return (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex flex-wrap items-center gap-2">
                <button
                    onClick={onImportCSV}
                    className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
                >
                    Import CSV
                </button>
                <button
                    onClick={onExportCSV}
                    className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
                >
                    Export Filtered CSV
                </button>
                <button
                    onClick={onAddRow}
                    className="px-3 py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600 text-sm"
                >
                    Add Row
                </button>
                <button
                    onClick={onClearAll}
                    className="px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 text-sm"
                >
                    Clear All
                </button>
                <input
                    id="bulk-lodgement-ref"
                    type="text"
                    maxLength={18}
                    value={bulkRef}
                    onChange={(e) => setBulkRef(e.target.value)}
                    placeholder="Lodgement Ref"
                    title="Max 18 characters"
                    className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                    onClick={handleApplyBulk}
                    className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
                    title="Apply the entered value to all rows"
                >
                    Apply to All
                </button>
            </div>
            <div className="flex items-center gap-2">
                <label htmlFor="transaction-search" className="sr-only">
                    Search transactions
                </label>
                <input
                    id="transaction-search"
                    type="search"
                    placeholder="Search transactions"
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-48 sm:w-64"
                    autoComplete="off"
                />
            </div>
        </div>
    );
}

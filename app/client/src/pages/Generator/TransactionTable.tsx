import { useState } from 'react';
import type { Transaction, SortState } from './types';

interface TransactionTableProps {
    transactions: Transaction[];
    searchTerm: string;
    sortState: SortState;
    onTransactionUpdate: (index: number, field: keyof Transaction, value: string | number) => void;
    onDeleteRow: (index: number) => void;
    onSortChange: (key: SortState['key']) => void;
    duplicateIndexSet: Set<number>;
    blockedIndexSet: Set<number>;
}

export function TransactionTable({
    transactions,
    sortState,
    onTransactionUpdate,
    onDeleteRow,
    onSortChange,
    duplicateIndexSet,
    blockedIndexSet,
}: TransactionTableProps) {
    const [amountDrafts, setAmountDrafts] = useState<Record<number, string>>({});
    // Filter and sort logic would go here (simplified for now)
    const filteredTransactions = transactions;

    const renderSortIndicator = (key: SortState['key']) => {
        if (sortState.key !== key) return null;
        return <span className="ml-1">{sortState.direction === 'asc' ? '▲' : '▼'}</span>;
    };

    const formatBsbValue = (value: string): string => {
        const digitsOnly = value.replace(/\D/g, '').slice(0, 6);
        if (digitsOnly.length <= 3) return digitsOnly;
        return `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3)}`;
    };

    const formatCurrency = (value: number) =>
        new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
            Number.isFinite(value) ? value : 0
        );

    const formatAmountDisplay = (index: number, value: number) => {
        if (amountDrafts[index] !== undefined) return amountDrafts[index];
        return formatCurrency(value);
    };

    const handleAmountChange = (index: number, rawValue: string) => {
        const sanitized = rawValue.replace(/[^0-9.,-]/g, '');
        setAmountDrafts((prev) => ({ ...prev, [index]: sanitized }));
        const parsed = parseFloat(sanitized.replace(/,/g, ''));
        if (!Number.isNaN(parsed)) {
            onTransactionUpdate(index, 'amount', parsed);
        }
    };

    const handleAmountBlur = (index: number) => {
        setAmountDrafts((prev) => {
            const next = { ...prev };
            delete next[index];
            return next;
        });
    };

    return (
        <div className="overflow-x-auto overflow-y-scroll relative shadow-sm sm:rounded-lg max-h-[60vh]">
            <table className="w-full text-sm text-left text-gray-600 border border-gray-300">
                <thead className="text-xs text-gray-700 uppercase bg-gray-200 border-b border-gray-300 sticky top-0 z-10">
                    <tr>
                        <th className="py-2 px-2 border-r border-gray-300 w-12 text-center">Row</th>
                        <th className="py-2 px-2 border-r border-gray-300 w-24">
                            <button
                                type="button"
                                className="font-bold hover:text-indigo-600"
                                onClick={() => onSortChange('bsb')}
                            >
                                BSB{renderSortIndicator('bsb')}
                            </button>
                        </th>
                        <th className="py-2 px-2 border-r border-gray-300 w-32">
                            <button
                                type="button"
                                className="font-bold hover:text-indigo-600"
                                onClick={() => onSortChange('account')}
                            >
                                Account{renderSortIndicator('account')}
                            </button>
                        </th>
                        <th className="text-right py-2 px-2 border-r border-gray-300 w-28">
                            <button
                                type="button"
                                className="font-bold hover:text-indigo-600"
                                onClick={() => onSortChange('amount')}
                            >
                                Amount{renderSortIndicator('amount')}
                            </button>
                        </th>
                        <th className="py-2 px-2 border-r border-gray-300 min-w-[16rem]">
                            <button
                                type="button"
                                className="font-bold hover:text-indigo-600"
                                onClick={() => onSortChange('accountTitle')}
                            >
                                Account Title{renderSortIndicator('accountTitle')}
                            </button>
                        </th>
                        <th className="py-2 px-2 border-r border-gray-300 min-w-[14rem]">
                            <button
                                type="button"
                                className="font-bold hover:text-indigo-600"
                                onClick={() => onSortChange('lodgementRef')}
                            >
                                Lodgement Ref{renderSortIndicator('lodgementRef')}
                            </button>
                        </th>
                        <th className="py-2 px-2 border-r border-gray-300 text-center">Txn Code</th>
                        <th className="py-2 px-2 text-center border-r border-gray-300">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredTransactions.length === 0 ? (
                        <tr>
                            <td colSpan={8} className="text-center py-3 text-gray-500">
                                No transactions added yet.
                            </td>
                        </tr>
                    ) : (
                        filteredTransactions.map((tx, index) => {
                            const isDuplicate = duplicateIndexSet.has(index);
                            const isBlocked = blockedIndexSet.has(index);

                            return (
                                <tr
                                    key={index}
                                    className={`border-b hover:bg-gray-50 ${isBlocked ? 'bg-red-50 border-red-200' : 'bg-white'} ${isDuplicate ? 'border-l-4 border-l-amber-400' : ''
                                        }`}
                                >
                                    <td className="p-2 whitespace-nowrap border-r border-gray-300 text-center text-gray-500">
                                        {index + 1}
                                        {isDuplicate && (
                                            <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 px-1 rounded">dup</span>
                                        )}
                                        {isBlocked && (
                                            <span className="ml-1 text-[10px] bg-red-100 text-red-700 px-1 rounded">blocked</span>
                                        )}
                                    </td>
                                    <td className="p-2 whitespace-nowrap border-r border-gray-300">
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={formatBsbValue(tx.bsb || '')}
                                            onChange={(e) => onTransactionUpdate(index, 'bsb', formatBsbValue(e.target.value))}
                                            className="w-full max-w-[6rem] bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded uppercase"
                                            placeholder="123-456"
                                        />
                                    </td>
                                    <td className="p-2 whitespace-nowrap border-r border-gray-300">
                                        <input
                                            type="text"
                                            value={tx.account}
                                            onChange={(e) => onTransactionUpdate(index, 'account', e.target.value)}
                                            className="w-full max-w-[8rem] bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded"
                                        />
                                    </td>
                                    <td className="p-2 whitespace-nowrap border-r border-gray-300">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={formatAmountDisplay(index, Number(tx.amount || 0))}
                                            onChange={(e) => handleAmountChange(index, e.target.value)}
                                            onBlur={() => handleAmountBlur(index)}
                                            className="w-full bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-indigo-300 text-right px-1 rounded"
                                        />
                                    </td>
                                    <td className="p-2 whitespace-nowrap border-r border-gray-300">
                                        <input
                                            type="text"
                                            value={tx.accountTitle}
                                            onChange={(e) => onTransactionUpdate(index, 'accountTitle', e.target.value)}
                                            className="w-full min-w-[16rem] bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded"
                                        />
                                    </td>
                                    <td className="p-2 whitespace-nowrap border-r border-gray-300">
                                        <input
                                            type="text"
                                            required
                                            maxLength={18}
                                            value={tx.lodgementRef}
                                            onChange={(e) => onTransactionUpdate(index, 'lodgementRef', e.target.value)}
                                            placeholder="Required"
                                            className="w-full min-w-[14rem] bg-transparent border border-transparent focus:border-gray-300 focus:outline-none px-1 rounded"
                                        />
                                    </td>
                                    <td className="p-2 whitespace-nowrap border-r border-gray-300 text-center">
                                        <input
                                            type="text"
                                            value="53"
                                            className="w-16 text-center border-none text-gray-500 cursor-not-allowed bg-gray-100 px-1 rounded"
                                            readOnly
                                            tabIndex={-1}
                                        />
                                    </td>
                                    <td className="p-2 text-center whitespace-nowrap border-r border-gray-300">
                                        <button
                                            onClick={() => onDeleteRow(index)}
                                            className="px-2 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md transition-colors"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
}

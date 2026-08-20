import { useMemo, useState } from 'react';
import { EmptyState, Icon } from '../../components/Ui';
import type { Transaction, SortState } from './types';
import { getVisibleTransactionRows } from './transaction-rows';

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
    searchTerm,
    sortState,
    onTransactionUpdate,
    onDeleteRow,
    onSortChange,
    duplicateIndexSet,
    blockedIndexSet,
}: TransactionTableProps) {
    const [amountDrafts, setAmountDrafts] = useState<Record<number, string>>({});
    const visibleRows = useMemo(
        () => getVisibleTransactionRows(transactions, searchTerm, sortState),
        [transactions, searchTerm, sortState]
    );

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
        <div className="data-table-wrap">
            <div className="data-table-scroll max-h-[60vh]">
            <table className="data-table">
                <thead>
                    <tr>
                        <th className="w-12 text-center">Row</th>
                        <th className="w-24">
                            <button
                                type="button"
                                className="inline-flex items-center font-bold hover:text-indigo-600"
                                onClick={() => onSortChange('bsb')}
                            >
                                BSB{renderSortIndicator('bsb')}
                            </button>
                        </th>
                        <th className="w-32">
                            <button
                                type="button"
                                className="inline-flex items-center font-bold hover:text-indigo-600"
                                onClick={() => onSortChange('account')}
                            >
                                Account{renderSortIndicator('account')}
                            </button>
                        </th>
                        <th className="w-28 text-right">
                            <button
                                type="button"
                                className="inline-flex items-center font-bold hover:text-indigo-600"
                                onClick={() => onSortChange('amount')}
                            >
                                Amount{renderSortIndicator('amount')}
                            </button>
                        </th>
                        <th className="min-w-[16rem]">
                            <button
                                type="button"
                                className="inline-flex items-center font-bold hover:text-indigo-600"
                                onClick={() => onSortChange('accountTitle')}
                            >
                                Account Title{renderSortIndicator('accountTitle')}
                            </button>
                        </th>
                        <th className="min-w-[14rem]">
                            <button
                                type="button"
                                className="inline-flex items-center font-bold hover:text-indigo-600"
                                onClick={() => onSortChange('lodgementRef')}
                            >
                                Lodgement Ref{renderSortIndicator('lodgementRef')}
                            </button>
                        </th>
                        <th className="text-center">Txn Code</th>
                        <th className="text-center">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {visibleRows.length === 0 ? (
                        <tr>
                            <td colSpan={8}>
                                <EmptyState
                                    title={transactions.length === 0 ? 'No transactions added yet.' : 'No transactions match your search.'}
                                    detail={transactions.length === 0 ? 'Add rows manually or import from Reader.' : 'Try a different BSB, account, title, or reference.'}
                                />
                            </td>
                        </tr>
                    ) : (
                        visibleRows.map(({ transaction: tx, originalIndex }) => {
                            const isDuplicate = duplicateIndexSet.has(originalIndex);
                            const isBlocked = blockedIndexSet.has(originalIndex);

                            return (
                                <tr
                                    key={originalIndex}
                                    className={`${isBlocked ? 'bg-red-50 border-red-200' : 'bg-white'} ${isDuplicate ? 'border-l-4 border-l-amber-400' : ''
                                        }`}
                                >
                                    <td className="text-center text-gray-500">
                                        {originalIndex + 1}
                                        {isDuplicate && (
                                            <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 px-1 rounded">dup</span>
                                        )}
                                        {isBlocked && (
                                            <span className="ml-1 text-[10px] bg-red-100 text-red-700 px-1 rounded">blocked</span>
                                        )}
                                    </td>
                                    <td>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={formatBsbValue(tx.bsb || '')}
                                            onChange={(e) => onTransactionUpdate(originalIndex, 'bsb', formatBsbValue(e.target.value))}
                                            className="w-full max-w-[6rem] bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded uppercase"
                                            placeholder="123-456"
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="text"
                                            value={tx.account}
                                            onChange={(e) => onTransactionUpdate(originalIndex, 'account', e.target.value)}
                                            className="w-full max-w-[8rem] bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded"
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={formatAmountDisplay(originalIndex, Number(tx.amount || 0))}
                                            onChange={(e) => handleAmountChange(originalIndex, e.target.value)}
                                            onBlur={() => handleAmountBlur(originalIndex)}
                                            className="w-full bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-indigo-300 text-right px-1 rounded"
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="text"
                                            value={tx.accountTitle}
                                            onChange={(e) => onTransactionUpdate(originalIndex, 'accountTitle', e.target.value)}
                                            className="w-full min-w-[16rem] bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded"
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="text"
                                            required
                                            maxLength={18}
                                            value={tx.lodgementRef}
                                            onChange={(e) => onTransactionUpdate(originalIndex, 'lodgementRef', e.target.value)}
                                            placeholder="Required"
                                            className="w-full min-w-[14rem] bg-transparent border border-transparent focus:border-gray-300 focus:outline-none px-1 rounded"
                                        />
                                    </td>
                                    <td className="text-center">
                                        <input
                                            type="text"
                                            value="53"
                                            className="w-16 text-center border-none text-gray-500 cursor-not-allowed bg-gray-100 px-1 rounded"
                                            readOnly
                                            tabIndex={-1}
                                        />
                                    </td>
                                    <td className="text-center">
                                        <button
                                            onClick={() => onDeleteRow(originalIndex)}
                                            className="icon-button mx-auto text-red-600 hover:border-red-200 hover:bg-red-50 hover:text-red-800"
                                            title="Delete row"
                                            aria-label={`Delete row ${originalIndex + 1}`}
                                        >
                                            <Icon name="trash" />
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
    );
}

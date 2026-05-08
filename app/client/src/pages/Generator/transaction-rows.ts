import type { SortState, Transaction } from './types';

export interface VisibleTransactionRow {
    transaction: Transaction;
    originalIndex: number;
}

export function getVisibleTransactionRows(
    transactions: Transaction[],
    searchTerm: string,
    sortState: SortState
): VisibleTransactionRow[] {
    const term = searchTerm.trim().toLowerCase();
    const rows = transactions
        .map((transaction, originalIndex) => ({ transaction, originalIndex }))
        .filter(({ transaction }) => {
            if (!term) return true;
            return [
                transaction.bsb,
                transaction.account,
                transaction.accountTitle,
                transaction.lodgementRef,
                transaction.txnCode,
                String(transaction.amount ?? ''),
            ]
                .join(' ')
                .toLowerCase()
                .includes(term);
        });

    const sortKey = sortState.key;
    if (!sortKey) return rows;

    const direction = sortState.direction === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
        const leftValue = left.transaction[sortKey];
        const rightValue = right.transaction[sortKey];
        if (sortKey === 'amount') {
            return (Number(leftValue || 0) - Number(rightValue || 0)) * direction;
        }
        const comparison = String(leftValue || '').localeCompare(String(rightValue || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
        });
        return comparison * direction || (left.originalIndex - right.originalIndex);
    });
}

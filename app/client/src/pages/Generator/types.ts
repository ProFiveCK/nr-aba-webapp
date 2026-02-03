/**
 * TypeScript Type Definitions for Generator Component
 */

export interface Transaction {
    bsb: string;
    account: string;
    amount: number;
    accountTitle: string;
    lodgementRef: string;
    txnCode: string;
}

export interface HeaderData {
    fi: string;
    reel: string;
    user: string;
    apca: string;
    desc: string;
    proc: string;
    trace_bsb: string;
    trace_acct: string;
    remitter: string;
    balance_required: boolean;
    balance_txn_code: string;
    balance_bsb: string;
    balance_acct: string;
    balance_title: string;
}

export interface DuplicateGroup extends Array<number> { }

export interface BatchMetrics {
    creditsCents: number;
    debitsCents: number;
    transactionCount: number;
}

export interface ValidationIssues {
    blockedAccounts: Transaction[];
    missingLodgementRefs: Transaction[];
    duplicateGroups: DuplicateGroup[];
}

export interface SortState {
    key: 'bsb' | 'account' | 'amount' | 'accountTitle' | 'lodgementRef' | null;
    direction: 'asc' | 'desc';
}

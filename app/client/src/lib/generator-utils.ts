/**
 * Generator Utility Functions
 * Business logic for CSV operations, duplicate detection, and ABA generation
 */

import type { Transaction, HeaderData } from '../pages/Generator/types';
import { parseCsvRows, normalizeBSBStrict, digitsOnly, todayDDMMYY } from './utils';

/**
 * Parse CSV file and convert to transactions
 */
export function parseTransactionsFromCSV(csvText: string): { transactions: Transaction[]; errors: string[] } {
    const rows = parseCsvRows(csvText);
    const transactions: Transaction[] = [];
    const errors: string[] = [];

    if (rows.length === 0) {
        return { transactions: [], errors: ['CSV file is empty'] };
    }

    // Try to detect header row
    const firstRow = rows[0].map((c) => String(c).toLowerCase().trim());
    const bsbIdx = firstRow.findIndex((c) => c.includes('bsb'));
    const accountIdx = firstRow.findIndex((c) => c.includes('account') && !c.includes('title'));
    const amountIdx = firstRow.findIndex((c) => c.includes('amount'));
    const titleIdx = firstRow.findIndex((c) => c.includes('title') || c.includes('name'));
    const lodgementIdx = firstRow.findIndex((c) => c.includes('lodgement') || c.includes('reference'));

    const hasHeader = bsbIdx >= 0 && accountIdx >= 0 && amountIdx >= 0;
    const startRow = hasHeader ? 1 : 0;

    // Use column indices or fall back to positional
    const getBSB = hasHeader && bsbIdx >= 0 ? (row: string[]) => row[bsbIdx] : (row: string[]) => row[0];
    const getAccount = hasHeader && accountIdx >= 0 ? (row: string[]) => row[accountIdx] : (row: string[]) => row[1];
    const getAmount = hasHeader && amountIdx >= 0 ? (row: string[]) => row[amountIdx] : (row: string[]) => row[2];
    const getTitle = hasHeader && titleIdx >= 0 ? (row: string[]) => row[titleIdx] : (row: string[]) => row[3];
    const getLodgement = hasHeader && lodgementIdx >= 0 ? (row: string[]) => row[lodgementIdx] : (row: string[]) => row[4];

    for (let i = startRow; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 3) continue; // Skip rows with insufficient data

        const bsb = String(getBSB(row) || '').trim();
        const account = String(getAccount(row) || '').trim();
        const amountStr = String(getAmount(row) || '').replace(/[$,]/g, '').trim();
        const amount = parseFloat(amountStr);

        if (!bsb || !account) {
            errors.push(`Row ${i + 1}: Missing BSB or Account`);
            continue;
        }

        if (isNaN(amount) || amount <= 0) {
            errors.push(`Row ${i + 1}: Invalid amount "${amountStr}"`);
            continue;
        }

        transactions.push({
            bsb,
            account,
            amount,
            accountTitle: String(getTitle(row) || '').trim(),
            lodgementRef: String(getLodgement(row) || '').trim(),
            txnCode: '53',
        });
    }

    return { transactions, errors };
}

/**
 * Export transactions to CSV
 */
export function exportTransactionsToCSV(transactions: Transaction[]): string {
    const header = 'BSB,Account,Amount,Account Title,Lodgement Reference,Transaction Code';
    const rows = transactions.map((tx) => {
        const escapeCsv = (val: string | number) => {
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        return [
            escapeCsv(tx.bsb),
            escapeCsv(tx.account),
            escapeCsv(tx.amount.toFixed(2)),
            escapeCsv(tx.accountTitle),
            escapeCsv(tx.lodgementRef),
            escapeCsv(tx.txnCode),
        ].join(',');
    });

    return [header, ...rows].join('\n');
}

/**
 * Build duplicate key for transaction
 */
export function buildDuplicateKey(tx: Transaction): string | null {
    if (!tx) return null;
    const bsb = normalizeBSBStrict(tx.bsb);
    const account = digitsOnly(tx.account);
    const amount = parseFloat(String(tx.amount));
    const lodgement = String(tx.lodgementRef || '').trim();
    if (!bsb || !account || !lodgement || isNaN(amount) || amount <= 0) return null;
    return `${bsb}|${account}|${amount.toFixed(2)}|${lodgement.toLowerCase()}`;
}

/**
 * Recompute duplicate groups
 */
export function recomputeDuplicates(transactions: Transaction[]): {
    duplicateGroups: number[][];
    duplicateIndexSet: Set<number>;
    duplicateIndexToGroup: Map<number, number[]>;
} {
    const duplicateGroups: number[][] = [];
    const duplicateIndexSet = new Set<number>();
    const duplicateIndexToGroup = new Map<number, number[]>();
    const keyMap = new Map<string, number[]>();

    transactions.forEach((tx, index) => {
        const key = buildDuplicateKey(tx);
        if (!key) return;
        if (!keyMap.has(key)) keyMap.set(key, []);
        keyMap.get(key)!.push(index);
    });

    keyMap.forEach((indexes) => {
        if (indexes.length > 1) {
            duplicateGroups.push(indexes);
            indexes.forEach((idx) => {
                duplicateIndexSet.add(idx);
                duplicateIndexToGroup.set(idx, indexes);
            });
        }
    });

    return { duplicateGroups, duplicateIndexSet, duplicateIndexToGroup };
}

/**
 * Build ABA file from header and transactions
 * CRITICAL: This must produce byte-for-byte identical output to the original implementation
 */
export function buildAbaFile(headerData: HeaderData, transactions: Transaction[]): string {
    if (!headerData.user || !headerData.remitter) {
        throw new Error('User Name and Remitter Name are required.');
    }

    const apca = String(headerData.apca || '').replace(/[^0-9]/g, '');
    if (apca.length !== 6) {
        throw new Error('APCA/User ID must be exactly 6 digits.');
    }

    const proc = /^\d{6}$/.test(headerData.proc) ? headerData.proc : todayDDMMYY();

    // Utility functions (must match original exactly)
    const U = {
        digitsOnly: (s: string) => String(s || '').replace(/[^0-9]/g, ''),
        padL: (s: string, w: number, ch = '0') => String(s || '').padStart(w, ch).slice(-w),
        padR: (s: string, w: number, ch = ' ') => String(s || '').padEnd(w, ch).slice(0, w),
    };

    // Type 0 (Header record)
    const t0 =
        '0' +
        U.padR('', 17) +
        U.padL(String(headerData.reel || '1'), 2) +
        U.padR((headerData.fi || '').slice(0, 3), 3) +
        U.padR('', 7) +
        U.padR((headerData.user || '').slice(0, 26), 26) +
        U.padL(apca, 6) +
        U.padR((headerData.desc || '').slice(0, 12), 12) +
        U.padR(proc, 6) +
        U.padR('', 40);
    const lines = [(t0 + ' '.repeat(120)).slice(0, 120)];

    let credits = 0;
    let count = 0;

    // Type 1 (Detail records - credits)
    transactions.forEach((r, i) => {
        const n = i + 1;

        if (!r.lodgementRef || r.lodgementRef.trim() === '') {
            throw new Error(`Row ${n}: Lodgement Ref is required.`);
        }

        const bsbDigits = U.digitsOnly(r.bsb || '');
        if (bsbDigits.length !== 6) {
            throw new Error(`Row ${n}: BSB must be 6 digits, format NNN-NNN.`);
        }
        const normalizedBsb = normalizeBSBStrict(r.bsb);
        if (!normalizedBsb) {
            throw new Error(`Row ${n}: BSB must be 6 digits, format NNN-NNN.`);
        }

        const acctDigits = U.digitsOnly(r.account || '');
        if (acctDigits.length < 5 || acctDigits.length > 9) {
            throw new Error(`Row ${n}: Account must be 5–9 digits.`);
        }

        const amount = parseFloat(String(r.amount));
        if (isNaN(amount) || amount <= 0) {
            throw new Error(`Row ${n}: Amount must be a positive number.`);
        }
        const cents = Math.round(amount * 100);
        if (cents > 9999999999) {
            throw new Error(`Row ${n}: Amount exceeds maximum allowed.`);
        }

        const bsb7 = normalizedBsb.padEnd(7, ' ').slice(0, 7);
        const acct9 = U.padL(acctDigits, 9, ' ');
        const ind1 = ' ';
        const code2 = '53';
        const amt10 = U.padL(String(cents), 10);
        const name32 = U.padR((r.accountTitle || '').slice(0, 32), 32);
        const lodg18 = U.padR((r.lodgementRef || '').slice(0, 18), 18);
        const trbsb7 = (headerData.trace_bsb || '').padEnd(7, ' ').slice(0, 7);
        const tracct9 = U.padL(U.digitsOnly(headerData.trace_acct || ''), 9, ' ');
        const remit16 = U.padR((headerData.remitter || '').slice(0, 16), 16);
        const wtax8 = U.padL('0', 8);

        const t1 = '1' + bsb7 + acct9 + ind1 + code2 + amt10 + name32 + lodg18 + trbsb7 + tracct9 + remit16 + wtax8;
        lines.push((t1 + ' '.repeat(120)).slice(0, 120));
        count++;
        credits += cents;
    });

    // Balancing debit (code 13), equals total credits
    const balAcctDigits = U.digitsOnly(headerData.balance_acct || '');
    const balBsbDigits = U.digitsOnly(headerData.balance_bsb || '');
    if (balBsbDigits.length !== 6) {
        throw new Error('Balance BSB must be 6 digits.');
    }
    const normalizedBalanceBsb = normalizeBSBStrict(headerData.balance_bsb || '');
    if (!normalizedBalanceBsb) {
        throw new Error('Balance BSB must be 6 digits.');
    }
    if (balAcctDigits.length < 5 || balAcctDigits.length > 9) {
        throw new Error('Balance Account must be 5–9 digits.');
    }

    const balCents = credits;
    const b_bsb7 = normalizedBalanceBsb.padEnd(7, ' ').slice(0, 7);
    const b_acct9 = U.padL(balAcctDigits, 9, ' ');
    const b_ind1 = ' ';
    const b_code2 = '13';
    const b_amt10 = U.padL(String(balCents), 10);
    const b_name32 = U.padR((headerData.balance_title || '').slice(0, 32), 32);
    const b_lodg18 = U.padR(`${(headerData.desc || '').slice(0, 12)}-${proc}`.slice(0, 18), 18);
    const b_trbsb7 = (headerData.trace_bsb || '').padEnd(7, ' ').slice(0, 7);
    const b_tracct9 = U.padL(U.digitsOnly(headerData.trace_acct || ''), 9, ' ');
    const b_remit16 = U.padR((headerData.remitter || '').slice(0, 16), 16);
    const b_wtax8 = U.padL('0', 8);

    const balT1 =
        '1' + b_bsb7 + b_acct9 + b_ind1 + b_code2 + b_amt10 + b_name32 + b_lodg18 + b_trbsb7 + b_tracct9 + b_remit16 + b_wtax8;
    lines.push((balT1 + ' '.repeat(120)).slice(0, 120));
    count++;

    // Type 7 (Control record)
    const netTotal = credits - balCents; // Should be 0
    const t7 =
        '7' +
        '999-999' +
        U.padR('', 12) +
        U.padL(String(netTotal), 10) +
        U.padL(String(credits), 10) +
        U.padL(String(balCents), 10) +
        U.padR('', 24) +
        U.padL(String(count), 6) +
        U.padR('', 40);
    lines.push((t7 + ' '.repeat(120)).slice(0, 120));

    return lines.join('\r\n') + '\r\n';
}

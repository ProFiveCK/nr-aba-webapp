import { normalizeBSBStrict, formatMoney } from './utils';

export interface AbaHeader {
    reel: string;
    fi: string;
    user: string;
    apca: string;
    desc: string;
    proc: string;
}

export interface AbaTransaction {
    line: number;
    bsb: string;
    account: string;
    amount: string; // Formatted money string
    cents: number;
    accountTitle: string;
    lodgementRef: string;
    txnCode: string;
    trace_bsb: string;
    trace_acct: string;
    isDuplicate?: boolean;
}

export interface AbaControl {
    net: number;
    credits: number;
    debits: number;
    count: number;
}

export interface ParsedAbaResult {
    header: AbaHeader | null;
    transactions: AbaTransaction[];
    control: AbaControl | null;
    balancing: {
        bsb: string;
        account: string;
        amount: number;
        title: string;
    } | null;
    errors: string[];
    duplicates: {
        sets: number;
        rows: number;
    };
}

const CREDIT_CODE_SET = new Set(['50', '51', '52', '53', '54', '55', '56', '57']);

export function parseAba(rawText: string): ParsedAbaResult {
    const text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim().length > 0);

    const result: ParsedAbaResult = {
        header: null,
        transactions: [],
        control: null,
        balancing: null,
        errors: [],
        duplicates: { sets: 0, rows: 0 }
    };

    let txCounter = 0;

    lines.forEach((raw, idx) => {
        const line = raw.padEnd(120, ' ').slice(0, 120);
        const type = line[0];

        if (!['0', '1', '7'].includes(type)) {
            result.errors.push(`Line ${idx + 1}: Unknown record type '${type}'.`);
            return;
        }

        if (type === '0') {
            result.header = {
                reel: line.slice(18, 20).trim(),
                fi: line.slice(20, 23).trim(),
                user: line.slice(30, 56).trimEnd(),
                apca: line.slice(56, 62).trim(),
                desc: line.slice(62, 74).trimEnd(),
                proc: line.slice(74, 80).trim(),
            };
        } else if (type === '1') {
            const bsb7 = line.slice(1, 8);
            const acct9 = line.slice(8, 17);
            const code2 = line.slice(18, 20);
            const amt10 = line.slice(20, 30);
            const name32 = line.slice(30, 62);
            const lodg18 = line.slice(62, 80);
            const trbsb7 = line.slice(80, 87);
            const tracct9 = line.slice(87, 96);

            const cents = parseInt(amt10.trim() || '0', 10) || 0;

            result.transactions.push({
                line: (++txCounter),
                bsb: bsb7.trim(),
                account: acct9.trim(),
                amount: formatMoney(cents),
                cents,
                accountTitle: name32.trimEnd(),
                lodgementRef: lodg18.trimEnd(),
                txnCode: code2.trim(),
                trace_bsb: trbsb7.trim(),
                trace_acct: tracct9.trim()
            });

            // Capture balancing entry (Code 13)
            if (code2.trim() === '13') {
                result.balancing = {
                    bsb: bsb7.trim(),
                    account: acct9.trim(),
                    amount: cents,
                    title: name32.trimEnd()
                };
            }
        } else if (type === '7') {
            result.control = {
                net: parseInt(line.slice(20, 30).trim() || '0', 10) || 0,
                credits: parseInt(line.slice(30, 40).trim() || '0', 10) || 0,
                debits: parseInt(line.slice(40, 50).trim() || '0', 10) || 0,
                count: parseInt(line.slice(74, 80).trim() || '0', 10) || 0,
            };
        }
    });

    // Duplicate detection
    const dupMap = new Map<string, number[]>();
    const digitsOnly = (s: string) => s.replace(/[^0-9]/g, '');

    result.transactions.forEach((t, i) => {
        const key = `${normalizeBSBStrict(t.bsb) || t.bsb}|${digitsOnly(t.account)}|${t.cents}|${t.lodgementRef.trim().toLowerCase()}`;
        if (!dupMap.has(key)) dupMap.set(key, []);
        dupMap.get(key)?.push(i);
    });

    const duplicateIndexes = new Set<number>();
    dupMap.forEach((idxs) => {
        if (idxs.length > 1) {
            result.duplicates.sets++;
            result.duplicates.rows += idxs.length;
            idxs.forEach(i => duplicateIndexes.add(i));
        }
    });

    // Mark duplicates
    result.transactions.forEach((t, i) => {
        if (duplicateIndexes.has(i)) {
            t.isDuplicate = true;
        }
    });

    // Integrity check
    const sumCredits = result.transactions
        .filter(t => CREDIT_CODE_SET.has(t.txnCode))
        .reduce((a, t) => a + t.cents, 0);

    if (result.control && result.control.credits !== sumCredits) {
        result.errors.push(`Warning: Calculated credit sum ${formatMoney(sumCredits)} does not match Control credits ${formatMoney(result.control.credits)}.`);
    }

    return result;
}

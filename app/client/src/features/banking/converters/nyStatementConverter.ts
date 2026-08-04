import { cleanCsvValue, parseCsvText } from './csvUtils';

export interface FmisBuildResult {
    content: string;
    transactionCount: number;
    debitCount: number;
    creditCount: number;
    skippedRows: number;
}

const FMIS_HEADER = ['FORMAT REC STATEMENT STD', 'ANBR,TCD,DDT1,DRF1,DAMT1,DDT2,DRF2,DAMT2,TCOM1,TCOM2,TCOM3'] as const;

const DEFAULT_ACCOUNT = '2260 0709 0431';

const TXN_LABELS = {
    CREDIT: 'Deposits and other credits',
    DEBIT: 'Withdrawals and other Debits',
    CHECK: 'Checks',
    SERVICE_FEE: 'Service fees',
} as const;

const SKIP_LABELS = new Set([
    '',
    'Statement Information',
    'Account Summary',
    'Daily Ledger Balances',
]);

export function convertNyStatementToFmis(text: string, fallbackAccount: string = DEFAULT_ACCOUNT): FmisBuildResult {
    const rows = parseCsvText(text);
    if (!rows.length) throw new Error('No data found in source file.');

    const accountNumber = extractAccountNumber(rows) || fallbackAccount;
    const statementYear = extractStatementYear(rows);

    const outputLines: string[] = [];
    let transactionCount = 0;
    let debitCount = 0;
    let creditCount = 0;
    let skippedRows = 0;

    for (const row of rows) {
        if (!row || !row.length) {
            skippedRows += 1;
            continue;
        }

        const label = row[0].trim();

        if (SKIP_LABELS.has(label)) {
            skippedRows += 1;
            continue;
        }

        if (!isTransactionLabel(label)) {
            skippedRows += 1;
            continue;
        }

        if (row.length < 5) {
            skippedRows += 1;
            continue;
        }

        const rawDate = row[1].trim().replace(/^"|"$/g, '');
        const dateFmt = parseDate(rawDate, statementYear);
        if (!dateFmt) {
            skippedRows += 1;
            continue;
        }

        const rawAmount = row[3].trim().replace(/^"|"$/g, '');
        if (!rawAmount) {
            skippedRows += 1;
            continue;
        }

        const absAmount = Math.abs(Number(rawAmount.replace(/,/g, '')));
        if (!Number.isFinite(absAmount) || absAmount === 0) {
            skippedRows += 1;
            continue;
        }

        let tcd = '';
        let amount = '';
        if (label === TXN_LABELS.CREDIT) {
            tcd = 'DEP';
            amount = `-${absAmount.toFixed(2)}`;
            creditCount += 1;
        } else {
            tcd = 'CHQ';
            amount = absAmount.toFixed(2);
            debitCount += 1;
        }

        let ref1 = '';
        if (label === TXN_LABELS.CHECK && row.length > 2) {
            ref1 = cleanCsvValue(row[2]);
        }

        const narration = cleanCsvValue(row[4] ?? '');
        const narr1 = narration.slice(0, 40);
        const narr2 = narration.slice(40, 80);

        outputLines.push([accountNumber, tcd, dateFmt, ref1, amount, '', '', '', narr1, narr2, ''].join(','));
        transactionCount += 1;
    }

    if (!transactionCount) {
        throw new Error('No transactions were found in the statement.');
    }

    const content = [...FMIS_HEADER, ...outputLines].join('\r\n') + '\r\n';

    return {
        content,
        transactionCount,
        debitCount,
        creditCount,
        skippedRows,
    };
}

function isTransactionLabel(label: string): boolean {
    return label === TXN_LABELS.CREDIT || label === TXN_LABELS.DEBIT || label === TXN_LABELS.CHECK || label === TXN_LABELS.SERVICE_FEE;
}

function extractAccountNumber(rows: string[][]): string {
    if (rows && rows[0] && rows[0][1]) {
        const acct = cleanCsvValue(rows[0][1]);
        if (acct) return acct;
    }
    return '';
}

function extractStatementYear(rows: string[][]): number | undefined {
    for (const r of rows.slice(0, 2)) {
        for (const cell of r.slice(1, 3)) {
            const yearText = parseDate(cell.trim().replace(/^"|"$/g, ''));
            if (yearText && yearText.length === 4 && /^\d{4}$/.test(yearText)) {
                return Number(yearText);
            }
        }
    }
    return undefined;
}

function parseDate(raw: string, statementYear?: number): string {
    const value = raw.trim().replace(/^"|"$/g, '');
    if (!value) return '';

    // Full month-name date (header range) -> extract year only
    const yearMatch = value.match(/\b(19|20)\d{2}\b/);
    if (yearMatch && (value.includes(',') || value.startsWith('June') || value.startsWith('July'))) {
        return yearMatch[0];
    }

    // MM/DD/YY or MM/DD/YYYY
    const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
    if (slashMatch) {
        const [, month, day, yearPart] = slashMatch;
        let year: number;
        if (yearPart) {
            year = yearPart.length === 2 ? 2000 + Number(yearPart) : Number(yearPart);
        } else if (statementYear) {
            year = statementYear;
        } else {
            year = new Date().getFullYear();
        }
        return `${Number(day).toString().padStart(2, '0')}/${Number(month).toString().padStart(2, '0')}/${year}`;
    }

    return value;
}

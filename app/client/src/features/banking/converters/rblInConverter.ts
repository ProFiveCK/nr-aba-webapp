import { cleanCsvValue, parseCsvText } from './csvUtils';

export interface FmisBuildResult {
    content: string;
    transactionCount: number;
    debitCount: number;
    creditCount: number;
    skippedRows: number;
}

const FMIS_HEADER = ['FORMAT REC STATEMENT STD', 'ANBR,TCD,DDT1,DRF1,DAMT1,DDT2,DRF2,DAMT2,TCOM1,TCOM2,TCOM3'] as const;

const TRANSACTION_HEADER = [
    'Transaction Date',
    'Transaction Details',
    'Cheque ID',
    'Value Date',
    'Withdrawl Amt',
    'Deposit Amt',
    'Balance (₹)',
];

const ACCOUNT_LABEL = 'Statement Of Transactions in Account Number:';
const SUMMARY_LABEL = 'Statement Summary';

/**
 * Convert an RBL Bank India statement CSV download into the TechnologyOne
 * Financials bank-reconciliation import format (.txt).
 *
 * RBL CSV structure:
 *  - Account metadata appears before the transaction table.
 *  - Account number is on the row:
 *      Statement Of Transactions in Account Number:,<account number>
 *  - Transaction table starts at:
 *      Transaction Date,Transaction Details,Cheque ID,Value Date,Withdrawl Amt,Deposit Amt,Balance (₹)
 *  - Transaction table ends before:
 *      Statement Summary
 *
 * Transaction Code rules:
 *  Withdrawal row -> TCD = CHQ
 *  Deposit row    -> TCD = DEP  (amount stored as negative)
 */
export function convertRblInCsvToFmis(text: string): FmisBuildResult {
    const stripped = String(text || '').replace(/^\uFEFF/, '');
    const rows = parseCsvText(stripped);
    if (!rows.length) throw new Error('CSV is empty.');

    const outputLines: string[] = [];
    let transactionCount = 0;
    let debitCount = 0;
    let creditCount = 0;
    let skippedRows = 0;
    let accountNumber = '';
    let inTransactions = false;

    for (const row of rows) {
        if (!row || !row.length) {
            skippedRows += 1;
            continue;
        }

        const first = cleanCsvValue(row[0] ?? '');

        if (!first && row.every((field) => !String(field || '').trim())) {
            skippedRows += 1;
            continue;
        }

        if (first === ACCOUNT_LABEL && row.length > 1) {
            accountNumber = cleanCsvValue(row[1] ?? '');
            continue;
        }

        if (row.slice(0, TRANSACTION_HEADER.length).every((val, idx) => cleanCsvValue(val) === TRANSACTION_HEADER[idx])) {
            inTransactions = true;
            continue;
        }

        if (first === SUMMARY_LABEL) {
            break;
        }

        if (!inTransactions) {
            continue;
        }

        if (row.length < 7) {
            skippedRows += 1;
            continue;
        }

        const transactionDate = convertDate(row[0] ?? '');
        const details = cleanCsvValue(row[1] ?? '');
        const chequeId = cleanCsvValue(row[2] ?? '');
        const withdrawal = cleanAmount(row[4] ?? '');
        const deposit = cleanAmount(row[5] ?? '');

        let tcd = '';
        let amount = '';
        if (withdrawal) {
            tcd = 'CHQ';
            amount = withdrawal;
            debitCount += 1;
        } else if (deposit) {
            tcd = 'DEP';
            amount = negativeAmount(deposit);
            creditCount += 1;
        } else {
            skippedRows += 1;
            continue;
        }

        const narr1 = details.slice(0, 40);
        const narr2 = details.slice(40, 80);
        const narr3 = details.slice(80, 120);

        outputLines.push(
            [accountNumber, tcd, transactionDate, chequeId, amount, '', '', '', narr1, narr2, narr3].join(',')
        );
        transactionCount += 1;
    }

    if (!transactionCount) {
        throw new Error('No transactions with withdrawal or deposit amounts were found in the file.');
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

function cleanAmount(value: unknown): string {
    return String(value || '')
        .trim()
        .replace(/"/g, '')
        .replace(/,/g, '')
        .replace(/₹/g, '')
        .trim();
}

function convertDate(value: unknown): string {
    const raw = String(value || '').trim().replace(/"/g, '');
    if (raw.length === 10 && (raw[2] === '/' || raw[2] === '-') && (raw[5] === '/' || raw[5] === '-')) {
        return `${raw.slice(0, 2)}/${raw.slice(3, 5)}/${raw.slice(6, 10)}`;
    }
    return raw;
}

function negativeAmount(amount: string): string {
    const numeric = Number(amount);
    if (Number.isFinite(numeric)) {
        return (numeric * -1).toFixed(2);
    }
    return amount;
}
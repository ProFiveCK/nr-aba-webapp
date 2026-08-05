import { cleanCsvValue, parseCsvText } from './csvUtils';

export interface FmisBuildResult {
    content: string;
    transactionCount: number;
    debitCount: number;
    creditCount: number;
    skippedRows: number;
}

const FMIS_HEADER = ['FORMAT REC STATEMENT STD', 'ANBR,TCD,DDT1,DRF1,DAMT1,DDT2,DRF2,DAMT2,TCOM1,TCOM2,TCOM3'] as const;

const DEFAULT_ACCOUNT = '0279 00321139.60';

const COL_TRADE_DATE = 0;
const COL_VALUE_DATE = 3;
const COL_DEBIT = 5;
const COL_CREDIT = 6;
const COL_TXN_NO = 9;
const COL_DESC1 = 10;
const COL_DESC2 = 11;
const COL_DESC3 = 12;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function splitSemicolonRecord(cell: string): string[] {
    if (!cell) return [];
    const result: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < cell.length; i++) {
        const ch = cell[i];
        if (inQuotes) {
            if (ch === '"') {
                if (cell[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ';') {
            result.push(field);
            field = '';
        } else {
            field += ch;
        }
    }
    result.push(field);
    return result;
}

function readSemicolonRecords(text: string): string[][] {
    const records: string[][] = [];
    const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.length > 0);
    for (const line of lines) {
        const parsed = parseCsvText(line);
        if (!parsed.length) continue;
        const cell = parsed[0]?.join(',') ?? '';
        if (!cell) continue;
        records.push(splitSemicolonRecord(cell));
    }
    return records;
}

function cleanNarration(text: string): string {
    return text
        .trim()
        .replace(/"/g, '')
        .replace(/;/g, ' ')
        .replace(/,/g, ' ')
        .split(/\s+/)
        .join(' ');
}

function parseIsoDate(raw: string): string {
    const value = raw.trim().replace(/^"|"$/g, '');
    if (!value) return '';
    const match = ISO_DATE_RE.exec(value);
    if (match) {
        const year = match[1];
        const month = match[2];
        const day = match[3];
        return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    }
    return value;
}

function extractAccountNumber(records: string[][]): string {
    for (const fields of records) {
        if (fields.length >= 2 && fields[0].trim().toLowerCase() === 'account number:') {
            const acct = fields[1].trim().replace(/;|"|/g, '').trim();
            if (acct) return acct;
        }
    }
    return '';
}

export function convertGvaUsdStatementToFmis(text: string, fallbackAccount: string = DEFAULT_ACCOUNT): FmisBuildResult {
    const records = readSemicolonRecords(text);
    if (!records.length) throw new Error('No data found in source file.');

    const accountNumber = extractAccountNumber(records) || fallbackAccount;

    const outputLines: string[] = [];
    let transactionCount = 0;
    let debitCount = 0;
    let creditCount = 0;
    let skippedRows = 0;
    const seenTxn = new Set<string>();

    for (const fields of records) {
        if (!fields.length) {
            skippedRows += 1;
            continue;
        }

        const tradeDate = fields[COL_TRADE_DATE]?.trim() ?? '';
        if (!ISO_DATE_RE.test(tradeDate)) {
            skippedRows += 1;
            continue;
        }

        if (fields.length <= COL_DESC3) {
            skippedRows += 1;
            continue;
        }

        const debitRaw = fields[COL_DEBIT].trim().replace(/^"|"$/g, '').replace(/;/g, '');
        const creditRaw = fields[COL_CREDIT].trim().replace(/^"|"$/g, '').replace(/;/g, '');
        const debit = debitRaw ? Number(debitRaw) : 0;
        const credit = creditRaw ? Number(creditRaw) : 0;

        if (!Number.isFinite(debit) || !Number.isFinite(credit) || (debit === 0 && credit === 0)) {
            skippedRows += 1;
            continue;
        }

        let tcd = '';
        let amount = '';
        if (debit !== 0) {
            tcd = 'CHQ';
            amount = `${Math.abs(debit).toFixed(2)}`;
            debitCount += 1;
        } else {
            tcd = 'DEP';
            amount = `-${Math.abs(credit).toFixed(2)}`;
            creditCount += 1;
        }

        const txnNo = cleanCsvValue(fields[COL_TXN_NO]);
        if (txnNo && seenTxn.has(txnNo)) {
            skippedRows += 1;
            continue;
        }
        if (txnNo) seenTxn.add(txnNo);

        const dateFmt = parseIsoDate(fields[COL_VALUE_DATE]);
        const narration = cleanNarration(
            [fields[COL_DESC1], fields[COL_DESC2], fields[COL_DESC3]].filter(Boolean).join(' ')
        );
        const narr1 = narration.slice(0, 40);
        const narr2 = narration.slice(40, 80);

        outputLines.push([accountNumber, tcd, dateFmt, txnNo, amount, '', '', '', narr1, narr2, ''].join(','));
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

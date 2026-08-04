import { cleanCsvValue, parseCsvText } from './csvUtils';

export interface FmisBuildResult {
    content: string;
    transactionCount: number;
    debitCount: number;
    creditCount: number;
    skippedRows: number;
}

const FMIS_HEADER = ['FORMAT REC STATEMENT STD', 'ANBR,TCD,DDT1,DRF1,DAMT1,DDT2,DRF2,DAMT2,TCOM1,TCOM2,TCOM3'] as const;

const WBC_FJ_SKIP_PREFIXES = ['total value', 'number of'];

export function convertWbcFjCsvToFmis(text: string): FmisBuildResult {
    const rows = parseCsvText(text);
    if (!rows.length) throw new Error('CSV is empty.');

    const outputLines: string[] = [];
    let transactionCount = 0;
    let debitCount = 0;
    let creditCount = 0;
    let skippedRows = 0;

    rows.forEach((row) => {
        if (!row || !row.length) {
            skippedRows += 1;
            return;
        }

        const first = cleanCsvValue(row[0] ?? '');
        const firstLower = first.toLowerCase();

        if (!first && row.every((field) => !String(field || '').trim())) {
            skippedRows += 1;
            return;
        }
        if (first === 'Account description') {
            skippedRows += 1;
            return;
        }
        if (WBC_FJ_SKIP_PREFIXES.some((prefix) => firstLower.startsWith(prefix))) {
            skippedRows += 1;
            return;
        }
        if (row.length < 7) {
            skippedRows += 1;
            return;
        }

        const accountNumber = cleanCsvValue(row[1] ?? '');
        const dateFormatted = convertWbcFjDate(row[3] ?? '');
        const narration = cleanCsvValue(row[4] ?? '');
        const debitRaw = cleanCsvValue(row[5] ?? '');
        const creditRaw = cleanCsvValue(row[6] ?? '');

        let tcd = '';
        let amount = '';
        if (debitRaw) {
            tcd = 'C001';
            amount = normalizeWbcAmount(debitRaw, false);
            debitCount += 1;
        } else if (creditRaw) {
            tcd = 'D001';
            amount = normalizeWbcAmount(creditRaw, true);
            creditCount += 1;
        } else {
            skippedRows += 1;
            return;
        }

        const narr1 = narration.slice(0, 40);
        const narr2 = narration.slice(40, 80);
        outputLines.push([accountNumber, tcd, dateFormatted, '', amount, '', '', '', narr1, narr2, ''].join(','));
        transactionCount += 1;
    });

    if (!transactionCount) throw new Error('No transactions with debit or credit amounts were found in the file.');

    const content = [...FMIS_HEADER, ...outputLines].join('\r\n') + '\r\n';

    return {
        content,
        transactionCount,
        debitCount,
        creditCount,
        skippedRows,
    };
}

function convertWbcFjDate(value: unknown): string {
    const raw = cleanCsvValue(value);
    if (raw.length === 8 && /^\d{8}$/.test(raw)) {
        return `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4, 8)}`;
    }
    return raw;
}

function normalizeWbcAmount(value: unknown, negate: boolean): string {
    const raw = String(value || '')
        .trim()
        .replace(/"/g, '')
        .replace(/,/g, '');
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
        const adjusted = negate ? numeric * -1 : numeric;
        return adjusted.toFixed(2);
    }
    return raw;
}

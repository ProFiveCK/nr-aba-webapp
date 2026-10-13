import { existsSync, readFileSync } from 'node:fs';
import { NumbersDocument, type CellInput } from 'cupertino-files';
import { describe, expect, it } from 'vitest';
import { parseCsvText, readStatementText } from './csvUtils';
import { convertGvaChfStatementToFmis } from './gvaChfStatementConverter';
import { convertGvaUsdStatementToFmis } from './gvaUsdStatementConverter';

const account = 'TEST-GVA-ACCOUNT';
const debit = ['2026-10-01', '', '', '2026-10-02', '', '125.50', '', '', '', 'TXN-001', 'Invoice, October', 'Office rent', ''];
const credit = ['2026-10-03', '', '', '2026-10-04', '', '', '250', '', '', 'TXN-002', 'Refund', '', ''];
const expectedTransactions = [
    `${account},CHQ,02/10/2026,TXN-001,125.50,,,,Invoice October Office rent,,`,
    `${account},DEP,04/10/2026,TXN-002,-250.00,,,,Refund,,`,
];

function csvCell(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

function numbersFile(rows: CellInput[][], name = 'statement.numbers'): File {
    const document = NumbersDocument.blank();
    const table = document.tables()[0];
    const width = Math.max(...rows.map((row) => row.length));
    if (width > table.columnCount) table.insertColumns(table.columnCount, width - table.columnCount);
    rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => table.setCell(rowIndex, columnIndex, value)));
    return new File([new Uint8Array(document.save()).buffer], name, { type: 'application/x-apple-numbers' });
}

function expectTransactions(text: string, convert: typeof convertGvaChfStatementToFmis) {
    const result = convert(text);
    expect(result.content.split('\r\n').slice(2, -1)).toEqual(expectedTransactions);
    expect(result).toMatchObject({ transactionCount: 2, debitCount: 1, creditCount: 1 });
}

describe.each([
    { currency: 'CHF', convert: convertGvaChfStatementToFmis, defaultAccount: '0279 00321139.01' },
    { currency: 'USD', convert: convertGvaUsdStatementToFmis, defaultAccount: '0279 00321139.60' },
])('GVA-$currency statement conversion', ({ currency, convert, defaultAccount }) => {
    // Bank statements remain in ignored DEV storage and are optional in other checkouts.
    const privateFixturePath = new URL(
        `../../../../../../DEV/Bank Statement ${currency} Account September 2026.numbers`,
        import.meta.url,
    );
    it.runIf(existsSync(privateFixturePath))('converts and reconciles the real DEV Numbers statement', async () => {
        const bytes = readFileSync(privateFixturePath);
        const result = convert(await readStatementText(new File([bytes], 'statement.numbers')));
        const document = NumbersDocument.load(new Uint8Array(bytes));
        const sourceText = document.tables().flatMap((table) =>
            Array.from({ length: table.rowCount }, (_, row) => table.cellText(row, 0)),
        ).join('\n');
        const sourceRows = parseCsvText(sourceText, ';');
        const metadata = (label: string) => sourceRows.find((row) => row[0] === label)?.[1];
        const sourceTransactions = sourceRows.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row[0]));
        const outputRows = result.content.split('\r\n').slice(2, -1).map((line) => line.split(','));
        const cents = (value: string | undefined) => Math.round(Number(value || 0) * 100);

        expect(result).toEqual(convert(sourceText));
        expect(result.transactionCount).toBe(Number(metadata('Numbers of transactions in this period:')));
        expect(outputRows).toHaveLength(sourceTransactions.length);
        for (const source of sourceTransactions) {
            const output = outputRows.find((row) => row[3] === source[9]);
            expect(output).toBeDefined();
            expect(output).toHaveLength(11);
            expect(output?.[0]).toBe(metadata('Account number:'));
            expect(output?.[2]).toBe(source[3].split('-').reverse().join('/'));
            expect(output?.[1]).toBe(cents(source[5]) ? 'CHQ' : 'DEP');
            expect(cents(output?.[4])).toBe(cents(source[5]) ? Math.abs(cents(source[5])) : -Math.abs(cents(source[6])));
        }
        const debitRows = outputRows.filter((row) => row[1] === 'CHQ');
        const creditRows = outputRows.filter((row) => row[1] === 'DEP');
        expect(result.debitCount).toBe(debitRows.length);
        expect(result.creditCount).toBe(creditRows.length);
        const importedNet = outputRows.reduce((sum, row) => sum - cents(row[4]), 0);
        expect(cents(metadata('Opening balance:')) + importedNet).toBe(cents(metadata('Closing balance:')));
    });

    it('preserves semicolon CSV imports and excludes duplicates from the totals', () => {
        const rows = [['Account number:', account], debit, credit, debit];
        expectTransactions(rows.map((row) => row.map(csvCell).join(';')).join('\r\n'), convert);
    });

    it('preserves CSV files containing a wrapped semicolon record in each row', () => {
        const rows = [['Account number:', account], debit, credit];
        expectTransactions(rows.map((row) => csvCell(row.join(';'))).join('\n'), convert);
    });

    it('converts Numbers columns with native dates and numeric amounts directly to FMIS', async () => {
        const nativeDebit: CellInput[] = [...debit];
        nativeDebit[0] = new Date('2026-10-01T00:00:00Z');
        nativeDebit[3] = new Date('2026-10-02T00:00:00Z');
        nativeDebit[5] = 125.5;
        const nativeCredit: CellInput[] = [...credit];
        nativeCredit[6] = 250;
        const file = numbersFile([['Account number:', account], nativeDebit, nativeCredit, nativeDebit], 'statement.NUMBERS');

        expectTransactions(await readStatementText(file), convert);
    });

    it('converts Numbers containing one semicolon statement record per cell', async () => {
        const rows = [['Account number:', account], debit, credit];
        const file = numbersFile(rows.map((row) => [row.join(';')]));

        expectTransactions(await readStatementText(file), convert);
    });

    it('converts single-cell Numbers records without comma-containing narration', async () => {
        const file = numbersFile([[`Account number:;${account}`], [credit.join(';')]]);
        const result = convert(await readStatementText(file));

        expect(result.content.split('\r\n').slice(2, -1)).toEqual([expectedTransactions[1]]);
        expect(result).toMatchObject({ transactionCount: 1, debitCount: 0, creditCount: 1 });
    });

    it('preserves quoted multiline narration in Numbers columns', async () => {
        const row = [...debit];
        row[10] = 'Invoice, "October";\nOffice rent';
        row[11] = '';
        const text = await readStatementText(numbersFile([['Account number:', account], row]));

        expect(convert(text).content.split('\r\n')[2]).toBe(expectedTransactions[0]);
    });

    it('reports an unreadable Numbers file', async () => {
        await expect(readStatementText(new File(['invalid'], 'statement.numbers')))
            .rejects.toThrow('This Numbers file could not be converted.');
    });

    it('uses the currency account fallback and respects an explicit override', () => {
        const text = debit.map(csvCell).join(';');
        expect(convert(text).content.split('\r\n')[2].split(',')[0]).toBe(defaultAccount);
        expect(convert(text, account).content.split('\r\n')[2].split(',')[0]).toBe(account);
    });

    it('reports statements without transactions', () => {
        expect(() => convert(`Account number:;${account}`))
            .toThrow('No transactions were found in the statement.');
    });
});

import { IWorkDocument } from 'cupertino-files';

export async function readStatementText(file: File): Promise<string> {
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.numbers')) {
        return readNumbersWorkbookText(file);
    }

    return file.text();
}

async function readNumbersWorkbookText(file: File): Promise<string> {
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const document = IWorkDocument.open(bytes);
        const tables = document.tables();

        if (!tables.length) {
            throw new Error('This Numbers file does not contain any table data.');
        }

        const outRows: string[] = [];
        for (const table of tables) {
            for (let rowIndex = 0; rowIndex < table.rowCount; rowIndex += 1) {
                const row: string[] = [];
                for (let colIndex = 0; colIndex < table.columnCount; colIndex += 1) {
                    const value = table.cellText(rowIndex, colIndex) ?? '';
                    row.push(escapeCsvCell(value));
                }

                if (row.some((cell) => cell.length > 0)) {
                    outRows.push(row.join(','));
                }
            }
        }

        if (!outRows.length) {
            throw new Error('This Numbers file does not contain any readable rows.');
        }

        return outRows.join('\n');
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to read Numbers workbook.';
        throw new Error(`This Numbers file could not be converted. ${message}`);
    }
}

function escapeCsvCell(value: string): string {
    const text = String(value ?? '');
    // Quote embedded semicolon records so they remain distinct from raw bank CSV.
    if (/[",;\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

export function parseCsvText(text: string, delimiter: string = ','): string[][] {
    const result: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;
    const input = String(text || '').replace(/^\uFEFF/, '');
    const finishRow = () => {
        row.push(cell);
        if (row.some((value) => value.trim().length > 0)) result.push(row);
        row = [];
        cell = '';
    };
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (inQuotes) {
            if (ch === '"') {
                if (input[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === delimiter) {
            row.push(cell);
            cell = '';
        } else if (ch === '\r' || ch === '\n') {
            finishRow();
            if (ch === '\r' && input[i + 1] === '\n') i++;
        } else {
            cell += ch;
        }
    }
    finishRow();
    return result;
}

export function cleanCsvValue(value: unknown): string {
    return String(value || '')
        .trim()
        .replace(/"/g, '')
        .replace(/,/g, '');
}

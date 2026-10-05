/**
 * CSV reading and writing for the staff import and the balance exports.
 *
 * `csvCell` was copy-pasted into Staff.tsx and Report.tsx; one definition now
 * serves both, and it is covered by tests.
 */

/** Minimal RFC4180 parser: quoted fields, escaped "" inside quotes, CRLF/LF. */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    const pushField = () => { row.push(field); field = ''; };
    const pushRow = () => { pushField(); rows.push(row); row = []; };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            pushField();
        } else if (c === '\n') {
            pushRow();
        } else if (c === '\r') {
            // skip; \n (if present) ends the row
        } else {
            field += c;
        }
    }
    if (field.length || row.length) pushRow();
    return rows.filter((r) => r.some((cell) => cell.trim().length));
}

export function csvCell(value: unknown): string {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function parseCsvText(text: string): string[][] {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0)
        .map(parseCsvLine);
}

function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
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
        } else if (ch === ',') {
            result.push(cell);
            cell = '';
        } else {
            cell += ch;
        }
    }
    result.push(cell);
    return result;
}

export function cleanCsvValue(value: unknown): string {
    return String(value || '')
        .trim()
        .replace(/"/g, '')
        .replace(/,/g, '');
}

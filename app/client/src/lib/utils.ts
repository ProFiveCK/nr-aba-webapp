/**
 * Utility Functions
 * Formatting, parsing, and ABA file generation
 */

// Currency formatter
const fmtAU = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

/**
 * Format a value as Australian currency
 */
export function formatCurrency(value: number | string): string {
    const n = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? String(value) : fmtAU.format(n);
}

/**
 * Format money value (from cents)
 */
export function formatMoney(cents: number | null | undefined): string {
    if (cents === null || cents === undefined) return '$0.00';
    return fmtAU.format(cents / 100);
}

/**
 * Format BSB number (XXX-XXX)
 */
export function formatBSB(value: string | number): string {
    const digits = String(value || '').replace(/\D+/g, '').slice(0, 6);
    return digits.length <= 3 ? digits : `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

/**
 * Normalize BSB to strict format
 */
export function normalizeBSBStrict(value: string): string | null {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 6);
    if (digits.length !== 6) return null;
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

/**
 * Extract only digits from a string
 */
export function digitsOnly(value: string | number): string {
    return String(value || '').replace(/\D+/g, '');
}

/**
 * Normalize account number to strict format (digits only)
 */
export function normalizeAccountStrict(value: string | number): string {
    return digitsOnly(value);
}

/**
 * Format PD number
 */
export function formatPdNumber(value: string | null | undefined): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length === 6) return `PD${digits}`;
    if (/^PD\d{6}$/i.test(raw)) return `PD${raw.slice(-6)}`;
    return raw.toUpperCase();
}

/**
 * Format batch code (ensure proper format)
 */
export function formatBatchCode(code: string): string {
    if (!code) return '';
    const str = String(code);
    if (str.includes('-')) return str;
    const digits = str.replace(/[^0-9]/g, '');
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/**
 * Format date/time in Australian format
 */
export const AU_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

export function formatAuDateTime(
    value: string | Date | null | undefined,
    { fallback = '-', options = AU_DATE_TIME_OPTIONS }: { fallback?: string; options?: Intl.DateTimeFormatOptions } = {}
): string {
    if (!value) return fallback;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return date.toLocaleString('en-AU', options);
}

export function formatIsoDateTime(value: string | Date | null | undefined): string {
    return formatAuDateTime(value, { fallback: 'N/A' });
}

// Alias for compatibility
export const formatDate = formatAuDateTime;

/**
 * Get today's date in DDMMYY format
 */
export function todayDDMMYY(): string {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${day}${month}${year}`;
}

/**
 * Parse CSV line (handles quoted values)
 */
export function parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inQuotes) {
            if (char === '"') {
                if (line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    values.push(current.trim());
    return values;
}

/**
 * Parse CSV text into rows
 */
export function parseCsvRows(text: string): string[][] {
    const rows: string[][] = [];
    let current: string[] = [];
    let value = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    value += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                value += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            current.push(value);
            value = '';
        } else if (char === '\n') {
            current.push(value);
            if (current.length > 0 && current.some((c) => c.trim())) {
                rows.push(current);
            }
            current = [];
            value = '';
        } else {
            value += char;
        }
    }
    if (value || current.length > 0) {
        current.push(value);
        if (current.some((c) => c.trim())) {
            rows.push(current);
        }
    }
    return rows;
}

const normalizeHeaderName = (value: string): string =>
    String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');

export interface ParsedBlacklistCsvRow {
    rowNumber: number;
    bsb: string;
    account: string;
    label: string | null;
    notes: string | null;
    active: string | boolean | null;
}

export interface BlacklistCsvParseResult {
    entries: ParsedBlacklistCsvRow[];
    issues: string[];
}

export function parseBlacklistCsv(text: string): BlacklistCsvParseResult {
    const normalizedContent = text.includes(',') ? text : text.replace(/	/g, ',');
    const rawRows = parseCsvRows(normalizedContent);
    const trimmedRows = rawRows
        .map((row) => row.map((cell) => String(cell ?? '').trim()))
        .filter((row) => row.some((cell) => cell.length));

    if (!trimmedRows.length) {
        return { entries: [], issues: ['File is empty.'] };
    }

    const headerCandidate = trimmedRows[0].map((cell) => normalizeHeaderName(cell));
    const headerHasKeywords = headerCandidate.some((cell) =>
        ['bsb', 'account', 'accountnumber', 'accountno', 'accountnum'].includes(cell)
    );

    let rows = trimmedRows;
    let headerIndex: Map<string, number> | null = null;
    if (headerHasKeywords) {
        rows = trimmedRows.slice(1);
        headerIndex = new Map(headerCandidate.map((name, index) => [name, index]));
    }

    const entries: ParsedBlacklistCsvRow[] = [];
    const issues: string[] = [];
    const aliases = {
        bsb: ['bsb'],
        account: ['account', 'accountnumber', 'accountno', 'acct', 'accountnum'],
        label: ['label', 'name', 'description', 'accname', 'accountname'],
        notes: ['notes', 'note', 'comment', 'comments'],
        active: ['active', 'status', 'enabled'],
    };

    const getValue = (row: string[], names: string[], fallbackIndex?: number) => {
        if (headerIndex) {
            for (const name of names) {
                const resolved = headerIndex.get(normalizeHeaderName(name));
                if (resolved !== undefined) {
                    return row[resolved] ?? '';
                }
            }
        }
        if (fallbackIndex !== undefined && fallbackIndex < row.length) {
            return row[fallbackIndex] ?? '';
        }
        return '';
    };

    rows.forEach((row, idx) => {
        const rowNumber = headerIndex ? idx + 2 : idx + 1;
        const bsb = getValue(row, aliases.bsb, 0);
        const account = getValue(row, aliases.account, 1);
        const label = getValue(row, aliases.label, 2) || null;
        const notes = getValue(row, aliases.notes, 3) || null;
        const active = getValue(row, aliases.active, 4) || null;

        if (!bsb && !account) {
            issues.push(`Row ${rowNumber} skipped: missing BSB and account.`);
            return;
        }

        entries.push({ rowNumber, bsb, account, label, notes, active });
    });

    return { entries, issues };
}



/**
 * Ensure batch code format (NN-NNNNNN)
 */
export function ensureBatchCodeFormat(value: string): string {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/**
 * Base64 encoding/decoding
 */
export function toBase64(str: string): string {
    return btoa(unescape(encodeURIComponent(str)));
}

export function fromBase64(str: string): string {
    return decodeURIComponent(escape(atob(str)));
}

/**
 * Download a base64 file
 */
export function downloadBase64File(base64: string, filename: string): void {
    const link = document.createElement('a');
    link.href = `data:text/plain;base64,${base64}`;
    link.download = filename;
    link.click();
}

/**
 * Escape HTML
 */
export function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Get batch stage metadata (label and color)
 */
export function getBatchStageMetadata(stage: string | null | undefined): {
    label: string;
    color: 'blue' | 'green' | 'red' | 'gray';
} {
    const stageStr = String(stage || '').toLowerCase();
    switch (stageStr) {
        case 'submitted':
            return { label: 'Submitted', color: 'blue' };
        case 'approved':
            return { label: 'Approved', color: 'green' };
        case 'rejected':
            return { label: 'Rejected', color: 'red' };
        default:
            return { label: 'Unknown', color: 'gray' };
    }
}

/**
 * Get Tailwind CSS classes for batch stage badge
 */
export function getBatchStageBadgeClasses(stage: string | null | undefined): string {
    const { color } = getBatchStageMetadata(stage);
    const colorClasses = {
        blue: 'bg-blue-100 text-blue-800',
        green: 'bg-green-100 text-green-800',
        red: 'bg-red-100 text-red-800',
        gray: 'bg-gray-100 text-gray-700',
    };
    return colorClasses[color];
}

// Alias for compatibility
export const getStatusColor = getBatchStageBadgeClasses;

/**
 * Parsing Utility Functions
 * CSV, batch codes, etc.
 */

/**
 * Parse CSV line (handles quoted values)
 */
export function parseCsvLine(line) {
  const values = [];
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
export function parseCsvRows(text) {
  const rows = [];
  let current = [];
  let value = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i += 1;
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
      if (current.length > 0 && current.some(c => c.trim())) {
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
    if (current.some(c => c.trim())) {
      rows.push(current);
    }
  }
  return rows;
}

/**
 * Ensure batch code format (NN-NNNNNN)
 */
export function ensureBatchCodeFormat(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/**
 * Normalize batch code
 */
export function normalizeBatchCode(code) {
  if (!code) return { raw: '', formatted: '', encoded: '' };
  const raw = String(code).trim();
  const formatted = formatBatchCode(raw);
  const encoded = encodeURIComponent(formatted);
  return { raw, formatted, encoded };
}

// Import formatBatchCode from formatters
import { formatBatchCode } from './formatters.js';

/**
 * Parse blacklist CSV
 */
export function parseBlacklistCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  
  // Try to detect header row
  const firstRow = rows[0].map(c => String(c).toLowerCase().trim());
  const bsbIdx = firstRow.findIndex(c => c.includes('bsb'));
  const accountIdx = firstRow.findIndex(c => c.includes('account'));
  const labelIdx = firstRow.findIndex(c => c.includes('label') || c.includes('name') || c.includes('alias'));
  const notesIdx = firstRow.findIndex(c => c.includes('note'));
  const activeIdx = firstRow.findIndex(c => c.includes('active'));
  
  const hasHeader = bsbIdx >= 0 && accountIdx >= 0;
  const startRow = hasHeader ? 1 : 0;
  
  const entries = [];
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (bsbIdx >= 0 && accountIdx >= 0 && row[bsbIdx] && row[accountIdx]) {
      entries.push({
        bsb: String(row[bsbIdx]).trim(),
        account: String(row[accountIdx]).trim(),
        label: labelIdx >= 0 ? String(row[labelIdx] || '').trim() : null,
        notes: notesIdx >= 0 ? String(row[notesIdx] || '').trim() : null,
        active: activeIdx >= 0 ? String(row[activeIdx] || '').trim().toLowerCase() !== 'no' : true
      });
    }
  }
  return entries;
}


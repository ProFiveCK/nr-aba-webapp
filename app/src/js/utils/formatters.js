/**
 * Formatting Utility Functions
 * Currency, dates, BSB, account numbers, etc.
 */

// Currency formatter
const fmtAU = new Intl.NumberFormat("en-AU", { 
  style: "currency", 
  currency: "AUD", 
  minimumFractionDigits: 2, 
  maximumFractionDigits: 2 
});

/**
 * Format a value as Australian currency
 */
export function formatCurrency(value) {
  const n = parseFloat(String(value).replace(/[^0-9.\-]/g, ""));
  return n === null || isNaN(n) ? value : fmtAU.format(n);
}

/**
 * Format money value (from cents)
 */
export function formatMoney(cents) {
  if (cents === null || cents === undefined) return '$0.00';
  return fmtAU.format(cents / 100);
}

/**
 * Format BSB number (XXX-XXX)
 */
export function formatBSB(value) {
  const digits = String(value || "").replace(/\D+/g, "").slice(0, 6);
  return digits.length <= 3 ? digits : `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

/**
 * Normalize BSB to strict format
 */
export function normalizeBSBStrict(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 6);
  if (digits.length !== 6) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

/**
 * Extract only digits from a string
 */
export function digitsOnly(value) {
  return String(value || "").replace(/\D+/g, "");
}

/**
 * Normalize account number to strict format (digits only)
 */
export function normalizeAccountStrict(value) {
  return digitsOnly(value);
}

/**
 * Format PD number
 */
export function formatPdNumber(value) {
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
export function formatBatchCode(code) {
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
export const AU_DATE_TIME_OPTIONS = { dateStyle: 'medium', timeStyle: 'short' };

export function formatAuDateTime(value, { fallback = '-', options = AU_DATE_TIME_OPTIONS } = {}) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString('en-AU', options);
}

export function formatIsoDateTime(value) {
  return formatAuDateTime(value, { fallback: 'N/A' });
}

/**
 * Get today's date in DDMMYY format
 */
export function todayDDMMYY() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${day}${month}${year}`;
}

/**
 * Normalize header name (for comparison)
 */
export function normalizeHeaderName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}


export function lowerEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function formatBatchCode(code) {
  if (!code) return '';
  const str = String(code);
  if (str.includes('-')) return str;
  const digits = str.replace(/[^0-9]/g, '');
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

export function normalizeBsb(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 6);
  if (digits.length !== 6) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function normalizeAccountNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '').trim();
}

export const buildBlacklistKey = (bsb, account) => {
  const normalizedBsb = normalizeBsb(bsb);
  const normalizedAccount = normalizeAccountNumber(account);
  if (!normalizedBsb || !normalizedAccount) return null;
  return `${normalizedBsb}|${normalizedAccount}`;
};

export function decodeBase64File(fileData) {
  const normalized = String(fileData).includes(',')
    ? String(fileData).split(',').pop()
    : String(fileData);
  return Buffer.from(normalized, 'base64');
}

export function sanitizeFileName(name) {
  return String(name || '').trim();
}

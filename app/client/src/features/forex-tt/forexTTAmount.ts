export function parseForexTTAmount(value: string): number | null {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;

  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function formatForexTTAmount(value: number | string | undefined): string {
  if (value === undefined || value === null || value === '') return '';

  const amount = typeof value === 'number' ? value : parseForexTTAmount(value);
  if (amount === null || !Number.isFinite(amount)) return '';

  return new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
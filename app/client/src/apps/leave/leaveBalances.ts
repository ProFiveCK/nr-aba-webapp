/** Preserve the six-decimal precision used by the leave ledger. */
export const leaveDays = (value: string | number) => Number(value).toLocaleString('en-AU', { maximumFractionDigits: 6 });

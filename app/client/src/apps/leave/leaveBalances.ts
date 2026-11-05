// Balances accrue in millionths of a day; people read them to two decimal places.
export const leaveDays = (value: string | number) => Number(value).toLocaleString('en-AU', { maximumFractionDigits: 2 });

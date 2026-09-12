import { describe, expect, it } from 'vitest';
import { formatForexTTAmount, parseForexTTAmount } from './forexTTAmount';

describe('FOREX TT amount handling', () => {
  it('formats amounts with grouping separators and two decimal places', () => {
    expect(formatForexTTAmount('1250000.5')).toBe('1,250,000.50');
  });

  it('parses grouped amounts and rejects invalid precision or negative values', () => {
    expect(parseForexTTAmount('1,250,000.50')).toBe(1250000.5);
    expect(parseForexTTAmount('10.123')).toBeNull();
    expect(parseForexTTAmount('-1.00')).toBeNull();
  });
});
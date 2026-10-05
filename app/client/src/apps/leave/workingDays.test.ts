import { describe, expect, it } from 'vitest';
import { calculateWorkingDays } from './types';

// Mon 8 Jun to Fri 12 Jun 2026 is a five-day working week.
const WEEK: [string, string] = ['2026-06-08', '2026-06-12'];

describe('calculateWorkingDays', () => {
    it('counts a plain working week', () => {
        expect(calculateWorkingDays(...WEEK)).toBe(5);
    });

    it('excludes weekends inside a range', () => {
        expect(calculateWorkingDays('2026-06-08', '2026-06-15')).toBe(6);
    });

    it('is zero for a weekend-only range', () => {
        expect(calculateWorkingDays('2026-06-13', '2026-06-14')).toBe(0);
    });

    it('is zero when the end precedes the start', () => {
        expect(calculateWorkingDays('2026-06-12', '2026-06-08')).toBe(0);
    });

    it('does not count a public holiday', () => {
        expect(calculateWorkingDays(...WEEK, ['2026-06-10'])).toBe(4);
    });

    it('ignores a holiday that falls on a weekend', () => {
        expect(calculateWorkingDays('2026-06-08', '2026-06-14', ['2026-06-13'])).toBe(5);
    });

    it('ignores a holiday outside the range', () => {
        expect(calculateWorkingDays(...WEEK, ['2026-07-01'])).toBe(5);
    });

    it('accepts a Set', () => {
        expect(calculateWorkingDays(...WEEK, new Set(['2026-06-10']))).toBe(4);
    });

    it('does not shift the day at UTC+12', () => {
        // The suite runs pinned to Pacific/Nauru. Stepping dates through
        // toISOString would move 1 January onto the previous year.
        expect(calculateWorkingDays('2026-01-01', '2026-01-01')).toBe(1);
        expect(calculateWorkingDays('2026-01-01', '2026-01-01', ['2026-01-01'])).toBe(0);
    });

    it('handles a single working day', () => {
        expect(calculateWorkingDays('2026-06-10', '2026-06-10')).toBe(1);
    });
});

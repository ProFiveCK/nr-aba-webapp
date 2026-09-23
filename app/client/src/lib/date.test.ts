import { describe, expect, it } from 'vitest';
import { toDateInputValue, toIsoDate, todayIsoDate } from './date';

/** Minutes the test machine is ahead of UTC (Naoero is +720). */
const offsetMinutes = -new Date().getTimezoneOffset();

describe('toIsoDate', () => {
    it('keeps the local calendar day', () => {
        expect(toIsoDate(new Date(2026, 0, 1))).toBe('2026-01-01');
        expect(toIsoDate(new Date(2026, 8, 24))).toBe('2026-09-24');
    });

    it('pads single-digit months and days', () => {
        expect(toIsoDate(new Date(2026, 2, 7))).toBe('2026-03-07');
    });

    it('does not shift across a year boundary at local midnight', () => {
        // The regression this file exists for: at UTC+12 the old
        // toISOString().slice(0, 10) turned this into 2025-12-31, so the
        // "This year" preset asked the API for the wrong year entirely.
        expect(toIsoDate(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01');
    });

    it('handles the last moment of a day', () => {
        expect(toIsoDate(new Date(2026, 5, 30, 23, 59, 59))).toBe('2026-06-30');
    });

    it.runIf(offsetMinutes > 0)('disagrees with toISOString ahead of UTC', () => {
        // Guards the fix itself: where the bug was possible, prove the helper
        // is not simply doing what the old code did.
        const midnight = new Date(2026, 0, 1);
        expect(midnight.toISOString().slice(0, 10)).toBe('2025-12-31');
        expect(toIsoDate(midnight)).toBe('2026-01-01');
    });
});

describe('toDateInputValue', () => {
    it('takes a plain date string verbatim', () => {
        expect(toDateInputValue('2026-09-24')).toBe('2026-09-24');
    });

    it('takes the date part of a timestamp verbatim, without reparsing', () => {
        // A UTC timestamp near midnight must not be shifted into the next day
        // just because the viewer is ahead of UTC.
        expect(toDateInputValue('2026-09-24T00:00:00.000Z')).toBe('2026-09-24');
    });

    it('reads a Date as its local calendar day', () => {
        expect(toDateInputValue(new Date(2026, 0, 1))).toBe('2026-01-01');
    });

    it('gives an empty string for missing or unusable input', () => {
        expect(toDateInputValue(null)).toBe('');
        expect(toDateInputValue(undefined)).toBe('');
        expect(toDateInputValue('')).toBe('');
        expect(toDateInputValue('not a date')).toBe('');
        expect(toDateInputValue(new Date('nonsense'))).toBe('');
    });
});

describe('todayIsoDate', () => {
    it('agrees with the local clock', () => {
        const now = new Date();
        expect(todayIsoDate()).toBe(
            `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        );
    });
});

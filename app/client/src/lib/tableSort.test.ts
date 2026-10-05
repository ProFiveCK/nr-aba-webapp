import { describe, expect, it } from 'vitest';
import { compareCells } from './tableSort';

const order = <T>(values: T[], direction: 'asc' | 'desc') =>
    values.slice().sort((a, b) => compareCells(a, b, direction));

describe('compareCells', () => {
    it('compares numbers numerically, not as text', () => {
        // The bug this guards: as strings, "10" sorts before "9".
        expect(order([9, 10, 2], 'asc')).toEqual([2, 9, 10]);
        expect(order([9, 10, 2], 'desc')).toEqual([10, 9, 2]);
    });

    it('compares anything else as text', () => {
        expect(order(['Ben', 'ana', 'Cara'], 'asc')).toEqual(['ana', 'Ben', 'Cara']);
    });

    // Sorting a column descending to find the largest value should not fill
    // the top of the table with people who have no value at all.
    it('sinks blanks to the bottom whichever way the column points', () => {
        expect(order(['FIN', null, 'HR'], 'asc')).toEqual(['FIN', 'HR', null]);
        expect(order(['FIN', null, 'HR'], 'desc')).toEqual(['HR', 'FIN', null]);
        expect(order([5, '', 2], 'desc')).toEqual([5, 2, '']);
        expect(order([5, undefined, 2], 'asc')).toEqual([2, 5, undefined]);
    });

    it('treats zero as a real value rather than a blank', () => {
        expect(order([0, 3, 1], 'desc')).toEqual([3, 1, 0]);
        expect(order([0, null, 1], 'desc')).toEqual([1, 0, null]);
    });

    it('reports two blanks as equal, so the caller\'s tie-break decides', () => {
        expect(compareCells(null, '', 'asc')).toBe(0);
        expect(compareCells(null, '', 'desc')).toBe(0);
    });
});

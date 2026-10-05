import { useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
    key: K;
    direction: SortDirection;
}

/**
 * Column sorting for a table rendered from an array already in memory.
 *
 * Clicking the column that is already sorted reverses it; clicking a new one
 * starts it at `defaultDirection`, which is per column because the useful
 * first look differs: a name wants A–Z, a number of days wants the largest
 * first.
 */
export function useTableSort<K extends string>(initial: SortState<K>) {
    const [sort, setSort] = useState<SortState<K>>(initial);
    const toggle = (key: K, defaultDirection: SortDirection = 'desc') => {
        setSort((current) => (current.key === key
            ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
            : { key, direction: defaultDirection }));
    };
    return { sort, toggle };
}

/**
 * Orders two cell values. Numbers compare numerically and anything else as
 * text, so a column of days sorts 9 before 10 rather than after it.
 *
 * A blank — no department recorded, no balance for a type — always sinks to
 * the bottom whichever way the column is pointing. Sorting descending to find
 * the largest should not fill the top of the table with people who have no
 * value at all.
 */
export function compareCells(a: unknown, b: unknown, direction: SortDirection): number {
    const blank = (value: unknown) => value === null || value === undefined || value === '';
    if (blank(a) && blank(b)) return 0;
    if (blank(a)) return 1;
    if (blank(b)) return -1;

    const flip = direction === 'asc' ? 1 : -1;
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * flip;
    return String(a).localeCompare(String(b)) * flip;
}

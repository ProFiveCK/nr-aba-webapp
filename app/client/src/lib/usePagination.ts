import { useState } from 'react';

export const PAGE_SIZE = 50;

/** The slice of `rows` on page `page` (0-based), with the page clamped into range. */
export function paginate<T>(rows: T[], page: number, pageSize = PAGE_SIZE) {
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const current = Math.min(Math.max(0, page), pageCount - 1);
    return {
        pageRows: rows.slice(current * pageSize, (current + 1) * pageSize),
        page: current,
        pageCount,
        total: rows.length,
        pageSize,
    };
}

/**
 * Client-side paging for a table whose rows are already in memory.
 *
 * Pass the search/filter text as `resetKey` so a new search starts at page 1;
 * a shrinking list (a row deleted on the last page) is clamped instead.
 */
export function usePagination<T>(rows: T[], resetKey = '', pageSize = PAGE_SIZE) {
    const [page, setPage] = useState(0);
    const [lastKey, setLastKey] = useState(resetKey);
    if (lastKey !== resetKey) {
        setLastKey(resetKey);
        setPage(0);
    }
    return { ...paginate(rows, page, pageSize), setPage };
}

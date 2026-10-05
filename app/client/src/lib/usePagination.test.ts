import { describe, expect, it } from 'vitest';
import { paginate } from './usePagination';

const rows = Array.from({ length: 120 }, (_, i) => i);

describe('paginate', () => {
    it('slices pages of 50', () => {
        expect(paginate(rows, 0).pageRows).toEqual(rows.slice(0, 50));
        expect(paginate(rows, 2).pageRows).toEqual(rows.slice(100, 120));
        expect(paginate(rows, 0).pageCount).toBe(3);
    });

    it('clamps a page past the end, e.g. after a filter shrinks the list', () => {
        const result = paginate(rows.slice(0, 30), 2);
        expect(result.page).toBe(0);
        expect(result.pageRows).toHaveLength(30);
    });

    it('treats an empty list as one empty page', () => {
        expect(paginate([], 0)).toMatchObject({ page: 0, pageCount: 1, total: 0, pageRows: [] });
    });
});

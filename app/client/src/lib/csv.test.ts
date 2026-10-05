import { describe, expect, it } from 'vitest';
import { csvCell, parseCsv } from './csv';

describe('parseCsv', () => {
    it('reads plain rows', () => {
        expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    });

    it('keeps commas inside quoted fields', () => {
        expect(parseCsv('name,dept\n"Doe, Ana",FIN')).toEqual([['name', 'dept'], ['Doe, Ana', 'FIN']]);
    });

    it('unescapes doubled quotes', () => {
        expect(parseCsv('a\n"She said ""hi"""')).toEqual([['a'], ['She said "hi"']]);
    });

    it('handles a newline inside a quoted field', () => {
        expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([['a', 'b'], ['line1\nline2', 'x']]);
    });

    it('accepts CRLF line endings, as Excel writes them', () => {
        expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    });

    it('drops blank rows rather than importing empty staff', () => {
        expect(parseCsv('a,b\n\n1,2\n   \n')).toEqual([['a', 'b'], ['1', '2']]);
    });

    it('keeps empty fields within a row that has content', () => {
        expect(parseCsv('a,b,c\n1,,3')).toEqual([['a', 'b', 'c'], ['1', '', '3']]);
    });

    it('returns nothing for empty input', () => {
        expect(parseCsv('')).toEqual([]);
    });
});

describe('csvCell', () => {
    it('leaves a plain value alone', () => {
        expect(csvCell('Ana')).toBe('Ana');
    });

    it('quotes a value containing a comma', () => {
        expect(csvCell('Doe, Ana')).toBe('"Doe, Ana"');
    });

    it('quotes and escapes embedded quotes', () => {
        expect(csvCell('She said "hi"')).toBe('"She said ""hi"""');
    });

    it('quotes a value containing a newline', () => {
        expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    });

    it('renders null and undefined as empty, not as the words', () => {
        expect(csvCell(null)).toBe('');
        expect(csvCell(undefined)).toBe('');
    });

    it('renders numbers and booleans', () => {
        expect(csvCell(12.5)).toBe('12.5');
        expect(csvCell(0)).toBe('0');
        expect(csvCell(false)).toBe('false');
    });

    it('round-trips through parseCsv', () => {
        const row = ['Doe, Ana', 'She said "hi"', 'plain'];
        expect(parseCsv(row.map(csvCell).join(','))).toEqual([row]);
    });
});

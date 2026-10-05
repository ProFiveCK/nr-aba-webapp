import { describe, expect, it } from 'vitest';
import type { HeaderData, Transaction } from '../pages/Generator/types';
import { buildAbaFile, buildDuplicateKey, parseTransactionsFromCSV, recomputeDuplicates } from './generator-utils';

// The CBA-RON preset, with a fixed processing date so the output is stable.
const HEADER: HeaderData = {
    fi: 'CBA',
    reel: '1',
    user: 'RON Government',
    apca: '301500',
    desc: 'PAYROLL',
    proc: '061026',
    trace_bsb: '064-000',
    trace_acct: '16744795',
    remitter: 'RON Government',
    balance_required: true,
    balance_txn_code: '13',
    balance_bsb: '064-000',
    balance_acct: '16744795',
    balance_title: 'Treasury OPA - CBA',
};

const tx = (overrides: Partial<Transaction> = {}): Transaction => ({
    bsb: '082-001',
    account: '12345678',
    amount: 1234567.89,
    accountTitle: 'Ana Example',
    lodgementRef: 'SAL OCT 26',
    txnCode: '53',
    ...overrides,
});

const sp = (n: number) => ' '.repeat(n);

/** Splits on the CRLF the generator writes, dropping the empty tail. */
const lines = (file: string) => file.split('\r\n').slice(0, -1);

/** Reads the type-7 money fields (net, credits, debits) and the record count. */
const trailer = (file: string) => {
    const t7 = lines(file).at(-1)!;
    return {
        net: Number(t7.slice(20, 30)),
        credits: Number(t7.slice(30, 40)),
        debits: Number(t7.slice(40, 50)),
        count: Number(t7.slice(74, 80)),
    };
};

describe('buildAbaFile: record layouts (hand-checked)', () => {
    const file = buildAbaFile(HEADER, [tx()]);
    const [t0, t1, bal, t7] = lines(file);

    it('writes header, one credit, the balancing debit and the trailer, CRLF-terminated', () => {
        expect(lines(file)).toHaveLength(4);
        expect(file.endsWith('\r\n')).toBe(true);
        expect(file.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    });

    it('every record is exactly 120 characters', () => {
        for (const line of lines(file)) expect(line).toHaveLength(120);
    });

    it('type 0 header', () => {
        expect(t0).toBe(
            '0' + sp(17) + '01' + 'CBA' + sp(7) +
            'RON Government' + sp(12) + // user name, 26
            '301500' +                  // APCA user id, 6
            'PAYROLL' + sp(5) +         // description, 12
            '061026' +                  // processing date DDMMYY
            sp(40)
        );
    });

    it('type 1 credit (code 53)', () => {
        expect(t1).toBe(
            '1' + '082-001' + ' 12345678' + ' ' + '53' +
            '0123456789' +                // $1,234,567.89 in cents, zero-filled to 10
            'Ana Example' + sp(21) +       // title, 32
            'SAL OCT 26' + sp(8) +         // lodgement ref, 18
            '064-000' + ' 16744795' +      // trace BSB + account
            'RON Government' + sp(2) +     // remitter, 16
            '00000000'                     // withholding tax
        );
    });

    it('type 1 balancing debit (code 13) equals the credits', () => {
        expect(bal).toBe(
            '1' + '064-000' + ' 16744795' + ' ' + '13' +
            '0123456789' +
            'Treasury OPA - CBA' + sp(14) +
            'PAYROLL-061026' + sp(4) +     // desc + "-" + proc
            '064-000' + ' 16744795' +
            'RON Government' + sp(2) +
            '00000000'
        );
    });

    it('type 7 trailer: net 0, credits = debits, count includes the balancing line', () => {
        expect(t7).toBe(
            '7' + '999-999' + sp(12) +
            '0000000000' + // net
            '0123456789' + // credits
            '0123456789' + // debits
            sp(24) +
            '000002' +     // record count
            sp(40)
        );
    });
});

describe('buildAbaFile: amounts and totals', () => {
    it('converts to cents without float drift', () => {
        const file = buildAbaFile(HEADER, [
            tx({ amount: 0.1, lodgementRef: 'A' }),
            tx({ amount: 0.2, lodgementRef: 'B' }),
            tx({ amount: 1.15, lodgementRef: 'C' }),   // 1.15 * 100 = 114.99999999999999
            tx({ amount: 4.35, lodgementRef: 'D' }),   // 4.35 * 100 = 434.99999999999994
        ]);
        const amounts = lines(file).slice(1, 5).map((l) => l.slice(20, 30));
        expect(amounts).toEqual(['0000000010', '0000000020', '0000000115', '0000000435']);
        expect(trailer(file).credits).toBe(580);
    });

    it('accepts amounts given as strings, as the payload sometimes carries them', () => {
        const file = buildAbaFile(HEADER, [tx({ amount: '1234567.89' as unknown as number })]);
        expect(lines(file)[1].slice(20, 30)).toBe('0123456789');
    });

    it('trailer totals and count equal the sum of the detail lines', () => {
        const amounts = [0.01, 19.99, 250, 1234567.89, 0.1, 0.2, 99999.99];
        const file = buildAbaFile(HEADER, amounts.map((amount, i) => tx({ amount, lodgementRef: `R${i}` })));
        const details = lines(file).filter((l) => l[0] === '1');
        const credits = details.filter((l) => l.slice(18, 20) === '53').reduce((s, l) => s + Number(l.slice(20, 30)), 0);
        const debits = details.filter((l) => l.slice(18, 20) === '13').reduce((s, l) => s + Number(l.slice(20, 30)), 0);

        expect(credits).toBe(133483818); // 1 + 1999 + 25000 + 123456789 + 10 + 20 + 9999999
        expect(debits).toBe(credits);
        expect(trailer(file)).toEqual({ net: 0, credits, debits, count: details.length });
        expect(details).toHaveLength(amounts.length + 1);
    });

    it('rejects a single amount over 10 digits of cents', () => {
        expect(() => buildAbaFile(HEADER, [tx({ amount: 100000000 })])).toThrow(/exceeds maximum/);
        expect(() => buildAbaFile(HEADER, [tx({ amount: 99999999.99 })])).not.toThrow();
    });

    // BUG: generator-utils.ts checks each row against 9999999999 cents but never
    // the running total. Two rows of $60,000,000.00 sum to 12000000000 cents
    // (11 digits); padL(..., 10) keeps the last ten, so the balancing debit and
    // the type-7 credits/debits read 2000000000 ($20,000,000.00) and the file
    // silently disagrees with its own detail lines.
    it.todo('rejects a batch whose total overflows the 10-digit trailer fields', () => {
        expect(() =>
            buildAbaFile(HEADER, [tx({ amount: 60000000, lodgementRef: 'A' }), tx({ amount: 60000000, lodgementRef: 'B' })])
        ).toThrow();
    });
});

describe('buildAbaFile: BSB and field widths', () => {
    it('formats BSBs as NNN-NNN whatever the input separator', () => {
        for (const bsb of ['082001', '082 001', ' 082-001 ', '082.001']) {
            expect(lines(buildAbaFile(HEADER, [tx({ bsb })]))[1].slice(1, 8)).toBe('082-001');
        }
    });

    it('right-justifies short accounts and strips their punctuation', () => {
        const line = lines(buildAbaFile(HEADER, [tx({ account: '12-345' })]))[1];
        expect(line.slice(8, 17)).toBe('    12345');
    });

    it('truncates long text fields instead of shifting the columns', () => {
        const file = buildAbaFile(
            { ...HEADER, user: 'A'.repeat(40), desc: 'D'.repeat(20), remitter: 'R'.repeat(30), balance_title: 'B'.repeat(40) },
            [tx({ accountTitle: 'T'.repeat(40), lodgementRef: 'L'.repeat(25) })]
        );
        const [t0, t1, bal] = lines(file);
        expect(t0.slice(30, 56)).toBe('A'.repeat(26));
        expect(t0.slice(56, 62)).toBe('301500');
        expect(t0.slice(62, 74)).toBe('D'.repeat(12));
        expect(t1.slice(30, 62)).toBe('T'.repeat(32));
        expect(t1.slice(62, 80)).toBe('L'.repeat(18));
        expect(t1.slice(96, 112)).toBe('R'.repeat(16));
        expect(t1.slice(112)).toBe('00000000');
        expect(bal.slice(30, 62)).toBe('B'.repeat(32));
        expect(bal.slice(62, 80)).toBe('D'.repeat(12) + '-06102'); // 12 + "-" + proc, cut to 18
        for (const line of lines(file)) expect(line).toHaveLength(120);
    });

    // BUG: the 120-character check is on UTF-16 units, but the file is shipped
    // as UTF-8 (toBase64 encodes UTF-8). A payee title such as "José" makes
    // that record 121 bytes, which a fixed-width bank parser misreads. Non-ASCII
    // text is neither rejected nor transliterated in generator-utils.ts.
    it.todo('keeps every record at 120 bytes when a name has non-ASCII letters', () => {
        const file = buildAbaFile(HEADER, [tx({ accountTitle: 'José Example' })]);
        for (const line of lines(file)) expect(new TextEncoder().encode(line)).toHaveLength(120);
    });
});

describe('buildAbaFile: rejects invalid input', () => {
    const rejects = (overrides: Partial<Transaction>, message: RegExp) =>
        expect(() => buildAbaFile(HEADER, [tx(overrides)])).toThrow(message);

    it('BSB not exactly six digits', () => {
        rejects({ bsb: '082-01' }, /BSB must be 6 digits/);
        rejects({ bsb: '082-0011' }, /BSB must be 6 digits/);
        rejects({ bsb: '' }, /BSB must be 6 digits/);
    });

    it('account outside 5-9 digits', () => {
        rejects({ account: '1234' }, /Account must be 5–9 digits/);
        rejects({ account: '1234567890' }, /Account must be 5–9 digits/);
    });

    // BUG: generator-utils.ts strips every non-digit before the length check, so
    // a mistyped letter O for a zero passes: "12345678O" is accepted as account
    // 12345678 — a different, valid-length account receives the money.
    it.todo('account containing letters', () => {
        rejects({ account: '12345678O' }, /Account must be 5–9 digits/);
    });

    it('non-positive or non-numeric amount', () => {
        rejects({ amount: 0 }, /positive number/);
        rejects({ amount: -5 }, /positive number/);
        rejects({ amount: NaN }, /positive number/);
    });

    it('blank lodgement reference', () => {
        rejects({ lodgementRef: '   ' }, /Lodgement Ref is required/);
    });

    it('names the failing row', () => {
        expect(() => buildAbaFile(HEADER, [tx(), tx({ bsb: '1' })])).toThrow(/^Row 2:/);
    });

    it('bad header or balancing account', () => {
        expect(() => buildAbaFile({ ...HEADER, apca: '30150' }, [tx()])).toThrow(/APCA/);
        expect(() => buildAbaFile({ ...HEADER, user: '' }, [tx()])).toThrow(/User Name/);
        expect(() => buildAbaFile({ ...HEADER, remitter: '' }, [tx()])).toThrow(/Remitter/);
        expect(() => buildAbaFile({ ...HEADER, balance_bsb: '064-00' }, [tx()])).toThrow(/Balance BSB/);
        expect(() => buildAbaFile({ ...HEADER, balance_acct: '1234' }, [tx()])).toThrow(/Balance Account/);
    });
});

describe('duplicate detection', () => {
    it('treats formatting differences in BSB, account, amount and reference case as the same payment', () => {
        expect(buildDuplicateKey(tx({ bsb: '082001', account: '12-345-678', amount: 1234567.89, lodgementRef: ' sal oct 26 ' })))
            .toBe(buildDuplicateKey(tx()));
    });

    it('groups only exact repeats', () => {
        const rows = [
            tx(),
            tx({ amount: 1234567.88 }),           // different cents
            tx({ bsb: '082 001' }),               // same as row 0
            tx({ lodgementRef: 'SAL NOV 26' }),   // different reference
            tx({ lodgementRef: '' }),             // no reference: never a duplicate
            tx({ lodgementRef: '' }),
        ];
        const { duplicateGroups, duplicateIndexSet, duplicateIndexToGroup } = recomputeDuplicates(rows);
        expect(duplicateGroups).toEqual([[0, 2]]);
        expect([...duplicateIndexSet]).toEqual([0, 2]);
        expect(duplicateIndexToGroup.get(2)).toEqual([0, 2]);
    });
});

describe('parseTransactionsFromCSV', () => {
    it('reads a headed file, strips $ and thousands separators, and reports bad rows by line', () => {
        const csv = [
            'Account Title,BSB,Account Number,Amount,Lodgement Reference',
            'Ana Example,082-001,12345678,"$1,234,567.89",SAL OCT 26',
            'No Money,082-001,12345678,0,X',
            'No Bsb,,12345678,10,X',
        ].join('\n');
        const { transactions, errors } = parseTransactionsFromCSV(csv);
        expect(transactions).toEqual([tx()]);
        expect(errors).toEqual(['Row 3: Invalid amount "0"', 'Row 4: Missing BSB or Account']);
    });

    it('falls back to BSB, account, amount, title, reference order without a header', () => {
        const { transactions } = parseTransactionsFromCSV('082-001,12345678,1234567.89,Ana Example,SAL OCT 26');
        expect(transactions).toEqual([tx()]);
    });
});

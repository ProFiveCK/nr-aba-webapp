import { describe, expect, it } from 'vitest';
import type { HeaderData, Transaction } from '../pages/Generator/types';
import { buildAbaFile } from './generator-utils';
import { parseAba } from './abaParser';

const HEADER: HeaderData = {
    fi: 'CBA', reel: '1', user: 'RON Government', apca: '301500', desc: 'PAYROLL', proc: '061026',
    trace_bsb: '064-000', trace_acct: '16744795', remitter: 'RON Government',
    balance_required: true, balance_txn_code: '13', balance_bsb: '064-000', balance_acct: '16744795',
    balance_title: 'Treasury OPA - CBA',
};

const tx = (amount: number, lodgementRef: string, account = '12345678'): Transaction => ({
    bsb: '082-001', account, amount, accountTitle: 'Ana Example', lodgementRef, txnCode: '53',
});

// The Reader and Reviewer pages show a submitted file through parseAba, so a
// generated file must read back as exactly what was entered.
describe('parseAba reads back a generated file', () => {
    it('round-trips header, payments, balancing line and control totals', () => {
        const parsed = parseAba(buildAbaFile(HEADER, [tx(0.1, 'A'), tx(1234567.89, 'B', '1234567')]));

        expect(parsed.errors).toEqual([]);
        expect(parsed.header).toEqual({ reel: '01', fi: 'CBA', user: 'RON Government', apca: '301500', desc: 'PAYROLL', proc: '061026' });
        expect(parsed.transactions.map((t) => [t.bsb, t.account, t.cents, t.txnCode, t.lodgementRef])).toEqual([
            ['082-001', '12345678', 10, '53', 'A'],
            ['082-001', '1234567', 123456789, '53', 'B'],
            ['064-000', '16744795', 123456799, '13', 'PAYROLL-061026'],
        ]);
        expect(parsed.balancing).toEqual({ bsb: '064-000', account: '16744795', amount: 123456799, title: 'Treasury OPA - CBA' });
        expect(parsed.control).toEqual({ net: 0, credits: 123456799, debits: 123456799, count: 3 });
    });

    it('warns when the control credits do not match the detail lines', () => {
        const file = buildAbaFile(HEADER, [tx(10, 'A')]);
        const tampered = file.replace(/^(7.{29})0000001000/m, '$10000001001');
        expect(parseAba(tampered).errors).toEqual([expect.stringMatching(/does not match Control credits/)]);
    });

    it('marks repeated payments as duplicates', () => {
        const parsed = parseAba(buildAbaFile(HEADER, [tx(10, 'A'), tx(10, 'a'), tx(10, 'B')]));
        expect(parsed.duplicates).toEqual({ sets: 1, rows: 2 });
        expect(parsed.transactions.map((t) => Boolean(t.isDuplicate))).toEqual([true, true, false, false]);
    });
});

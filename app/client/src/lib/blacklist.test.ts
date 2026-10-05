import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../pages/Generator/types';

const get = vi.fn();
vi.mock('./api', () => ({ apiClient: { get: (...args: unknown[]) => get(...args) } }));

const { refreshActiveBlacklist, isBlacklistedCombo, findBlockedTransactions, getBlockedIndexSet } = await import('./blacklist');

const tx = (bsb: string, account: string): Transaction => ({
    bsb, account, amount: 10, accountTitle: '', lodgementRef: 'X', txnCode: '53',
});

// What /api/blacklist/active returns: one blocked account, one whole blocked BSB.
const ACTIVE = [
    { id: 1, bsb: '082-001', account: '12345678', all_accounts: false, active: true },
    { id: 2, bsb: '999 999', account: '', all_accounts: true, active: true },
];

describe('blacklist', () => {
    beforeEach(async () => {
        get.mockReset().mockResolvedValue(ACTIVE);
        await refreshActiveBlacklist();
    });

    it('reads the active list from the backend', () => {
        expect(get).toHaveBeenCalledWith('/blacklist/active');
    });

    it('blocks a listed account however the BSB and account are punctuated', () => {
        expect(isBlacklistedCombo('082-001', '12345678')).toBe(true);
        expect(isBlacklistedCombo('082001', '12-345-678')).toBe(true);
        expect(isBlacklistedCombo(' 082 001 ', ' 12345678 ')).toBe(true);
    });

    it('does not block a different account at the same BSB', () => {
        expect(isBlacklistedCombo('082-001', '12345679')).toBe(false);
        expect(isBlacklistedCombo('082-002', '12345678')).toBe(false);
    });

    it('blocks every account at an all-accounts BSB', () => {
        expect(isBlacklistedCombo('999-999', '1')).toBe(true);
        expect(isBlacklistedCombo('999999', '87654321')).toBe(true);
    });

    it('flags the blocked rows by index', () => {
        const rows = [tx('082-001', '11111'), tx('082001', '12345678'), tx('999-999', '55555'), tx('', '12345678')];
        expect(findBlockedTransactions(rows)).toEqual([rows[1], rows[2]]);
        expect([...getBlockedIndexSet(rows)]).toEqual([1, 2]);
    });

    it('keeps the last good list when a refresh fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        get.mockRejectedValueOnce(new Error('offline'));
        await refreshActiveBlacklist();
        expect(isBlacklistedCombo('082-001', '12345678')).toBe(true);
    });

    it('drops entries that are removed or deactivated on the next refresh', async () => {
        get.mockResolvedValueOnce([]);
        await refreshActiveBlacklist();
        expect(isBlacklistedCombo('082-001', '12345678')).toBe(false);
        expect(isBlacklistedCombo('999-999', '1')).toBe(false);
    });
});

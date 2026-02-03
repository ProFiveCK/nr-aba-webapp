/**
 * Blacklist Management
 * Functions for checking transactions against blocked accounts
 */

import type { Transaction } from '../pages/Generator/types';
import { normalizeBSBStrict, normalizeAccountStrict } from './utils';
import { apiClient } from './api';

export interface BlacklistEntry {
    id: number;
    bsb: string;
    account: string;
    label?: string;
    notes?: string;
    active: boolean;
}

// In-memory cache
let activeBlacklistEntries: BlacklistEntry[] = [];
let activeBlacklistSet = new Set<string>();

/**
 * Build blacklist key from BSB and account
 */
function buildBlacklistKey(bsb: string, account: string): string | null {
    const normalizedBsb = normalizeBSBStrict(bsb);
    const normalizedAccount = normalizeAccountStrict(account);
    if (!normalizedBsb || !normalizedAccount) return null;
    return `${normalizedBsb}|${normalizedAccount}`;
}

/**
 * Check if a BSB/account combination is blacklisted
 */
export function isBlacklistedCombo(bsb: string, account: string): boolean {
    const key = buildBlacklistKey(bsb, account);
    return key ? activeBlacklistSet.has(key) : false;
}

/**
 * Get blacklist entry details for a BSB/account combination
 */
export function getBlacklistDetails(bsb: string, account: string): BlacklistEntry | null {
    const normalizedBsb = normalizeBSBStrict(bsb);
    const normalizedAccount = normalizeAccountStrict(account);
    if (!normalizedBsb || !normalizedAccount) return null;

    return (
        activeBlacklistEntries.find((entry) => {
            const entryBsb = normalizeBSBStrict(entry.bsb);
            const entryAccount = normalizeAccountStrict(entry.account);
            return entryBsb === normalizedBsb && entryAccount === normalizedAccount;
        }) || null
    );
}

/**
 * Refresh the active blacklist from the backend
 */
export async function refreshActiveBlacklist(): Promise<void> {
    try {
        const entries = await apiClient.get<BlacklistEntry[]>('/blacklist/active');
        activeBlacklistEntries = Array.isArray(entries) ? entries : [];

        activeBlacklistSet = new Set(
            activeBlacklistEntries
                .map((entry) => {
                    const bsb = normalizeBSBStrict(entry.bsb);
                    const account = normalizeAccountStrict(entry.account);
                    if (!bsb || !account) return null;
                    return `${bsb}|${account}`;
                })
                .filter((key): key is string => key !== null)
        );
    } catch (err) {
        console.warn('Unable to refresh blacklist', err);
        // Keep existing cache on error
    }
}

/**
 * Validate transactions against blacklist and return blocked ones
 */
export function findBlockedTransactions(transactions: Transaction[]): Transaction[] {
    return transactions.filter((tx) => tx.bsb && tx.account && isBlacklistedCombo(tx.bsb, tx.account));
}

/**
 * Create a Set of indices for blocked transactions
 */
export function getBlockedIndexSet(transactions: Transaction[]): Set<number> {
    const blocked = new Set<number>();
    transactions.forEach((tx, index) => {
        if (tx.bsb && tx.account && isBlacklistedCombo(tx.bsb, tx.account)) {
            blocked.add(index);
        }
    });
    return blocked;
}

import { todayIsoDate } from '../../lib/date';

/** One current (or overdue) account per type; future openings are never available. */
export function currentLeaveEntitlements<T extends { code: string; as_of: string; period_start: string; period_end: string }>(entitlements: T[], asOf = todayIsoDate()): T[] {
    const latest = new Map<string, T>();
    for (const entitlement of entitlements) {
        if (entitlement.as_of > asOf || entitlement.period_start > asOf) continue;
        const previous = latest.get(entitlement.code);
        if (!previous || entitlement.period_start > previous.period_start || entitlement.period_start === previous.period_start && entitlement.as_of > previous.as_of) latest.set(entitlement.code, entitlement);
    }
    const order = ['recreation', 'medical', 'special'];
    return [...latest.values()].sort((a, b) => {
        const rank = (code: string) => order.includes(code) ? order.indexOf(code) : order.length;
        return rank(a.code) - rank(b.code) || a.code.localeCompare(b.code);
    });
}

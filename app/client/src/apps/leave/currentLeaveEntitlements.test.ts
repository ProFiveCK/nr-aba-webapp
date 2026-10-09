import { expect, it } from 'vitest';
import { currentLeaveEntitlements } from './currentLeaveEntitlements';

it('shows one current balance per type without treating history or future credit as available', () => {
    const old = { id: 'old', code: 'medical', as_of: '2025-01-01', period_start: '2025-01-01', period_end: '2025-12-31' };
    const current = { ...old, id: 'current', as_of: '2026-01-01', period_start: '2026-01-01', period_end: '2026-12-31' };
    const future = { ...old, id: 'future', as_of: '2027-01-01', period_start: '2027-01-01', period_end: '2027-12-31' };
    expect(currentLeaveEntitlements([future, old, current], '2026-10-09')).toEqual([current]);
    expect(currentLeaveEntitlements([future], '2026-10-09')).toEqual([]);
});

it('retains an overdue balance for display and renewal follow-up rather than silently substituting future credit', () => {
    const overdue = { code: 'special', as_of: '2025-01-01', period_start: '2025-01-01', period_end: '2025-12-31' };
    expect(currentLeaveEntitlements([overdue], '2026-10-09')).toEqual([overdue]);
});

import { expect, it } from 'vitest';
import { leaveSetupSteps, nextLeaveSetupView } from './leaveSetup';
import type { LeavePolicyUsage } from './leaveSetup';

const usage: LeavePolicyUsage = {
    as_of: '2026-10-09', initial_setup: { adopted: true },
    current_policy: { id: 'policy', label: 'Government policy', effective_from: '2026-01-01', effective_to: '2027-12-31' },
    schedulers: { government: false, legacy: true },
    counts: { active_employees: 29, legacy_awaiting_migration: 8, legacy_excluded_contracts: 2, legacy_not_entitled: 2,
        government_active: 19, government_paused: 0, government_awaiting_activation: 0, government_missing_job_plans: 19 },
};
it('does not report staff transfer complete just because the policy and mappings were published', () => {
    expect(nextLeaveSetupView(usage)).toBe('rollout');
    expect(leaveSetupSteps(usage).find(s => s.view === 'rollout')?.ready).toBe(false);
    expect(nextLeaveSetupView({ ...usage, current_policy: null })).toBe('policies');
    expect(nextLeaveSetupView({ ...usage, initial_setup: { adopted: false } })).toBe('initial-setup');
});
it('distinguishes transferred staff from activation and scheduling still required', () => {
    const next = { ...usage, counts: { ...usage.counts, legacy_awaiting_migration: 0, government_awaiting_activation: 1 } };
    expect(nextLeaveSetupView(next)).toBe('employees');
    expect(leaveSetupSteps(next).find(s => s.view === 'employees')?.label).toBe('Finish staff activation');
    expect(leaveSetupSteps(next).find(s => s.view === 'accrual')?.ready).toBe(false);
    expect(nextLeaveSetupView({ ...next, counts: { ...next.counts, government_awaiting_activation: 0 } })).toBe('accrual');
    const paused = { ...next, counts: { ...next.counts, government_awaiting_activation: 0, government_paused: 1 } };
    expect(nextLeaveSetupView(paused)).toBe('employees');
    expect(leaveSetupSteps(paused).find(s => s.view === 'employees')?.ready).toBe(false);
});

export type LeavePolicyUsage = {
    as_of: string;
    counts: {
        active_employees: number;
        legacy_awaiting_migration: number;
        legacy_not_entitled: number;
        legacy_excluded_contracts: number;
        government_active: number;
        government_awaiting_activation: number;
        government_paused: number;
        government_missing_job_plans: number;
    };
    initial_setup: { adopted: boolean };
    current_policy: { id: string; label: string; effective_from: string; effective_to: string } | null;
    schedulers: { government: boolean; legacy: boolean };
};

export function leaveSetupSteps(usage: LeavePolicyUsage) {
    const remaining = usage.counts.legacy_awaiting_migration;
    const needsActivation = usage.counts.government_awaiting_activation > 0 || usage.counts.government_paused > 0;
    return [
        { view: 'policies', label: 'Government policy', ready: !!usage.current_policy,
            detail: usage.current_policy ? usage.current_policy.label : 'Publish the approved policy and its effective dates.' },
        { view: 'initial-setup', label: 'Match existing records', ready: usage.initial_setup.adopted,
            detail: usage.initial_setup.adopted ? 'Existing leave types and organisation are matched.' : 'Review the suggested leave type and department matches once.' },
        { view: 'organisation', label: 'Approvers', ready: null,
            detail: 'Choose the approval levels and nominate the people who approve leave.' },
        { view: !remaining && needsActivation ? 'employees' : 'rollout', label: !remaining && needsActivation ? 'Finish staff activation' : 'Move staff to Government leave', ready: remaining === 0 && !needsActivation,
            detail: remaining ? `${remaining} staff still need their balances and setup transferred.` : usage.counts.government_awaiting_activation ? `${usage.counts.government_awaiting_activation} staff need activation.` : usage.counts.government_paused ? `${usage.counts.government_paused} staff have paused activation. Review their employee record.` : 'All leave-entitled active staff have moved.' },
        { view: 'accrual', label: 'Automatic balances', ready: usage.counts.government_missing_job_plans === 0 && usage.schedulers.government && usage.counts.government_active > 0,
            detail: usage.counts.government_missing_job_plans ? `${usage.counts.government_missing_job_plans} staff need a balance schedule.` : usage.schedulers.government ? 'Scheduled balance updates are enabled.' : 'Enable the Government leave scheduler after reviewing the balance schedules.' },
    ];
}

export function nextLeaveSetupView(usage: LeavePolicyUsage) {
    if (!usage.current_policy) return 'policies';
    if (!usage.initial_setup.adopted) return 'initial-setup';
    if (usage.counts.legacy_awaiting_migration) return 'rollout';
    if (usage.counts.government_awaiting_activation || usage.counts.government_paused) return 'employees';
    return 'accrual';
}

import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { EmployeeManagement } from './EmployeeManagement';
import { LeaveSetupStatus } from './LeaveSetupStatus';
import type { LeavePolicyUsage } from './leaveSetup';

vi.mock('../../contexts/useAuth', () => ({
    useAuth: () => ({ user: { id: 'hr-admin', role: 'admin', permissions: { hr_admin: true, admin: true } } }),
}));
vi.mock('./GovernmentPayroll', () => ({ GovernmentPayroll: () => <p>Payroll instructions screen</p> }));
vi.mock('./GovernmentWorkflowManagement', () => ({ GovernmentWorkflowManagement: () => <p>Balance schedule controls</p> }));

function renderWorkspace(query: string, workspace: 'employees' | 'settings' = 'settings') {
    return renderToStaticMarkup(<MemoryRouter initialEntries={[`/leave/${workspace}${query}`]}>
        <EmployeeManagement workspace={workspace}/>
    </MemoryRouter>);
}

describe('current employee and settings navigation', () => {
    it.each(['rollout', 'initial-setup', 'import', 'setup', 'legacy-settings', 'operations', 'legacy'])('does not revive retired administration through view=%s', view => {
        const html = renderWorkspace(`?view=${view}`);
        expect(html).not.toContain('Staff transfer');
        expect(html).not.toContain('Payroll identities');
        expect(html).not.toContain('Retained Finance');
        expect(html).toContain('Loading settings');
    });
    it('keeps one direct employee creation action and removes the operations switcher', () => {
        const html = renderWorkspace('', 'employees');
        expect(html).toContain('Add employee');
        expect(html).not.toContain('Employee view');
        expect(html).not.toContain('Leave operations');
    });
    it('keeps payroll and balance administration explicitly reachable from settings', () => {
        expect(renderWorkspace('?view=payroll')).toContain('Payroll instructions screen');
        expect(renderWorkspace('?view=accrual')).toContain('Balance schedule controls');
    });
});

it('reports incomplete leave access without presenting a migration workflow', () => {
    const usage: LeavePolicyUsage = {
        as_of: '2026-10-09', current_policy: null, initial_setup: { adopted: false },
        schedulers: { government: false, legacy: true },
        counts: { active_employees: 8, government_active: 4, government_awaiting_activation: 2,
            government_paused: 1, government_missing_job_plans: 2, legacy_awaiting_migration: 1,
            legacy_not_entitled: 0, legacy_excluded_contracts: 0 },
    };
    const html = renderToStaticMarkup(<MemoryRouter><LeaveSetupStatus usage={usage} onOpen={() => {}}/></MemoryRouter>);
    expect(html).toContain('Access needs review');
    expect(html).toContain('No published policy covers today');
    expect(html).toContain('Employee accounts');
    expect(html).not.toMatch(/migration|transfer|second system|Finance administration/i);
});

import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { WorkQueue } from './sections/WorkQueue';
import { Employees } from './sections/Employees';
import { EmployeeApplications } from './EmployeeApplications';
import { ApplicationActions } from './ApplicationActions';
const auth = vi.hoisted(() => ({ permissions: {} as Record<string, boolean> }));
vi.mock('../../contexts/useAuth', () => ({ useAuth: () => ({ user: { id: 'test', permissions: auth.permissions } }) }));
vi.mock('./EmployeeManagement', () => ({ EmployeeManagement: () => <p>Employee directory editor</p> }));
vi.mock('./sections/Balances', () => ({ Balances: () => <p>Authorised balance browser</p> }));
const render = (node: ReactNode, path = '/leave/work-queue') => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
beforeEach(() => { auth.permissions = { hr_admin: true }; });
it('starts the work queue at approvals without setup or follow-up forms', () => {
    const html = render(<WorkQueue />);
    expect(html).toContain('Pending approvals');
    expect(html).toContain('Follow-ups');
    expect(html).not.toContain('Follow-up status');
    expect(html).not.toContain('Prepare balance schedule');
});
it('keeps specialist views inaccessible to an ordinary approver even through a query', () => {
    auth.permissions = { hr_leave_approve: true };
    const html = render(<WorkQueue />, '/leave/work-queue?view=followups');
    expect(html).toContain('Pending approvals');
    expect(html).not.toContain('Follow-up status');
    expect(html).not.toContain('Planning');
});
it('gives an HR officer employee records and balances under one right', () => {
    auth.permissions = { hr_officer: true };
    expect(render(<Employees />, '/leave/employees')).toContain('Employee directory editor');
    expect(render(<Employees />, '/leave/employees?view=balances')).toContain('Authorised balance browser');
});
it('gives an approver neither records nor balances', () => {
    auth.permissions = { hr_leave_approve: true };
    const html = render(<Employees />, '/leave/employees?view=balances');
    expect(html).not.toContain('Employee directory editor');
    expect(html).not.toContain('Authorised balance browser');
});
it('opens an employee at the leave list with application entry on demand', () => {
    const html = render(<EmployeeApplications employeeId="employee" canApply />);
    expect(html).toContain('Apply on behalf');
    expect(html).toContain('Application status');
    expect(html).not.toContain('Employee request / assisted-entry authority');
    expect(html).not.toContain('Supporting documents');
    expect(html).not.toContain('Follow-up status');
});
it('shows application actions as plain buttons, without a menu', () => {
    const html = render(<ApplicationActions actions={[{ label: 'Cancel application', onSelect: () => {} }]} />);
    expect(html).toContain('Cancel application');
    expect(html).not.toContain('aria-expanded');
});

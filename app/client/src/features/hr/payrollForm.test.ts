import { describe, expect, it } from 'vitest';
import { buildApprovedLeaveFormHtml } from './payrollForm';
import type { ApprovedLeavePayrollForm } from './payrollForm';

const form: ApprovedLeavePayrollForm = {
    id: 'form-1', employee_name: 'Ana', position_title: 'Analyst', department_code: 'TRE',
    supervisor_name: 'Manager', approved_by_name: 'Manager', leave_type_name: 'Annual',
    start_date: '2026-06-01', end_date: '2026-06-05', days: 5, reason: 'Family',
    applied_at: '2026-05-20', approved_at: '2026-05-21', balance_year: 2026,
    balances: [{ leave_type_id: 'annual', leave_type_name: 'Annual', before: 20, after: 15 }],
    approval_snapshot_available: true,
};

describe('approved leave payroll form', () => {
    it('includes the approval-time balances and requested fields', () => {
        const html = buildApprovedLeaveFormHtml(form);
        expect(html).toContain('Position / job title');
        expect(html).toContain('Reason for leave');
        expect(html).toContain('Supervisor signature');
        expect(html).toContain('20.00');
        expect(html).toContain('15.00');
    });

    it('escapes employee text and does not invent historical balances', () => {
        const html = buildApprovedLeaveFormHtml({
            ...form, employee_name: '<script>alert(1)</script>', reason: '<img src=x onerror=alert(1)>',
            approval_snapshot_available: false, balances: null,
        });
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).not.toContain('<img src=x onerror=alert(1)>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('Approval-time balances are unavailable');
        expect(html).not.toContain('20.00');
    });
});

import { apiClient } from '../../lib/api';
import { escapeHtml, printReport } from '../../lib/print';
import { formatDate } from './types';

export interface ApprovedLeavePayrollForm {
    id: string;
    employee_name: string;
    position_title: string | null;
    department_code: string | null;
    supervisor_name: string | null;
    approved_by_name: string | null;
    leave_type_name: string;
    start_date: string;
    end_date: string;
    days: number;
    reason: string | null;
    applied_at: string;
    approved_at: string;
    balance_year: number | null;
    balances: { leave_type_id: string; leave_type_name: string; before: number; after: number }[] | null;
    approval_snapshot_available: boolean;
}

const safe = (value: string | number | null | undefined) => escapeHtml(value == null || value === '' ? 'Not recorded' : String(value));
const days = (value: number) => Number(value).toFixed(2);

/** Temporary layout until the official HR form is supplied. All values are encoded. */
export function buildApprovedLeaveFormHtml(form: ApprovedLeavePayrollForm): string {
    const balances = form.approval_snapshot_available && form.balances
        ? `<table><thead><tr><th>Leave type</th><th class="right">Before approval</th><th class="right">After approval</th></tr></thead><tbody>${form.balances.map((balance) => `
            <tr${balance.leave_type_name === form.leave_type_name ? ' class="selected-type"' : ''}>
                <td>${safe(balance.leave_type_name)}</td><td class="right">${safe(days(balance.before))}</td><td class="right">${safe(days(balance.after))}</td>
            </tr>`).join('')}</tbody></table>
            <p class="note">Balances are in days for ${safe(form.balance_year)} and were captured when this leave was approved. The requested leave type is highlighted.</p>`
        : '<p class="missing">Approval-time balances are unavailable for this older request. Personnel details shown are current. Verify both in HR before sending this form to payroll.</p>';

    return `
        <style>
            @page { size: A4; margin: 18mm; }
            body { font-family: Arial, sans-serif; color: #12213b; margin: 28px; }
            .form-head { border-bottom: 3px solid #002B7F; padding-bottom: 14px; margin-bottom: 22px; }
            .eyebrow { color: #002B7F; font-size: 10px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
            h1 { font-size: 22px; margin: 5px 0; }
            h2 { font-size: 14px; margin: 22px 0 9px; color: #002B7F; }
            .reference { font-size: 11px; color: #58677d; }
            .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; }
            .field { border-bottom: 1px solid #cbd5e1; padding: 0 0 8px; min-height: 40px; }
            .field-label { display: block; color: #627189; font-size: 10px; margin-bottom: 5px; text-transform: uppercase; }
            .field-value { display: block; font-size: 13px; font-weight: 600; white-space: pre-wrap; }
            .wide { grid-column: 1 / -1; }
            .selected-type { background: #eef4ff; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
            th { background: #f3f6fa; }
            .right { text-align: right; }
            .note, .missing { font-size: 11px; color: #58677d; margin-top: 8px; }
            .missing { border: 1px solid #d79b28; padding: 10px; }
            .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 36px; }
            .signature { border-top: 1px solid #34425a; padding-top: 6px; font-size: 11px; min-height: 42px; }
            .signature span { display: block; color: #627189; margin-top: 4px; }
            .footer-note { margin-top: 24px; font-size: 10px; color: #627189; }
            @media print { body { margin: 0; } h2, .signatures, table { break-inside: avoid; } }
        </style>
        <header class="form-head">
            <div class="eyebrow">Republic of Naoero · Treasury</div>
            <h1>Approved leave advice</h1>
            <div class="reference">For payroll processing · Reference ${safe(form.id)}</div>
        </header>
        <h2>Employee and leave details</h2>
        <div class="fields">
            <div class="field"><span class="field-label">Employee name</span><span class="field-value">${safe(form.employee_name)}</span></div>
            <div class="field"><span class="field-label">Position / job title</span><span class="field-value">${safe(form.position_title)}</span></div>
            <div class="field"><span class="field-label">Department</span><span class="field-value">${safe(form.department_code)}</span></div>
            <div class="field"><span class="field-label">Leave type</span><span class="field-value">${safe(form.leave_type_name)}</span></div>
            <div class="field"><span class="field-label">First day</span><span class="field-value">${safe(formatDate(form.start_date))}</span></div>
            <div class="field"><span class="field-label">Last day</span><span class="field-value">${safe(formatDate(form.end_date))}</span></div>
            <div class="field"><span class="field-label">Working days approved</span><span class="field-value">${safe(days(form.days))}</span></div>
            <div class="field"><span class="field-label">Approved on</span><span class="field-value">${safe(formatDate(form.approved_at))}</span></div>
            <div class="field wide"><span class="field-label">Reason for leave</span><span class="field-value">${safe(form.reason)}</span></div>
            <div class="field"><span class="field-label">Supervisor</span><span class="field-value">${safe(form.supervisor_name)}</span></div>
            <div class="field"><span class="field-label">Approved by</span><span class="field-value">${safe(form.approved_by_name)}</span></div>
        </div>
        <h2>Leave balances</h2>
        ${balances}
        <h2>Signatures</h2>
        <div class="signatures">
            <div class="signature">Employee signature<span>Date: ____________________</span></div>
            <div class="signature">Supervisor signature · ${safe(form.supervisor_name)}<span>Date: ____________________</span></div>
            <div class="signature">Payroll received by<span>Date: ____________________</span></div>
        </div>
        <p class="footer-note">System-generated from the approved HR request. Signature lines are for signing the printed form.</p>
    `;
}

export async function printApprovedLeaveForm(applicationId: string): Promise<void> {
    // Open during the click so popup blockers do not prevent the async fetch.
    const preview = window.open('', '_blank', 'width=1000,height=800');
    if (!preview) throw new Error('Allow pop-ups to print the approved leave form.');
    preview.opener = null;
    preview.document.write('<!doctype html><title>Preparing approved leave form</title><p>Preparing form…</p>');
    try {
        const form = await apiClient.get<ApprovedLeavePayrollForm>(`/hr/leaves/${applicationId}/payroll-form`);
        if (preview.closed) return;
        printReport(`Approved leave - ${form.employee_name}`, buildApprovedLeaveFormHtml(form), preview);
    } catch (error) {
        preview.close();
        throw error;
    }
}

import { Link } from 'react-router-dom';
import { GovernmentWorkflowManagement } from './GovernmentWorkflowManagement';
import { EmployeeOnboarding } from './EmployeeOnboarding';
import { GovernmentPayroll } from './GovernmentPayroll';
import type { OrgDepartment } from './types';

const tools = [
    { id: 'accrual', title: 'Leave access and balance schedules', detail: 'Review employee activation and the approved schedules that post due balances.' },
    { id: 'accounts', title: 'Bulk employee accounts', detail: 'Prepare employee logins, activation and account lifecycle work.' },
    { id: 'payroll', title: 'Payroll reconciliation', detail: 'Prepare approved instructions and record Salary Unit receipts.' },
];
export function AdvancedMaintenance({ tool, departments }: { tool: string | null; departments: OrgDepartment[] }) {
    const selected = tools.find(item => item.id === tool);
    return <div className="space-y-5">
        <div><h3 className="text-lg font-semibold">Maintenance tools</h3><p className="mt-1 text-sm text-gray-600">Manage initial setup, account batches and payroll reconciliation. For a change to one person’s leave, open their employee record.</p></div>
        <Link className="text-sm font-semibold text-brand underline" to="/leave/employees">Open employee records</Link>
        <nav aria-label="Advanced maintenance tools" className="grid gap-3 md:grid-cols-3">{tools.map(item => <Link key={item.id} aria-current={item.id === selected?.id ? 'page' : undefined} to={`/leave/settings?view=advanced&tool=${item.id}`} className={`app-panel space-y-2 p-4 ${item.id === selected?.id ? 'border-blue-400 bg-blue-50' : ''}`}><h4 className="font-semibold">{item.title}</h4><p className="text-sm text-gray-600">{item.detail}</p></Link>)}</nav>
        {selected?.id === 'accrual' && <GovernmentWorkflowManagement />}
        {selected?.id === 'accounts' && <EmployeeOnboarding departments={departments} />}
        {selected?.id === 'payroll' && <GovernmentPayroll />}
    </div>;
}

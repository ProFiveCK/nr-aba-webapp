import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/useAuth';
import { EmployeeManagement } from '../EmployeeManagement';
import { Balances } from './Balances';

export function Employees() {
    const { user } = useAuth();
    const [params] = useSearchParams();
    const staff = user?.permissions?.hr_admin === true || user?.permissions?.hr_staff_manage === true;
    const balances = user?.permissions?.hr_admin === true || user?.permissions?.hr_balance_manage === true;
    const balanceView = balances && (!staff || ['balances', 'legacy'].includes(params.get('view') || '') || params.get('operation') === 'legacy');
    return <div className="space-y-5">
        {staff && balances && !params.has('employee') && <nav aria-label="Employee views" className="flex flex-wrap gap-2">
            <Link aria-current={!balanceView ? 'page' : undefined} className={`rounded-lg px-4 py-2 text-sm font-semibold ${!balanceView ? 'bg-brand text-white' : 'border border-gray-300 bg-white text-gray-700'}`} to="/leave/employees">Employee records</Link>
            <Link aria-current={balanceView ? 'page' : undefined} className={`rounded-lg px-4 py-2 text-sm font-semibold ${balanceView ? 'bg-brand text-white' : 'border border-gray-300 bg-white text-gray-700'}`} to="/leave/employees?view=balances">Staff balances</Link>
        </nav>}
        {balanceView ? <Balances /> : staff ? <EmployeeManagement /> : null}
    </div>;
}

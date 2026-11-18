import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/useAuth';
import { EmployeeManagement } from '../EmployeeManagement';
import { Balances } from './Balances';

export function Employees() {
    const { user } = useAuth();
    const [params] = useSearchParams();
    // Central HR or an HR officer: one right covers records and balances.
    const officer = user?.permissions?.hr_admin === true || user?.permissions?.hr_officer === true;
    const balanceView = officer && (['balances', 'legacy'].includes(params.get('view') || '') || params.get('operation') === 'legacy');
    return <div className="space-y-5">
        {officer && !params.has('employee') && <nav aria-label="Employee views" className="flex flex-wrap gap-2">
            <Link aria-current={!balanceView ? 'page' : undefined} className={`rounded-lg px-4 py-2 text-sm font-semibold ${!balanceView ? 'bg-brand text-white' : 'border border-gray-300 bg-white text-gray-700'}`} to="/leave/employees">Employee records</Link>
            <Link aria-current={balanceView ? 'page' : undefined} className={`rounded-lg px-4 py-2 text-sm font-semibold ${balanceView ? 'bg-brand text-white' : 'border border-gray-300 bg-white text-gray-700'}`} to="/leave/employees?view=balances">Staff balances</Link>
        </nav>}
        {balanceView ? <Balances /> : officer ? <EmployeeManagement /> : null}
    </div>;
}

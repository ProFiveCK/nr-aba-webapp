import { useAuth } from '../../../contexts/useAuth';
import { EmployeeManagement } from '../EmployeeManagement';
import { ScopedBalances } from '../ScopedBalances';

export function Staff({ workspace = 'employees' }: { workspace?: 'employees' | 'settings' }) {
    const { user } = useAuth();
    return user?.permissions?.hr_admin || user?.permissions?.hr_staff_manage
        ? <EmployeeManagement workspace={workspace} />
        : <ScopedBalances />;
}

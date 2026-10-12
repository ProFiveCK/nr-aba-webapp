import { EmployeeManagement } from '../EmployeeManagement';

export function Staff({ workspace = 'employees' }: { workspace?: 'employees' | 'settings' }) {
    return <EmployeeManagement workspace={workspace} />;
}

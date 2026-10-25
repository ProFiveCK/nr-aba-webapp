import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/useAuth';
import { Button } from '../../../components/Ui';
import { GovernmentRequestList } from '../GovernmentRequests';
import { GovernmentCaseTasks } from '../GovernmentCases';
import { Overview } from './Overview';

export function WorkQueue() {
    const { user } = useAuth();
    const central = user?.permissions?.hr_admin === true;
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const views = central
        ? [['approvals', 'Approvals'], ['followups', 'Follow-ups'], ['applications', 'All applications'], ['overview', 'Planning']]
        : [['approvals', 'Approvals']];
    const view = views.some(([id]) => id === params.get('view')) ? params.get('view')! : 'approvals';
    const employeeId = params.get('employee') || undefined;
    const requestId = params.get('request') || undefined;
    function change(view: string) { setParams({ view }); }
    return <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Work queue</h2><p className="mt-1 text-sm text-gray-600">{central ? 'Review leave, resolve outstanding work and track applications.' : 'Review the leave applications assigned to you.'}</p></div>{central && <Link className="text-sm font-semibold text-brand underline" to="/leave/employees">Find an employee</Link>}</div>
        {employeeId && <div className="flex flex-wrap items-center gap-3 rounded-lg bg-blue-50 p-3 text-sm"><span>Showing this employee’s work.</span><Link className="font-semibold text-brand underline" to={`/leave/employees?employee=${encodeURIComponent(employeeId)}&section=applications`}>Return to employee</Link><Button variant="ghost" onClick={() => change(view)}>Show all employees</Button></div>}
        {views.length > 1 && <nav aria-label="Work queue views" className="flex flex-wrap gap-2">{views.map(([id, label]) => <Button key={id} variant={view === id ? 'primary' : 'secondary'} aria-current={view === id ? 'page' : undefined} onClick={() => change(id)}>{label}</Button>)}</nav>}
        {view === 'approvals' && <GovernmentRequestList key="approvals" mode="queue" includeRecorded waitingOnMeDefault />}
        {view === 'applications' && <GovernmentRequestList key={`applications:${employeeId || 'all'}:${requestId || ''}`} mode="all" includeRecorded initialStatus="all" employeeId={employeeId} selectedRequestId={requestId} />}
        {view === 'followups' && central && <GovernmentCaseTasks employeeId={employeeId || ''} refreshVersion={0} onSelect={id => setParams({ view: 'applications', request: id, ...(employeeId ? { employee: employeeId } : {}) })} />}
        {view === 'overview' && central && <Overview onNavigate={destination => {
            if (destination === 'approvals' || destination === 'overview') change(destination);
            else navigate(`/leave/${destination === 'staff' ? 'employees' : destination === 'policies' ? 'settings' : destination}`);
        }} />}
    </div>;
}

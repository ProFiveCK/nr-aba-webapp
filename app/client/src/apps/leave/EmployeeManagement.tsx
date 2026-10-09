import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Policies } from './sections/Policies';
import { LeaveSetupStatus } from './LeaveSetupStatus';
import type { LeavePolicyUsage } from './leaveSetup';
import { useAuth } from '../../contexts/useAuth';
import { GovernmentWorkflowManagement } from './GovernmentWorkflowManagement';
import { GovernmentPayroll } from './GovernmentPayroll';
import { EmployeeOnboarding } from './EmployeeOnboarding';
import { HrAccessManagement } from './HrAccessManagement';
import { ScopedBalances } from './ScopedBalances';
import { apiClient } from '../../lib/api';
import { Button, LoadingState, Pager } from '../../components/Ui';
import { ActionDialog, Field, PlacementFields, inputClass } from './ManagementFields';
import { value } from './managementForm';
import { EmployeeLeaveWorkspace } from './EmployeeLeaveWorkspace';
import type { EmployeeSection, PreparationStep } from './EmployeeLeaveWorkspace';
import { OrganisationManagement } from './OrganisationManagement';
import { ReviewRecordName } from './ReviewRecordName';
import { reviewRecordLabel } from './reviewRecordNames';
import type { EmployeeProfile, ManagedEmployee, WorkPattern } from './managementTypes';
import type { OrgDepartment } from './types';

export function EmployeeManagement({ workspace='employees' }: { workspace?:'employees'|'settings' }) {
    const { user } = useAuth();
    const central = user?.permissions?.hr_admin === true;
    const [params,setParams]=useSearchParams();
    const requested=params.get('view');
    const [usage,setUsage]=useState<LeavePolicyUsage|null>(null);
    const [usageLoading,setUsageLoading]=useState(true);
    useEffect(()=>{if(workspace!=='settings'||!central)return;let live=true;void apiClient.get<LeavePolicyUsage>('/hr/directory/leave-policy-usage').then(data=>{if(live)setUsage(data);}).catch(()=>{if(live)setUsage(null);}).finally(()=>{if(live)setUsageLoading(false);});return()=>{live=false;};},[workspace,central,requested]);
    const [scopeSummary,setScopeSummary] = useState('Checking assigned access…');
    useEffect(() => { void apiClient.get<{central:boolean;scopes:{department_name:string;division_name:string|null}[]}>('/hr/access-scopes/context').then(context=>setScopeSummary(context.central ? 'Central HR · Government-wide records' : context.scopes.length ? `Assigned access: ${context.scopes.map(scope=>`${scope.department_name} / ${scope.division_name || 'All divisions'}`).join('; ')}` : 'No active department or division assignment. Contact central HR.')).catch(()=>setScopeSummary('Unable to confirm assigned access.')); }, []);
    const choices = workspace === 'settings'
        ? [['summary', 'Settings'], ['policies', 'Policy & calendars'], ['organisation', 'Organisation & approvers'], ['accrual', 'Balance schedules'], ['access', 'HR access'], ['accounts', 'Employee accounts'], ['payroll', 'Payroll instructions'], ['workflow', 'Applications & follow-ups']]
        : [['directory', 'Employees'], ...(!central && user?.permissions?.hr_balance_manage ? [['balances', 'Manage balances']] : [])];
    // Retired setup URLs return to the current workspace; they must not revive import or transfer tools.
    const alias = requested === 'foundations' ? 'directory' : requested;
    const tab = choices.some(([id]) => id === alias) ? alias! : choices[0][0];
    const employeeId=workspace==='employees'?params.get('employee')||'':'';
    const section=(['arrangements','details','applications','prepare'].includes(params.get('section')||'')?params.get('section'):'arrangements') as EmployeeSection;
    const step=(['identity','login','balances','activation'].includes(params.get('step')||'')?params.get('step'):'balances') as PreparationStep;
    function changeView(view:string){if(workspace==='settings'&&view==='summary')setUsageLoading(true);const next=new URLSearchParams(params);next.set('view',view);next.delete('employee');next.delete('section');next.delete('step');setParams(next);}
    const [creating, setCreating] = useState(false);
    const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [department, setDepartment] = useState(''), [status, setStatus] = useState(''), [readiness, setReadiness] = useState(''), [page, setPage] = useState(0);
    const [list, setList] = useState<{ employees: ManagedEmployee[]; total: number; page_size: number }>({ employees: [], total: 0, page_size: 50 });
    const [departments, setDepartments] = useState<OrgDepartment[]>([]), [patterns, setPatterns] = useState<WorkPattern[]>([]);
    const [profile, setProfile] = useState<EmployeeProfile | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [opening, setOpening] = useState(false), [version, setVersion] = useState(0);
    async function loadReferences() { const [org, work] = await Promise.all([apiClient.get<OrgDepartment[]>('/hr/org-units'), apiClient.get<WorkPattern[]>('/hr/directory/work-patterns')]); setDepartments(org); setPatterns(work); }
    useEffect(() => { let live=true;void Promise.all([apiClient.get<OrgDepartment[]>('/hr/org-units'),apiClient.get<WorkPattern[]>('/hr/directory/work-patterns')]).then(([org,work])=>{if(live){setDepartments(org);setPatterns(work);}}).catch((err:Error)=>{if(live)setError(err.message);});return()=>{live=false;}; }, []);
    useEffect(() => {
        if (tab !== 'directory') return;
        let live = true;
        const params = new URLSearchParams({ page: String(page + 1), search });
        if (department) params.set('department_id', department); if (status) params.set('status', status); if (readiness) params.set('readiness', readiness);
        void apiClient.get<typeof list>(`/hr/directory?${params}`).then((data) => { if (live) { setList(data); if (page > 0 && page * 50 >= data.total) setPage(Math.max(0, Math.ceil(data.total / 50) - 1)); } }).catch((err: Error) => { if (live) setError(err.message); }).finally(() => { if (live) setLoading(false); });
        return () => { live = false; };
    }, [tab, page, search, department, status, readiness, version]);
    async function open(id: string, initialSection: EmployeeSection = 'arrangements') { setProfile(null);setError('');const next=new URLSearchParams(params);next.set('view','directory');next.set('employee',id);next.set('section',initialSection);next.delete('step');setParams(next); }
    useEffect(()=>{if(!employeeId)return;let live=true;void apiClient.get<EmployeeProfile>(`/hr/directory/${employeeId}/profile`).then(data=>{if(live){setProfile(data);setError('');}}).catch((err:Error)=>{if(live)setError(err.message);}).finally(()=>{if(live)setOpening(false);});return()=>{live=false;};},[employeeId]);
    function closeEmployee(){const next=new URLSearchParams(params);next.delete('employee');next.delete('section');next.delete('step');setParams(next);}
    if(employeeId) return <div className="space-y-4">{error&&<><p role="alert" className="text-sm text-red-700">{error}</p><Button variant="secondary" onClick={closeEmployee}>Back to employees</Button></>}{(!profile||profile.employee.id!==employeeId)&&!error&&<LoadingState label="Opening employee…"/>}{profile?.employee.id===employeeId&&<EmployeeLeaveWorkspace key={profile.employee.id} central={central} profile={profile} departments={departments} patterns={patterns} section={section} step={step} onClose={closeEmployee} onNavigate={(section,step)=>{const next=new URLSearchParams(params);next.set('section',section);if(step)next.set('step',step);setParams(next);}} onChanged={async()=>{setProfile(await apiClient.get<EmployeeProfile>(`/hr/directory/${employeeId}/profile`));setVersion(v=>v+1);}}/>}</div>;
    return <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
                {workspace === 'settings' && tab !== 'summary' && <Button variant="ghost" onClick={() => changeView('summary')}>← All settings</Button>}
                <h2 className="text-xl font-semibold text-gray-950">{choices.find(([id]) => id === tab)?.[1]}</h2>
                <p className="mt-1 text-sm text-gray-600">{workspace === 'employees' ? 'Manage employee details, leave balances and access in one place.' : 'Manage the rules, people and schedules used by leave management.'}</p>
            </div>
            {workspace === 'employees' && central && <Button onClick={() => setCreating(true)}>Add employee</Button>}
        </div>
        <p className="text-xs text-gray-500">{scopeSummary}</p>
        {choices.length > 1 && workspace === 'employees' && <nav aria-label="Employee views" className="flex flex-wrap gap-2">{choices.map(([id, label]) => <Button key={id} variant={tab === id ? 'primary' : 'secondary'} aria-current={tab === id ? 'page' : undefined} onClick={() => changeView(id)}>{label}</Button>)}</nav>}
        {workspace === 'settings' && tab === 'summary' && (usageLoading ? <LoadingState label="Loading settings…"/> : usage ? <LeaveSetupStatus usage={usage} onOpen={changeView}/> : <div role="status" className="app-panel space-y-3 p-5"><p className="text-sm">Unable to load the settings summary.</p><Button variant="secondary" onClick={() => {setUsageLoading(true);void apiClient.get<LeavePolicyUsage>('/hr/directory/leave-policy-usage').then(setUsage).catch((e: Error) => setError(e.message)).finally(() => setUsageLoading(false));}}>Try again</Button></div>)}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {tab === 'directory' && <>
            <form className="app-panel grid items-end gap-4 p-5 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); setPage(0); }}>
                <Field label="Search employees"><input className={inputClass} maxLength={100} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or exact Payroll ID" /></Field>
                <Field label="Department"><select className={inputClass} value={department} onChange={(e) => { setDepartment(e.target.value); setPage(0); }}><option value="">All departments</option>{departments.map((item) => <option key={item.id} value={item.id}>{reviewRecordLabel(item.name)}</option>)}</select></Field>
                <Field label="Status"><select className={inputClass} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
                <Field label="Needs attention"><select className={inputClass} value={readiness} onChange={(e) => { setReadiness(e.target.value); setPage(0); }}><option value="">All employees</option><option value="unlinked">No verified login</option><option value="missing_id">Payroll ID missing</option><option value="missing_placement">Placement incomplete</option><option value="missing_service">Appointment or service incomplete</option><option value="missing_pattern">Work schedule missing</option></select></Field>
                <Button type="submit">Search employees</Button>
            </form>
            <p className="text-sm text-gray-600">{list.total} employee{list.total === 1 ? '' : 's'} · {list.page_size} per page</p>
            {loading ? <LoadingState label="Loading employee page…" /> : <div className="app-panel divide-y divide-gray-100">
                {!list.employees.length && <p className="p-5 text-sm text-gray-500">No employees match these filters. Try another search or add an employee.</p>}
                {list.employees.map((employee) => <article key={employee.id} className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0 space-y-1.5"><h3 className="break-words font-semibold text-gray-900"><ReviewRecordName name={employee.display_name}/></h3><p className="break-words text-sm text-gray-600">{reviewRecordLabel(employee.department_code || 'Department unverified')}{employee.division_code ? ` / ${reviewRecordLabel(employee.division_code)}` : ''} · {employee.status}</p><p className="break-words text-xs text-gray-500">Payroll ID: {employee.external_ids?.map((id) => id.external_id).join(', ') || 'Missing'} · {employee.reviewer_id ? 'Login linked' : 'Login unlinked'}</p><p className="text-xs text-gray-500">{employee.employment_category || 'Current appointment unrecorded'}{employee.is_teacher ? ' · Teacher' : ''}{employee.is_intern ? ' · Intern' : ''}{employee.counts_for_service == null ? ' · Service credit unknown' : employee.counts_for_service ? ' · Service included' : ' · Service excluded'}</p></div>
                    <Button variant="secondary" className="min-w-24" aria-label={`Manage ${employee.display_name}`} disabled={opening} onClick={() => void open(employee.id)}>Manage</Button>
                </article>)}
                <div className="px-3"><Pager page={page} pageCount={Math.ceil(list.total / list.page_size)} total={list.total} pageSize={list.page_size} setPage={setPage} /></div>
            </div>}
        </>}
        {tab === 'policies' && central && <Policies />}
        {tab === 'organisation' && central && <OrganisationManagement departments={departments} patterns={patterns} onChanged={loadReferences} />}
        {tab === 'access' && central && <HrAccessManagement departments={departments} />}
        {tab === 'accounts' && central && <EmployeeOnboarding departments={departments} />}
        {tab === 'workflow' && central && <GovernmentWorkflowManagement view="applications" />}
        {tab === 'accrual' && central && <GovernmentWorkflowManagement view="activation" />}
        {tab === 'payroll' && central && <GovernmentPayroll />}
        {tab === 'balances' && <ScopedBalances />}
        {creating && <ActionDialog title="Add employee" onClose={() => setCreating(false)} saveLabel="Create & continue" onSave={async (data) => {
            const created = await apiClient.post<{ id: string }>('/hr/directory', { display_name: value(data,'display_name'), external_id: value(data,'external_id'), department_id: value(data,'department_id'), division_id: value(data,'division_id') || null, reason: value(data,'reason') });
            setCreating(false); setVersion((current) => current + 1); await open(created.id, 'details');
        }}><p className="text-sm text-gray-600">Enter the employee’s name, Payroll ID and department. After saving, add their appointment and work schedule, then review balances and account access. Check the employee list first to avoid duplicate records.</p><Field label="Employee name"><input className={inputClass} name="display_name" maxLength={200} required /></Field><Field label="Payroll ID"><input className={inputClass} name="external_id" maxLength={100} required /></Field><PlacementFields departments={departments} /></ActionDialog>}

    </div>;
}

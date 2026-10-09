import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Policies, HistoricalPolicySettings } from './sections/Policies';
import { LeaveSetupStatus } from './LeaveSetupStatus';
import type { LeavePolicyUsage } from './leaveSetup';
import type { ReactNode } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { GovernmentWorkflowManagement } from './GovernmentWorkflowManagement';
import { GovernmentRollout } from './GovernmentRollout';
import { GovernmentPayroll } from './GovernmentPayroll';
import { EmployeeOnboarding } from './EmployeeOnboarding';
import { HrAccessManagement } from './HrAccessManagement';
import { ScopedBalances } from './ScopedBalances';
import { apiClient } from '../../lib/api';
import { Button, LoadingState, Pager } from '../../components/Ui';
import { ActionDialog, Field, PlacementFields, inputClass } from './ManagementFields';
import { value } from './managementForm';
import { PayrollEmployeeImport } from './PayrollEmployeeImport';
import { EmployeeLeaveWorkspace } from './EmployeeLeaveWorkspace';
import type { EmployeeSection, PreparationStep } from './EmployeeLeaveWorkspace';
import { OrganisationManagement } from './OrganisationManagement';
import { GovernmentInitialSetup } from './GovernmentInitialSetup';
import { ReviewRecordName } from './ReviewRecordName';
import { reviewRecordLabel } from './reviewRecordNames';
import type { EmployeeProfile, ManagedEmployee, WorkPattern } from './managementTypes';
import type { OrgDepartment } from './types';

export function EmployeeManagement({ legacyTools,workspace='employees' }: { legacyTools: ReactNode;workspace?:'employees'|'settings' }) {
    const { user } = useAuth();
    const central = user?.permissions?.hr_admin === true;
    const [params,setParams]=useSearchParams();
    const requested=params.get('view');
    const [usage,setUsage]=useState<LeavePolicyUsage|null>(null);
    const [usageLoading,setUsageLoading]=useState(true);
    const setupAdopted=usage?.initial_setup.adopted??null;
    useEffect(()=>{if(workspace!=='settings'||!central)return;let live=true;void apiClient.get<LeavePolicyUsage>('/hr/directory/leave-policy-usage').then(data=>{if(live)setUsage(data);}).catch(()=>{if(live)setUsage(null);}).finally(()=>{if(live)setUsageLoading(false);});return()=>{live=false;};},[workspace,central,requested]);
    const [scopeSummary,setScopeSummary] = useState('Checking assigned access…');
    useEffect(() => { void apiClient.get<{central:boolean;scopes:{department_name:string;division_name:string|null}[]}>('/hr/access-scopes/context').then(context=>setScopeSummary(context.central ? 'Central HR · Government-wide records' : context.scopes.length ? `Assigned access: ${context.scopes.map(scope=>`${scope.department_name} / ${scope.division_name || 'All divisions'}`).join('; ')}` : 'No active department or division assignment. Contact central HR.')).catch(()=>setScopeSummary('Unable to confirm assigned access.')); }, []);
    const choices = workspace==='settings' ? [['summary','Leave setup'],['policies','Policy & calendars'],['organisation','Approvers & organisation'],['rollout','Staff transfer'],['accrual','Automatic balances'],...(['initial-setup','access','setup','legacy-settings'].includes(requested||'')?[[requested!,requested==='initial-setup'?(setupAdopted?'Setup record':'Match existing records'):requested==='access'?'HR access':requested==='setup'?'Accounts & import':'Previous calculation settings']]:[])] : [['directory','Employees'],...(central ? [['operations','Leave operations']] : user?.permissions?.hr_balance_manage ? [['balances','Scoped balances']] : [])];
    const alias=requested==='import'||requested==='onboarding'?'setup':['government-workflow','payroll','legacy'].includes(requested||'')?'operations':requested==='foundations'?'directory':requested;
    const tab=choices.some(([id])=>id===alias)?alias!:choices[0][0];
    const employeeId=workspace==='employees'?params.get('employee')||'':'';
    const section=(['arrangements','details','applications','prepare'].includes(params.get('section')||'')?params.get('section'):'arrangements') as EmployeeSection;
    const step=(['identity','login','balances','reconciliation','activation'].includes(params.get('step')||'')?params.get('step'):'identity') as PreparationStep;
    const requestedOperation=params.get('operation')||(['payroll','legacy'].includes(requested||'')?requested:'workflow');
    const operation=['workflow','activation','payroll','legacy'].includes(requestedOperation||'')?requestedOperation:'workflow';
    const setupView=params.get('setup')||(requested==='import'?'import':'onboarding');
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
    async function open(id: string) { setProfile(null);setError('');const next=new URLSearchParams(params);next.set('view','directory');next.set('employee',id);next.set('section','arrangements');next.delete('step');setParams(next); }
    useEffect(()=>{if(!employeeId)return;let live=true;void apiClient.get<EmployeeProfile>(`/hr/directory/${employeeId}/profile`).then(data=>{if(live){setProfile(data);setError('');}}).catch((err:Error)=>{if(live)setError(err.message);}).finally(()=>{if(live)setOpening(false);});return()=>{live=false;};},[employeeId]);
    function closeEmployee(){const next=new URLSearchParams(params);next.delete('employee');next.delete('section');next.delete('step');setParams(next);}
    if(employeeId) return <div className="space-y-4">{error&&<><p role="alert" className="text-sm text-red-700">{error}</p><Button variant="secondary" onClick={closeEmployee}>Back to employees</Button></>}{(!profile||profile.employee.id!==employeeId)&&!error&&<LoadingState label="Opening employee…"/>}{profile?.employee.id===employeeId&&<EmployeeLeaveWorkspace key={profile.employee.id} central={central} profile={profile} departments={departments} patterns={patterns} section={section} step={step} onClose={closeEmployee} onNavigate={(section,step)=>{const next=new URLSearchParams(params);next.set('section',section);if(step)next.set('step',step);setParams(next);}} onChanged={async()=>{setProfile(await apiClient.get<EmployeeProfile>(`/hr/directory/${employeeId}/profile`));setVersion(v=>v+1);}}/>}</div>;
    return <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
            {workspace==='settings'?<nav aria-label="Leave settings" className="flex flex-wrap gap-2">{choices.filter(([id])=>!['initial-setup','access','setup','legacy-settings'].includes(id)).map(([id,label])=><Button key={id} variant={tab===id?'primary':'secondary'} aria-current={tab===id?'page':undefined} onClick={()=>changeView(id)}>{label}</Button>)}</nav>:<label className="flex min-w-0 flex-wrap items-center gap-3 text-sm font-medium text-gray-700">Employee view
                <select aria-label="Employee view" className="min-w-0 max-w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900" value={tab} onChange={e=>changeView(e.target.value)}>
                    {choices.map(([id,label])=><option key={id} value={id}>{label}</option>)}
                </select>
            </label>}
            <p className="text-xs text-gray-500">{scopeSummary}</p>
        </div>
        {workspace==='employees'&&<p className="text-sm text-gray-600">Open an employee to see their balances, policy and approvers together.</p>}
        {workspace==='settings'&&tab==='summary'&&(usageLoading?<LoadingState label="Checking leave setup…"/>:usage?<LeaveSetupStatus usage={usage} onOpen={changeView}/>:<p role="status" className="app-panel p-4 text-sm">Unable to confirm setup progress. <Button variant="secondary" onClick={()=>{setUsageLoading(true);void apiClient.get<LeavePolicyUsage>('/hr/directory/leave-policy-usage').then(setUsage).catch((e:Error)=>setError(e.message)).finally(()=>setUsageLoading(false));}}>Refresh setup</Button></p>)}
        {workspace==='settings'&&['initial-setup','access','setup','legacy-settings'].includes(tab)&&<Button variant="ghost" onClick={()=>changeView('summary')}>← Leave setup</Button>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {tab === 'directory' && <>
            <form className="app-panel grid items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); setPage(0); }}>
                <Field label="Search employees"><input className={inputClass} maxLength={100} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or exact Payroll ID" /></Field>
                <Field label="Filter department"><select className={inputClass} value={department} onChange={(e) => { setDepartment(e.target.value); setPage(0); }}><option value="">All departments</option>{departments.map((item) => <option key={item.id} value={item.id}>{reviewRecordLabel(item.name)}</option>)}</select></Field>
                <Field label="Filter status"><select className={inputClass} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
                <Field label="Preparation issues"><select className={inputClass} value={readiness} onChange={(e) => { setReadiness(e.target.value); setPage(0); }}><option value="">All employees</option><option value="unlinked">No verified login</option><option value="missing_id">Payroll ID missing</option><option value="missing_placement">Placement incomplete</option><option value="missing_service">Current category / service credit incomplete</option><option value="missing_pattern">Current work pattern missing</option></select></Field>
                <Button type="submit">Search employees</Button>
            </form>
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-gray-600">{list.total} matching employees · 50 per page</p>{central && <Button onClick={() => setCreating(true)}>Add verified employee</Button>}</div>
            {loading ? <LoadingState label="Loading employee page…" /> : <div className="app-panel divide-y divide-gray-100">
                {!list.employees.length && <p className="p-5 text-sm text-gray-500">No employees match these filters. Prepare the Payroll import or add a verified employee.</p>}
                {list.employees.map((employee) => <article key={employee.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4">
                    <div className="min-w-0"><h3 className="break-words font-semibold text-gray-900"><ReviewRecordName name={employee.display_name}/></h3><p className="break-words text-sm text-gray-600">{reviewRecordLabel(employee.department_code || 'Department unverified')}{employee.division_code ? ` / ${reviewRecordLabel(employee.division_code)}` : ''} · {employee.status} · {employee.leave_policy_regime==='government'?'Government policy':'Awaiting staff transfer'}</p><p className="break-words text-xs text-gray-500">Payroll ID: {employee.external_ids?.map((id) => id.external_id).join(', ') || 'Missing'} · {employee.reviewer_id ? 'Login linked' : 'Login unlinked'}</p><p className="text-xs text-gray-500">{employee.employment_category || 'Current appointment unrecorded'}{employee.is_teacher ? ' · Teacher' : ''}{employee.is_intern ? ' · Intern' : ''}{employee.counts_for_service == null ? ' · Service credit unknown' : employee.counts_for_service ? ' · Service included' : ' · Service excluded'}</p></div>
                    <Button variant="secondary" className="min-w-24" aria-label={`Manage ${employee.display_name}`} disabled={opening} onClick={() => void open(employee.id)}>Manage</Button>
                </article>)}
                <div className="px-3"><Pager page={page} pageCount={Math.ceil(list.total / list.page_size)} total={list.total} pageSize={list.page_size} setPage={setPage} /></div>
            </div>}
        </>}
        {tab === 'initial-setup' && central && <GovernmentInitialSetup onAdopted={async()=>{setUsage(await apiClient.get<LeavePolicyUsage>('/hr/directory/leave-policy-usage'));await loadReferences();setVersion(v=>v+1);}} />}
        {tab === 'policies' && central && <Policies />}
        {tab === 'organisation' && <OrganisationManagement departments={departments} patterns={patterns} onChanged={loadReferences} />}
        {tab === 'access' && central && <HrAccessManagement departments={departments} />}
        {tab === 'operations' && central && <><nav aria-label="Leave operations" className="flex flex-wrap gap-2">{[['workflow','Applications & follow-ups'],['activation','Activation & accrual'],['payroll','Payroll & handover'],['legacy','Retained Finance administration']].map(([key,label])=><Button key={key} variant={operation===key?'primary':'secondary'} onClick={()=>{const next=new URLSearchParams(params);next.set('operation',key);setParams(next);}}>{label}</Button>)}</nav><p className="text-sm text-gray-600">Cross-employee administration. For preparation or balances, <Button variant="ghost" onClick={()=>changeView('directory')}>select an employee</Button> first.</p>{operation==='workflow'&&<GovernmentWorkflowManagement view="applications"/>}{operation==='activation'&&<GovernmentWorkflowManagement view="activation"/>}{operation==='payroll'&&<GovernmentPayroll/>}{operation==='legacy'&&<><p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Retained Finance maintenance tools. Employee identity, placement and Government preparation are managed in the employee workspace. These tools keep historical imports, reports and existing record maintenance available.</p>{legacyTools}</>}</>}
        {tab === 'setup' && central && <><nav aria-label="Employee setup" className="flex flex-wrap gap-2">{[['import','Payroll identities'],['onboarding','Login preparation']].map(([key,label])=><Button key={key} variant={setupView===key?'primary':'secondary'} onClick={()=>{const next=new URLSearchParams(params);next.set('setup',key);setParams(next);}}>{label}</Button>)}</nav><p className="text-sm text-gray-600">Prepare or reconcile a verified employee cohort here. For one employee, use Employees → Manage → Prepare Government Leave.</p>{setupView==='import'?<PayrollEmployeeImport onApplied={()=>setVersion(v=>v+1)}/>:<EmployeeOnboarding departments={departments}/>}</>}
        {tab === 'rollout' && central && <GovernmentRollout departments={departments} />}
        {tab === 'accrual' && central && <GovernmentRollout departments={departments} mode="balances"/>}
        {tab === 'legacy-settings' && central && <><p className="app-panel bg-amber-50 p-4 text-sm text-amber-900">Previous calculations are used only for staff awaiting transfer. Government leave uses the published policy and automatic balance schedules. Complete Staff transfer to retire these calculations.</p><HistoricalPolicySettings/></>}
        {workspace==='settings'&&<details className="border-t border-gray-200 pt-4"><summary className="cursor-pointer text-sm text-gray-600">More administration</summary><div className="mt-3 flex flex-wrap gap-2">{[['initial-setup',setupAdopted?'View original setup record':'Match existing records'],['access','HR access'],['setup','Accounts & Payroll import'],...(usage&&usage.counts.legacy_awaiting_migration>0?[['legacy-settings','Previous calculations for unmigrated staff']]:[])].map(([id,label])=><Button key={id} variant="secondary" onClick={()=>changeView(id)}>{label}</Button>)}</div></details>}
        {tab === 'balances' && <ScopedBalances />}
        {creating && <ActionDialog title="Add verified employee" onClose={() => setCreating(false)} saveLabel="Create employee record" onSave={async (data) => {
            const created = await apiClient.post<{ id: string }>('/hr/directory', { display_name: value(data,'display_name'), external_id: value(data,'external_id'), department_id: value(data,'department_id'), division_id: value(data,'division_id') || null, reason: value(data,'reason') });
            setCreating(false); setVersion((current) => current + 1); await open(created.id);
        }}><p className="text-sm text-gray-600">Check the Payroll and personnel record before creating a distinct employee. For possible duplicates, use Payroll import reconciliation. Login and service records are prepared separately.</p><Field label="Employee name"><input className={inputClass} name="display_name" maxLength={200} required /></Field><Field label="Payroll ID"><input className={inputClass} name="external_id" maxLength={100} required /></Field><PlacementFields departments={departments} /></ActionDialog>}

    </div>;
}

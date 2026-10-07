import { useEffect, useState } from 'react';
import { Link,useSearchParams } from 'react-router-dom';
import { Policies } from './sections/Policies';
import type { ReactNode } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { GovernmentWorkflowManagement } from './GovernmentWorkflowManagement';
import { GovernmentFoundation } from './GovernmentFoundation';
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
import { EmployeeDetails } from './EmployeeDetails';
import { OrganisationManagement } from './OrganisationManagement';
import { ReviewRecordName } from './ReviewRecordName';
import { reviewRecordLabel } from './reviewRecordNames';
import type { EmployeeProfile, ManagedEmployee, WorkPattern } from './managementTypes';
import type { OrgDepartment } from './types';

export function EmployeeManagement({ legacyTools,workspace='employees' }: { legacyTools: ReactNode;workspace?:'employees'|'settings' }) {
    const { user } = useAuth();
    const central = user?.permissions?.hr_admin === true;
    const [scopeSummary,setScopeSummary] = useState('Checking assigned access…');
    useEffect(() => { void apiClient.get<{central:boolean;scopes:{department_name:string;division_name:string|null}[]}>('/hr/access-scopes/context').then(context=>setScopeSummary(context.central ? 'Central HR · Government-wide records' : context.scopes.length ? `Assigned access: ${context.scopes.map(scope=>`${scope.department_name} / ${scope.division_name || 'All divisions'}`).join('; ')}` : 'No active department or division assignment. Contact central HR.')).catch(()=>setScopeSummary('Unable to confirm assigned access.')); }, []);
    const choices = workspace==='settings' ? [['policies','Leave policies'],['organisation','Organisation & approvers'],['access','HR access'],['import','Payroll import'],['onboarding','Onboarding'],['rollout','Rollout readiness']] : [['directory','Employee list'],...(central ? [['legacy','Existing leave records'],['foundations','Government balances & service'],['government-workflow','Government applications & jobs'],['payroll','Payroll & handover']] : user?.permissions?.hr_balance_manage ? [['balances','Balances']] : [])];
    const [params,setParams]=useSearchParams();
    const requested=params.get('view'),tab=choices.some(([id])=>id===requested)?requested!:choices[0][0];
    const [creating, setCreating] = useState(false);
    const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [department, setDepartment] = useState(''), [status, setStatus] = useState(''), [readiness, setReadiness] = useState(''), [page, setPage] = useState(0);
    const [list, setList] = useState<{ employees: ManagedEmployee[]; total: number; page_size: number }>({ employees: [], total: 0, page_size: 50 });
    const [departments, setDepartments] = useState<OrgDepartment[]>([]), [patterns, setPatterns] = useState<WorkPattern[]>([]);
    const [profile, setProfile] = useState<EmployeeProfile | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [opening, setOpening] = useState(false), [version, setVersion] = useState(0);
    async function loadReferences() { const [org, work] = await Promise.all([apiClient.get<OrgDepartment[]>('/hr/org-units'), apiClient.get<WorkPattern[]>('/hr/directory/work-patterns')]); setDepartments(org); setPatterns(work); }
    useEffect(() => { void loadReferences().catch((err: Error) => setError(err.message)); }, []);
    useEffect(() => {
        if (tab !== 'directory') return;
        let live = true; setLoading(true); setError('');
        const params = new URLSearchParams({ page: String(page + 1), search });
        if (department) params.set('department_id', department); if (status) params.set('status', status); if (readiness) params.set('readiness', readiness);
        void apiClient.get<typeof list>(`/hr/directory?${params}`).then((data) => { if (live) { setList(data); if (page > 0 && page * 50 >= data.total) setPage(Math.max(0, Math.ceil(data.total / 50) - 1)); } }).catch((err: Error) => { if (live) setError(err.message); }).finally(() => { if (live) setLoading(false); });
        return () => { live = false; };
    }, [tab, page, search, department, status, readiness, version]);
    async function open(id: string) { setOpening(true); setError(''); try { setProfile(await apiClient.get<EmployeeProfile>(`/hr/directory/${id}/profile`)); } catch (err) { setError((err as Error).message); } finally { setOpening(false); } }
    return <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
            <label className="flex min-w-0 flex-wrap items-center gap-3 text-sm font-medium text-gray-700">{workspace==='settings'?'Settings':'Employee view'}
                <select aria-label={workspace==='settings'?'Leave settings':'Employee view'} className="min-w-0 max-w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900" value={tab} onChange={e=>setParams({view:e.target.value})}>
                    {choices.map(([id,label])=><option key={id} value={id}>{label}</option>)}
                </select>
            </label>
            <p className="text-xs text-gray-500">{scopeSummary}</p>
        </div>
        {!(workspace==='settings'&&tab==='policies')&&<details className="text-sm text-gray-600">
            <summary className="cursor-pointer font-medium">{workspace==='settings'?'How to use Settings':'How to review employees'}</summary>
            <div className="mt-3 space-y-2">
                {workspace==='settings'?<><p>Leave policies holds government rules, public holidays and weekly work schedules. Organisation &amp; approvers holds departments, divisions and dated office assignments. HR access controls which records HR officers can manage.</p><p>Payroll import reconciles employee identities. Onboarding prepares individual accounts. Rollout readiness checks prepared employees before release.</p><p>Return to <Link className="font-medium text-brand underline" to="/leave/employees">Employees</Link> to inspect records, balances and leave operations.</p></>:<><p>Start with the Employee list and open Manage. Existing leave records holds the retained employee balances and leave tools. Government balances &amp; service holds independently certified balances and service calculations for the new policy.</p><p>Government applications &amp; jobs controls independent employee activation and approved balance updates. Payroll &amp; handover handles opening reconciliation, Payroll receipts and transfer records.</p><p>Shared configuration is under <Link className="font-medium text-brand underline" to="/leave/settings">Settings</Link>: policies, organisation, approvers, HR access and onboarding.</p></>}
            </div>
        </details>}
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
                    <div className="min-w-0"><h3 className="break-words font-semibold text-gray-900"><ReviewRecordName name={employee.display_name}/></h3><p className="break-words text-sm text-gray-600">{reviewRecordLabel(employee.department_code || 'Department unverified')}{employee.division_code ? ` / ${reviewRecordLabel(employee.division_code)}` : ''} · {employee.status}</p><p className="break-words text-xs text-gray-500">Payroll ID: {employee.external_ids?.map((id) => id.external_id).join(', ') || 'Missing'} · {employee.reviewer_id ? 'Login linked' : 'Login unlinked'}</p><p className="text-xs text-gray-500">{employee.employment_category || 'Current appointment unrecorded'}{employee.is_teacher ? ' · Teacher' : ''}{employee.is_intern ? ' · Intern' : ''}{employee.counts_for_service == null ? ' · Service credit unknown' : employee.counts_for_service ? ' · Service included' : ' · Service excluded'}</p></div>
                    <Button variant="secondary" className="min-w-24" aria-label={`Manage ${employee.display_name}`} disabled={opening} onClick={() => void open(employee.id)}>Manage</Button>
                </article>)}
                <div className="px-3"><Pager page={page} pageCount={Math.ceil(list.total / list.page_size)} total={list.total} pageSize={list.page_size} setPage={setPage} /></div>
            </div>}
        </>}
        {tab === 'policies' && central && <Policies />}
        {tab === 'import' && <PayrollEmployeeImport onApplied={() => setVersion((current) => current + 1)} />}
        {tab === 'organisation' && <OrganisationManagement departments={departments} patterns={patterns} onChanged={loadReferences} />}
        {tab === 'access' && central && <HrAccessManagement departments={departments} />}
        {tab === 'government-workflow' && central && <GovernmentWorkflowManagement />}
        {tab === 'foundations' && central && <GovernmentFoundation />}
        {tab === 'payroll' && central && <GovernmentPayroll />}
        {tab === 'rollout' && central && <GovernmentRollout departments={departments} />}
        {tab === 'onboarding' && central && <EmployeeOnboarding departments={departments} />}
        {tab === 'balances' && <ScopedBalances />}
        {tab === 'legacy' && central && legacyTools}
        {creating && <ActionDialog title="Add verified employee" onClose={() => setCreating(false)} saveLabel="Create employee record" onSave={async (data) => {
            const created = await apiClient.post<{ id: string }>('/hr/directory', { display_name: value(data,'display_name'), external_id: value(data,'external_id'), department_id: value(data,'department_id'), division_id: value(data,'division_id') || null, reason: value(data,'reason') });
            setCreating(false); setVersion((current) => current + 1); await open(created.id);
        }}><p className="text-sm text-gray-600">Check the Payroll and personnel record before creating a distinct employee. For possible duplicates, use Payroll import reconciliation. Login and service records are prepared separately.</p><Field label="Employee name"><input className={inputClass} name="display_name" maxLength={200} required /></Field><Field label="Payroll ID"><input className={inputClass} name="external_id" maxLength={100} required /></Field><PlacementFields departments={departments} /></ActionDialog>}
        {profile && <EmployeeDetails central={central} profile={profile} departments={departments} patterns={patterns} onClose={() => setProfile(null)} onChanged={async () => { setProfile(await apiClient.get<EmployeeProfile>(`/hr/directory/${profile.employee.id}/profile`)); setVersion((current) => current + 1); }} />}
    </div>;
}

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { GovernmentFoundation } from './GovernmentFoundation';
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
import type { EmployeeProfile, ManagedEmployee, WorkPattern } from './managementTypes';
import type { OrgDepartment } from './types';

export function EmployeeManagement({ legacyTools }: { legacyTools: ReactNode }) {
    const { user } = useAuth();
    const central = user?.permissions?.hr_admin === true;
    const [scopeSummary,setScopeSummary] = useState('Checking assigned access…');
    useEffect(() => { void apiClient.get<{central:boolean;scopes:{department_name:string;division_name:string|null}[]}>('/hr/access-scopes/context').then(context=>setScopeSummary(context.central ? 'Central HR · Government-wide records' : context.scopes.length ? `Assigned access: ${context.scopes.map(scope=>`${scope.department_name} / ${scope.division_name || 'All divisions'}`).join('; ')}` : 'No active department or division assignment. Contact central HR.')).catch(()=>setScopeSummary('Unable to confirm assigned access.')); }, []);
    const [tab, setTab] = useState('directory'), [creating, setCreating] = useState(false);
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
        <div><h2 className="text-2xl font-semibold text-gray-950">Employee management</h2><p className="mt-1 text-sm text-gray-600">Prepare verified identities, appointments and the enterprise approval structure for government leave.</p></div>
        <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{scopeSummary}</p>
        <nav aria-label="Employee management" className="app-panel flex flex-wrap gap-2 p-3">{[['directory','Employees'],...(central ? [['import','Payroll import'],['organisation','Organisation & approvers'],['access','HR access'],['onboarding','Onboarding'],['foundations','Policy & balances'],['legacy','Historical balances & tools']] : user?.permissions?.hr_balance_manage ? [['balances','Balances']] : [])].map(([id,label]) => <Button key={id} variant={tab === id ? 'primary' : 'secondary'} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</Button>)}</nav>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {tab === 'directory' && <>
            <form className="app-panel grid items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); setPage(0); }}>
                <Field label="Search employees"><input className={inputClass} maxLength={100} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or exact Payroll ID" /></Field>
                <Field label="Filter department"><select className={inputClass} value={department} onChange={(e) => { setDepartment(e.target.value); setPage(0); }}><option value="">All departments</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                <Field label="Filter status"><select className={inputClass} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
                <Field label="Preparation issues"><select className={inputClass} value={readiness} onChange={(e) => { setReadiness(e.target.value); setPage(0); }}><option value="">All employees</option><option value="unlinked">No verified login</option><option value="missing_id">Payroll ID missing</option><option value="missing_placement">Placement incomplete</option><option value="missing_service">Current category / service credit incomplete</option><option value="missing_pattern">Current work pattern missing</option></select></Field>
                <Button type="submit">Search employees</Button>
            </form>
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-gray-600">{list.total} matching employees · 50 per page</p>{central && <Button onClick={() => setCreating(true)}>Add verified employee</Button>}</div>
            {loading ? <LoadingState label="Loading employee page…" /> : <div className="app-panel divide-y divide-gray-100">
                {!list.employees.length && <p className="p-5 text-sm text-gray-500">No employees match these filters. Prepare the Payroll import or add a verified employee.</p>}
                {list.employees.map((employee) => <article key={employee.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0"><h3 className="break-words font-semibold text-gray-900">{employee.display_name}</h3><p className="break-words text-sm text-gray-600">{employee.department_code || 'Department unverified'}{employee.division_code ? ` / ${employee.division_code}` : ''} · {employee.status}</p><p className="break-words text-xs text-gray-500">Payroll ID: {employee.external_ids?.map((id) => id.external_id).join(', ') || 'Missing'} · {employee.reviewer_id ? 'Login linked' : 'Login unlinked'}</p><p className="text-xs text-gray-500">{employee.employment_category || 'Current appointment unrecorded'}{employee.is_teacher ? ' · Teacher' : ''}{employee.is_intern ? ' · Intern' : ''}{employee.counts_for_service == null ? ' · Service credit unknown' : employee.counts_for_service ? ' · Service included' : ' · Service excluded'}</p></div>
                    <Button variant="secondary" disabled={opening} onClick={() => void open(employee.id)}>Manage {employee.display_name}</Button>
                </article>)}
                <div className="px-3"><Pager page={page} pageCount={Math.ceil(list.total / list.page_size)} total={list.total} pageSize={list.page_size} setPage={setPage} /></div>
            </div>}
        </>}
        {tab === 'import' && <PayrollEmployeeImport onApplied={() => setVersion((current) => current + 1)} />}
        {tab === 'organisation' && <OrganisationManagement departments={departments} patterns={patterns} onChanged={loadReferences} />}
        {tab === 'access' && central && <HrAccessManagement departments={departments} />}
        {tab === 'foundations' && central && <GovernmentFoundation />}
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

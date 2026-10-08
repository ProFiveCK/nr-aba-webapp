import { useEffect, useState } from 'react';
import { formatDate, todayIsoDate } from '../../lib/date';
import { AustralianDateInput } from '../../components/AustralianDateInput';
import { apiClient } from '../../lib/api';
import { Button, LoadingState, Pager } from '../../components/Ui';
import { StatutoryOffices } from './StatutoryOffices';
import { OrgUnits } from './OrgUnits';
import { ActionDialog, DirectoryPicker, Field, inputClass } from './ManagementFields';
import { value } from './managementForm';
import { APPROVER_LABELS } from './managementTypes';
import { appointmentTiming, organisationQuery } from './organisationBrowse';
import type { ApprovalAssignment, WorkPattern } from './managementTypes';
import type { OrgDepartment } from './types';

type Section = 'departments' | 'approvers' | 'statutory';
const sections: { id: Section; label: string }[] = [
    { id: 'departments', label: 'Departments & divisions' },
    { id: 'approvers', label: 'Leave approvers' },
    { id: 'statutory', label: 'Statutory & HR offices' },
];
// Patterns remain accepted for the caller during consolidation; Policies owns their editing.
export function OrganisationManagement({ departments, onChanged }: { departments: OrgDepartment[]; patterns?: WorkPattern[]; onChanged: () => Promise<void> }) {
    const [section, setSection] = useState<Section>('departments'), [department, setDepartment] = useState(''), [error, setError] = useState('');
    return <div className="space-y-4">
        <p className="text-sm text-gray-600">Current staff and their nominated managers are retained. Dated office appointments route new Government applications after independent activation.</p>
        <nav aria-label="Organisation sections" className="flex flex-wrap gap-2">{sections.map((item) => <button key={item.id} type="button" aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)} className={`rounded-lg px-3 py-2 text-sm font-medium ${section === item.id ? 'bg-brand text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>{item.label}</button>)}</nav>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {section === 'departments' && <OrgUnits onChanged={() => { void onChanged().catch((err: Error) => setError(err.message)); }} onManageOffices={(id) => { setDepartment(id); setSection('approvers'); }} />}
        {section === 'approvers' && <LeaveApprovers departments={departments} initialDepartment={department} />}
        {section === 'statutory' && <StatutoryOffices departments={departments} />}
    </div>;
}

function LeaveApprovers({ departments, initialDepartment }: { departments: OrgDepartment[]; initialDepartment: string }) {
    const [list, setList] = useState<{ assignments: ApprovalAssignment[]; total: number; page_size: number }>({ assignments: [], total: 0, page_size: 10 });
    const [page, setPage] = useState(0), [version, setVersion] = useState(0), [error, setError] = useState(''), [loading, setLoading] = useState(true);
    const [search, setSearch] = useState(''), [appliedSearch, setAppliedSearch] = useState('');
    const [department, setDepartment] = useState(initialDepartment), [level, setLevel] = useState(''), [timing, setTiming] = useState('');
    const [adding, setAdding] = useState(false), [closing, setClosing] = useState<ApprovalAssignment | null>(null);
    useEffect(() => {
        let live = true;
        const query = organisationQuery(page, { search: appliedSearch, department_id: department, level, timing });
        void apiClient.get<typeof list>(`/hr/directory/approval-assignments?${query}`).then((data) => { if (live) { setList(data); setError(''); } }).catch((err: Error) => { if (live) setError(err.message); }).finally(() => { if (live) setLoading(false); });
        return () => { live = false; };
    }, [page, version, appliedSearch, department, level, timing]);
    function filter(set: (value: string) => void, selected: string) { set(selected); setPage(0); setLoading(true); setVersion((current) => current + 1); }
    function reload() { setLoading(true); setVersion((current) => current + 1); }
    const today = todayIsoDate();
    return <section className="app-panel space-y-4 p-4 sm:p-5" aria-label="Leave approvers">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm text-gray-600">Divisional approver → Head of Department → Chief Secretary. Review appointments by department, office or date.</p><Button onClick={() => setAdding(true)}>Assign officeholder</Button></div>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); filter(setAppliedSearch, search.trim()); }}><div className="min-w-0 flex-1 basis-56"><Field label="Search appointments"><input className={inputClass} type="search" maxLength={100} placeholder="Officeholder or department" value={search} onChange={(event) => setSearch(event.target.value)} /></Field></div><Button type="submit" variant="secondary">Search</Button></form>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Department"><select className={inputClass} value={department} onChange={(event) => filter(setDepartment, event.target.value)}><option value="">All departments and government-wide</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Approval office"><select className={inputClass} value={level} onChange={(event) => filter(setLevel, event.target.value)}><option value="">All offices</option>{Object.entries(APPROVER_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field><Field label="Appointment dates"><select className={inputClass} value={timing} onChange={(event) => filter(setTiming, event.target.value)}><option value="">All dates</option><option value="current">Effective now</option><option value="upcoming">Upcoming</option><option value="ended">Ended</option></select></Field></div>
        <p className="text-xs text-gray-500">An appointment requires active staff, a verified login and a separate approval grant. Assigning an office does not grant account permissions.</p>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div aria-busy={loading}>{loading ? <LoadingState label="Loading appointments…" /> : error ? null : <>
            <p className="mb-2 text-sm text-gray-500" role="status">{list.total} matching appointments</p>
            {!list.assignments.length && <p className="py-6 text-sm text-gray-500">No appointments match these filters.</p>}
            <ul className="divide-y divide-gray-200">{list.assignments.map((assignment) => {
                const ready = assignment.employee_status === 'active' && assignment.account_status === 'active' && assignment.has_approval_grant;
                const appointmentState = appointmentTiming(assignment.effective_from, assignment.effective_to, today);
                return <li key={assignment.id} className="py-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1 basis-64"><p className="break-words text-sm font-semibold">{APPROVER_LABELS[assignment.level]} · {assignment.approver_name}</p><p className="mt-1 text-sm text-gray-600">{assignment.department_name || 'Government-wide'}{assignment.division_name ? ` / ${assignment.division_name}` : ''}</p><p className="mt-1 text-xs text-gray-500">{formatDate(assignment.effective_from)} → {assignment.effective_to ? formatDate(assignment.effective_to) : 'Open'} · {appointmentState === 'current' ? 'Effective now' : appointmentState === 'upcoming' ? 'Upcoming' : 'Ended'}</p><p className={`mt-1 text-xs ${ready ? 'text-green-800' : 'text-amber-800'}`}>{ready ? 'Employee, login and approval grant ready' : !assignment.reviewer_id ? 'Needs verified login' : assignment.employee_status !== 'active' || assignment.account_status !== 'active' ? 'Employee or account inactive' : 'Needs explicit leave approval permission'}</p><details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">Appointment authority</summary><p className="mt-1 break-words">{assignment.reason}</p></details></div>{appointmentState !== 'ended' && <Button variant="secondary" onClick={() => setClosing(assignment)}>Close appointment</Button>}</div></li>;
            })}</ul>
            <Pager page={page} pageCount={Math.ceil(list.total / list.page_size)} total={list.total} pageSize={list.page_size} setPage={(next) => { setLoading(true); setPage(next); }} />
        </>}</div>
        {adding && <OfficeholderDialog departments={departments} initialDepartment={department} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setPage(0); reload(); }} />}
        {closing && <ActionDialog title="Close officeholder appointment" description={`${APPROVER_LABELS[closing.level]} · ${closing.approver_name}`} onClose={() => setClosing(null)} onSave={async (data) => { await apiClient.post(`/hr/directory/approval-assignments/${closing.id}/close`, { end_date: value(data, 'end_date'), reason: value(data, 'reason') }); setClosing(null); reload(); }}><p className="text-sm text-gray-600">Preserve the appointment record. A replacement can start on the following day; overlapping primary officeholders are blocked.</p><Field label="Final officeholder day"><AustralianDateInput name="end_date" className={inputClass} min={closing.effective_from} max={closing.effective_to || undefined} defaultValue={closing.effective_to || ''} required /></Field></ActionDialog>}
    </section>;
}

function OfficeholderDialog({ departments, initialDepartment, onClose, onSaved }: { departments: OrgDepartment[]; initialDepartment: string; onClose: () => void; onSaved: () => void }) {
    const [level,setLevel] = useState('division'), [department,setDepartment] = useState(initialDepartment);
    return <ActionDialog title="Assign leave officeholder" onClose={onClose} onSave={async (data) => {
        const approver = value(data,'approver_employee_id'); if (!approver) throw new Error('Choose an active officeholder with a verified login.');
        await apiClient.post('/hr/directory/approval-assignments',{ level,department_id: level === 'chief_secretary' ? null : department,division_id: level === 'division' ? value(data,'division_id') : null,approver_employee_id: approver,effective_from: value(data,'effective_from'),effective_to: value(data,'effective_to') || null,reason: value(data,'reason') }); onSaved();
    }}><Field label="Approval office"><select className={inputClass} value={level} onChange={(e) => setLevel(e.target.value)}>{Object.entries(APPROVER_LABELS).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
        {level !== 'chief_secretary' && <Field label="Department scope"><select className={inputClass} value={department} onChange={(e) => setDepartment(e.target.value)} required><option value="">Choose department</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
        {level === 'division' && <Field label="Division scope"><select key={department} className={inputClass} name="division_id" required><option value="">Choose division</option>{departments.find((item) => item.id === department)?.divisions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
        <DirectoryPicker name="approver_employee_id" label="Officeholder employee" requireLinked />
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Effective from"><AustralianDateInput className={inputClass} name="effective_from"  defaultValue={todayIsoDate()} required /></Field><Field label="Effective to (optional)"><AustralianDateInput className={inputClass} name="effective_to"  /></Field></div>
        <p className="text-xs text-gray-500">Record the appointment instrument or authorising evidence in the reason. Assignment alone cannot approve leave or supply a missing account grant.</p>
    </ActionDialog>;
}

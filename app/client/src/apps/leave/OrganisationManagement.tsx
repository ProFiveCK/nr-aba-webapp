import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { todayIsoDate } from '../../lib/date';
import { Button, Pager } from '../../components/Ui';
import { StatutoryOffices } from './StatutoryOffices';
import { OrgUnits } from './OrgUnits';
import { ActionDialog, DirectoryPicker, Field, inputClass } from './ManagementFields';
import { value } from './managementForm';
import { APPROVER_LABELS } from './managementTypes';
import type { ApprovalAssignment, WorkPattern } from './managementTypes';
import type { OrgDepartment } from './types';

const WEEKDAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export function OrganisationManagement({ departments, patterns, onChanged }: { departments: OrgDepartment[]; patterns: WorkPattern[]; onChanged: () => Promise<void> }) {
    const [list, setList] = useState<{ assignments: ApprovalAssignment[]; total: number; page_size: number }>({ assignments: [], total: 0, page_size: 50 });
    const [page, setPage] = useState(0), [version, setVersion] = useState(0), [error, setError] = useState('');
    const [adding, setAdding] = useState(false), [closing, setClosing] = useState<ApprovalAssignment | null>(null), [addingPattern, setAddingPattern] = useState(false);
    useEffect(() => { let live = true; void apiClient.get<typeof list>(`/hr/directory/approval-assignments?page=${page + 1}`).then((data) => { if (live) setList(data); }).catch((err: Error) => { if (live) setError(err.message); }); return () => { live = false; }; }, [page,version]);
    const reloadReferences = () => { void onChanged().catch((err: Error) => setError(err.message)); };
    return <div className="space-y-4">
        <OrgUnits onChanged={reloadReferences} />
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <section className="app-panel space-y-4 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Enterprise leave approvers</h3><p className="mt-1 text-sm text-gray-600">Divisional approver → Head of Department → Chief Secretary. Assign offices with effective dates and retain past appointments.</p></div><Button onClick={() => setAdding(true)}>Assign officeholder</Button></div>
            <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">An office assignment needs an active employee, verified login and an explicit leave approval grant. Assigning an office does not grant account permissions. The employee route preview checks these three offices. Additional HR, Secretary and Minister offices are configured below. Government submissions require independent activation for each employee.</p>
            {!list.assignments.length && <p className="text-sm text-gray-500">No officeholders assigned yet.</p>}
            <div className="space-y-2">{list.assignments.map((assignment) => {
                const ready = assignment.employee_status === 'active' && assignment.account_status === 'active' && assignment.has_approval_grant;
                const today = todayIsoDate(), timing = assignment.effective_from > today ? 'Upcoming' : assignment.effective_to && assignment.effective_to < today ? 'Ended' : 'Effective now';
                return <article key={assignment.id} className="space-y-2 rounded-lg border border-gray-200 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold">{APPROVER_LABELS[assignment.level]} · {assignment.approver_name}</h4><p className="text-sm text-gray-600">{assignment.department_name || 'Government-wide'}{assignment.division_name ? ` / ${assignment.division_name}` : ''}</p><p className="text-xs text-gray-500">{assignment.effective_from} → {assignment.effective_to || 'Open'} · {timing}</p></div><Button variant="secondary" onClick={() => setClosing(assignment)}>Close appointment</Button></div><p className={`text-xs ${ready ? 'text-green-800' : 'text-amber-800'}`}>{ready ? 'Employee, login and approval grant ready' : !assignment.reviewer_id ? 'Needs verified login' : assignment.employee_status !== 'active' || assignment.account_status !== 'active' ? 'Employee or account inactive' : 'Needs explicit leave approval permission'}</p><p className="break-words text-xs text-gray-500">Authority recorded: {assignment.reason}</p></article>;
            })}</div>
            <Pager page={page} pageCount={Math.ceil(list.total/list.page_size)} total={list.total} pageSize={list.page_size} setPage={setPage} />
        </section>
        <StatutoryOffices departments={departments}/>
        <section className="app-panel space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Approved work patterns</h3><Button onClick={() => setAddingPattern(true)}>Add work pattern</Button></div><p className="text-sm text-gray-600">Record verified weekly patterns for service review. Shift and leave charging still need configuration. Create a new pattern when hours change to preserve historical references.</p>
            {!patterns.length && <p className="text-sm text-gray-500">No patterns recorded.</p>}
            {patterns.map((pattern) => <div key={pattern.id} className="rounded-lg bg-gray-50 p-3"><p className="font-medium">{pattern.name}</p><p className="text-sm text-gray-600">{pattern.working_weekdays.map((day) => WEEKDAYS[day - 1]).join(', ')} · {pattern.hours_per_day ? `${pattern.hours_per_day} hours/day` : 'Hours unverified'}</p></div>)}
        </section>
        {adding && <OfficeholderDialog departments={departments} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setPage(0); setVersion((current) => current + 1); }} />}
        {closing && <ActionDialog title="Close officeholder appointment" description={`${APPROVER_LABELS[closing.level]} · ${closing.approver_name}`} onClose={() => setClosing(null)} onSave={async (data) => { await apiClient.post(`/hr/directory/approval-assignments/${closing.id}/close`, { end_date: value(data,'end_date'), reason: value(data,'reason') }); setClosing(null); setVersion((current) => current + 1); }}><p className="text-sm text-gray-600">Preserve the appointment record. A replacement can start on the following day; overlapping primary officeholders are blocked.</p><Field label="Final officeholder day"><input name="end_date" className={inputClass} type="date" min={closing.effective_from} max={closing.effective_to || undefined} defaultValue={closing.effective_to || ''} required /></Field></ActionDialog>}
        {addingPattern && <ActionDialog title="Add approved work pattern" onClose={() => setAddingPattern(false)} onSave={async (data) => {
            const weekdays = data.getAll('working_weekdays').map(Number); if (!weekdays.length) throw new Error('Select at least one working weekday.');
            await apiClient.post('/hr/directory/work-patterns',{ name: value(data,'name'), working_weekdays: weekdays, hours_per_day: value(data,'hours_per_day') ? Number(value(data,'hours_per_day')) : null, reason: value(data,'reason') }); await onChanged(); setAddingPattern(false);
        }}><Field label="Pattern name"><input className={inputClass} name="name" required maxLength={120} /></Field><fieldset className="space-y-2"><legend className="text-sm font-medium text-gray-700">Working weekdays</legend><div className="grid grid-cols-2 gap-2 text-sm">{WEEKDAYS.map((day,index) => <label key={day}><input name="working_weekdays" type="checkbox" value={index + 1} /> {day}</label>)}</div></fieldset><Field label="Hours per working day (optional)"><input className={inputClass} name="hours_per_day" type="number" min="0.01" max="24" step="0.01" /></Field></ActionDialog>}
    </div>;
}

function OfficeholderDialog({ departments, onClose, onSaved }: { departments: OrgDepartment[]; onClose: () => void; onSaved: () => void }) {
    const [level,setLevel] = useState('division'), [department,setDepartment] = useState('');
    return <ActionDialog title="Assign leave officeholder" onClose={onClose} onSave={async (data) => {
        const approver = value(data,'approver_employee_id'); if (!approver) throw new Error('Choose an active officeholder with a verified login.');
        await apiClient.post('/hr/directory/approval-assignments',{ level,department_id: level === 'chief_secretary' ? null : department,division_id: level === 'division' ? value(data,'division_id') : null,approver_employee_id: approver,effective_from: value(data,'effective_from'),effective_to: value(data,'effective_to') || null,reason: value(data,'reason') }); onSaved();
    }}><Field label="Approval office"><select className={inputClass} value={level} onChange={(e) => setLevel(e.target.value)}>{Object.entries(APPROVER_LABELS).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
        {level !== 'chief_secretary' && <Field label="Department scope"><select className={inputClass} value={department} onChange={(e) => setDepartment(e.target.value)} required><option value="">Choose department</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
        {level === 'division' && <Field label="Division scope"><select key={department} className={inputClass} name="division_id" required><option value="">Choose division</option>{departments.find((item) => item.id === department)?.divisions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
        <DirectoryPicker name="approver_employee_id" label="Officeholder employee" requireLinked />
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Effective from"><input className={inputClass} name="effective_from" type="date" defaultValue={todayIsoDate()} required /></Field><Field label="Effective to (optional)"><input className={inputClass} name="effective_to" type="date" /></Field></div>
        <p className="text-xs text-gray-500">Record the appointment instrument or authorising evidence in the reason. Assignment alone cannot approve leave or supply a missing account grant.</p>
    </ActionDialog>;
}

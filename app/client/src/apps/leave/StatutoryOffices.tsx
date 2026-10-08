import { useEffect, useState } from 'react';
import { formatDate, todayIsoDate } from '../../lib/date';
import { AustralianDateInput } from '../../components/AustralianDateInput';
import { apiClient } from '../../lib/api';
import { Button, LoadingState, Pager } from '../../components/Ui';
import { ActionDialog, DirectoryPicker, Field, inputClass } from './ManagementFields';
import { value } from './managementForm';
import { governmentLabel as label } from './governmentWorkflowTypes';
import { appointmentTiming, organisationQuery } from './organisationBrowse';
import type { ConsentOffice } from './governmentWorkflowTypes';
import type { OrgDepartment } from './types';

const root = '/hr/government/workflow';
type OfficePage = { offices: ConsentOffice[]; total: number; page: number; page_size: number };
export function StatutoryOffices({ departments }: { departments: OrgDepartment[] }) {
    const [data, setData] = useState<OfficePage>({ offices: [], total: 0, page: 1, page_size: 10 });
    const [version, setVersion] = useState(0), [error, setError] = useState(''), [loading, setLoading] = useState(true), [page, setPage] = useState(0);
    const [search, setSearch] = useState(''), [appliedSearch, setAppliedSearch] = useState(''), [department, setDepartment] = useState(''), [level, setLevel] = useState(''), [timing, setTiming] = useState('');
    const [dialog, setDialog] = useState<{ kind: 'office' | 'close-office'; target?: ConsentOffice } | null>(null), [officeLevel, setOfficeLevel] = useState('relevant_secretary');
    useEffect(() => {
        let live = true;
        const query = organisationQuery(page, { search: appliedSearch, level, timing,
            scope: department === 'government' ? 'government' : '',
            department_id: department === 'government' ? '' : department,
        });
        void apiClient.get<OfficePage>(`${root}/consent-offices?${query}`).then((response) => { if (live) { setData(response); setError(''); } }).catch((err: Error) => { if (live) setError(err.message); }).finally(() => { if (live) setLoading(false); });
        return () => { live = false; };
    }, [version, page, appliedSearch, department, level, timing]);
    function filter(set: (value: string) => void, selected: string) { set(selected); setPage(0); setLoading(true); setVersion((current) => current + 1); }
    function show(kind: 'office' | 'close-office', target?: ConsentOffice) { setDialog({ kind, target }); }
    async function save(form: FormData) {
        if (!dialog) return;
        const reason = value(form, 'reason'), source_reference = value(form, 'source_reference');
        if (dialog.kind === 'office') {
            if (!value(form, 'approver_employee_id')) throw new Error('Choose an active officeholder with a verified login.');
            await apiClient.post(`${root}/consent-offices`, { reason, source_reference, level: value(form, 'level'), department_id: value(form, 'department_id') || null, approver_employee_id: value(form, 'approver_employee_id'), effective_from: value(form, 'effective_from'), effective_to: value(form, 'effective_to') || null });
        } else await apiClient.post(`${root}/consent-offices/${dialog.target?.id}/close`, { reason, effective_to: value(form, 'effective_to') });
        setDialog(null); setLoading(true); setVersion((current) => current + 1);
    }
    return <section className="app-panel space-y-4 p-4 sm:p-5" aria-label="Statutory and HR offices">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm text-gray-600">Department Secretaries and Ministers provide statutory decisions. The central HR verifier is a government-wide office.</p><Button onClick={() => show('office')}>Assign statutory or HR office</Button></div>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); filter(setAppliedSearch, search.trim()); }}><div className="min-w-0 flex-1 basis-56"><Field label="Search statutory offices"><input className={inputClass} type="search" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Officeholder or source reference" /></Field></div><Button variant="secondary" type="submit">Search</Button></form>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Office scope"><select className={inputClass} value={department} onChange={(event) => filter(setDepartment, event.target.value)}><option value="">All scopes</option><option value="government">Government-wide</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Statutory or HR office"><select className={inputClass} value={level} onChange={(event) => filter(setLevel, event.target.value)}><option value="">All offices</option><option value="relevant_secretary">Relevant Secretary</option><option value="hr_verifier">Central HR verifier</option><option value="minister">Minister for medical escalation</option></select></Field><Field label="Appointment dates"><select className={inputClass} value={timing} onChange={(event) => filter(setTiming, event.target.value)}><option value="">All dates</option><option value="current">Effective now</option><option value="upcoming">Upcoming</option><option value="ended">Ended</option></select></Field></div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div aria-busy={loading}>{loading ? <LoadingState label="Loading statutory offices…" /> : error ? null : <>
            <p className="mb-2 text-sm text-gray-500" role="status">{data.total} matching appointments</p>
            {!data.offices.length && <p className="py-6 text-sm text-gray-500">No appointments match these filters.</p>}
            <ul className="divide-y divide-gray-200">{data.offices.map((office) => {
                const appointmentState = appointmentTiming(office.effective_from, office.effective_to, todayIsoDate());
                return <li key={office.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><div className="min-w-0 flex-1 basis-64"><p className="break-words text-sm font-semibold">{label(office.level)} · {office.display_name}{office.closed_office_id ? ' · Closure recorded' : ''}</p><p className="mt-1 text-sm text-gray-600">{office.department_id ? departments.find((item) => item.id === office.department_id)?.name || 'Managed department' : 'Government-wide'}</p><p className="mt-1 text-xs text-gray-500">{formatDate(office.effective_from)} → {office.effective_to ? formatDate(office.effective_to) : 'Open'} · {appointmentState === 'current' ? 'Effective now' : appointmentState === 'upcoming' ? 'Upcoming' : 'Ended'}</p><details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">Approved source reference</summary><p className="mt-1 break-words">{office.source_reference}</p></details></div>{!office.closed_office_id && appointmentState !== 'ended' && <Button variant="secondary" onClick={() => show('close-office', office)}>Close appointment</Button>}</li>;
            })}</ul>
            <Pager page={page} pageCount={Math.ceil(data.total / data.page_size)} total={data.total} pageSize={data.page_size} setPage={(next) => { setLoading(true); setPage(next); }} />
        </>}</div>
        {dialog && <ActionDialog title={dialog.kind === 'office' ? 'Assign statutory consent or HR verifier' : 'Close statutory office appointment'} onClose={() => setDialog(null)} onSave={save}>
            {dialog.kind === 'office' && <><Field label="Consent or evidence office"><select name="level" className={inputClass} value={officeLevel} onChange={(event) => setOfficeLevel(event.target.value)}><option value="relevant_secretary">Relevant Secretary</option><option value="hr_verifier">Central HR verifier</option><option value="minister">Minister for medical escalation</option></select></Field>{officeLevel !== 'hr_verifier' && <Field label="Statutory office department"><select name="department_id" className={inputClass} required defaultValue={department === 'government' ? '' : department}><option value="">Choose managed department</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}<DirectoryPicker name="approver_employee_id" label="Consent officeholder" requireLinked /><div className="grid gap-3 sm:grid-cols-2"><Field label="Office effective from"><AustralianDateInput name="effective_from" required defaultValue={todayIsoDate()} className={inputClass} /></Field><Field label="Office effective through"><AustralianDateInput name="effective_to" className={inputClass} /></Field></div><p className="text-sm text-gray-600">The Secretary and Minister need an explicit approval grant; the HR verifier needs central HR authority. Appointment does not grant account permissions.</p><Field label="Approved source reference"><input name="source_reference" required minLength={5} maxLength={500} className={inputClass} /></Field></>}
            {dialog.kind === 'close-office' && <><p className="text-sm text-gray-600">Record the inclusive last effective date without deleting appointment history. Pending bindings need explicit review after an office change.</p><Field label="Last effective office date"><AustralianDateInput name="effective_to" required min={dialog.target?.effective_from} max={dialog.target?.effective_to || undefined} className={inputClass} /></Field></>}
        </ActionDialog>}
    </section>;
}

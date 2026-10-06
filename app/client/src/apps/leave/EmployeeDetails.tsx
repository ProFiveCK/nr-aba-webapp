import { useCallback, useEffect, useState } from 'react';
import { Button, Modal } from '../../components/Ui';
import { apiClient } from '../../lib/api';
import { todayIsoDate } from '../../lib/date';
import { ActionDialog, DirectoryPicker, Field, PlacementFields, inputClass } from './ManagementFields';
import { value } from './managementForm';
import { APPROVER_LABELS, CATEGORIES } from './managementTypes';
import type { ApprovalChain, EmployeeProfile, ServicePeriod, WorkPattern } from './managementTypes';
import type { OrgDepartment } from './types';

const ROOT = '/hr/directory';
type Action = 'details' | 'placement' | 'service' | 'close_service' | 'identifier' | 'link' | 'unlink';
export function EmployeeDetails({ profile, departments, patterns, central, onClose, onChanged }: { central: boolean; profile: EmployeeProfile; departments: OrgDepartment[]; patterns: WorkPattern[]; onClose: () => void; onChanged: () => Promise<void> }) {
    const employee = profile.employee;
    const [action, setAction] = useState<Action | null>(null), [period, setPeriod] = useState<ServicePeriod | null>(null);
    const [onDate, setOnDate] = useState(todayIsoDate), [previewDate, setPreviewDate] = useState('');
    const [chain, setChain] = useState<ApprovalChain | null>(null), [error, setError] = useState(''), [previewBusy, setPreviewBusy] = useState(false);
    const preview = useCallback(async (date: string) => {
        setPreviewBusy(true); setError('');
        try { setChain(await apiClient.get<ApprovalChain>(`${ROOT}/${employee.id}/approval-chain?on_date=${date}`)); setPreviewDate(date); }
        catch (err) { setError((err as Error).message); } finally { setPreviewBusy(false); }
    }, [employee.id]);
    useEffect(() => { void preview(todayIsoDate()); }, [preview, employee.department_id, employee.division_id, employee.status]);
    async function saved() { await onChanged(); setAction(null); }
    if (action) {
        const titles: Record<Action, string> = { details: 'Edit employee details', placement: 'Verify organisation placement', service: 'Add service period', close_service: 'Close service period', identifier: 'Verify Payroll ID', link: 'Link a verified login', unlink: 'Unlink login' };
        return <ActionDialog title={titles[action]} description={employee.display_name} onClose={() => setAction(null)} onSave={async (data) => {
            const reason = value(data, 'reason'), base = `${ROOT}/${employee.id}`;
            if (action === 'details') await apiClient.put(`${base}/details`, { display_name: value(data,'display_name'), position_title: value(data,'position_title') || null, email: value(data,'email') || null, status: value(data,'status'), manager_id: value(data,'manager_id') || null, reason });
            if (action === 'placement') await apiClient.put(`${base}/organisation`, { department_id: value(data,'department_id'), division_id: value(data,'division_id') || null, reason });
            if (action === 'identifier') await apiClient.post(`${base}/external-ids`, { external_id: value(data,'external_id'), reason });
            if (action === 'service') await apiClient.post(`${base}/service-periods`, { start_date: value(data,'start_date'), end_date: value(data,'end_date') || null, employment_category: value(data,'employment_category'), is_teacher: data.has('is_teacher'), is_intern: data.has('is_intern'), counts_for_service: value(data,'counts_for_service') === '' ? null : value(data,'counts_for_service') === 'true', work_pattern_id: value(data,'work_pattern_id') || null, appointment_reference: value(data,'appointment_reference') || null, reason });
            if (action === 'close_service' && period) await apiClient.post(`${base}/service-periods/${period.id}/close`, { end_date: value(data,'end_date'), reason });
            if (action === 'link') {
                if (!value(data,'reviewer_id')) throw new Error('Explicitly choose a verified portal account.');
                await apiClient.put(`${base}/account-link`, { reviewer_id: value(data,'reviewer_id'), reason });
            }
            if (action === 'unlink') await apiClient.put(`${base}/account-link`, { reviewer_id: null, reason });
            await saved();
        }}>
            {action === 'details' && <>
                <Field label="Employee name"><input className={inputClass} name="display_name" defaultValue={employee.display_name} required maxLength={200} /></Field>
                <Field label="Position title"><input className={inputClass} name="position_title" defaultValue={employee.position_title || ''} maxLength={120} /></Field>
                <Field label="Contact email"><input className={inputClass} type="email" name="email" defaultValue={employee.email || ''} readOnly={!!employee.reviewer_id} maxLength={254} /></Field>
                {employee.reviewer_id && <p className="text-xs text-gray-500">The linked login email is retained. Contact changes require account verification.</p>}
                <Field label="Employee status"><select className={inputClass} disabled={!central} name={central ? "status" : undefined} defaultValue={employee.status}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>{!central && <input type="hidden" name="status" value={employee.status} />}
                <p className="text-xs text-gray-500">Changing status revokes linked sessions. Government employee access also checks active status on every request.</p>
                <DirectoryPicker name="manager_id" label="Reporting manager" initialId={employee.manager_id || ''} initialLabel={employee.manager_name || ''} employeeId={employee.id} allowClear />
            </>}
            {action === 'placement' && <><PlacementFields departments={departments} initialDepartment={employee.department_id || ''} initialDivision={employee.division_id || ''} /><p className="text-xs text-gray-500">This verifies the current placement. Reporting managers and leave officeholders are maintained separately.</p></>}
            {action === 'identifier' && <><Field label="Payroll ID"><input className={inputClass} name="external_id" required maxLength={100} /></Field><p className="text-xs text-gray-500">Keep leading zeros and letters. An existing ID cannot move from another employee.</p></>}
            {action === 'service' && <>
                <div className="grid gap-3 sm:grid-cols-2"><Field label="Appointment start"><input className={inputClass} name="start_date" type="date" required /></Field><Field label="Appointment end (inclusive)"><input className={inputClass} name="end_date" type="date" /></Field></div>
                <Field label="Employment category"><select className={inputClass} name="employment_category" defaultValue="unknown">{CATEGORIES.map((category) => <option key={category} value={category}>{category[0].toUpperCase() + category.slice(1)}</option>)}</select></Field>
                <div className="flex flex-wrap gap-4 text-sm"><label><input type="checkbox" name="is_teacher" /> Teacher</label><label><input type="checkbox" name="is_intern" /> Intern</label></div>
                <Field label="Counts for service"><select className={inputClass} name="counts_for_service"><option value="">Unknown — HR determination needed</option><option value="true">Included</option><option value="false">Excluded</option></select></Field>
                <Field label="Work pattern"><select className={inputClass} name="work_pattern_id"><option value="">Not yet verified</option>{patterns.map((pattern) => <option key={pattern.id} value={pattern.id}>{pattern.name}</option>)}</select></Field>
                <Field label="Appointment reference"><input className={inputClass} name="appointment_reference" maxLength={200} /></Field>
                <p className="text-xs text-gray-500">Overlaps are blocked. Close the previous period before recording a new appointment. Classification records facts. Automated government leave calculations are not yet enabled.</p>
            </>}
            {action === 'close_service' && period && <><p className="text-sm text-gray-600">Preserve the period beginning {period.start_date}. A close can only shorten its dates.</p><Field label="Final service day"><input className={inputClass} type="date" name="end_date" required min={period.start_date} max={period.end_date || undefined} defaultValue={period.end_date || ''} /></Field></>}
            {action === 'link' && <><p className="text-sm text-gray-600">Verify the individual's identity and Payroll record before linking. Both affected accounts must sign in again after a link changes.</p><DirectoryPicker kind="accounts" name="reviewer_id" label="Portal account" employeeId={employee.id} initialId={employee.reviewer_id || ''} initialLabel={employee.account_name || ''} /></>}
            {action === 'unlink' && <p className="text-sm text-gray-600">Unlink {employee.account_name || employee.account_email}. This retains employee history and revokes the affected login's sessions.</p>}
        </ActionDialog>;
    }
    return <Modal title={employee.display_name} description={`${employee.department_code || 'Department unverified'}${employee.division_code ? ` / ${employee.division_code}` : ''} · ${employee.status}`} onClose={onClose} placement="right" size="3xl">
        <div className="space-y-5">{!central && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">You may update details within your assigned scope. Central HR verifies identities, placement, service appointments and activation.</p>}
            <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Employee details</h3><Button variant="secondary" onClick={() => setAction('details')}>Edit details</Button></div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-gray-500">Position</dt><dd>{employee.position_title || 'Not recorded'}</dd></div><div><dt className="text-gray-500">Contact</dt><dd className="break-words">{employee.email || 'Not recorded'}</dd></div><div><dt className="text-gray-500">Reporting manager</dt><dd>{employee.manager_name || 'Not recorded'}</dd></div><div><dt className="text-gray-500">Historical join date</dt><dd>{employee.join_date || 'Not recorded'}</dd></div></dl>
                {central && <Button variant="secondary" onClick={() => setAction('placement')}>Verify placement</Button>}
            </section>
            <section className="space-y-3 border-t border-gray-200 pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Payroll identity</h3>{central && <Button variant="secondary" onClick={() => setAction('identifier')}>Verify Payroll ID</Button>}</div>
                {!profile.external_ids.length && <p className="text-sm text-amber-800">No Payroll ID verified. Verify identity before linking a login.</p>}
                {profile.external_ids.map((entry) => <div key={entry.id} className="rounded-lg bg-gray-50 p-3"><p className="break-words text-sm font-medium">{entry.external_id}</p><p className="break-words text-xs text-gray-500">{entry.reason}</p></div>)}
            </section>
            <section className="space-y-3 border-t border-gray-200 pt-4"><h3 className="font-semibold">Verified login</h3>
                <p className="break-words text-sm text-gray-600">{employee.reviewer_id ? `${employee.account_name} · ${employee.account_email} · ${employee.account_status}` : 'No login linked'}</p>
                <div className="flex flex-wrap gap-2">{central && <><Button variant="secondary" disabled={!profile.external_ids.length || employee.status !== 'active'} onClick={() => setAction('link')}>{employee.reviewer_id ? 'Change verified login' : 'Link verified login'}</Button>{employee.reviewer_id && <Button variant="secondary" onClick={() => setAction('unlink')}>Unlink login</Button>}</>}</div>
                <details className="text-xs text-gray-600"><summary className="cursor-pointer">Verification history ({profile.account_links.length})</summary><div className="mt-2 space-y-2">{profile.account_links.map((link) => <p key={link.id}>{link.recorded_at.slice(0,10)} · {link.reviewer_id ? 'Login linked' : 'Login unlinked'} · {link.reason}</p>)}</div></details>
            </section>
            <section className="space-y-3 border-t border-gray-200 pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Service and appointment history</h3>{central && <Button variant="secondary" onClick={() => setAction('service')}>Add service period</Button>}</div>
                {!profile.service_periods.length && <p className="text-sm text-amber-800">Service classification is missing. HR needs verified appointment dates and service credit.</p>}
                {profile.service_periods.map((item) => <article key={item.id} className="space-y-2 rounded-lg border border-gray-200 p-3"><p className="text-sm font-medium">{item.start_date} → {item.end_date || 'Open'} · {item.employment_category}{item.is_teacher ? ' · Teacher' : ''}{item.is_intern ? ' · Intern' : ''}</p><p className="text-xs text-gray-600">Service credit: {item.counts_for_service === null ? 'Unknown' : item.counts_for_service ? 'Included' : 'Excluded'} · {patterns.find((pattern) => pattern.id === item.work_pattern_id)?.name || 'Work pattern unverified'}</p><p className="break-words text-xs text-gray-500">{item.appointment_reference || 'No appointment reference'} · {item.reason}</p><>{central && <Button variant="secondary" onClick={() => { setPeriod(item); setAction('close_service'); }}>Close period from {item.start_date}</Button>}</></article>)}
            </section>
            <section className="space-y-3 border-t border-gray-200 pt-4"><h3 className="font-semibold">Approval route preview</h3><p className="text-xs text-gray-500">This previews the configured authorities and does not approve an application.</p><div className="flex flex-wrap items-end gap-2"><Field label="Route date"><input className={inputClass} type="date" value={onDate} onChange={(e) => setOnDate(e.target.value)} /></Field><Button variant="secondary" disabled={!onDate} loading={previewBusy} onClick={() => void preview(onDate)}>Preview route</Button></div>
                {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                {chain && <><p className={`text-sm ${chain.ready ? 'text-green-800' : 'text-amber-800'}`}>{previewDate}: {chain.ready ? 'All three configured authorities are ready' : 'Route needs configuration'}</p><ol className="space-y-2">{chain.stages.map((stage) => <li key={stage.level} className="rounded-lg bg-gray-50 p-3 text-sm"><p className="font-medium">{APPROVER_LABELS[stage.level]} · {stage.approver_name || 'Unassigned'}</p>{stage.issue && <p className="mt-1 text-xs text-amber-800">{stage.issue}</p>}</li>)}</ol></>}
            </section>
        </div>
    </Modal>;
}

import { AustralianDateInput } from '../../components/AustralianDateInput';
import { formatDate, formatDateTime } from '../../lib/date';
import {ServiceCorrectionHistory} from './ServiceCorrectionHistory';
import { useCallback, useEffect, useState } from 'react';
import { Button, Modal } from '../../components/Ui';
import { apiClient } from '../../lib/api';
import { todayIsoDate } from '../../lib/date';
import { ActionDialog, DirectoryPicker, Field, PlacementFields, inputClass } from './ManagementFields';
import { value } from './managementForm';
import { APPROVER_LABELS, CATEGORIES } from './managementTypes';
import type { ApprovalChain, EmployeeProfile, ServicePeriod, WorkPattern } from './managementTypes';
import type { OrgDepartment } from './types';
import { ReviewRecordReference } from './ReviewRecordName';
import { reviewRecordLabel } from './reviewRecordNames';

const ROOT = '/hr/directory';
type Action = 'details' | 'placement' | 'service' | 'correct_service' | 'close_service' | 'identifier' | 'link' | 'unlink';
export function EmployeeDetails({ profile, departments, patterns, central, onClose, onChanged, embedded=false }: { embedded?:boolean; central: boolean; profile: EmployeeProfile; departments: OrgDepartment[]; patterns: WorkPattern[]; onClose: () => void; onChanged: () => Promise<void> }) {
    const employee = profile.employee;
    const matchingDepartments=departments.filter(d=>d.name.toLowerCase()===(employee.department_code||'').toLowerCase());
    const placementDepartment=employee.department_id|| (matchingDepartments.length===1?matchingDepartments[0].id:'');
    const matchingDivisions=departments.find(d=>d.id===placementDepartment)?.divisions.filter(d=>d.name.toLowerCase()===(employee.division_code||'').toLowerCase())||[];
    const placementDivision=employee.division_id||(matchingDivisions.length===1?matchingDivisions[0].id:'');
    const [action, setAction] = useState<Action | null>(null), [period, setPeriod] = useState<ServicePeriod | null>(null);
    const [onDate, setOnDate] = useState(todayIsoDate), [previewDate, setPreviewDate] = useState('');
    const [chain, setChain] = useState<ApprovalChain | null>(null), [error, setError] = useState(''), [previewBusy, setPreviewBusy] = useState(false);
    const preview = useCallback(async (date: string) => {
        setPreviewBusy(true); setError('');
        try { setChain(await apiClient.get<ApprovalChain>(`${ROOT}/${employee.id}/approval-chain?on_date=${date}`)); setPreviewDate(date); }
        catch (err) { setError((err as Error).message); } finally { setPreviewBusy(false); }
    }, [employee.id]);
    useEffect(() => { if(!embedded)void preview(todayIsoDate()); }, [embedded,preview, employee.department_id, employee.division_id, employee.status]);
    async function saved() { await onChanged(); setAction(null); }
    if (action) {
        const titles: Record<Action, string> = { details: 'Edit employee details', placement: 'Verify organisation placement', service: 'Add service period', correct_service: 'Prepare appointment correction', close_service: 'Close service period', identifier: 'Verify Payroll ID', link: 'Link a verified login', unlink: 'Unlink login' };
        return <ActionDialog title={titles[action]} description={employee.display_name} onClose={() => setAction(null)} onSave={async (data) => {
            const reason = value(data, 'reason'), base = `${ROOT}/${employee.id}`;
            if (action === 'details') await apiClient.put(`${base}/details`, { display_name: value(data,'display_name'), position_title: value(data,'position_title') || null, email: value(data,'email') || null, status: value(data,'status'), manager_id: value(data,'manager_id') || null, reason });
            if (action === 'placement') await apiClient.put(`${base}/organisation`, { department_id: value(data,'department_id'), division_id: value(data,'division_id') || null, reason });
            if (action === 'identifier') await apiClient.post(`${base}/external-ids`, { external_id: value(data,'external_id'), reason });
            if (action === 'service' || action === 'correct_service') await apiClient.post(action==='correct_service'?`${ROOT}/service-corrections/employees/${employee.id}/periods/${period?.id}`:`${base}/service-periods`, { ...(action==='correct_service'?{expected_hash:period?.correction_hash,source_reference:value(data,'source_reference')}:{}), start_date: value(data,'start_date'), end_date: value(data,'end_date') || null, employment_category: value(data,'employment_category'), is_teacher: data.has('is_teacher'), is_intern: data.has('is_intern'), counts_for_service: value(data,'counts_for_service') === '' ? null : value(data,'counts_for_service') === 'true', work_pattern_id: value(data,'work_pattern_id') || null, appointment_reference: value(data,'appointment_reference') || null, reason });
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
            {action === 'placement' && <><PlacementFields departments={departments} initialDepartment={placementDepartment} initialDivision={placementDivision} /><p className="text-xs text-gray-500">Retained placement: {employee.department_code || 'not recorded'} / {employee.division_code || 'not recorded'}. Matching existing names are preselected for your review; saving explicitly verifies the managed placement. Reporting managers and leave officeholders are maintained separately.</p></>}
            {action === 'identifier' && <><Field label="Payroll ID"><input className={inputClass} name="external_id" required maxLength={100} /></Field><p className="text-xs text-gray-500">Keep leading zeros and letters. An existing ID cannot move from another employee.</p></>}
            {(action === 'service'||action==='correct_service') && <>
                <div className="grid gap-3 sm:grid-cols-2"><Field label="Appointment start"><AustralianDateInput className={inputClass} name="start_date"  defaultValue={action==='correct_service'?period?.start_date:''} required /></Field><Field label="Appointment end (inclusive)"><AustralianDateInput className={inputClass} name="end_date"  defaultValue={action==='correct_service'?period?.end_date||'':''} /></Field></div>
                <Field label="Employment category"><select className={inputClass} name="employment_category" defaultValue={action==='correct_service'?period?.employment_category:'unknown'}>{CATEGORIES.map((category) => <option key={category} value={category}>{category[0].toUpperCase() + category.slice(1)}</option>)}</select></Field>
                <div className="flex flex-wrap gap-4 text-sm"><label><input type="checkbox" name="is_teacher" defaultChecked={action==='correct_service'&&period?.is_teacher} /> Teacher</label><label><input type="checkbox" name="is_intern" defaultChecked={action==='correct_service'&&period?.is_intern} /> Intern</label></div>
                <Field label="Counts for service"><select className={inputClass} name="counts_for_service" defaultValue={action==='correct_service'&&period?.counts_for_service!==null?String(period?.counts_for_service):''}><option value="">Unknown — HR determination needed</option><option value="true">Included</option><option value="false">Excluded</option></select></Field>
                <Field label="Work pattern"><select className={inputClass} name="work_pattern_id" defaultValue={action==='correct_service'?period?.work_pattern_id||'':''}><option value="">Not yet verified</option>{patterns.map((pattern) => <option key={pattern.id} value={pattern.id}>{reviewRecordLabel(pattern.name)}</option>)}</select></Field>
                <Field label="Appointment reference"><input className={inputClass} name="appointment_reference" defaultValue={action==='correct_service'?period?.appointment_reference||'':''} maxLength={200} /></Field>
                {action==='correct_service'&&<><Field label="Authorised correction source"><input name="source_reference" required minLength={5} maxLength={500} className={inputClass}/></Field><p className="text-sm text-gray-600">Prepare corrected facts without changing the employee yet. A different central HR officer must approve. Prior facts remain in history; existing grants and balances are preserved.</p></>}
                <p className="text-xs text-gray-500">Overlaps are blocked. Close the previous period before recording a new appointment. Classification records facts. Leave calculations also require a verified service basis, rules, schedules and certified balances.</p>
            </>}
            {action === 'close_service' && period && <><p className="text-sm text-gray-600">Preserve the period beginning {formatDate(period.start_date)}. A close can only shorten its dates.</p><Field label="Final service day"><AustralianDateInput className={inputClass}  name="end_date" required min={period.start_date} max={period.end_date || undefined} defaultValue={period.end_date || ''} /></Field></>}
            {action === 'link' && <><p className="text-sm text-gray-600">Verify the individual's identity and Payroll record before linking. Both affected accounts must sign in again after a link changes.</p><DirectoryPicker kind="accounts" name="reviewer_id" label="Portal account" employeeId={employee.id} initialId={employee.reviewer_id || ''} initialLabel={employee.account_name || ''} /></>}
            {action === 'unlink' && <p className="text-sm text-gray-600">Unlink {employee.account_name || employee.account_email}. This retains employee history and revokes the affected login's sessions.</p>}
        </ActionDialog>;
    }
    const content = <div className="space-y-5"><ReviewRecordReference name={employee.display_name}/>{!central && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">You may update details within your assigned scope. Central HR verifies identities, placement, service appointments and activation.</p>}
            <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Employee details</h3><Button variant="secondary" onClick={() => setAction('details')}>Edit details</Button></div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-gray-500">Position</dt><dd>{employee.position_title || 'Not recorded'}</dd></div><div><dt className="text-gray-500">Contact</dt><dd className="break-words">{employee.email || 'Not recorded'}</dd></div><div><dt className="text-gray-500">Reporting manager</dt><dd>{employee.manager_name || 'Not recorded'}</dd></div><div><dt className="text-gray-500">Historical join date</dt><dd>{employee.join_date ? formatDate(employee.join_date) : 'Not recorded'}</dd></div></dl>
                {central && <Button variant="secondary" onClick={() => setAction('placement')}>Verify placement</Button>}
            </section>
            <section className="space-y-3 border-t border-gray-200 pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Payroll identity</h3>{central && <Button variant="secondary" onClick={() => setAction('identifier')}>Verify Payroll ID</Button>}</div>
                {!profile.external_ids.length && <p className="text-sm text-amber-800">No Payroll ID verified. Verify identity before linking a login.</p>}
                {profile.external_ids.map((entry) => <div key={entry.id} className="rounded-lg bg-gray-50 p-3"><p className="break-words text-sm font-medium">{entry.external_id}</p><p className="break-words text-xs text-gray-500">{entry.reason}</p></div>)}
            </section>
            <section className="space-y-3 border-t border-gray-200 pt-4"><h3 className="font-semibold">Verified login</h3>
                <p className="break-words text-sm text-gray-600">{employee.reviewer_id ? `${reviewRecordLabel(employee.account_name || 'Account name unverified')} · ${employee.account_email || 'Payroll ID sign-in'} · ${employee.account_status}` : 'No login linked'}</p>
                <div className="flex flex-wrap gap-2">{central && <><Button variant="secondary" disabled={!profile.external_ids.length || employee.status !== 'active'} onClick={() => setAction('link')}>{employee.reviewer_id ? 'Change verified login' : 'Link verified login'}</Button>{employee.reviewer_id && <Button variant="secondary" onClick={() => setAction('unlink')}>Unlink login</Button>}</>}</div>
                <details className="text-xs text-gray-600"><summary className="cursor-pointer">Verification history ({profile.account_links.length})</summary><div className="mt-2 space-y-2">{profile.account_links.map((link) => <p key={link.id}>{formatDateTime(link.recorded_at)} · {link.reviewer_id ? 'Login linked' : 'Login unlinked'} · {link.reason}</p>)}</div></details>
            </section>
            <section className="space-y-3 border-t border-gray-200 pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Service and appointment history</h3>{central && <Button variant="secondary" onClick={() => setAction('service')}>Add service period</Button>}</div>
                {!profile.service_periods.length && <p className="text-sm text-amber-800">Service classification is missing. HR needs verified appointment dates and service credit.</p>}
                {profile.service_periods.map((item) => <article key={item.id} className="space-y-2 rounded-lg border border-gray-200 p-3"><p className="text-sm font-medium">{formatDate(item.start_date)} → {item.end_date ? formatDate(item.end_date) : 'Open'} · {item.employment_category}{item.is_teacher ? ' · Teacher' : ''}{item.is_intern ? ' · Intern' : ''}</p><p className="text-xs text-gray-600">Service credit: {item.counts_for_service === null ? 'Unknown' : item.counts_for_service ? 'Included' : 'Excluded'} · {reviewRecordLabel(patterns.find((pattern) => pattern.id === item.work_pattern_id)?.name || 'Work pattern unverified')}</p><p className="break-words text-xs text-gray-500">{item.appointment_reference || 'No appointment reference'} · {item.reason}</p><>{central && <Button variant="secondary" onClick={()=>{setPeriod(item);setAction('correct_service');}}>Prepare correction</Button>}{central && <Button variant="secondary" onClick={() => { setPeriod(item); setAction('close_service'); }}>Close period from {formatDate(item.start_date)}</Button>}</></article>)}
            </section>
            {central&&<ServiceCorrectionHistory employeeId={employee.id} onChanged={onChanged}/>}
            {!embedded&&<section className="space-y-3 border-t border-gray-200 pt-4"><h3 className="font-semibold">Approval route preview</h3><p className="text-xs text-gray-500">This checks division, department and Chief Secretary appointments. The application timeline also checks required HR, Secretary or Minister stages and employee activation.</p><div className="flex flex-wrap items-end gap-2"><Field label="Route date"><AustralianDateInput className={inputClass} value={onDate} onChange={(e) => setOnDate(e.target.value)} /></Field><Button variant="secondary" disabled={!onDate} loading={previewBusy} onClick={() => void preview(onDate)}>Preview route</Button></div>
                {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                {chain && <><p className={`text-sm ${chain.ready ? 'text-green-800' : 'text-amber-800'}`}>{formatDate(previewDate)}: {chain.ready ? 'Division, department and Chief Secretary appointments are ready' : 'Route needs configuration'}</p><ol className="space-y-2">{chain.stages.map((stage) => <li key={stage.level} className="rounded-lg bg-gray-50 p-3 text-sm"><p className="font-medium">{APPROVER_LABELS[stage.level]} · {reviewRecordLabel(stage.approver_name || 'Unassigned')}</p>{stage.issue && <p className="mt-1 text-xs text-amber-800">{stage.issue}</p>}</li>)}</ol></>}
            </section>}
        </div>;
    if(embedded)return content;
    return <Modal title={reviewRecordLabel(employee.display_name)} description={`${reviewRecordLabel(employee.department_code || 'Department unverified')}${employee.division_code ? ` / ${reviewRecordLabel(employee.division_code)}` : ''} · ${employee.status}`} onClose={onClose} placement="right" size="3xl">
        {content}
    </Modal>;
}

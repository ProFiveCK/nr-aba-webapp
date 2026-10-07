import { formatDate } from '../../lib/date';
import { AustralianDateInput } from '../../components/AustralianDateInput';
import {useEffect,useState} from 'react';
import {apiClient} from '../../lib/api';
import {Button,LoadingState} from '../../components/Ui';
import {ActionDialog,DirectoryPicker,Field,inputClass} from './ManagementFields';
import {value} from './managementForm';
import {governmentLabel as label} from './governmentWorkflowTypes';
import type {ConsentOffice} from './governmentWorkflowTypes';
import type {OrgDepartment} from './types';
const root='/hr/government/workflow',today=()=>new Date(Date.now()+12*3600000).toISOString().slice(0,10);
function SourceField(){return <Field label="Approved source reference"><input name="source_reference" required minLength={5} maxLength={500} className={inputClass}/></Field>;}
export function StatutoryOffices({departments}:{departments:OrgDepartment[]}){
 const [data,setData]=useState<{offices:ConsentOffice[]}|null>(null),[version,setVersion]=useState(0),[error,setError]=useState(''),[dialog,setDialog]=useState<{kind:'office'|'close-office';target?:ConsentOffice}|null>(null),[officeLevel,setOfficeLevel]=useState('relevant_secretary');
 useEffect(()=>{let live=true;void apiClient.get<{offices:ConsentOffice[]}>(`${root}/administration`).then(r=>{if(live)setData(r);}).catch((e:Error)=>{if(live)setError(e.message);});return()=>{live=false;};},[version]);
 function show(kind:'office'|'close-office',target?:ConsentOffice){setError('');setDialog({kind,target});}
 async function save(form:FormData){if(!dialog)return;const reason=value(form,'reason'),source_reference=value(form,'source_reference');
 if(dialog.kind==='office')await apiClient.post(`${root}/consent-offices`,{reason,source_reference,level:value(form,'level'),department_id:value(form,'department_id')||null,approver_employee_id:value(form,'approver_employee_id'),effective_from:value(form,'effective_from'),effective_to:value(form,'effective_to')||null});
 else await apiClient.post(`${root}/consent-offices/${dialog.target?.id}/close`,{reason,effective_to:value(form,'effective_to')});
 setDialog(null);setVersion(v=>v+1);}
 if(!data)return error?<p role="alert" className="text-sm text-red-700">{error}</p>:<LoadingState label="Loading statutory offices…"/>;
 return <>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
 <section className="app-panel space-y-4 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">Additional statutory and evidence offices</h3><Button onClick={()=>show('office')}>Assign consent office</Button></div><p className="text-sm text-gray-600">Division, HOD and Chief Secretary appointments are shown above. These offices add the department's relevant Secretary, an independent central HR verifier and the Minister for statutory medical escalation.</p>{data.offices.map(o=><article key={o.id} className="space-y-2 rounded-lg border border-gray-200 p-3"><h4 className="font-semibold">{label(o.level)} · {o.display_name}{o.closed_office_id?' · closure recorded':''}</h4><p className="text-sm">{formatDate(o.effective_from)} to {o.effective_to ? formatDate(o.effective_to) : 'open'} · {o.department_id?departments.find(d=>d.id===o.department_id)?.name||'Managed department':'Government-wide HR verification'}</p><p className="break-words text-sm text-gray-600">{o.source_reference}</p>{!o.closed_office_id&&<Button variant="secondary" onClick={()=>show('close-office',o)}>Close office appointment</Button>}</article>)}</section>
 {dialog&&<ActionDialog title={dialog.kind==='office'?'Assign statutory consent or HR verifier':'Close statutory office appointment'} onClose={()=>setDialog(null)} onSave={save}>
   {dialog.kind==='office'&&<><Field label="Consent or evidence office"><select name="level" className={inputClass} value={officeLevel} onChange={e=>setOfficeLevel(e.target.value)}><option value="relevant_secretary">Relevant Secretary</option><option value="hr_verifier">Central HR verifier</option><option value="minister">Minister for medical escalation</option></select></Field>{officeLevel!=='hr_verifier'&&<Field label="Statutory office department"><select name="department_id" className={inputClass} required><option value="">Choose managed department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}<DirectoryPicker name="approver_employee_id" label="Consent officeholder" requireLinked/><Field label="Office effective from"><AustralianDateInput name="effective_from" required defaultValue={today()} className={inputClass}/></Field><Field label="Office effective through"><AustralianDateInput name="effective_to"  className={inputClass}/></Field><p className="text-sm text-gray-600">The Secretary and Minister need an explicit approval grant; the HR verifier needs central HR authority. Appointment does not grant account permissions.</p><SourceField/></>}
   {dialog.kind==='close-office'&&<><p className="text-sm">Record the inclusive last effective date without deleting appointment history. Pending bindings need explicit review after an office change.</p><Field label="Last effective office date"><AustralianDateInput name="effective_to" required className={inputClass}/></Field></>}
 </ActionDialog>}
 </>;
}

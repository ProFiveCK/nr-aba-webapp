import {useEffect,useState} from 'react';
import {apiClient} from '../../lib/api';
import {AustralianDateInput} from '../../components/AustralianDateInput';
import {todayIsoDate,formatDate} from '../../lib/date';
import {Button} from '../../components/Ui';
import {ActionDialog,Field,inputClass} from './ManagementFields';
import {value} from './managementForm';
import {ReviewRecordName} from './ReviewRecordName';

type Preview={snapshot_hash:string;ready:number;total:number;employees:{employee_id:string;display_name:string;issues:string[]}[]};
export function GovernmentInitialFoundations({selected,names,starts,onChanged}:{selected:string[];names:Record<string,string>;starts:Record<string,string>;onChanged:()=>void}){
 const [patterns,setPatterns]=useState<{id:string;name:string;approval_id:string|null}[]>([]),[open,setOpen]=useState(false),[preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{let live=true;void apiClient.get<{patterns:{id:string;name:string;approval_id:string|null}[]}>('/hr/government/configuration').then(r=>{if(live)setPatterns(r.patterns);}).catch((e:Error)=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 async function save(form:FormData){
  const data={reuse_recorded_dates:true,employees:selected.map(employee_id=>({employee_id,service_start:value(form,`start-${employee_id}`)})),effective_from:value(form,'effective_from'),employment_category:value(form,'employment_category'),anniversary_method:value(form,'anniversary_method'),leap_day_method:value(form,'leap_day_method'),work_pattern_id:value(form,'work_pattern_id'),source_reference:value(form,'source_reference'),reason:value(form,'reason'),facts_confirmed:form.has('facts_confirmed')};
  const root='/hr/government/workflow/commissioning/foundations';
  if(!preview){setPreview(await apiClient.post<Preview>(`${root}/preview`,data));return;}
  if(preview.ready!==preview.total)throw new Error('Resolve every listed preparation issue, then preview again.');
  const result=await apiClient.post<{prepared:number}>(`${root}/apply`,{...data,snapshot_hash:preview.snapshot_hash});setNotice(`${result.prepared} staff prepared. Current leave, logins and balances are retained. Preview the migration next.`);setOpen(false);setPreview(null);onChanged();
 }
 const changed=()=>setPreview(null);
 const recorded=selected.filter(id=>starts[id]),missing=selected.filter(id=>!starts[id]);
 const approved=patterns.filter(p=>p.approval_id);
 const treasury=approved.find(p=>p.name==='Treasury Monday-Friday (7 paid hours)');
 return <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
  <p className="text-sm text-gray-700">Import existing service dates for the selected staff in one batch. Choose the shared employment category and workweek once. Only missing dates need an entry; existing recorded dates carry through automatically.</p>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-green-800">{notice}</p>}
  <Button variant="secondary" disabled={!selected.length} onClick={()=>{setPreview(null);setOpen(true);}}>Import existing staff setup · {selected.length} selected</Button>
  {open&&<ActionDialog title="Import existing Treasury staff setup" defaultReason="Initial migration: reuse existing personnel start dates and the confirmed Treasury workweek." saveLabel={preview?'Import existing staff setup':'Preview existing staff setup'} onClose={()=>setOpen(false)} onSave={save}>
   <Field label="Preparation date"><AustralianDateInput name="effective_from" required max={todayIsoDate()} defaultValue={todayIsoDate()} className={inputClass} onChange={changed}/></Field>
   <Field label="Shared employment category"><select name="employment_category" required defaultValue="" className={inputClass} onChange={changed}><option value="" disabled>Choose verified category</option><option value="permanent">Permanent</option><option value="temporary">Temporary</option><option value="contract">Contract</option></select></Field>
   <Field label="Shared verified work schedule"><select name="work_pattern_id" required defaultValue={treasury?.id||(approved.length===1?approved[0].id:'')} className={inputClass} onChange={changed}><option value="" disabled>Choose existing weekly schedule</option>{approved.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
   <p className="text-xs text-gray-600">Treasury’s confirmed Monday–Friday, 7-paid-hour workweek is available here. Select a different recorded schedule only for staff with different hours.</p>
   <details><summary className="cursor-pointer text-sm">Service exceptions and source</summary>
   <Field label="Anniversary treatment"><select name="anniversary_method" required defaultValue="calendar" className={inputClass} onChange={changed}><option value="" disabled>Choose actual service treatment</option><option value="calendar">Fixed calendar anniversary</option><option value="pause_exclusions">Move anniversary for excluded service</option></select></Field>
   <Field label="Leap-day anniversary"><select name="leap_day_method" required defaultValue="mar1" className={inputClass} onChange={changed}><option value="" disabled>Choose actual treatment</option><option value="feb28">28 February in non-leap years</option><option value="mar1">1 March in non-leap years</option></select></Field>
   <Field label="Service and appointment source reference"><input name="source_reference" defaultValue="Existing Finance/Treasury personnel register and confirmed weekly workweek" required minLength={5} maxLength={500} className={inputClass} onChange={changed}/></Field>
   </details>
   <p className="text-sm text-gray-600">{recorded.length} recorded start dates will be imported automatically. {missing.length?`${missing.length} staff records have no start date; enter only those missing dates below, or select the staff with recorded dates first.`:'No individual dates need to be entered.'}</p>
   {recorded.length>0&&<details><summary className="cursor-pointer text-sm">View recorded dates</summary><div className="space-y-1 py-2">{recorded.map(id=><p key={id} className="text-sm"><ReviewRecordName name={names[id]||id}/> · {formatDate(starts[id])}</p>)}</div></details>}
   <div className="space-y-3">{missing.map(id=><Field key={id} label={`${names[id]||id} · missing service start`}><AustralianDateInput name={`start-${id}`} required max={todayIsoDate()} className={inputClass} onChange={changed}/></Field>)}</div>
   <label className="flex items-start gap-2 text-sm"><input name="facts_confirmed" type="checkbox" required className="mt-1" onChange={changed}/>Use the existing recorded dates with this category and workweek for the initial migration. Staff with service breaks or different appointment terms are prepared separately.</label>
   {preview&&<div className="space-y-3"><p className="text-sm font-semibold">{preview.ready} of {preview.total} ready for preparation</p>{preview.employees.map(p=><div key={p.employee_id} className="text-sm"><ReviewRecordName name={p.display_name}/>{p.issues.map(issue=><p key={issue} className="text-amber-800">{issue}</p>)}</div>)}</div>}
  </ActionDialog>}
 </div>;
}

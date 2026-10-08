import {useEffect,useState} from 'react';
import {apiClient} from '../../lib/api';
import {AustralianDateInput} from '../../components/AustralianDateInput';
import {todayIsoDate} from '../../lib/date';
import {Button} from '../../components/Ui';
import {ActionDialog,Field,inputClass} from './ManagementFields';
import {value} from './managementForm';
import {ReviewRecordName} from './ReviewRecordName';

type Preview={snapshot_hash:string;ready:number;total:number;employees:{employee_id:string;display_name:string;issues:string[]}[]};
export function GovernmentInitialFoundations({selected,names,starts,onChanged}:{selected:string[];names:Record<string,string>;starts:Record<string,string>;onChanged:()=>void}){
 const [patterns,setPatterns]=useState<{id:string;name:string;approval_id:string|null}[]>([]),[open,setOpen]=useState(false),[preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{let live=true;void apiClient.get<{patterns:{id:string;name:string;approval_id:string|null}[]}>('/hr/government/configuration').then(r=>{if(live)setPatterns(r.patterns);}).catch((e:Error)=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 async function save(form:FormData){
  const data={employees:selected.map(employee_id=>({employee_id,service_start:value(form,`start-${employee_id}`)})),effective_from:value(form,'effective_from'),employment_category:value(form,'employment_category'),anniversary_method:value(form,'anniversary_method'),leap_day_method:value(form,'leap_day_method'),work_pattern_id:value(form,'work_pattern_id'),source_reference:value(form,'source_reference'),reason:value(form,'reason'),facts_confirmed:form.has('facts_confirmed')};
  const root='/hr/government/workflow/commissioning/foundations';
  if(!preview){setPreview(await apiClient.post<Preview>(`${root}/preview`,data));return;}
  if(preview.ready!==preview.total)throw new Error('Resolve every listed preparation issue, then preview again.');
  const result=await apiClient.post<{prepared:number}>(`${root}/apply`,{...data,snapshot_hash:preview.snapshot_hash});setNotice(`${result.prepared} staff prepared. Current leave, logins and balances are retained. Preview the migration next.`);setOpen(false);setPreview(null);onChanged();
 }
 const changed=()=>setPreview(null);
 return <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
  <p className="text-sm text-gray-700">Prepare shared service facts for an initial group in one review. Select staff with the same category and verified weekly schedule. Prepare different categories separately; existing verified service records stay in the employee workspace.</p>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-green-800">{notice}</p>}
  <Button variant="secondary" disabled={!selected.length} onClick={()=>{setPreview(null);setOpen(true);}}>Prepare initial staff foundations · {selected.length} selected</Button>
  {open&&<ActionDialog title="Prepare existing Treasury staff" saveLabel={preview?'Save verified preparation':'Preview staff preparation'} onClose={()=>setOpen(false)} onSave={save}>
   <Field label="Preparation date"><AustralianDateInput name="effective_from" required max={todayIsoDate()} defaultValue={todayIsoDate()} className={inputClass} onChange={changed}/></Field>
   <Field label="Shared employment category"><select name="employment_category" required defaultValue="" className={inputClass} onChange={changed}><option value="" disabled>Choose verified category</option><option value="permanent">Permanent</option><option value="temporary">Temporary</option><option value="contract">Contract</option></select></Field>
   <Field label="Shared verified work schedule"><select name="work_pattern_id" required defaultValue="" className={inputClass} onChange={changed}><option value="" disabled>Choose approved weekly schedule</option>{patterns.filter(p=>p.approval_id).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
   <p className="text-xs text-gray-600">Create and verify weekly schedules under Settings → Policies → Work schedules.</p>
   <Field label="Anniversary treatment"><select name="anniversary_method" required defaultValue="" className={inputClass} onChange={changed}><option value="" disabled>Choose actual service treatment</option><option value="calendar">Fixed calendar anniversary</option><option value="pause_exclusions">Move anniversary for excluded service</option></select></Field>
   <Field label="Leap-day anniversary"><select name="leap_day_method" required defaultValue="" className={inputClass} onChange={changed}><option value="" disabled>Choose actual treatment</option><option value="feb28">28 February in non-leap years</option><option value="mar1">1 March in non-leap years</option></select></Field>
   <Field label="Service and appointment source reference"><input name="source_reference" required minLength={5} maxLength={500} className={inputClass} onChange={changed}/></Field>
   <p className="text-sm text-gray-600">Review each credited continuous-service start below. Recorded join dates are suggestions for your verification. Missing dates need an actual date; this setup does not invent them.</p>
   <div className="space-y-3">{selected.map(id=><Field key={id} label={`${names[id]||id} · verified service start`}><AustralianDateInput name={`start-${id}`} required defaultValue={starts[id]||''} max={todayIsoDate()} className={inputClass} onChange={changed}/></Field>)}</div>
   <label className="flex items-start gap-2 text-sm"><input name="facts_confirmed" type="checkbox" required className="mt-1" onChange={changed}/>I verified these ordinary appointments, uninterrupted credited-service dates and the shared category/schedule. Teacher, intern, service-break and roster cases require individual preparation.</label>
   {preview&&<div className="space-y-3"><p className="text-sm font-semibold">{preview.ready} of {preview.total} ready for preparation</p>{preview.employees.map(p=><div key={p.employee_id} className="text-sm"><ReviewRecordName name={p.display_name}/>{p.issues.map(issue=><p key={issue} className="text-amber-800">{issue}</p>)}</div>)}</div>}
  </ActionDialog>}
 </div>;
}

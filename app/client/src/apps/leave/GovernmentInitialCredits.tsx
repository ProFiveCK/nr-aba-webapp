import {useEffect,useState} from 'react';
import {apiClient} from '../../lib/api';
import {todayIsoDate} from '../../lib/date';
import {Button} from '../../components/Ui';
import {ActionDialog,Field,inputClass} from './ManagementFields';
import {value} from './managementForm';
import {reviewRecordLabel} from './reviewRecordNames';

type Setup={leave_types:{id:string;name:string;is_active:boolean}[];adopted:{plan:{mappings:{leave_type_id:string;code:string|null}[]}}|null};
export function GovernmentInitialCredits({selected,names,categories,onChanged}:{selected:string[];names:Record<string,string>;categories:Record<string,string>;onChanged:()=>void}){
 const [setup,setSetup]=useState<Setup|null>(null),[open,setOpen]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[creditEmployee,setCreditEmployee]=useState('');
 useEffect(()=>{let live=true;void apiClient.get<Setup>('/hr/government/initial-setup').then(r=>{if(live)setSetup(r);}).catch((e:Error)=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 const codeByType=new Map(setup?.adopted?.plan.mappings.map(m=>[m.leave_type_id,m.code])||[]);
 const mapped=new Set(setup?.adopted?.plan.mappings.filter(m=>m.code&&['recreation','medical','special'].includes(m.code)).map(m=>m.leave_type_id)||[]);
 async function save(form:FormData){
  await apiClient.post('/hr/government/workflow/commissioning/initial-credit',{employee_id:value(form,'employee_id'),leave_type_id:value(form,'leave_type_id'),amount:value(form,'amount'),year:Number(value(form,'year')),source_reference:value(form,'source_reference'),reason:value(form,'reason')});
  setNotice('Verified missing source credit recorded. Preview the cohort again to include it.');setOpen(false);onChanged();
 }
 return <div className="space-y-2 rounded-lg border border-gray-200 p-3">
  <p className="text-sm text-gray-600">If the preview lists a missing stored credit, record the actual reviewed source amount here before migration. Temporary staff do not require an Annual source credit for this migration. Enter zero only when the source confirms zero. Existing balance rows cannot be replaced through this action.</p>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-green-800">{notice}</p>}
  <Button variant="secondary" disabled={!selected.length||!mapped.size} onClick={()=>{setCreditEmployee(selected.length===1?selected[0]:'');setOpen(true);}}>Record missing source credit</Button>
  {open&&<ActionDialog title="Record verified missing credit" automaticReason="Recorded the verified missing source credit from the specified balance register." saveLabel="Record source credit" onClose={()=>setOpen(false)} onSave={save}>
   <Field label="Existing employee"><select name="employee_id" required value={creditEmployee} onChange={e=>setCreditEmployee(e.target.value)} className={inputClass}><option value="" disabled>Choose existing staff member</option>{selected.map(id=><option key={id} value={id}>{reviewRecordLabel(names[id]||id)}</option>)}</select></Field>
   <Field label="Mapped source leave type"><select key={creditEmployee} name="leave_type_id" disabled={!creditEmployee} required defaultValue="" className={inputClass}><option value="" disabled>Choose missing source type</option>{setup?.leave_types.filter(t=>t.is_active&&mapped.has(t.id)&&!(categories[creditEmployee]==='temporary'&&codeByType.get(t.id)==='recreation')).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
   <Field label="Verified remaining source credit (days)"><input name="amount" type="number" min="0" max="10000" step="0.01" required className={inputClass}/></Field>
   <Field label="Source year"><input name="year" type="number" min="1900" max={Number(todayIsoDate().slice(0,4))} defaultValue={Number(todayIsoDate().slice(0,4))} required className={inputClass}/></Field>
   <Field label="Verified balance register reference"><input name="source_reference" required minLength={5} maxLength={500} className={inputClass}/></Field>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" required className="mt-1"/>I verified the actual remaining credit, source type and year for this existing employee. This is a missing stored source, not an increase to an existing balance.</label>
  </ActionDialog>}
 </div>;
}

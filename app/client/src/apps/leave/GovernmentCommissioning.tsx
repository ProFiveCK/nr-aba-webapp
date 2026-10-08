import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {apiClient} from '../../lib/api';
import {useAuth} from '../../contexts/useAuth';
import {formatDate,todayIsoDate} from '../../lib/date';
import {AustralianDateInput} from '../../components/AustralianDateInput';
import {Button} from '../../components/Ui';
import {ActionDialog,Field,inputClass} from './ManagementFields';
import {value} from './managementForm';
import {ReviewRecordName} from './ReviewRecordName';

type History={start_date:string;end_date:string;uncertified:boolean};
type Target={code:string;amount:string;sources:{id:string;name:string;year:number;balance:string;pending:string}[]};
type Person={employee_id:string;display_name:string;payroll_id:string|null;targets:Target[];warnings?:string[];issues:string[];route:{level:string;label:string}[]};
type Preview={snapshot_hash:string;ready:number;total:number;employees:Person[]};
type Plan={employees:{employee_id:string;medical_history:History[]}[];cutover_date:string;history_confirmed:boolean;source_reference:string;payroll_reference:string;transition_reference:string;history_reference:string;reason:string};
type Review={id:string;prepared_by:string;snapshot_hash:string;plan:Plan;snapshot:{employees:Person[]};applied_at:string|null};
const root='/hr/government/workflow/commissioning';
const labels:Record<string,string>={source_reference:'Treasury balance register reference',payroll_reference:'Payroll reconciliation reference',transition_reference:'Approved full-credit transition reference',history_reference:'Complete Medical history review reference'};
function history(text:string):History[]{return text.trim()?text.trim().split('\n').filter(line=>line.trim()).map(line=>{const parts=line.trim().split(/[\s,]+/);if(parts.length!==3||!['certified','uncertified'].includes(parts[2]))throw new Error('Enter one Medical absence per line: start date, end date, certified or uncertified.');return {start_date:parts[0],end_date:parts[1],uncertified:parts[2]==='uncertified'};}):[];}
function RosterReview({people}:{people:Person[]}){return <div className="divide-y divide-gray-200">{people.map(p=><article key={p.employee_id} className="space-y-2 py-3 text-sm"><p className="font-semibold"><ReviewRecordName name={p.display_name}/> · {p.payroll_id||'Payroll ID missing'}</p><p>{p.route.map(s=>s.label).join(' → ')}</p><ul className="space-y-1">{p.targets.map(t=><li key={t.code}><span className="font-medium capitalize">{t.code}: {t.sources.length?`${Number(t.amount)} days`:'Not determined'}</span><span className="block break-words text-xs text-gray-500">{t.sources.map(s=>`${s.name} ${s.year}: ${Number(s.balance)} days`).join(' + ')||'No stored credit source'}</span></li>)}</ul>{p.warnings?.map(warning=><p key={warning} className="text-amber-800">{warning}</p>)}{p.issues.length>0&&<ul className="list-disc space-y-1 pl-5 text-amber-800">{p.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}<Link className="text-brand underline" to={`/leave/employees?view=directory&employee=${p.employee_id}&section=prepare`}>Review employee preparation</Link></article>)}</div>;}

export function GovernmentCommissioning({selected,names}:{selected:string[];names:Record<string,string>}){
 const {user}=useAuth();
 const [reviews,setReviews]=useState<Review[]>([]),[version,setVersion]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[plan,setPlan]=useState<Plan|null>(null),[busy,setBusy]=useState(false),[dialog,setDialog]=useState<'prepare'|Review|null>(null),[medical,setMedical]=useState<Record<string,string>>({});
 const selection=selected.join(',');
 useEffect(()=>{setPreview(null);setPlan(null);},[selection]);
 useEffect(()=>{let live=true;void apiClient.get<{reviews:Review[]}>(root).then(r=>{if(live)setReviews(r.reviews);}).catch((e:Error)=>{if(live)setError(e.message);});return()=>{live=false;};},[version]);
 async function save(form:FormData){
  if(dialog==='prepare'){
   const next:Plan={employees:selected.map(employee_id=>({employee_id,medical_history:history(medical[employee_id]||'')})),cutover_date:value(form,'cutover_date'),history_confirmed:form.has('history_confirmed'),source_reference:value(form,'source_reference'),payroll_reference:value(form,'payroll_reference'),transition_reference:value(form,'transition_reference'),history_reference:value(form,'history_reference'),reason:value(form,'reason')};
   const result=await apiClient.post<Preview>(`${root}/preview`,next);setPlan(next);setPreview(result);setDialog(null);
  }else if(dialog){await apiClient.post(`${root}/${dialog.id}/apply`,{snapshot_hash:dialog.snapshot_hash,reason:value(form,'reason')});setNotice('Cohort consolidated: carried credits and Government activation applied together. Review accrual job plans before enabling scheduled accrual.');setDialog(null);setPreview(null);setPlan(null);setVersion(v=>v+1);}
 }
 async function freeze(){if(!preview||!plan)return;setBusy(true);setError('');try{await apiClient.post(root,{...plan,snapshot_hash:preview.snapshot_hash});setNotice('Consolidation frozen for a second HR officer. The selected employees still use their existing arrangements until it is applied.');setPreview(null);setPlan(null);setVersion(v=>v+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="app-panel space-y-4 p-4 sm:p-5" aria-label="Consolidate existing Treasury staff">
  <div><h3 className="text-lg font-semibold">Consolidate existing staff</h3><p className="mt-1 text-sm text-gray-600">Use the selected department roster above. Review its stored balances, verified service and approval route together. A second HR officer applies carried credits and Government activation in one transaction. Existing records and logins are retained.</p></div>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-green-800">{notice}</p>}
  <Button disabled={!selected.length} onClick={()=>setDialog('prepare')}>Preview consolidation · {selected.length} selected</Button>
  {preview&&<><p role="status" className="text-sm font-semibold">{preview.ready} of {preview.total} ready for consolidation</p><RosterReview people={preview.employees}/>{preview.ready===preview.total?<Button loading={busy} onClick={()=>void freeze()}>Freeze reviewed consolidation</Button>:<p className="text-sm text-amber-800">Resolve the listed facts and reservations, then preview again. No employees or balances have been changed.</p>}</>}
  {reviews.length>0&&<div className="space-y-3"><p className="text-sm font-semibold">Recent consolidation reviews</p>{reviews.map(r=><details key={r.id} className="rounded-lg border border-gray-200 p-3"><summary className="cursor-pointer text-sm font-medium">{r.plan.employees.length} staff · Cutover {formatDate(r.plan.cutover_date)} · {r.applied_at?'Applied':'Awaiting second HR officer'}</summary><div className="mt-3 space-y-3"><RosterReview people={r.snapshot.employees}/><p className="break-words text-xs text-gray-500">{r.plan.source_reference} · {r.plan.transition_reference}</p>{!r.applied_at&&r.prepared_by!==String(user?.id)&&<Button onClick={()=>setDialog(r)}>Certify and consolidate cohort</Button>}</div></details>)}</div>}
  {dialog&&<ActionDialog title={dialog==='prepare'?'Review existing staff consolidation':'Certify and consolidate cohort'} saveLabel={dialog==='prepare'?'Preview balances and readiness':'Apply carried credits and Government workflow'} onClose={()=>setDialog(null)} onSave={save}>
   {dialog==='prepare'?<>
    <Field label="Treasury cutover date"><AustralianDateInput name="cutover_date" required max={todayIsoDate()} defaultValue={plan?.cutover_date||todayIsoDate()} className={inputClass}/></Field>
    <p className="text-sm text-gray-600">The preview uses the latest active stored balance for each mapped type, including both Medical evidence categories in one pool. Pending days are never added. Missing stored credits, unresolved pending leave or unverified appointments need individual review.</p>
    {Object.entries(labels).map(([key,label])=><Field key={key} label={label}><input name={key} className={inputClass} required minLength={5} maxLength={500} defaultValue={plan?.[key as keyof Plan] as string||''}/></Field>)}
    <details><summary className="cursor-pointer text-sm font-medium">Medical absences before cutover</summary><p className="my-3 text-xs text-gray-600">Record every reviewed absence since each employee’s service-year start, before cutover. One line: YYYY-MM-DD, YYYY-MM-DD, certified or uncertified. Leave blank only when the complete reviewed record confirms none.</p><div className="space-y-3">{selected.map(id=><Field key={id} label={`${names[id]||id} · Medical history`}><textarea className={inputClass} rows={2} value={medical[id]||''} onChange={e=>setMedical({...medical,[id]:e.target.value})}/></Field>)}</div></details>
    <label className="flex items-start gap-2 text-sm"><input name="history_confirmed" type="checkbox" required className="mt-1"/>I reviewed the complete Medical usage and uncertified occasions for every selected employee. Blank history means confirmed no prior absence in this service year.</label>
   </>:<><p className="text-sm text-gray-600">Review the roster and its carried amounts below. The server checks the current sources again and applies the whole selected cohort together. Changed records stop the transaction.</p><RosterReview people={dialog.snapshot.employees}/><label className="flex items-start gap-2 text-sm"><input type="checkbox" required className="mt-1"/>I independently verified the source balances, service and schedule, Medical history, pending leave resolution and nominated approval route.</label></>}
  </ActionDialog>}
 </section>;
}

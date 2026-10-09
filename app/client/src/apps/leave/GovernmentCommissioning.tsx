import {MedicalHistoryFields} from './MedicalHistoryFields';
import type {MedicalHistoryEntry} from './MedicalHistoryFields';
import {useEffect,useRef,useState} from 'react';
import {migrateInitialCohort} from './governmentCommissioningActions';
import type {SavedMigrationReview} from './governmentCommissioningActions';
import {Link} from 'react-router-dom';
import {apiClient} from '../../lib/api';
import {useAuth} from '../../contexts/useAuth';
import {formatDate,todayIsoDate} from '../../lib/date';
import {AustralianDateInput} from '../../components/AustralianDateInput';
import {Button} from '../../components/Ui';
import {ActionDialog,Field,inputClass} from './ManagementFields';
import {value} from './managementForm';
import {ReviewRecordName} from './ReviewRecordName';
import {GovernmentInitialFoundations} from './GovernmentInitialFoundations';
import {GovernmentInitialCredits} from './GovernmentInitialCredits';

type History=MedicalHistoryEntry;
type Target={code:string;amount:string;sources:{id:string;name:string;year:number;balance:string;pending:string}[]};
type Person={employee_id:string;display_name:string;payroll_id:string|null;targets:Target[];enabled_codes?:string[];excluded_targets?:{code:string;reason:string;sources:Target['sources']}[];approved_leave?:{legacy_request_id:string;code:string;start_date:string;end_date:string;days:string;approved_by_name:string|null}[];warnings?:string[];issues:string[];route:{level:string;label:string}[]|{stages:{level:string;label:string}[]}};
type Preview={snapshot_hash:string;ready:number;total:number;employees:Person[]};
type Plan={initial_admin_setup?:boolean;employees:{employee_id:string;medical_history:History[]}[];cutover_date:string;history_confirmed:boolean;source_reference:string;payroll_reference:string;transition_reference:string;history_reference:string;reason:string};
type Review={id:string;prepared_by:string;snapshot_hash:string;plan:Plan;snapshot:{employees:Person[]};applied_at:string|null};
const root='/hr/government/workflow/commissioning';
const labels:Record<string,string>={source_reference:'Balance source',payroll_reference:'Balance review reference',transition_reference:'Migration decision reference',history_reference:'Medical history review reference'};
// Initial admin setup uses the live register and the administrator’s explicit
// confirmations. These describe the recorded actions, not external documents.
const initialReferences={source_reference:'Existing Finance/Treasury database: mapped stored leave balance rows',payroll_reference:'Administrator review of stored balances in the cohort consolidation preview',transition_reference:'Initial admin migration: carry the reviewed stored credits into the enabled Government leave types',history_reference:'Administrator confirmation of pre-cutover Medical absences and certificate status'};
export function RosterReview({people}:{people:Person[]}){return <div className="divide-y divide-gray-200">{people.map(p=><article key={p.employee_id} className="space-y-2 py-3 text-sm"><p className="font-semibold"><ReviewRecordName name={p.display_name}/> · {p.payroll_id||'Payroll ID missing'}</p><p>{(Array.isArray(p.route)?p.route:p.route.stages).map(s=>s.label).join(' → ')}</p><ul className="space-y-1">{p.targets.map(t=><li key={t.code}><span className="font-medium capitalize">{t.code}: {t.sources.length?`${Number(t.amount)} days`:'Not determined'}</span><span className="block break-words text-xs text-gray-500">{t.sources.map(s=>`${s.name} ${s.year}: ${Number(s.balance)} days`).join(' + ')||'No stored credit source'}</span></li>)}</ul>{p.enabled_codes&&<p className="text-gray-600">Leave to activate: {p.enabled_codes.map(c=>c[0].toUpperCase()+c.slice(1)).join(', ')}.</p>}{p.excluded_targets?.map(t=><div key={t.code} className="text-gray-600"><p>{t.reason}</p>{t.sources.length>0&&<p className="text-xs">Retained Annual history: {t.sources.map(s=>`${s.name} ${s.year}: ${Number(s.balance)} days`).join(' + ')}.</p>}</div>)}{p.approved_leave?.map(a=><p key={a.legacy_request_id} className="text-green-800">Approved {a.code} leave: {formatDate(a.start_date)} to {formatDate(a.end_date)} · {Number(a.days)} days. Existing approval retained{a.approved_by_name?` (${a.approved_by_name})`:''}; already deducted from the shown balance.</p>)}{p.warnings?.map(warning=><p key={warning} className="text-amber-800">{warning}</p>)}{p.issues.length>0&&<ul className="list-disc space-y-1 pl-5 text-amber-800">{p.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}<Link className="text-brand underline" to={`/leave/employees?view=directory&employee=${p.employee_id}&section=prepare`}>Review employee preparation</Link></article>)}</div>;}

export function GovernmentCommissioning({selected,names,starts,categories,onChanged,onMigrated=onChanged}:{selected:string[];names:Record<string,string>;starts:Record<string,string>;categories:Record<string,string>;onChanged:()=>void;onMigrated?:()=>void}){
 const {user}=useAuth();
 const [reviews,setReviews]=useState<Review[]>([]),[version,setVersion]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[plan,setPlan]=useState<Plan|null>(null),[busy,setBusy]=useState(false),[dialog,setDialog]=useState<'prepare'|Review|null>(null),[medical,setMedical]=useState<Record<string,History[]>>({});
 const migrating=useRef(false);
 const [savedReview,setSavedReview]=useState<SavedMigrationReview|null>(null);
 const [initialAdmin,setInitialAdmin]=useState(user?.role==='admin');
 const refreshSetup=()=>{setPreview(null);setPlan(null);setSavedReview(null);setVersion(v=>v+1);onChanged();};
 const selection=selected.join(',');
 useEffect(()=>{setPreview(null);setPlan(null);setSavedReview(null);},[selection]);
 useEffect(()=>{let live=true;void apiClient.get<{reviews:Review[]}>(root).then(r=>{if(live)setReviews(r.reviews);}).catch((e:Error)=>{if(live)setError(e.message);});return()=>{live=false;};},[version]);
 async function save(form:FormData){
  if(dialog==='prepare'){
   const references=initialAdmin?initialReferences:Object.fromEntries(Object.keys(labels).map(key=>[key,value(form,key)])) as typeof initialReferences;
   const next:Plan={initial_admin_setup:initialAdmin,employees:selected.map(employee_id=>({employee_id,medical_history:medical[employee_id]||[]})),cutover_date:value(form,'cutover_date'),history_confirmed:form.has('history_confirmed'),...references,reason:value(form,'reason')};
   const result=await apiClient.post<Preview>(`${root}/preview`,next);setPlan(next);setPreview(result);setSavedReview(null);setDialog(null);
  }else if(dialog){await apiClient.post(`${root}/${dialog.id}/apply`,{snapshot_hash:dialog.snapshot_hash,reason:value(form,'reason')});setNotice('Migration applied: staff now use their reviewed Government leave types and carried credits. Prepare the first accrual plans before enabling scheduled jobs.');setDialog(null);setPreview(null);setPlan(null);setVersion(v=>v+1);onMigrated();}
 }
 async function migrate(review?:Review){
  if(migrating.current||(!review&&(!preview||!plan)))return;
  migrating.current=true;setBusy(true);setError('');setNotice('');
  try{
   await migrateInitialCohort({plan:review?.plan||plan!,snapshotHash:review?.snapshot_hash||preview!.snapshot_hash,savedReview:review||savedReview,onPrepared:review?()=>{}:setSavedReview});
   setNotice('Migration applied: staff now use their reviewed Government leave types and carried credits.');setPreview(null);setPlan(null);setSavedReview(null);setVersion(v=>v+1);onMigrated();
  }catch(e){setError((e as Error).message);setVersion(v=>v+1);}
  finally{migrating.current=false;setBusy(false);}
 }
 async function freeze(){if(!preview||!plan)return;setBusy(true);setError('');try{await apiClient.post(root,{...plan,snapshot_hash:preview.snapshot_hash});setNotice(plan.initial_admin_setup?'Migration reviewed. You can apply this initial setup as the administrator; staff keep their current arrangements until then.':'Consolidation frozen for a second HR officer. Staff keep their current arrangements until it is applied.');setPreview(null);setPlan(null);setVersion(v=>v+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="app-panel space-y-4 p-4 sm:p-5" aria-label="Consolidate existing Treasury staff">
  <div><h3 className="text-lg font-semibold">Transfer existing staff</h3><p className="mt-1 text-sm text-gray-600">Use the selected department roster above. Review its stored balances, verified service and approval route together. For initial setup, preview the staff, then click Apply staff transfer to apply the switch. Staff keep using their current arrangements until the switch. Existing records, logins and credited balances carry forward.</p></div>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-green-800">{notice}</p>}
  {user?.role==='admin'&&<GovernmentInitialFoundations selected={selected} names={names} starts={starts} onChanged={refreshSetup}/>}
  {user?.role==='admin'&&<details><summary className="cursor-pointer text-sm text-gray-600">A stored balance is missing</summary><div className="mt-3"><GovernmentInitialCredits selected={selected} names={names} categories={categories} onChanged={refreshSetup}/></div></details>}
  <Button disabled={busy||!selected.length} onClick={()=>{setInitialAdmin(user?.role==='admin'&&(plan?.initial_admin_setup??true));setDialog('prepare');}}>Review staff transfer · {selected.length} selected</Button>
  {preview&&<><p role="status" className="text-sm font-semibold">{preview.ready} of {preview.total} ready for consolidation</p><RosterReview people={preview.employees}/>{preview.ready===preview.total?<><p className="text-sm text-gray-600">{plan?.initial_admin_setup?'Apply staff transfer applies these reviewed balances and approval arrangements to all selected staff together.':'Freeze this review for a second HR officer to certify.'}</p><Button loading={busy} onClick={()=>void (plan?.initial_admin_setup?migrate():freeze())}>{plan?.initial_admin_setup?'Apply staff transfer':'Freeze reviewed consolidation'}</Button></>:<p className="text-sm text-amber-800">Resolve the listed facts and reservations, then preview again. No employees or balances have been changed.</p>}</>}
  {reviews.length>0&&<div className="space-y-3"><p className="text-sm font-semibold">Recent consolidation reviews</p>{reviews.map(r=><details key={r.id} className="rounded-lg border border-gray-200 p-3"><summary className="cursor-pointer text-sm font-medium">{r.plan.employees.length} staff · Cutover {formatDate(r.plan.cutover_date)} · {r.applied_at?'Applied':r.plan.initial_admin_setup?'Ready for admin migration':'Awaiting second HR officer'}</summary><div className="mt-3 space-y-3"><RosterReview people={r.snapshot.employees}/><p className="break-words text-xs text-gray-500">{r.plan.source_reference} · {r.plan.transition_reference}</p>{!r.applied_at&&(r.plan.initial_admin_setup?r.prepared_by===String(user?.id)&&user?.role==='admin':r.prepared_by!==String(user?.id))&&<Button loading={busy} onClick={()=>r.plan.initial_admin_setup?void migrate(r):setDialog(r)}>{r.plan.initial_admin_setup?'Apply staff transfer':'Certify and consolidate cohort'}</Button>}</div></details>)}</div>}
  {dialog&&<ActionDialog title={dialog==='prepare'?'Review staff transfer':dialog.plan.initial_admin_setup&&dialog.prepared_by===String(user?.id)?'Apply staff transfer':'Certify and consolidate cohort'} saveLabel={dialog==='prepare'?'Preview balances and readiness':'Apply carried credits and Government workflow'} onClose={()=>setDialog(null)} onSave={save} automaticReason={dialog==='prepare'&&initialAdmin?'Initial Treasury migration using the existing recorded staff setup and reviewed stored leave balances.':dialog!=='prepare'&&dialog.plan.initial_admin_setup?'Applied the reviewed initial Treasury migration and carried the verified stored credits.':undefined}>
   {dialog==='prepare'?<>
    {initialAdmin&&<p className="text-sm text-gray-600">Review the recorded staff setup and balances below. Applying this transfer records your review and starts Government leave for the selected staff.</p>}
    {user?.role==='admin'&&<details><summary className="cursor-pointer text-sm text-gray-600">Other migration options</summary><label className="mt-3 flex items-start gap-2 text-sm"><input name="initial_admin_setup" type="checkbox" checked={initialAdmin} onChange={e=>setInitialAdmin(e.target.checked)} className="mt-1"/>Initial admin migration: I can review and apply this existing staff setup. Clear only to use separate preparation and certification by two HR officers.</label></details>}
    <Field label="Migration date"><AustralianDateInput name="cutover_date" required max={todayIsoDate()} defaultValue={plan?.cutover_date||todayIsoDate()} className={inputClass}/></Field>
    <p className="text-sm text-gray-600">The preview uses the latest active stored balance for each mapped type, including both Medical evidence categories in one pool. Temporary staff migrate with Medical and Special only; no Annual credit is required or carried. Pending days are never added. Missing stored credits, unresolved pending leave or unverified appointments need individual review.</p>
    {!initialAdmin&&Object.entries(labels).map(([key,label])=><Field key={key} label={label}><input name={key} className={inputClass} required minLength={5} maxLength={500} defaultValue={plan?.[key as keyof Plan] as string||''}/></Field>)}
    <details><summary className="cursor-pointer text-sm font-medium">Medical leave already taken this service year</summary><p className="my-3 text-xs text-gray-600">Enter Medical absences taken in this service year before migration, so the allowance without an MC carries over correctly. The stored balance alone does not show how many non-MC occasions were used. Use Add earlier Medical absence to record the dates and whether an MC was provided. Leave empty only if the employee took no Medical leave in this service year.</p><div className="space-y-3">{selected.map(id=><fieldset key={id} className="space-y-3"><legend className="font-medium text-sm">{names[id]||id} · Medical history</legend><MedicalHistoryFields entries={medical[id]||[]} onChange={entries=>setMedical({...medical,[id]:entries})}/></fieldset>)}</div></details>
    <label className="flex items-start gap-2 text-sm"><input name="history_confirmed" type="checkbox" required className="mt-1"/>I checked the Medical leave already taken by these staff in this service year. I entered any absences above, including those without an MC. Blank means no Medical leave was taken.</label>
   </>:<><p className="text-sm text-gray-600">Review the roster and its carried amounts below. The server checks the current sources again and applies the whole selected cohort together. Changed records stop the transaction.</p><RosterReview people={dialog.snapshot.employees}/><label className="flex items-start gap-2 text-sm"><input type="checkbox" required className="mt-1"/>I verified the source balances, service and schedule, Medical history, pending leave resolution and nominated approval route for this migration.</label></>}
  </ActionDialog>}
 </section>;
}

import {useEffect,useState} from 'react';
import {apiClient} from '../../lib/api';
import {useAuth} from '../../contexts/useAuth';
import {formatDateTime} from '../../lib/date';
import {Button,LoadingState} from '../../components/Ui';
import {ActionDialog,Field,inputClass} from './ManagementFields';
import {value} from './managementForm';
import {governmentLabel} from './governmentWorkflowTypes';
import type {OrgDepartment} from './types';

type Stage={level:string;label:string};
type Route={id:string|null;department_id:string|null;stages:Stage[];configured?:boolean;recorded_at?:string;recorded_by_name?:string;source_reference?:string};
type Settings={latest:Route|null;effective:Route;history:Route[]};
const offices=['division','parent_division','department','hr_verifier','relevant_secretary','chief_secretary'];
const root='/hr/government/workflow/approval-route';
const one:Stage[]=[{level:'division',label:'Division approver'}];
const oneDepartment:Stage[]=[{level:'department',label:'Head of Department'}];
const two:Stage[]=[{level:'division',label:'First approver'},{level:'department',label:'Head of Department'}];

export function GovernmentApprovalRoutes({departments,onNominate}:{departments:OrgDepartment[];onNominate:(departmentId:string)=>void}){
 const {user}=useAuth(),central=user?.permissions?.hr_admin===true;
 const [department,setDepartment]=useState(''),[data,setData]=useState<Settings|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[version,setVersion]=useState(0),[editing,setEditing]=useState(false),[stages,setStages]=useState<Stage[]>(one);
 useEffect(()=>{if(!central)return;let live=true;void apiClient.get<Settings>(`${root}${department?`?department_id=${department}`:''}`).then(r=>{if(live){setData(r);setError('');}}).catch((e:Error)=>{if(live)setError(e.message);});return()=>{live=false;};},[central,department,version]);
 if(!central)return null;
 const parentUnits=departments.find(d=>d.id===department)?.divisions.filter(d=>!d.parent_division_id)||[];
 const parentLabel=parentUnits.length===1?parentUnits[0].name:'Parent unit';
 const throughParent:Stage[]=[{level:'division',label:'Division approver'},{level:'parent_division',label:parentLabel}];
 const throughHoD:Stage[]=[...throughParent,{level:'department',label:'Head of Department'}];
 const change=(index:number,part:Partial<Stage>)=>setStages(previous=>previous.map((s,i)=>i===index?{...s,...part}:s));
 return <section className="app-panel space-y-4 p-4 sm:p-5" aria-label="Government approval routes">
  <div><h3 className="text-lg font-semibold">Approval route</h3><p className="mt-1 text-sm text-gray-600">Choose the levels for new Annual/Recreation, Medical and Special applications. The last level grants leave. Changes apply to new applications; submitted routes and decisions stay in history.</p></div>
  <Field label="Approval route scope"><select className={inputClass} value={department} onChange={e=>{setData(null);setDepartment(e.target.value);setNotice('');}}><option value="">Government default</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-green-800">{notice}</p>}
  {!data&&!error?<LoadingState label="Loading approval route…"/>:data&&<>
   <p className="text-sm text-gray-600">{data.latest?'Route for this scope':data.effective.configured?'Uses the Government default':'Uses the original Government route until configured'}</p>
   <ol className="space-y-2">{data.effective.stages.map((s,i)=><li key={s.level} className="rounded-lg border border-gray-200 p-3 text-sm"><span className="font-semibold">{i+1}. {s.label}</span><span className="block text-gray-600">{governmentLabel(s.level)}{i===data.effective.stages.length-1?' · Final approver':''}</span></li>)}</ol>
   <div className="flex flex-wrap gap-2"><Button onClick={()=>{setStages(data.effective.stages.map(s=>({...s})));setEditing(true);}}>Configure levels</Button><Button variant="secondary" onClick={()=>onNominate(department)}>Nominate officeholders</Button></div>
   <p className="text-sm text-gray-600">Finance → Treasury → divisions is the organisation hierarchy. Choose one level to stop at the employee’s division nominee, two to continue to Treasury, or three to continue to Finance’s HoD. Each parent-level nominee is resolved from the employee’s actual unit. HR verifies Medical and Special supporting evidence separately when the route has no HR level. Statutory event cases retain their specific route.</p>
   {data.history.length>0&&<details><summary className="cursor-pointer text-sm font-medium">Route revisions</summary><ul className="mt-3 space-y-3 text-sm">{data.history.map(r=><li key={r.id} className="break-words border-t border-gray-100 pt-2"><p>{r.stages.map(s=>s.label).join(' → ')}</p><p className="text-xs text-gray-500">{formatDateTime(r.recorded_at||'')} · {r.recorded_by_name} · {r.source_reference}</p></li>)}</ul></details>}
  </>}
  {editing&&data&&<ActionDialog title="Configure Government approval levels" saveLabel="Publish approval route" automaticReason="Configured the nominated approval levels for new leave applications." onClose={()=>setEditing(false)} onSave={async form=>{
   await apiClient.post(root,{department_id:department||null,expected_latest_id:data.latest?.id||null,stages,source_reference:`Administrator approval route setup: ${department?departments.find(d=>d.id===department)?.name||department:'Government default'}; ${stages.map(s=>s.label).join(' → ')}`.slice(0,500),reason:value(form,'reason')});setEditing(false);setNotice('Approval route published for new applications. Review the nominated officeholders before staff submit.');setData(null);setVersion(v=>v+1);
  }}>
   <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={()=>setStages(one.map(s=>({...s})))}>One level: division approver</Button><Button variant="secondary" onClick={()=>setStages(oneDepartment.map(s=>({...s})))}>One level: HoD</Button><Button variant="secondary" onClick={()=>setStages(throughParent.map(s=>({...s})))}>Two levels: division → {parentLabel}</Button><Button variant="secondary" onClick={()=>setStages(throughHoD.map(s=>({...s})))}>Three levels: division → {parentLabel} → HoD</Button><Button variant="secondary" onClick={()=>setStages(two.map(s=>({...s})))}>Two levels: first approver → HoD</Button></div>
   {stages.map((s,i)=><fieldset key={i} className="space-y-3 rounded-lg border border-gray-200 p-3"><legend className="px-1 text-sm font-semibold">Level {i+1}{i===stages.length-1?' · Final approver':''}</legend><Field label={`Level ${i+1} name`}><input className={inputClass} required minLength={3} maxLength={100} value={s.label} onChange={e=>change(i,{label:e.target.value})}/></Field><Field label={`Level ${i+1} nominated office`}><select className={inputClass} value={s.level} onChange={e=>change(i,{level:e.target.value})}>{offices.map(level=><option key={level} value={level} disabled={stages.some((other,n)=>n!==i&&other.level===level)}>{governmentLabel(level)}</option>)}</select></Field>{stages.length>1&&<Button variant="ghost" onClick={()=>setStages(stages.filter((_,n)=>n!==i))}>Remove level {i+1}</Button>}</fieldset>)}
   {stages.length<5&&<Button variant="secondary" onClick={()=>{const next=offices.find(level=>!stages.some(s=>s.level===level));if(next)setStages([...stages,{level:next,label:governmentLabel(next)}]);}}>Add another level</Button>}
   <p className="text-sm text-gray-600">The final selected office grants leave. Medical and Special evidence verification stays required. Existing pending applications keep their original levels; use a reviewed continuation if they need the new route.</p>
   <p className="text-xs text-gray-500">Your selected levels, account and time are recorded automatically.</p>
  </ActionDialog>}
 </section>;
}

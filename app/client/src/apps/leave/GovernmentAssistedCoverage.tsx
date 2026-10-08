import { formatDate } from '../../lib/date';
import { AustralianDateInput } from '../../components/AustralianDateInput';
import {DraftLifecycle} from './DraftLifecycle';
import {useEffect,useState} from 'react';
import {apiClient} from '../../lib/api';
import {useAuth} from '../../contexts/useAuth';
import {Button,Pager} from '../../components/Ui';
import {ActionDialog,Field,inputClass} from './ManagementFields';
import {value} from './managementForm';
import {ReviewRecordName} from './ReviewRecordName';
const root='/hr/government/rollout/coverage';
type Coverage={id:string;label:string;employee_ids:string[];effective_from:string;effective_to:string;prepared_by:string;approved_by:string|null;snapshot_hash:string;snapshot:unknown;draft_revision?:number;discarded?:boolean;source_reference:string};
export function GovernmentAssistedCoverage({selected,onChanged}:{selected:string[];onChanged:()=>void}){
 const {user}=useAuth();const [rows,setRows]=useState<Coverage[]>([]),[page,setPage]=useState(0),[total,setTotal]=useState(0),[version,setVersion]=useState(0),[error,setError]=useState(''),[dialog,setDialog]=useState<{id:string;row?:Coverage}|null>(null),[notice,setNotice]=useState('');
 useEffect(()=>{let live=true;void apiClient.get<{coverage:Coverage[];total:number}>(`${root}?page=${page+1}`).then(r=>{if(live){setRows(r.coverage);setTotal(r.total);}}).catch((e:Error)=>{if(live)setError(e.message);});return()=>{live=false;};},[page,version]);
 const save=async(f:FormData)=>{
  if(!dialog)return;
  if(dialog.row)await apiClient.post(`${root}/${dialog.id}/approve`,{snapshot_hash:dialog.row.snapshot_hash,reason:value(f,'reason')});
  else await apiClient.post(root,{coverage_id:dialog.id,employee_ids:selected,label:value(f,'label'),effective_from:value(f,'effective_from'),effective_to:value(f,'effective_to'),source_reference:value(f,'source_reference'),reason:value(f,'reason')});
  setDialog(null);setVersion(v=>v+1);onChanged();setNotice('Coverage recorded. Employee activation, policy entitlements and individual case approvals remain required.');
 };
 const download=(row:Coverage)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(row,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`leave-assisted-coverage-${row.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <div className="space-y-3 border-t border-gray-200 pt-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">Teacher & roster coverage</p><Button variant="secondary" disabled={!selected.length} onClick={()=>setDialog({id:crypto.randomUUID()})}>Prepare dated coverage</Button></div>
  <p className="text-sm text-gray-500">Select teacher or roster employees above. Review actual duty and off-duty dates for up to one year. A different HR officer verifies the schedule and Education handling. Changed records require a fresh review.</p>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-green-800">{notice}</p>}
  {rows.map(row=><article key={row.id} className="app-panel space-y-2 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold"><ReviewRecordName name={row.label}/></p><p className="text-xs text-gray-500">{formatDate(row.effective_from)} to {formatDate(row.effective_to)} · {row.employee_ids.length} employees · {row.approved_by?'Independently reviewed':row.discarded?'Discarded draft':'Awaiting review'}</p><p className="text-xs text-gray-500">{row.source_reference}</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={()=>download(row)}>Download coverage</Button>{!row.approved_by&&!row.discarded&&row.prepared_by!==String(user?.id)&&<Button onClick={()=>setDialog({id:row.id,row})}>Review coverage</Button>}{!row.approved_by&&<DraftLifecycle kind="coverage" record={row} onChanged={()=>setVersion(v=>v+1)}/>}</div></div></article>)}
  <Pager page={page} pageCount={Math.ceil(total/50)} total={total} pageSize={50} setPage={setPage}/>
  {dialog&&<ActionDialog title={dialog.row?'Independently review coverage':'Prepare teacher or roster coverage'} onClose={()=>setDialog(null)} onSave={save} saveLabel={dialog.row?'Record independent review':'Prepare coverage'}>{dialog.row?<><p className="text-sm text-gray-600">Download the complete schedule and confirm the actual roster, off-duty dates, holiday source and teacher processing authority. This review changes no balances or permissions.</p><p className="break-all text-xs text-gray-500">{dialog.row.snapshot_hash}</p><label className="flex gap-2 text-sm"><input type="checkbox" required/>I checked the complete dated coverage and cited handling authority.</label></>:<><Field label="Coverage name"><input name="label" className={inputClass} required minLength={5} maxLength={500}/></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Effective from"><AustralianDateInput  name="effective_from" className={inputClass} required/></Field><Field label="Effective through"><AustralianDateInput  name="effective_to" className={inputClass} required/></Field></div><Field label="Signed roster / Education processing reference"><input name="source_reference" className={inputClass} required minLength={5} maxLength={500}/></Field><p className="text-sm text-gray-500">Every date must have verified appointment, policy and Gazette calendar coverage. Roster employees need published duty or off-duty records for every date. Teacher Recreation remains discretionary; no annual Recreation balance is created by this review.</p></>}</ActionDialog>}
 </div>;
}

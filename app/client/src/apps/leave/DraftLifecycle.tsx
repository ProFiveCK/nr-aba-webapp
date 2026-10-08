import {useState} from 'react';
import {apiClient} from '../../lib/api';
import {Button} from '../../components/Ui';
import {ActionDialog} from './ManagementFields';
import {value} from './managementForm';
export type DraftLifecycleRecord={id:string;draft_revision?:number;discarded?:boolean};
export function DraftLifecycle({kind,record,onChanged}:{kind:'configuration'|'job'|'opening'|'coverage'|'benefit_reconciliation';record:DraftLifecycleRecord;onChanged:()=>void}){
 const [open,setOpen]=useState(false);const action=record.discarded?'restore':'discard';
 return <><Button variant="secondary" onClick={()=>setOpen(true)}>{record.discarded?'Restore draft':'Delete draft'}</Button>{open&&<ActionDialog title={record.discarded?'Restore preparation draft':'Delete unwanted preparation draft'} saveLabel={record.discarded?'Restore draft':'Delete draft'} onClose={()=>setOpen(false)} onSave={async form=>{await apiClient.post(`/hr/government/drafts/${kind}/${record.id}/lifecycle`,{action,expected_revision:record.draft_revision||0,reason:value(form,'reason')});setOpen(false);onChanged();}}>
 <p className="text-sm text-gray-600">{record.discarded?'Restore the original reviewed facts. Changed foundations still require a fresh preparation and independent approval.':'Remove this draft from approval while retaining its facts and reason in history. This never deletes published activation, certified balances, accrual postings or employee leave.'}</p>
 {!record.discarded&&<label className="block text-sm"><input type="checkbox" required/> I want to remove this unwanted draft from approval.</label>}
 </ActionDialog>}</>;
}

import {AustralianDateInput} from '../../components/AustralianDateInput';
import {Field,inputClass} from './ManagementFields';
import type {GovernmentRequest} from './governmentWorkflowTypes';

import {leaveDetailFields} from './leaveDetailFields';

export function SimpleLeaveDetails({code,initial={},application=false,request}:{code:string;initial?:Record<string,unknown>;application?:boolean;request?:GovernmentRequest}){
 const basis=request?.benefit_basis,fields=leaveDetailFields(code,application).filter(f=>!basis||!['duration_unit','prior_consumed','prior_history_reference'].includes(f.key));
 if(!fields.length)return null;
 return <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2"><legend className="mb-3 font-semibold">{application?'Leave details':'Details for this leave type'}</legend>{basis&&<p className="text-sm text-gray-600 sm:col-span-2">Previous usage and benefit units come from the employee’s recorded benefit balance.</p>}{fields.map(f=><Field key={f.key} label={f.label}>{f.options?<select name={`detail_${f.key}`} defaultValue={String(initial[f.key]??f.options[0][0])} className={inputClass} required={!f.optional}>{f.options.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select>:f.type==='date'?<AustralianDateInput name={`detail_${f.key}`} defaultValue={String(initial[f.key]??'')} required={!f.optional} className={inputClass}/>:<input name={`detail_${f.key}`} type={f.type||'text'} min={f.type==='number'?0:undefined} step={f.type==='number'?'0.000001':undefined} required={!f.optional} maxLength={500} defaultValue={String(initial[f.key]??'')} className={inputClass}/>}</Field>)}</fieldset>;
}

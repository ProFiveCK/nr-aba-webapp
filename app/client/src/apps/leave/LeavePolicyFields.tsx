import {useState} from 'react';
import {AustralianDateInput} from '../../components/AustralianDateInput';
import {Field,inputClass} from './ManagementFields';
import {POLICY_NO_END_DATE} from './policyDates';

type Rules = Record<string,string|number>;
type Policy = {label:string;effective_from:string;effective_to:string;rules:Rules;source_reference:string;next_change_date?:string};
const commonRules = ['recreation_annual_days','recreation_cap_days','recreation_notice_days','medical_annual_days','special_annual_days'];
const ruleLabels:Record<string,string> = {
 recreation_annual_days:'Recreation days per year',recreation_cap_days:'Maximum recreation balance',recreation_notice_days:'Recreation notice (days)',
 medical_annual_days:'Medical days per year',special_annual_days:'Special days per year',ordinary_recreation_months:'Recreation qualifying period (months)',
 temporary_recreation_months:'Temporary staff qualifying period (months)',medical_uncertified_occasions:'Medical occasions without a certificate',
};

export function LeavePolicyFields({defaults,policy,replacement,today}:{defaults:Rules;policy?:Policy;replacement:boolean;today:string}){
 const [noEnd,setNoEnd] = useState(!policy || policy.effective_to === POLICY_NO_END_DATE);
 const rules = {...defaults,...policy?.rules};
 const renderRule = (key:string) => <Field key={key} label={ruleLabels[key] || key.replace(/_/g,' ')}><input name={key} type="number" min="0" step={typeof defaults[key] === 'number' ? '1' : '0.000001'} className={inputClass} defaultValue={rules[key]} required/></Field>;
 return <>
  <Field label="Policy name"><input name="label" className={inputClass} required minLength={3} maxLength={120} defaultValue={policy?.label || 'Leave policy'}/></Field>
  <div className="grid gap-3 sm:grid-cols-2">
   <Field label="Effective from"><AustralianDateInput name="effective_from" className={inputClass} required min={replacement?policy?.next_change_date:undefined} defaultValue={replacement ? policy?.next_change_date || (policy && today > policy.effective_from ? today : '') : policy?.effective_from || today}/></Field>
   {!noEnd && <Field label="Effective through"><AustralianDateInput name="effective_to" className={inputClass} required defaultValue={policy?.effective_to === POLICY_NO_END_DATE ? undefined : policy?.effective_to}/></Field>}
  </div>
  <label className="flex items-center gap-2 text-sm"><input name="no_end_date" type="checkbox" checked={noEnd} onChange={event=>setNoEnd(event.target.checked)}/> No end date</label>
  {noEnd && <input type="hidden" name="effective_to" value={POLICY_NO_END_DATE}/>}
  <p className="text-sm text-gray-600">{replacement ? 'Existing allowances are copied below. Changes apply from the selected date; earlier records stay in history.' : 'These allowances apply to leave within the policy dates.'}</p>
  <div className="grid gap-3 sm:grid-cols-2">{commonRules.map(renderRule)}</div>
  <details className="rounded-lg border border-gray-200 p-3"><summary className="cursor-pointer text-sm font-medium text-gray-600">Advanced settings</summary><div className="mt-3 space-y-3">
   <div className="grid gap-3 sm:grid-cols-2">{Object.keys(defaults).filter(key=>!commonRules.includes(key)).map(renderRule)}</div>
   <Field label="Source (optional)"><input name="source_reference" className={inputClass} minLength={5} maxLength={500} defaultValue={policy?.source_reference}/></Field>
  </div></details>
 </>;
}

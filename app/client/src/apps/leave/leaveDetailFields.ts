export type LeaveDetailField={key:string;label:string;type?:'date'|'number';optional?:boolean;options?:[string,string][]};
export function leaveDetailFields(code:string,application=false):LeaveDetailField[]{
 const fields:LeaveDetailField[]=[];
 if(['maternity','paternity','adoption'].includes(code))fields.push({key:'sex_eligibility',label:'Employee eligibility',options:code==='paternity'?[['male','Male employee']]:[['female','Female employee']]});
 if(code==='maternity')fields.push({key:'pregnancy_number',label:'Pregnancy number',type:'number'},{key:'expected_birth_date',label:'Expected birth date',type:'date'});
 if(code==='paternity')fields.push({key:'event_kind',label:'Parental event',options:[['birth','Birth'],['adoption','Adoption']]});
 if(['paternity','adoption'].includes(code))fields.push({key:'child_birth_date',label:'Child’s birth date (required for adoption)',type:'date',optional:code==='paternity'});
 if(code==='adoption')fields.push({key:'spouse_or_stepchild',label:'Is the child a spouse’s child or stepchild?',options:[['false','No'],['true','Yes']]});
 if(code==='lwop')fields.push({key:'extension_basis',label:'For leave longer than twelve months',optional:true,options:[['','Not applicable'],['relevant_study','Study relevant to public service'],['exceptional_circumstances','Exceptional circumstances']]});
 if(application)return fields;
 if(code==='extended_medical_minister')fields.push({key:'salary_percent',label:'Approved salary percentage',type:'number'});
 if(code==='official')fields.push({key:'allowance_amount',label:'Official allowance AUD (if applicable)',type:'number',optional:true});
 if(['long_service','furlough','recreation_encashment','recreation_separation'].includes(code)){
  const actions:[string,string][]=[['encashment','Cash payment'],['contract_expiry','Contract expiry'],['retirement','Retirement'],['medical_retirement','Medical retirement'],['redundancy','Redundancy'],['termination_without_cause','Termination without cause'],['resignation','Resignation'],['death_in_service','Death in service']];
  fields.push({key:'action',label:'Benefit requested',options:code==='furlough'?[['take_leave','Take leave'],...actions]:code==='recreation_encashment'?[actions[0]]:code==='recreation_separation'?[...actions.slice(1),['termination_misconduct','Misconduct termination']]:actions},
   {key:'requested_units',label:'Days or shifts requested (calculated for furlough leave)',type:'number',optional:code==='furlough'});
  if(!code.startsWith('recreation_'))fields.push({key:'duration_unit',label:'Benefit unit',options:[['working_days','Working days'],['calendar_days','Calendar days'],['roster_shifts','Rostered shifts']]},{key:'prior_consumed',label:'Previous usage and payments in these units',type:'number'},{key:'prior_history_reference',label:'Prior usage record reference'});
  fields.push({key:'payable_amount',label:'Payment amount AUD (required for cash payments)',type:'number',optional:true},{key:'salary_valuation_reference',label:'Payment calculation reference (required for cash payments)',optional:true});
 }
 if(code==='attendance')fields.push({key:'outcome',label:'Attendance outcome',options:[['excused_paid','Excused with pay'],['reviewed_unpaid','Unpaid after review']]});
 return fields;
}
export function collectLeaveDetails(form:FormData){const details:Record<string,string>={};for(const [key,value] of form.entries())if(key.startsWith('detail_')&&typeof value==='string'&&value)details[key.slice(7)]=value;return details;}

import { createHash } from 'node:crypto';
import {calendarCoverageRequired,calendarFallbackNotice} from './governmentLeaveCalendarRules.js';
export const ENGINE_VERSION='gov-foundation-1';
export const CODES = ['recreation','medical','special','teacher_recreation','extended_medical','extended_medical_minister','maternity','paternity','adoption','official','lwop','long_service','furlough','recreation_encashment','recreation_separation','attendance','amendment','witness_republic','witness_other'];
export const COMMON_CODES=['recreation','medical','special'];
export const DEFAULT_RULES={ordinary_recreation_months:3,temporary_recreation_months:12,recreation_annual_days:'20',recreation_cap_days:'60',recreation_notice_days:14,medical_annual_days:'10',special_annual_days:'3',medical_uncertified_occasions:3};
export const SOURCE='GoN HRIS Reference Updated D; DHRL 22 July / 15 September 2026; owner ordinary-recreation decision 6 October 2026';
export function canonical(value){return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);}
export const fingerprint=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function units(value){const match=/^(-?)(\d{1,10})(?:\.(\d{1,6}))?$/.exec(String(value));if(!match)throw new Error('Use a decimal with at most six places.');return (match[1]? -1n:1n)*(BigInt(match[2])*1000000n+BigInt((match[3]||'').padEnd(6,'0')));}
export function decimal(value){const negative=value<0n,absolute=negative?-value:value;return `${negative?'-':''}${absolute/1000000n}.${String(absolute%1000000n).padStart(6,'0')}`;}
export function dayNumber(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Use a calendar date (YYYY-MM-DD).');const date=new Date(`${value}T00:00:00Z`);if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new Error('Invalid calendar date.');return date.getTime()/86400000;}
export const isoDay=number=>new Date(number*86400000).toISOString().slice(0,10);
export const nextDay=date=>isoDay(dayNumber(date)+1);
export function monthBoundary(date,months,leap='feb28'){
 const [y,m,d]=date.split('-').map(Number),target=new Date(Date.UTC(y,m-1+months,1));
 const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
 if(m===2&&d===29&&last===28&&leap==='mar1')return isoDay(Date.UTC(target.getUTCFullYear(),2,1)/86400000);
 return isoDay(Date.UTC(target.getUTCFullYear(),target.getUTCMonth(),Math.min(d,last))/86400000);
}
export function validateRules(rules){
 if(!rules||Object.keys(rules).sort().join()!==Object.keys(DEFAULT_RULES).sort().join())throw new Error('Use the complete typed policy schedule.');
 for(const key of ['ordinary_recreation_months','temporary_recreation_months','recreation_notice_days','medical_uncertified_occasions'])if(!Number.isInteger(rules[key])||rules[key]<0||rules[key]>120)throw new Error(`Invalid ${key}.`);
 for(const key of ['recreation_annual_days','recreation_cap_days','medical_annual_days','special_annual_days'])if(units(rules[key])<=0n||units(rules[key])>1000n*1000000n)throw new Error(`Invalid ${key}.`);
 if(units(rules.recreation_cap_days)<units(rules.recreation_annual_days))throw new Error('The recreation cap cannot be below its annual quantum.');
 return rules;
}
// A verified basis defines the continuity group. A later break requires a successor basis.
export function serviceFacts(context,asAt){
 const basis=context.bases.filter(b=>b.effective_from<=asAt).at(-1);if(!basis)return {issues:['HR must certify the continuous-service basis.']};
 const start=basis.continuity_start,first=dayNumber(start),finish=dayNumber(asAt),issues=[];
 if(finish-first>18300)throw new Error('Service history exceeds the supported 50-year window.');
 for(const item of context.exclusions)if(item.kind==='continuity_break'&&item.start_date<=asAt&&item.end_date>=start)issues.push('A recorded continuity break requires a new certified service basis.');
 const periods=context.periods.filter(p=>!p.end_date||p.end_date>=start),covered=[];
 for(const p of periods)if(p.counts_for_service!=null)covered.push([Math.max(first,dayNumber(p.start_date)),p.end_date?dayNumber(p.end_date):first+18301]);
 covered.sort((a,b)=>a[0]-b[0]);let until=first-1;
 for(const [from,to] of covered){if(from>until+1)break;until=Math.max(until,to);}
 if(until<finish)issues.push('Service history has a gap or an unresolved credit determination.');
 const raw=[...context.exclusions.filter(x=>x.kind!=='continuity_break').map(x=>[Math.max(first,dayNumber(x.start_date)),dayNumber(x.end_date)]),...periods.filter(p=>p.counts_for_service===false).map(p=>[Math.max(first,dayNumber(p.start_date)),p.end_date?dayNumber(p.end_date):first+18301])].filter(([from,to])=>to>=from).sort((a,b)=>a[0]-b[0]);
 const merged=[];for(const range of raw){const prior=merged.at(-1);if(prior&&range[0]<=prior[1]+1)prior[1]=Math.max(prior[1],range[1]);else merged.push([...range]);}
 const excludedBefore=end=>merged.reduce((sum,[from,to])=>sum+Math.max(0,Math.min(end-1,to)-from+1),0);
 const milestone=months=>{
   let remaining=dayNumber(monthBoundary(start,months,basis.leap_day_method))-first,cursor=first;
   for(const [from,to] of merged){if(to<cursor)continue;const credited=Math.max(0,from-cursor);if(remaining<=credited)break;remaining-=credited;cursor=to+1;}
   const boundary=cursor+remaining;return boundary<=until+1&&boundary-first<=18300?isoDay(boundary):null;
 };
 let year=0,periodStart=start,periodEnd=null;
 for(let candidate=1;candidate<=51;candidate++){
   const boundary=basis.anniversary_method==='calendar'?monthBoundary(start,candidate*12,basis.leap_day_method):milestone(candidate*12);
   if(!boundary){issues.push('An anniversary crosses unverified future service.');break;}
   if(boundary>asAt){periodEnd=isoDay(dayNumber(boundary)-1);break;}year=candidate;periodStart=boundary;
 }
 return {basis,issues:[...new Set(issues)],excluded_days:excludedBefore(finish),credited_days:finish-first-excludedBefore(finish),period_start:periodStart,period_end:periodEnd,completed_years:year,milestone};
}
export function calculateEvaluation(context,input){
 const start=dayNumber(input.start_date),end=dayNumber(input.end_date),today=dayNumber(input.notice_date);
 if(end<start||end-start>365)throw new Error('Preview at most 366 consecutive calendar dates.');
 if(!CODES.includes(input.code))throw new Error('Choose a stable government leave code.');
 const issues=[],requirements=[],warnings=[],segments=[],policies=new Map(),services=new Map(),allocations=new Map();let charge=0n,hours=0;
 const common=COMMON_CODES.includes(input.code);
 for(let n=start;n<=end;n++){
   const date=isoDay(n),policy=context.policies.find(p=>p.status==='published'&&p.effective_from<=date&&p.effective_to>=date);
   const calendar=context.calendars.find(c=>c.effective_from<=date&&c.effective_to>=date);
   const service=serviceFacts(context,date),period=context.periods.find(p=>p.start_date<=date&&(!p.end_date||p.end_date>=date));
   if(!policy){issues.push('No published government policy covers every requested date.');continue;}
   if(policy.evaluator_version&&policy.evaluator_version!==ENGINE_VERSION){issues.push('This published policy requires an unsupported evaluator version.');continue;}
   policies.set(policy.id,policy);services.set(service.basis?.id,service.basis);
   issues.push(...service.issues);
   if(context.exclusions.some(x=>x.kind==='lwop'&&x.start_date<=date&&x.end_date>=date))issues.push('The requested absence overlaps recorded LWOP. Resolve it through an authorised amendment.');
   if(!period){issues.push('No verified appointment covers every requested date.');continue;}
   if(['unknown','casual','probationary'].includes(period.employment_category))issues.push('HR must determine the category and applicable legal terms; intern designation alone does not determine entitlement.');
   if(input.code==='recreation'&&period.is_teacher)issues.push('Teacher recreation requires an authorised discretionary case.');
   if(['maternity','paternity','adoption'].includes(input.code)&&period.employment_category==='temporary')issues.push('Temporary parental applications are excluded under the September DHRL confirmation.');
   if(input.code==='lwop'&&period.employment_category!=='permanent')issues.push('LWOP is restricted to permanent employees.');
   if(['long_service','furlough'].includes(input.code)&&period.employment_category==='temporary')issues.push('Temporary long-service treatment requires an authorised determination.');
   if(input.code==='recreation'){
     const months=period.employment_category==='temporary'?policy.rules.temporary_recreation_months:policy.rules.ordinary_recreation_months;
     const qualified=service.milestone?.(months);if(!qualified||date<qualified)issues.push(`Recreation requires ${months} months of credited continuous service${qualified?`; eligible ${qualified}`:''}.`);
     if(start-today<policy.rules.recreation_notice_days)issues.push(`Recreation requires at least ${policy.rules.recreation_notice_days} calendar days' notice.`);
   }
   if(!common)continue;
   if(!calendar){if(calendarCoverageRequired(context)){issues.push('An approved calendar must cover every requested date.');continue;}warnings.push(calendarFallbackNotice);}
   let policyDays=0n,paidHours=0,rosterId=null,patternId=null;
   if(service.basis?.schedule_mode==='roster'){
     const roster=context.rosters.find(r=>r.day===date);if(!roster){issues.push('Published roster coverage is missing, including off-duty dates.');continue;}
     policyDays=units(roster.policy_days);paidHours=Number(roster.paid_hours);rosterId=roster.id;
   }else{
     const pattern=context.patterns.find(p=>p.id===period.work_pattern_id),approval=context.pattern_approvals.find(a=>a.work_pattern_id===period.work_pattern_id);
     if(!pattern||!approval||!pattern.hours_per_day){issues.push('The weekly work pattern and policy-day conversion must be verified.');continue;}
     patternId=pattern.id;const weekday=new Date(n*86400000).getUTCDay()||7;
     if(pattern.working_weekdays.includes(weekday)){policyDays=1000000n;paidHours=Number(pattern.hours_per_day);}
   }
   const holiday=calendar?.holidays.some(h=>h.date===date)||false,exempt=holiday&&['recreation','medical'].includes(input.code);
   const amount=exempt?0n:policyDays;charge+=amount;hours+=paidHours;
   const entitlement=context.entitlements.find(e=>e.code===input.code&&e.period_start===service.period_start&&e.period_end===service.period_end&&e.period_start<=date&&e.period_end>=date&&e.as_of<=date);
   if(amount>0n&&!entitlement)issues.push('Certified opening entitlement is missing for a charged date; forecast accrual is not spendable.');
   if(amount>0n&&entitlement){const old=allocations.get(entitlement.id)||{entitlement_id:entitlement.id,amount:0n};old.amount+=amount;allocations.set(entitlement.id,old);}
   segments.push({date,charge:decimal(amount),scheduled_hours:paidHours,holiday_exempt:exempt,policy_version_id:policy.id,calendar_id:calendar?.id||null,service_basis_id:service.basis?.id||null,service_period_id:period.id,employment_category:period.employment_category,is_teacher:period.is_teacher===true,is_intern:period.is_intern===true,work_pattern_id:patternId,roster_id:rosterId,entitlement_id:entitlement?.id||null,service_period_start:service.period_start,service_period_end:service.period_end});
 }
 if(common&&charge===0n)issues.push('The selected dates contain no chargeable absence.');
 if(input.code==='medical')requirements.push('Medical history and the three non-consecutive single-absence counter must be verified at submission.');
 const verifiedSingleShift=input.verified_single_shift_exemption===true&&end===start&&charge>0n&&charge<=2000000n&&segments.length===1&&!!segments[0].roster_id&&Number(segments[0].scheduled_hours)>0;
 if(input.code==='medical'&&(charge>1000000n||end>start)&&!input.certificate_available&&!verifiedSingleShift)issues.push('A medical certificate is required for this multi-day absence.');
 if(input.code==='special'&&!input.justification_available)issues.push('Special leave requires sufficient-cause justification.');
 if(!common)issues.push('This entitlement requires the assisted case module and an authorised determination.');
 const allocated=[...allocations.values()].map(a=>({...a,amount:decimal(a.amount)}));
 for(const item of allocated){const account=context.entitlements.find(e=>e.id===item.entitlement_id);if(units(item.amount)>units(account.available))issues.push('The request exceeds a certified entitlement after existing reservations.');}
 const result={engine_version:ENGINE_VERSION,code:input.code,eligible_for_preview:issues.length===0,submission_enabled:false,issues:[...new Set(issues)],warnings:[...new Set(warnings)],requirements,charge:decimal(charge),scheduled_hours:hours,segments,allocations:allocated,policy_versions:[...policies.values()],service_bases:[...services.values()].filter(Boolean),required_offices:['division','head_of_department',...(['recreation','medical','lwop'].includes(input.code)?['relevant_secretary_consent']:[]),'chief_secretary'],source_reference:SOURCE};
 return {...result,input:{...input},snapshot_hash:fingerprint({context,input,result})};
}

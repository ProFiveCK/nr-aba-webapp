import {withTransaction} from '../lib/transaction.js';
import {ServiceError} from '../lib/serviceError.js';
import {dayNumber,fingerprint} from '../lib/governmentLeaveRules.js';
import {assertCentral,today} from './governmentLeaveWorkflow.js';
import {assertInitialAdmin} from './governmentLeaveInitialAdmin.js';
import {addServicePeriod} from './employeeDirectory.js';
import {addFoundationRecord,lockEmployee} from './governmentLeave.js';
import {recordAudit} from './auditService.js';
import {initialSetupReference} from './governmentLeaveInitialSetupReference.js';

const fail=(message,status=409)=>{throw new ServiceError(status,message);};
function plan(data) {
 if(!Array.isArray(data.employees))fail('Choose existing employees.',400);
 if(data.reuse_recorded_dates!=null&&typeof data.reuse_recorded_dates!=='boolean')fail('Choose a valid recorded-date import option.',400);
 const ids=data.employees.map(e=>e?.employee_id);
 if(!Array.isArray(ids)||!ids.length||ids.length>50||ids.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))||new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)fail('Choose 1–50 distinct existing employees.',400);
 try{dayNumber(data.effective_from);}catch{fail('Enter the preparation effective date.',400);}
 if(data.effective_from>today()||!['permanent','temporary','contract'].includes(data.employment_category)||!['calendar','pause_exclusions'].includes(data.anniversary_method)||!['feb28','mar1'].includes(data.leap_day_method)||data.facts_confirmed!==true)fail('Confirm the actual category, continuity, anniversary treatment and shared schedule.',400);
 if(typeof data.work_pattern_id!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(data.work_pattern_id))fail('Choose the verified work schedule.',400);
 for(const key of ['source_reference','reason'])if(typeof data[key]!=='string'||data[key].trim().length<(key==='reason'?10:5)||data[key].length>(key==='reason'?1000:500))fail('Record the preparation source and reason.',400);
 return {reuse_recorded_dates:data.reuse_recorded_dates===true,effective_from:data.effective_from,employment_category:data.employment_category,anniversary_method:data.anniversary_method,leap_day_method:data.leap_day_method,work_pattern_id:data.work_pattern_id,source_reference:data.source_reference.trim(),reason:data.reason.trim(),facts_confirmed:true,employees:data.employees.map(e=>({employee_id:e.employee_id.toLowerCase(),service_start:e.service_start||''})).sort((a,b)=>a.employee_id.localeCompare(b.employee_id))};
}
async function snapshot(client,input) {
 const {rows:[pattern]}=await client.query('SELECT p.*,a.id AS approval_id FROM hr_work_patterns p LEFT JOIN hr_gov_pattern_approvals a ON a.work_pattern_id=p.id WHERE p.id=$1 FOR SHARE OF p',[input.work_pattern_id]);
 if(!pattern?.approval_id)fail('Verify the shared work schedule in Settings → Policies → Work schedules first.');
 const employees=[];
 for(const person of input.employees){
  const {rows:[employee]}=await client.query("SELECT id,display_name,to_char(join_date,'YYYY-MM-DD') AS join_date,status,leave_policy_regime,department_id,division_id FROM hr_employees WHERE id=$1",[person.employee_id]);
  if(!employee)fail('An employee no longer exists.',404);
  const periods=(await client.query('SELECT * FROM hr_employee_service_periods WHERE employee_id=$1 ORDER BY id',[employee.id])).rows;
  const bases=(await client.query('SELECT * FROM hr_gov_service_bases WHERE employee_id=$1 ORDER BY id',[employee.id])).rows;
  const issues=[];
  if(employee.status!=='active'||employee.leave_policy_regime!=='legacy')issues.push('Use this initial preparation for existing active staff on their current arrangements.');
  if(!employee.department_id||!employee.division_id)issues.push('Adopt or verify the managed organisation placement first.');
  if(periods.length||bases.length)issues.push('Service preparation already exists. Retain it and review this employee individually.');
  const serviceStart=input.reuse_recorded_dates&&employee.join_date?employee.join_date:person.service_start;
  try{dayNumber(serviceStart);if(serviceStart>input.effective_from)issues.push('Service start cannot follow the preparation date.');}catch{issues.push('Enter the verified credited-service start date.');}
  employees.push({employee_id:employee.id,display_name:employee.display_name,service_start:serviceStart,date_source:input.reuse_recorded_dates&&employee.join_date?'existing_register':'entered_date',issues,employee,periods,bases});
 }
 return {employees,hash:fingerprint({input,pattern,employees})};
}
function view(state){return {snapshot_hash:state.hash,ready:state.employees.filter(e=>!e.issues.length).length,total:state.employees.length,employees:state.employees.map(e=>({employee_id:e.employee_id,display_name:e.display_name,service_start:e.service_start,date_source:e.date_source,issues:e.issues}))};}
export async function previewInitialFoundations(pool,{user,data}) {
 const input=plan(data);
 return withTransaction(pool,async client=>{await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await assertCentral(client,user);await assertInitialAdmin(client,user.id);return view(await snapshot(client,input));});
}
export async function applyInitialFoundations(pool,{user,actor,data}) {
 const input=plan(data);
 return withTransaction(pool,async client=>{
  await assertCentral(client,user);await assertInitialAdmin(client,user.id);
  for(const person of input.employees)await lockEmployee(client,person.employee_id);
  const current=await snapshot(client,input);
  if(current.hash!==data.snapshot_hash||current.employees.some(e=>e.issues.length))fail('Staff preparation changed or remains incomplete. Preview the current facts again.');
  for(const person of current.employees){
   await addServicePeriod(pool,{client,employeeId:person.employee_id,actor,reason:input.reason,period:{start_date:person.service_start,employment_category:input.employment_category,counts_for_service:true,work_pattern_id:input.work_pattern_id,appointment_reference:input.source_reference}});
   await addFoundationRecord(pool,{client,user,actor,employeeId:person.employee_id,kind:'basis',data:{...input,effective_from:person.service_start,continuity_start:person.service_start,schedule_mode:'weekly'}});
  }
  await recordAudit({client,actor,action:'hr.gov.initial_foundations.applied',entityType:'hr_employee',after:{...input,employees:current.employees.map(e=>({employee_id:e.employee_id,service_start:e.service_start,date_source:e.date_source}))}});
  return {prepared:input.employees.length};
 });
}

// Explicit source entry for existing staff whose historical register has no
// stored row. Never seed a default or replace an existing credited balance.
export async function recordInitialCredit(pool,{user,actor,data}) {
 const text=String(data.amount??''),year=Number(data.year);
 if(!/^\d+(?:\.\d{1,2})?$/.test(text)||Number(text)>10000||!Number.isInteger(year)||year<1900||year>Number(today().slice(0,4)))fail('Enter the actual reviewed credit (zero is allowed) and source year.',400);
 if(typeof data.source_reference!=='string'||data.source_reference.trim().length<5||data.source_reference.length>500||typeof data.reason!=='string'||data.reason.trim().length<10||data.reason.length>1000)fail('Record the verified balance source and reason.',400);
 return withTransaction(pool,async client=>{
  await assertCentral(client,user);await assertInitialAdmin(client,user.id);
  const employee=await lockEmployee(client,data.employee_id);
  if(employee.status!=='active'||employee.leave_policy_regime!=='legacy')fail('Record initial source credits before this existing active employee migrates.');
  const setup=await initialSetupReference(client);
  if(setup?.status!=='adopted'||!setup.mappings.some(m=>m.leave_type_id===data.leave_type_id&&['recreation','medical','special'].includes(m.code)))fail('Adopt the source type mapping before recording this initial credit.');
  const code=setup.mappings.find(m=>m.leave_type_id===data.leave_type_id)?.code;
  const currentAppointment=(await client.query('SELECT employment_category FROM hr_employee_service_periods WHERE employee_id=$1 AND start_date<=$2 AND (end_date IS NULL OR end_date>=$2)',[employee.id,today()])).rows[0];
  if(currentAppointment?.employment_category==='contract'&&employee.leave_entitled===false)fail('This Contract appointment has no leave entitlement. No source credit is required for initial migration.');
  if(code==='recreation'){
   const {rows:[appointment]}=await client.query('SELECT employment_category FROM hr_employee_service_periods WHERE employee_id=$1 AND start_date<=$2 AND (end_date IS NULL OR end_date>=$2)',[employee.id,today()]);
   if(appointment?.employment_category==='temporary')fail('Recreation is not enabled for Temporary staff in the initial migration. An Annual source credit is not required.');
  }
  const {rows:[type]}=await client.query('SELECT * FROM hr_leave_types WHERE id=$1 FOR SHARE',[data.leave_type_id]);
  if(!type?.is_active)fail('Choose an active mapped source type.');
  if((await client.query('SELECT id FROM hr_leave_balances WHERE employee_id=$1 AND leave_type_id=$2',[employee.id,type.id])).rowCount)fail('A source balance already exists. Retain it; use the normal reviewed correction tools if it needs correction.');
  const {rows:[balance]}=await client.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance,pending) VALUES($1,$2,$3,$4,0) RETURNING *',[employee.id,type.id,year,text]);
  await recordAudit({client,actor,action:'hr.gov.initial_credit.recorded',entityType:'hr_leave_balance',entityId:balance.id,after:{...balance,source_reference:data.source_reference.trim(),reason:data.reason.trim()}});
  return balance;
 });
}

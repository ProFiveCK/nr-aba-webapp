import {describe,test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {connectTestDatabase,resetLeaveTables,skipWithoutDatabase} from '../test-support/database.js';
import {DEFAULT_RULES,fingerprint} from '../lib/governmentLeaveRules.js';

describe('government rollout readiness and release evidence',{skip:skipWithoutDatabase},()=>{
 let pool,p,l,w,hr,certifier,owner,employee,department,division,policy,auth,server,base,rollout;
 const reason='Synthetic signed local Salary Unit and HR reconciliation.';
 const actor=row=>({id:row.id}),user=row=>({...row,permissions:row.permissions});
 const args=(data,by=hr)=>({user:user(by),actor:actor(by),data});
 before(async()=>{
  pool=await connectTestDatabase();rollout=await import('../services/governmentLeaveRollout.js');p=await import('../services/governmentLeavePayroll.js');l=await import('../services/governmentLeave.js');w=await import('../services/governmentLeaveWorkflow.js');auth=await import('../services/authService.js');
  const express=(await import('express')).default,errors=await import('../middleware/errors.js');errors.enableAsyncErrors();const app=express();app.use(express.json());app.use('/api/hr',(await import('./hr.js')).default);app.use(errors.errorHandler);server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}/api/hr/government/rollout`;
 });
 after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
 async function account(permissions){return(await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES($1,'Synthetic Payroll reviewer','user','x',$2) RETURNING *",[`${randomUUID()}@example.test`,permissions])).rows[0];}
 async function opening(code,amount){const row=await l.prepareOpening(pool,{...args({code,amount,policy_version_id:policy.id,period_start:'2026-01-01',period_end:'2026-12-31',as_of:'2026-10-01',source_reference:'Synthetic opening source',payroll_reference:'Synthetic Salary Unit opening source',reason}),employeeId:employee.id});await l.certifyOpening(pool,{...args({},certifier),id:row.id,reason});}
 beforeEach(async()=>{
  await resetLeaveTables(pool);await pool.query('TRUNCATE hr_gov_rollout_waves,hr_gov_job_runs,hr_gov_payroll_batches,hr_gov_handovers,hr_gov_policy_versions,hr_gov_calendars,hr_gov_pattern_approvals CASCADE');
  hr=await account({hr_admin:true,hr_access:true});certifier=await account({hr_admin:true,hr_access:true});owner=await account({hr_access:true,hr_leave_apply:true});
  department=(await pool.query("INSERT INTO hr_departments(name) VALUES('Synthetic Payroll Department') RETURNING *")).rows[0];division=(await pool.query("INSERT INTO hr_divisions(name,department_id) VALUES('Synthetic Payroll Division',$1) RETURNING *",[department.id])).rows[0];
  employee=(await pool.query("INSERT INTO hr_employees(display_name,reviewer_id,department_id,division_id,leave_policy_regime) VALUES('Synthetic Payroll Employee',$1,$2,$3,'government') RETURNING *",[owner.id,department.id,division.id])).rows[0];
  await pool.query("INSERT INTO hr_employee_external_ids(employee_id,source,external_id,verified_by,reason) VALUES($1,'techone_payroll','00001-A',$2,$3)",[employee.id,hr.id,reason]);
  const pattern=(await pool.query("INSERT INTO hr_work_patterns(name,working_weekdays,hours_per_day) VALUES($1,ARRAY[1,2,3,4,5],7) RETURNING *",[`Synthetic Payroll ${randomUUID()}`])).rows[0];
  await pool.query("INSERT INTO hr_employee_service_periods(employee_id,start_date,employment_category,counts_for_service,work_pattern_id,reason) VALUES($1,'2026-01-01','permanent',TRUE,$2,$3)",[employee.id,pattern.id,reason]);
  await l.addFoundationRecord(pool,{...args({work_pattern_id:pattern.id,source_reference:'Synthetic work pattern authority',reason}),kind:'pattern'});
  await l.addFoundationRecord(pool,{...args({effective_from:'2026-01-01',continuity_start:'2026-01-01',anniversary_method:'calendar',leap_day_method:'feb28',schedule_mode:'weekly',source_reference:'Synthetic service basis authority',reason}),employeeId:employee.id,kind:'basis'});
  policy=await l.createPolicy(pool,args({label:'Synthetic Payroll policy',effective_from:'2026-01-01',effective_to:'2027-12-31',rules:DEFAULT_RULES,source_reference:'Synthetic published policy',reason}));await l.publishPolicy(pool,{...args({}),id:policy.id,reason});
  await l.createCalendar(pool,args({label:'Synthetic Payroll calendar',effective_from:'2026-01-01',effective_to:'2027-12-31',holidays:[],source_reference:'Synthetic Gazette calendar',reason}));
  for(const [code,amount] of [['recreation','20'],['medical','10'],['special','3']])await opening(code,amount);
 });
 async function readyEmployee(){
  const config=await w.prepareConfiguration(pool,{...args({enabled_codes:['recreation','medical','special'],medical_rule:'single_calendar_date_nonadjacent_scheduled_days',medical_history:[],source_reference:reason,legacy_resolution_reference:reason,reason}),employeeId:employee.id});
  await w.publishConfiguration(pool,{...args({},certifier),id:config.id,reason});
  for(const level of ['division','department','chief_secretary','hr_verifier','relevant_secretary']){
   const reviewer=level==='hr_verifier'?certifier:await account({hr_access:true,hr_leave_approve:true});
   const officer=(await pool.query('INSERT INTO hr_employees(display_name,reviewer_id) VALUES($1,$2) RETURNING id',[`Synthetic ${level}`,reviewer.id])).rows[0];
   if(['division','department','chief_secretary'].includes(level))await pool.query("INSERT INTO hr_approval_assignments(level,department_id,division_id,approver_employee_id,effective_from,recorded_by,reason) VALUES($1,$2,$3,$4,'2026-01-01',$5,$6)",[level,level==='chief_secretary'?null:department.id,level==='division'?division.id:null,officer.id,hr.id,reason]);
   else await w.assignConsentOffice(pool,{...args({level,department_id:level==='hr_verifier'?null:department.id,approver_employee_id:officer.id,effective_from:'2026-01-01',source_reference:reason,reason})});
  }
 }
 async function payrollCycles(){
  const batches=[];
  for(const [start,end,day] of [['2026-11-01','2026-11-14','2026-11-02'],['2026-11-15','2026-11-28','2026-11-17']]){
   const id=randomUUID(),grant={employee:{id:employee.id,name:employee.display_name},evaluation:{segments:[{date:day,charge:'1.000000',scheduled_hours:7,policy_version_id:policy.id}]}};
   await pool.query("INSERT INTO hr_gov_requests(id,employee_id,code,start_date,end_date,reason,medical_mode,payload_hash,application_snapshot,department_id,division_id,charge,submitted_by,status,grant_snapshot,final_pdf) VALUES($1,$2,'official',$3,$3,$4,'not_applicable','synthetic',$5,$6,$7,0,$8,'approved',$5,$9)",[id,employee.id,day,reason,grant,department.id,division.id,hr.id,Buffer.from('%PDF-1.7 synthetic cohort fixture')]);
   const batch=await p.preparePayroll(pool,args({batch_id:randomUUID(),period_start:start,period_end:end,source_reference:reason,reason}));
   await p.acknowledgePayroll(pool,{...args({snapshot_hash:batch.snapshot_hash,reference:`Synthetic receipt ${start}`,reason},certifier),id:batch.id});batches.push(batch.id);
  }
  return batches;
 }
 const data=batchIds=>({wave_id:randomUUID(),label:'Synthetic prepared department cohort',kind:'rehearsal',employee_ids:[employee.id],payroll_batch_ids:batchIds,source_reference:reason,reason,evidence:Object.fromEntries(rollout.EVIDENCE_KEYS.map(k=>[k,`Synthetic signed ${k} evidence`]))});
 const prepare=d=>rollout.prepareWave(pool,args(d));
 const approve=(row,by=certifier,changes={})=>rollout.approveWave(pool,{...args({snapshot_hash:row.snapshot_hash,reason,...changes},by),id:row.id});
 async function http(path,by=owner,body=null){const session=await auth.createSession(by.id),token=auth.buildTokenPayload(by,session.tokenId,session.expiresAt),r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
 test('readiness explains incomplete activation and authority without changing balances',async()=>{
  const before=(await pool.query('SELECT count(*)::int AS n FROM hr_gov_ledger')).rows[0].n;
  const state=await rollout.previewWave(pool,user(hr),[employee.id]);assert.equal(state.ready,0);assert.ok(state.employees[0].issues.some(i=>i.includes('activate')));assert.ok(state.employees[0].issues.some(i=>i.includes('officeholder')));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_ledger')).rows[0].n,before);
 });
 test('a verified common cohort passes and independent review is immutable and idempotent',async()=>{
  await readyEmployee();assert.equal((await rollout.previewWave(pool,user(hr),[employee.id])).ready,1);
  const d=data(await payrollCycles()),row=await prepare(d);assert.equal(fingerprint(row.snapshot),row.snapshot_hash);assert.equal((await prepare(d)).id,row.id);
  await assert.rejects(approve(row,hr),/different central/);const receipt=await approve(row);assert.equal((await approve(row)).wave_id,receipt.wave_id);
  await assert.rejects(pool.query('UPDATE hr_gov_rollout_waves SET label=$2 WHERE id=$1',[row.id,'Rewrite cohort']),/immutable/);
  await assert.rejects(pool.query('DELETE FROM hr_gov_rollout_approvals WHERE wave_id=$1',[row.id]),/immutable/);
 });
 test('teacher coverage independently verifies dated foundations and removes ordinary Recreation activation requirement',async()=>{
  await pool.query('UPDATE hr_employee_service_periods SET is_teacher=TRUE WHERE employee_id=$1',[employee.id]);await readyEmployee();
  const config=await w.prepareConfiguration(pool,{...args({enabled_codes:['medical','special'],medical_rule:'single_calendar_date_nonadjacent_scheduled_days',medical_history:[],source_reference:reason,legacy_resolution_reference:reason,reason}),employeeId:employee.id});await w.publishConfiguration(pool,{...args({},certifier),id:config.id,reason});
  assert.equal((await rollout.previewWave(pool,user(hr),[employee.id])).ready,0);
  const row=await rollout.prepareCoverage(pool,args({coverage_id:randomUUID(),label:'Synthetic teacher Education coverage',employee_ids:[employee.id],effective_from:'2026-10-01',effective_to:'2026-11-30',source_reference:reason,reason}));
  await assert.rejects(rollout.approveCoverage(pool,{...args({snapshot_hash:row.snapshot_hash,reason}),id:row.id}),/different central/);
  await rollout.approveCoverage(pool,{...args({snapshot_hash:row.snapshot_hash,reason},certifier),id:row.id});assert.equal((await rollout.previewWave(pool,user(hr),[employee.id])).ready,1);
  await pool.query('UPDATE hr_work_patterns SET hours_per_day=8 WHERE id=(SELECT work_pattern_id FROM hr_employee_service_periods WHERE employee_id=$1)',[employee.id]);assert.equal((await rollout.previewWave(pool,user(hr),[employee.id])).ready,0);
 });
 test('roster coverage requires every duty and off-duty date and stale replacements lose readiness',async(t)=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-07T00:00:00Z')});
  await readyEmployee();await l.addFoundationRecord(pool,{...args({effective_from:'2026-10-01',continuity_start:'2026-01-01',anniversary_method:'calendar',leap_day_method:'feb28',schedule_mode:'roster',source_reference:reason,reason}),employeeId:employee.id,kind:'basis'});
  const d={coverage_id:randomUUID(),label:'Synthetic roster duty coverage',employee_ids:[employee.id],effective_from:'2026-10-07',effective_to:'2026-10-08',source_reference:reason,reason};
  await assert.rejects(rollout.prepareCoverage(pool,args(d)),/off-duty/);
  const first=await l.addFoundationRecord(pool,{...args({day:'2026-10-07',paid_hours:'8',policy_days:'1',source_reference:reason,reason}),employeeId:employee.id,kind:'roster'});
  await assert.rejects(rollout.prepareCoverage(pool,args(d)),/off-duty/);
  await l.addFoundationRecord(pool,{...args({day:'2026-10-08',paid_hours:'0',policy_days:'0',source_reference:reason,reason}),employeeId:employee.id,kind:'roster'});
  const row=await rollout.prepareCoverage(pool,args(d));await rollout.approveCoverage(pool,{...args({snapshot_hash:row.snapshot_hash,reason},certifier),id:row.id});assert.equal((await rollout.previewWave(pool,user(hr),[employee.id])).ready,1);
  await l.addFoundationRecord(pool,{...args({day:'2026-10-07',paid_hours:'7',policy_days:'1',source_reference:reason,reason,supersedes_id:first.id}),employeeId:employee.id,kind:'roster'});assert.equal((await rollout.previewWave(pool,user(hr),[employee.id])).ready,0);
 });
 test('discarded coverage cannot be approved and restoring stale foundations still requires fresh review',async()=>{
  await pool.query('UPDATE hr_employee_service_periods SET is_teacher=TRUE WHERE employee_id=$1',[employee.id]);
  const d={coverage_id:randomUUID(),label:'Synthetic unwanted dated teacher coverage',employee_ids:[employee.id],effective_from:'2026-10-01',effective_to:'2026-11-30',source_reference:reason,reason},row=await rollout.prepareCoverage(pool,args(d));
  const drafts=await import('../services/governmentLeaveDrafts.js');await drafts.changeDraftState(pool,{...args({action:'discard',expected_revision:0,reason}),kind:'coverage',id:row.id});
  await assert.rejects(rollout.approveCoverage(pool,{...args({snapshot_hash:row.snapshot_hash,reason},certifier),id:row.id}),/discarded/);
  await pool.query('UPDATE hr_work_patterns SET hours_per_day=8 WHERE id=(SELECT work_pattern_id FROM hr_employee_service_periods WHERE employee_id=$1)',[employee.id]);
  await drafts.changeDraftState(pool,{...args({action:'restore',expected_revision:1,reason}),kind:'coverage',id:row.id});
  await assert.rejects(rollout.approveCoverage(pool,{...args({snapshot_hash:row.snapshot_hash,reason},certifier),id:row.id}),/coverage changed/);
 });
 test('a revoked Leave entry capability or unfinished password change blocks cohort readiness',async()=>{
  await readyEmployee();await pool.query("UPDATE reviewers SET permissions='{\"hr_access\":false,\"hr_leave_apply\":true}' WHERE id=$1",[owner.id]);
  assert.ok((await rollout.previewWave(pool,user(hr),[employee.id])).employees[0].issues.some(i=>i.includes('Leave access')));
  await pool.query("UPDATE reviewers SET permissions='{\"hr_access\":true,\"hr_leave_apply\":true}',must_change_password=TRUE WHERE id=$1",[owner.id]);
  assert.ok((await rollout.previewWave(pool,user(hr),[employee.id])).employees[0].issues.some(i=>i.includes('password change')));
 });
 test('review key cannot be reused for changed evidence',async()=>{
  const d=data(await payrollCycles());await prepare(d);await assert.rejects(prepare({...d,label:'Different department review'}),/different review facts/);
 });
 test('incomplete cohort may be frozen but cannot be approved',async()=>{
  const row=await prepare(data(await payrollCycles()));await assert.rejects(approve(row),/preparation issue/);
 });
 test('missing evidence or identical payroll cycles reject preparation',async()=>{
  const d=data(await payrollCycles());await assert.rejects(prepare({...d,evidence:{}}),/evidence/);
  await assert.rejects(prepare({...d,payroll_batch_ids:[d.payroll_batch_ids[0],d.payroll_batch_ids[0]]}),/distinct/);
 });
 test('changed employee facts invalidate review without ledger effects',async()=>{
  await readyEmployee();const row=await prepare(data(await payrollCycles()));await pool.query("UPDATE hr_employees SET display_name='Changed synthetic name' WHERE id=$1",[employee.id]);
  await assert.rejects(approve(row),/Payroll grants changed|Cohort facts changed/);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_rollout_approvals')).rows[0].n,0);
 });
 test('revoked approver capability fails fresh authority check',async()=>{
  await readyEmployee();const row=await prepare(data(await payrollCycles()));
  await pool.query("UPDATE reviewers SET permissions='{\"hr_leave_approve\":false}' WHERE id=(SELECT reviewer_id FROM hr_employees WHERE id=(SELECT approver_employee_id FROM hr_approval_assignments WHERE level='department' LIMIT 1))");
  await assert.rejects(approve(row),/preparation issue/);
 });
 test('self-approval officeholders require reviewed substitutes',async()=>{
  await readyEmployee();await pool.query("UPDATE hr_approval_assignments SET approver_employee_id=$1 WHERE level='division'",[employee.id]);
  const state=await rollout.previewWave(pool,user(hr),[employee.id]);assert.ok(state.employees[0].issues.some(i=>i.includes('Self-approval')));
 });
 test('changed or unacknowledged payroll blocks review',async()=>{
  await readyEmployee();const d=data(await payrollCycles()),row=await prepare(d);
  const original=(await pool.query("SELECT id FROM hr_gov_requests WHERE start_date='2026-11-02'")).rows[0];
  await pool.query('INSERT INTO hr_gov_case_effects(request_id,original_request_id,effect,recorded_by) VALUES($1,$1,$2,$3)',[original.id,{action:'cancel_grant'},hr.id]);
  await assert.rejects(approve(row),/Payroll grants changed/);
  const next=await p.preparePayroll(pool,args({batch_id:randomUUID(),period_start:'2026-11-01',period_end:'2026-11-14',source_reference:reason,reason}));
  await assert.rejects(prepare({...d,wave_id:randomUUID(),payroll_batch_ids:[next.id,d.payroll_batch_ids[1]]}),/reconciled register/);
 });
 test('non-central or revoked HR cannot read operational totals, prepare or export a review',async()=>{
  assert.equal((await http('/operations')).status,403);assert.equal((await http('/preview',owner,{employee_ids:[employee.id]})).status,403);
  const d=data(await payrollCycles()),row=await prepare(d);assert.equal((await http(`/waves/${row.id}/export`)).status,403);assert.equal((await http(`/waves/${row.id}/export`,hr)).status,200);
  const staleUser=user(hr);await pool.query("UPDATE reviewers SET permissions='{\"hr_admin\":false,\"hr_access\":true}' WHERE id=$1",[hr.id]);await assert.rejects(rollout.previewWave(pool,staleUser,[employee.id]),/central HR authority/);
 });
 test('cohort lists are bounded and invalid/duplicate selections reject',async()=>{
  await assert.rejects(rollout.previewWave(pool,user(hr),[employee.id,employee.id.toUpperCase()]),/distinct/);
  assert.equal((await rollout.previewWave(pool,user(hr),[employee.id.toUpperCase()])).employees[0].employee_id,employee.id);
  assert.equal((await http('/preview',hr,{employee_ids:[]})).status,422);assert.equal((await http('/waves?page=0',hr)).status,422);
  const response=await http('/operations',hr);assert.equal(response.status,200);assert.equal(response.body.schedulers.government,false);
 });
});

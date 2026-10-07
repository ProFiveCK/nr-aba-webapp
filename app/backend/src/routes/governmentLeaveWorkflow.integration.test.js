import {describe,test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {connectTestDatabase,resetLeaveTables,skipWithoutDatabase} from '../test-support/database.js';
import {DEFAULT_RULES} from '../lib/governmentLeaveRules.js';

describe('government common leave workflow and reviewed jobs',{skip:skipWithoutDatabase},()=>{
 let pool,w,l,jobs,auth,server,base,hr,certifier,owner,employee,department,division,officers,policy;
 const reason='Synthetic verified authority and evidence for local tests.';
 const user=row=>({...row,permissions:row.permissions});
 before(async()=>{
   pool=await connectTestDatabase();w=await import('../services/governmentLeaveWorkflow.js');l=await import('../services/governmentLeave.js');jobs=await import('../services/governmentLeaveJobs.js');auth=await import('../services/authService.js');
   const express=(await import('express')).default,errors=await import('../middleware/errors.js');errors.enableAsyncErrors();const app=express();app.use(express.json());app.use('/api/hr',(await import('./hr.js')).default);app.use(errors.notFoundHandler);app.use(errors.errorHandler);server=await new Promise(resolve=>{const running=app.listen(0,'127.0.0.1',()=>resolve(running));});base=`http://127.0.0.1:${server.address().port}`;
 });
 after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await pool?.end();});
 async function account(permissions,type='staff'){return(await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions,account_type) VALUES($1,'Synthetic workflow actor','user','x',$2,$3) RETURNING *",[`${randomUUID()}@example.test`,permissions,type])).rows[0];}
 async function opening(code,amount){const o=await l.prepareOpening(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{code,amount,policy_version_id:policy.id,period_start:'2026-01-01',period_end:'2026-12-31',as_of:'2026-10-01',source_reference:'Synthetic reviewed HR register',payroll_reference:'Synthetic Salary Unit reconciliation',reason}});await l.certifyOpening(pool,{user:user(certifier),actor:certifier,id:o.id,reason});}
 async function configure(codes=['recreation','medical','special'],history=[]){const row=await w.prepareConfiguration(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{enabled_codes:codes,medical_rule:'single_calendar_date_nonadjacent_scheduled_days',medical_history:history,source_reference:'Synthetic medical rule and cutover history approval',legacy_resolution_reference:'Synthetic legacy leave reconciled register',reason}});await w.publishConfiguration(pool,{user:user(certifier),actor:certifier,id:row.id,reason});return row;}
 const application=(code='recreation',start='2026-11-02',end=start)=>({request_id:randomUUID(),code,start_date:start,end_date:end,reason,medical_mode:code==='medical'?'exemption':'not_applicable'});
 async function submit(data=application(),documents=[]){return w.submitRequest(pool,{user:user(owner),actor:owner,employeeId:employee.id,data,documents});}
 async function decide(id,changes={},actor=null){const view=await w.requestView(pool,user(hr),id),stage=view.stages[view.stage_index];const by=actor||officers[stage.level].account;return w.decideRequest(pool,{user:user(by),actor:by,id,data:{stage_id:stage.id,binding_id:stage.binding?.id||randomUUID(),event_key:randomUUID(),decision:'approved',note:reason,evidence_reviewed:true,certificate_reviewed:true,justification_accepted:true,source_reference:'Synthetic registered-practitioner and HR verified source',covers_start:'2026-01-01',covers_end:'2026-12-31',...changes}});}
 async function grant(id){let result;for(let i=0;i<5;i++){const r=await w.getRequest(pool,id);if(r.status!=='pending')return r;result=await decide(id);}return result;}
 async function call(path,data,by=owner,method=data?'POST':'GET'){const session=await auth.createSession(by.id),token=auth.buildTokenPayload(by,session.tokenId,session.expiresAt);const response=await fetch(base+'/api/hr/government/workflow'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return {status:response.status,body:response.headers.get('content-type')?.includes('json')?await response.json():await response.arrayBuffer(),cache:response.headers.get('cache-control')};}
 beforeEach(async()=>{
  await resetLeaveTables(pool);await pool.query('TRUNCATE hr_gov_policy_versions,hr_gov_calendars,hr_gov_pattern_approvals CASCADE');
  hr=await account({hr_admin:true,hr_access:true,hr_report_read:true,hr_evidence_read:true});certifier=await account({hr_admin:true,hr_access:true});owner=await account({hr_access:true,hr_leave_apply:true},'employee');
  department=(await pool.query("INSERT INTO hr_departments(name) VALUES('Synthetic Government Workflow') RETURNING *")).rows[0];division=(await pool.query("INSERT INTO hr_divisions(name,department_id) VALUES('Synthetic Division',$1) RETURNING *",[department.id])).rows[0];
  employee=(await pool.query("INSERT INTO hr_employees(display_name,reviewer_id,department_id,division_id,department_code,division_code,leave_policy_regime) VALUES('Synthetic Government Applicant',$1,$2,$3,'Synthetic Government Workflow','Synthetic Division','government') RETURNING *",[owner.id,department.id,division.id])).rows[0];
  const pattern=(await pool.query("INSERT INTO hr_work_patterns(name,working_weekdays,hours_per_day) VALUES($1,ARRAY[1,2,3,4,5],7) RETURNING *",[`Synthetic Workflow Pattern ${randomUUID()}`])).rows[0];
  await pool.query("INSERT INTO hr_employee_service_periods(employee_id,start_date,employment_category,counts_for_service,work_pattern_id,reason) VALUES($1,'2026-01-01','permanent',TRUE,$2,$3)",[employee.id,pattern.id,reason]);
  await l.addFoundationRecord(pool,{user:user(hr),actor:hr,kind:'pattern',data:{work_pattern_id:pattern.id,source_reference:'Synthetic one policy day per standard scheduled day',reason}});
  await l.addFoundationRecord(pool,{user:user(hr),actor:hr,employeeId:employee.id,kind:'basis',data:{effective_from:'2026-01-01',continuity_start:'2026-01-01',anniversary_method:'calendar',leap_day_method:'feb28',schedule_mode:'weekly',source_reference:'Synthetic signed continuous service',reason}});
  policy=await l.createPolicy(pool,{user:user(hr),actor:hr,data:{label:'Synthetic common workflow policy',effective_from:'2026-01-01',effective_to:'2027-12-31',rules:DEFAULT_RULES,source_reference:'Synthetic typed policy authority',reason}});await l.publishPolicy(pool,{user:user(hr),actor:hr,id:policy.id,reason});
  await l.createCalendar(pool,{user:user(hr),actor:hr,data:{label:'Synthetic workflow calendar',effective_from:'2026-01-01',effective_to:'2027-12-31',holidays:[],source_reference:'Synthetic holiday Gazette reference',reason}});
  for(const [code,amount] of [['recreation','20'],['medical','10'],['special','3']])await opening(code,amount);
  officers={};
  for(const level of w.routeLevels('recreation')){
    const accountRow=level==='hr_verifier'?certifier:await account({hr_access:true,hr_leave_approve:true});
    const staff=(await pool.query("INSERT INTO hr_employees(display_name,reviewer_id,department_id,division_id) VALUES($1,$2,$3,$4) RETURNING *",[`Synthetic ${level}`,accountRow.id,department.id,division.id])).rows[0];officers[level]={account:accountRow,employee:staff};
    if(['division','department','chief_secretary'].includes(level))await pool.query("INSERT INTO hr_approval_assignments(level,department_id,division_id,approver_employee_id,effective_from,reason) VALUES($1,$2,$3,$4,'2026-01-01',$5)",[level,level==='chief_secretary'?null:department.id,level==='division'?division.id:null,staff.id,reason]);
    else await w.assignConsentOffice(pool,{user:user(hr),actor:hr,data:{level,department_id:level==='relevant_secretary'?department.id:null,approver_employee_id:staff.id,effective_from:'2026-01-01',source_reference:'Synthetic statutory office appointment',reason}});
  }
  await configure();
 });
 test('activation is independent and typed, preserves oversized historical balances, and pauses new submissions',async()=>{
  const draft=await w.prepareConfiguration(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{enabled_codes:[],medical_rule:'single_calendar_date_nonadjacent_scheduled_days',medical_history:[],source_reference:'Synthetic emergency pause',legacy_resolution_reference:'Reviewed baseline unchanged',reason}});
  await assert.rejects(w.publishConfiguration(pool,{user:user(hr),actor:hr,id:draft.id,reason}),e=>e.status===403);await w.publishConfiguration(pool,{user:user(certifier),actor:certifier,id:draft.id,reason});await assert.rejects(submit(),/not activated/);
  const special=(await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='special');await l.correctLedger(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{entitlement_id:special.id,amount:'2',effective_date:'2026-10-07',event_key:randomUUID(),source_reference:'Preserved signed historical transition credit',reason}});
  await assert.rejects(configure(['special']),/exceeds the standard/);assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='special').balance,'5.000000');
 });
 test('all required offices act in order; no administrator bypass; final grant posts once and PDF remains frozen',async()=>{
  const data=application(),r=await submit(data);assert.equal((await submit(data)).id,r.id);await assert.rejects(submit({...data,reason:'Changed submitted reason text'}),/request key/);
  assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='recreation').held,'1.000000');await assert.rejects(decide(r.id,{},hr),e=>e.status===403);
  const initial=await w.requestView(pool,user(hr),r.id),final=initial.stages.at(-1);await assert.rejects(w.decideRequest(pool,{user:user(officers.chief_secretary.account),actor:officers.chief_secretary.account,id:r.id,data:{stage_id:final.id,binding_id:final.binding.id,event_key:randomUUID(),decision:'approved',note:reason}}),/stage changed/);
  for(let i=0;i<4;i++)await decide(r.id);assert.equal((await w.getRequest(pool,r.id)).status,'pending');assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='recreation').balance,'20.000000');
  const last=await w.requestView(pool,user(hr),r.id),stage=last.stages[last.stage_index],decision={stage_id:stage.id,binding_id:stage.binding.id,event_key:randomUUID(),decision:'approved',note:reason};
  await w.decideRequest(pool,{user:user(officers.chief_secretary.account),actor:officers.chief_secretary.account,id:r.id,data:decision});await w.decideRequest(pool,{user:user(officers.chief_secretary.account),actor:officers.chief_secretary.account,id:r.id,data:decision});
  const granted=await w.getRequest(pool,r.id);assert.equal(granted.status,'approved');assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='recreation').balance,'19.000000');assert.ok(granted.final_pdf.subarray(0,5).toString()==='%PDF-');
  const bytes=Buffer.from(granted.final_pdf);await pool.query("UPDATE hr_employees SET display_name='Changed later profile' WHERE id=$1",[employee.id]);assert.deepEqual((await w.getRequest(pool,r.id)).final_pdf,bytes);await assert.rejects(pool.query("UPDATE hr_gov_requests SET charge=99 WHERE id=$1",[r.id]),/immutable/);
  await writeFile('/tmp/government-leave-package-3-approved.pdf',bytes);
 });
 test('rejection/cancellation releases once and a granted request cannot be erased; Secretary refusal needs consultation and alternative',async()=>{
  const r=await submit();await decide(r.id);await decide(r.id);await decide(r.id);
  await assert.rejects(decide(r.id,{decision:'rejected'}),/operational reasons/);await decide(r.id,{decision:'rejected',operational_refusal:true,alternative_date:'2026-12-01',consultation_reference:'Synthetic employee consultation and alternative agreed'});
  assert.equal((await w.getRequest(pool,r.id)).status,'rejected');assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='recreation').held,'0');
  const second=await submit(application('special'));await w.cancelRequest(pool,{user:user(owner),actor:owner,id:second.id,reason});await w.cancelRequest(pool,{user:user(owner),actor:owner,id:second.id,reason});await assert.rejects(decide(second.id),/already completed/);
  const third=await submit(application('special','2026-11-03'));await grant(third.id);await assert.rejects(w.cancelRequest(pool,{user:user(owner),actor:owner,id:third.id,reason}),/assisted amendment/);
 });
 test('temporary medical ten-day pool requires uploaded and verified certificate; HR checks complete date coverage',async()=>{
  await pool.query("UPDATE hr_employee_service_periods SET employment_category='temporary',is_intern=TRUE WHERE employee_id=$1",[employee.id]);
  const data={...application('medical','2026-11-02','2026-11-13'),medical_mode:'certificate'};await assert.rejects(submit(data),/Attach the medical certificate/);
  const doc={file_name:'synthetic.pdf',content_type:'application/pdf',byte_size:12,sha256:'synthetic-only',file_data:Buffer.from('%PDF-1.7\ntest')};const r=await submit(data,[doc]);assert.equal((await w.getRequest(pool,r.id)).charge,'10.000000');
  await decide(r.id);await decide(r.id);await assert.rejects(decide(r.id,{covers_end:'2026-11-03'}),/complete absence/);await decide(r.id);await decide(r.id);await decide(r.id);
  assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='medical').balance,'0.000000');
 });
 test('pending uncertified occasions reserve the counter, cancellation frees it, and roster adjacency rejects split absences',async()=>{
  const a=await submit(application('medical','2026-11-02')),b=await submit(application('medical','2026-11-04')),c=await submit(application('medical','2026-11-06'));
  await assert.rejects(submit(application('medical','2026-11-10')),/already committed/);
  await assert.rejects(submit({...application('medical','2026-11-09'),medical_mode:'certificate'},[{file_name:'synthetic.pdf',content_type:'application/pdf',byte_size:5,sha256:'example',file_data:Buffer.from('%PDF-')}]),/Adjacent/);
  await w.cancelRequest(pool,{user:user(owner),actor:owner,id:b.id,reason});const next=await submit(application('medical','2026-11-12'));assert.ok(next.id);await grant(a.id);await grant(c.id);
 });
 test('concurrent applications cannot overspend Special and overlap cannot be submitted across types',async()=>{
  const first=application('special','2026-11-02','2026-11-03'),second=application('special','2026-11-05','2026-11-06');const result=await Promise.allSettled([submit(first),submit(second)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  const r=result.find(r=>r.status==='fulfilled').value,stored=await w.getRequest(pool,r.id);await assert.rejects(submit(application('medical',stored.start_date)),/overlap/);
  await grant(r.id);const special=(await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='special');
  await l.correctLedger(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{entitlement_id:special.id,amount:'1',effective_date:'2026-10-07',event_key:randomUUID(),source_reference:'Synthetic unsupported extra annual Special credit',reason}});
  await assert.rejects(configure(['special']),/single annual pool/);
  await assert.rejects(submit(application('special','2026-11-12')),/single annual pool/);
 });
 test('placement transfer, revoked capability and calendar successor cannot silently change a pending grant',async()=>{
  const r=await submit();const old=await l.loadContext(pool,employee.id),calendar=old.calendars[0];await l.createCalendar(pool,{user:user(hr),actor:hr,data:{label:'Corrected synthetic calendar',effective_from:calendar.effective_from,effective_to:calendar.effective_to,holidays:[{date:'2026-11-02',name:'Synthetic added holiday'}],supersedes_id:calendar.id,source_reference:'Synthetic corrected gazette',reason}});
  await assert.rejects(decide(r.id),/no chargeable|calculation changed/);await w.cancelRequest(pool,{user:user(hr),actor:hr,id:r.id,reason});
  const second=await submit(application('special','2026-11-03'));await pool.query("UPDATE reviewers SET permissions=permissions||'{\"hr_leave_approve\":false}' WHERE id=$1",[officers.division.account.id]);await assert.rejects(decide(second.id),/capability/);
  await pool.query("UPDATE reviewers SET permissions=permissions||'{\"hr_leave_approve\":true}' WHERE id=$1",[officers.division.account.id]);await pool.query('UPDATE hr_employees SET division_id=NULL WHERE id=$1',[employee.id]);await assert.rejects(decide(second.id),/Placement changed/);await assert.rejects(w.requestView(pool,user(officers.division.account),second.id),/Request not found/);assert.equal((await call('/requests?mode=queue',null,officers.division.account)).body.total,0);
 });
 test('self-approval uses a signed substitute but Chief Secretary cannot be replaced with HOD delegation',async()=>{
  await pool.query('UPDATE hr_approval_assignments SET approver_employee_id=$1 WHERE level=\'division\'',[employee.id]);await pool.query("UPDATE reviewers SET permissions=permissions||'{\"hr_leave_approve\":true}' WHERE id=$1",[owner.id]);owner.permissions.hr_leave_approve=true;
  const r=await submit(),view=await w.requestView(pool,user(hr),r.id);assert.match(view.stages[0].issue,/Self-approval/);await assert.rejects(decide(r.id,{},owner),/Self-approval/);
  await w.rebindStage(pool,{user:user(hr),actor:hr,id:r.id,stageId:view.stages[0].id,data:{substitute_employee_id:officers.department.employee.id,source_reference:'Signed case-specific authorised division substitute',reason}});await decide(r.id,{},officers.department.account);
  await assert.rejects(w.rebindStage(pool,{user:user(hr),actor:hr,id:r.id,stageId:view.stages.at(-1).id,data:{substitute_employee_id:officers.department.employee.id,source_reference:'Attempted unsupported HOD delegation',reason}}),/Chief Secretary must/);
 });
 test('missing or expired officeholders are explicit, consent closures preserve history and rebinding is audited',async()=>{
  const secretary=(await pool.query("SELECT * FROM hr_gov_consent_offices WHERE level='relevant_secretary'")).rows[0];await w.closeConsentOffice(pool,{user:user(hr),actor:hr,id:secretary.id,data:{effective_to:'2026-10-01',reason}});
  const r=await submit(),view=await w.requestView(pool,user(hr),r.id);assert.match(view.stages.find(s=>s.level==='relevant_secretary').issue,/missing officeholder/);
  await w.assignConsentOffice(pool,{user:user(hr),actor:hr,data:{level:'relevant_secretary',department_id:department.id,approver_employee_id:officers.relevant_secretary.employee.id,effective_from:'2026-10-02',source_reference:'Signed replacement Secretary office',reason}});
  await w.rebindStage(pool,{user:user(hr),actor:hr,id:r.id,stageId:view.stages.find(s=>s.level==='relevant_secretary').id,data:{source_reference:'Reviewed replacement office for submitted route',reason}});await grant(r.id);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_consent_offices')).rows[0].n,3);
 });
 test('HTTP isolation: private reasons/files withheld from ordinary approvers, no clinical PDF bypass, paging and no client charge injection',async()=>{
  const data=application('medical','2026-11-02'),r=await submit(data);
  const outsider=await account({hr_access:true,hr_leave_approve:true,hr_report_read:true});assert.equal((await call(`/requests/${r.id}`,null,outsider)).status,404);
  const approver=await call(`/requests/${r.id}`,null,officers.division.account);assert.equal(approver.status,200);assert.equal(approver.body.reason,null);assert.deepEqual(approver.body.documents,[]);assert.equal(approver.cache,'no-store');
  const centralList=await call('/requests?mode=all&status=pending',null,hr);assert.equal(centralList.status,200);assert.equal(centralList.body.total,1);assert.equal(centralList.body.requests[0].id,r.id);
  assert.equal((await call(`/requests/${r.id}/documents/${randomUUID()}`,null,officers.division.account)).status,404);
  const mine=await call('/requests?mode=mine&status=all&page=1');assert.equal(mine.body.page_size,50);assert.equal(mine.body.requests.length,1);assert.equal(mine.body.requests[0].reason,undefined);
  const preview=await call('/preview',{...application('special','2026-11-05'),charge:0,notice_date:'2000-01-01'});assert.equal(preview.body.charge,'1.000000');
  await grant(r.id);
  const calendar=await call('/calendar?from=2026-11-01&to=2026-11-30',null,owner);assert.equal(calendar.status,200);assert.equal(calendar.body.entries[0].id,r.id);assert.equal(calendar.body.entries[0].leave_type_name,'Approved government leave');assert.equal(calendar.body.entries[0].reason,undefined);
  assert.equal((await call('/calendar?from=2026-11-01&to=2026-11-30',null,outsider)).body.entries.length,0);
  assert.equal((await call('/calendar?from=2026-11-01&to=2026-11-30',null,hr)).body.entries.length,1);
assert.equal((await call(`/requests/${r.id}/pdf`,null,officers.chief_secretary.account)).status,404);assert.equal((await call(`/requests/${r.id}/pdf`)).status,200);
  assert.equal((await call(`/requests/${r.id}/salary-acknowledgement`,{reference:'Synthetic Salary Unit register',reason},owner)).status,403);assert.equal((await call(`/requests/${r.id}/salary-acknowledgement`,{reference:'Synthetic Salary Unit register',reason},hr)).status,200);
 });
 test('audit failure rolls back final grant, postings, PDF and decision together',async()=>{
  const r=await submit();for(let i=0;i<4;i++)await decide(r.id);await pool.query(`CREATE FUNCTION synthetic_gov_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='hr.gov.stage.decided' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER synthetic_gov_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_gov_audit_failure()`);
  try{await assert.rejects(decide(r.id),/synthetic audit failure/);assert.equal((await w.getRequest(pool,r.id)).status,'pending');assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='recreation').balance,'20.000000');}finally{await pool.query('DROP TRIGGER synthetic_gov_audit_failure ON audit_log; DROP FUNCTION synthetic_gov_audit_failure()');}
  await decide(r.id);assert.equal((await w.getRequest(pool,r.id)).status,'approved');
 });
 async function plan(code='recreation'){const data={code,first_post_end:'2026-10-14',payroll_anchor:'2026-10-14',temporary_start:'appointment',source_reference:'Signed synthetic 26-period cumulative-floor and calendar proration approval',reason};const p=await jobs.prepareJobPlan(pool,{user:user(hr),actor:hr,employeeId:employee.id,data});await jobs.approveJobPlan(pool,{user:user(certifier),actor:certifier,id:p.id,reason});return p;}
 test('reviewed jobs require independent approval, do not forecast, preserve proration, cap-stop and retries',async()=>{
  assert.equal((await jobs.runEmployeeJobs(pool,{user:user(hr),actor:hr,employeeId:employee.id})).results.length,0);
  const p=await jobs.prepareJobPlan(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{code:'recreation',first_post_end:'2026-10-14',payroll_anchor:'2026-10-14',temporary_start:'appointment',source_reference:'Signed synthetic payroll configuration',reason}});await assert.rejects(jobs.approveJobPlan(pool,{user:user(hr),actor:hr,id:p.id,reason}),/different central/);await jobs.approveJobPlan(pool,{user:user(certifier),actor:certifier,id:p.id,reason});
  await assert.rejects(jobs.runEmployeeJobs(pool,{user:user(hr),actor:hr,employeeId:employee.id,asOf:'2099-01-01'}),/future entitlement/);
  const run=()=>jobs.runEmployeeJobs(pool,{user:user(hr),actor:hr,employeeId:employee.id,asOf:'2026-10-28',clockDate:'2026-10-28'});await Promise.all([run(),run()]);assert.equal((await pool.query("SELECT count(*)::int AS n FROM hr_gov_job_posts WHERE code='recreation'")).rows[0].n,2);
  assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='recreation').balance,'21.538461');
  const account=(await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='recreation');await l.correctLedger(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{entitlement_id:account.id,amount:'38.461539',effective_date:'2026-10-28',event_key:randomUUID(),source_reference:'Synthetic cap reconciliation',reason}});await jobs.runEmployeeJobs(pool,{user:user(hr),actor:hr,employeeId:employee.id,asOf:'2026-11-11',clockDate:'2026-11-11'});assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='recreation').balance,'60.000000');assert.equal((await pool.query('SELECT capped FROM hr_gov_job_posts ORDER BY event_date DESC LIMIT 1')).rows[0].capped,true);
 });
 test('annual Medical/Special reset expires unused balances, grants once, resets exemption baseline and retains holds until resolved',async()=>{
  await plan('medical');await plan('special');const pending=await submit(application('medical','2026-11-02'));
  await assert.rejects(jobs.runEmployeeJobs(pool,{user:user(hr),actor:hr,employeeId:employee.id,asOf:'2027-01-01',clockDate:'2027-01-01'}),/Pending leave still holds/);
  await w.cancelRequest(pool,{user:user(owner),actor:owner,id:pending.id,reason});const run=()=>jobs.runEmployeeJobs(pool,{user:user(hr),actor:hr,employeeId:employee.id,asOf:'2027-01-01',clockDate:'2027-01-01'});await run();await run();
  const accounts=(await l.loadContext(pool,employee.id)).entitlements;assert.equal(accounts.find(e=>e.code==='medical'&&e.period_start==='2026-01-01').balance,'0.000000');assert.equal(accounts.find(e=>e.code==='medical'&&e.period_start==='2027-01-01').balance,'10.000000');assert.equal(accounts.find(e=>e.code==='special'&&e.period_start==='2027-01-01').balance,'3.000000');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM hr_gov_job_posts WHERE event_kind='renewal'")).rows[0].n,2);
 });
 test('reviewed medical cutover history consumes exemptions and HTTP cannot omit its evidence route',async()=>{
  const history=[{start_date:'2026-09-01',end_date:'2026-09-01',uncertified:true},{start_date:'2026-09-03',end_date:'2026-09-03',uncertified:true},{start_date:'2026-09-07',end_date:'2026-09-07',uncertified:true}];
  await assert.rejects(configure(['medical'],history),/single annual pool/);
  const medical=(await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='medical');
  await l.correctLedger(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{entitlement_id:medical.id,amount:'-3',effective_date:'2026-10-07',event_key:randomUUID(),source_reference:'Synthetic corrected cutover subtracts three prior medical days',reason}});
  await configure(['medical'],history);
  await assert.rejects(submit(application('medical')),/already committed/);
  const missing=application('medical');delete missing.medical_mode;assert.equal((await call('/preview',missing)).status,422);
 });
 test('due runner requires published enabled plans, prorates the cutover, and records a system audit without duplicate postings',async()=>{
  const p=await jobs.prepareJobPlan(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{code:'recreation',first_post_end:'2026-10-07',payroll_anchor:'2026-10-07',temporary_start:'appointment',source_reference:'Signed synthetic payroll anchor and proration',reason}});
  assert.equal((await jobs.runDueGovernmentJobs(pool)).result.employees,0);
  await jobs.approveJobPlan(pool,{user:user(certifier),actor:certifier,id:p.id,reason});
  const first=await jobs.runDueGovernmentJobs(pool);assert.equal(first.acquired,true);assert.equal(first.result.changed,1);
  assert.equal((await pool.query("SELECT amount FROM hr_gov_job_posts WHERE event_kind='accrual'")).rows[0].amount,'0.384615');
  assert.equal((await jobs.runDueGovernmentJobs(pool)).result.changed,0);
  const entries=(await pool.query("SELECT actor_id,after FROM audit_log WHERE action='hr.gov.jobs.posted' AND entity_id=$1",[p.id])).rows;assert.equal(entries.length,1);assert.equal(entries[0].actor_id,null);assert.equal(entries[0].after.run_origin,'scheduler');
  await configure([]);assert.equal((await jobs.runDueGovernmentJobs(pool)).result.employees,0);
 });

 test('multipart submission validates actual file contents and reserves only server-owned charges for the signed-in employee',async()=>{
  const session=await auth.createSession(owner.id),token=auth.buildTokenPayload(owner,session.tokenId,session.expiresAt);
  async function upload(bytes,filename){const data=application('medical','2026-11-16'),form=new FormData();data.medical_mode='certificate';for(const [key,value] of Object.entries(data))form.set(key,value);form.set('charge','0');form.set('employee_id',officers.division.employee.id);form.set('status','approved');form.set('documents',new Blob([bytes],{type:'text/plain'}),filename);return fetch(base+'/api/hr/government/workflow/requests',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});}
  assert.equal((await upload('<script>untrusted</script>','fake.pdf')).status,400);
  assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='medical').held,'0');
  assert.equal((await upload(Buffer.alloc(5*1024*1024+1),'oversized.pdf')).status,413);
  const accepted=await upload('%PDF-1.7 synthetic certificate pending human review','synthetic.pdf');assert.equal(accepted.status,201);const result=await accepted.json(),view=await w.requestView(pool,user(owner),result.id);
  assert.equal(view.status,'pending');assert.equal(view.employee_id,employee.id);assert.equal(view.charge,'1.000000');assert.equal(view.documents.length,1);assert.equal(view.documents[0].content_type,'application/pdf');
  const forbidden=await call(`/requests/${result.id}/documents/${view.documents[0].id}`,null,officers.division.account);assert.equal(forbidden.status,404);
  assert.equal((await call(`/requests/${result.id}/documents/${view.documents[0].id}`)).status,200);
 });

 test('submission proceeds alongside another office snapshot reader without a global exclusive write lock',async()=>{
  const officeReader=await pool.connect();let timer,submitted;
  try {
    await officeReader.query('BEGIN');await officeReader.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-approval-assignments'))");
    submitted=submit(application('special','2026-11-20'));
    const request=await Promise.race([submitted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Independent office snapshot reader blocked submission')),2000);})]);
    assert.equal((await w.getRequest(pool,request.id)).status,'pending');
  }finally{clearTimeout(timer);await officeReader.query('ROLLBACK');officeReader.release();await submitted;}
 });

});

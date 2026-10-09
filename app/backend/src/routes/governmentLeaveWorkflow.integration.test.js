import {describe,test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {connectTestDatabase,resetLeaveTables,skipWithoutDatabase} from '../test-support/database.js';
import {DEFAULT_RULES} from '../lib/governmentLeaveRules.js';

describe('government common leave workflow and reviewed jobs',{skip:skipWithoutDatabase},()=>{
 let pool,w,l,jobs,routes,commission,auth,server,base,hr,certifier,owner,employee,department,division,officers,policy;
 const reason='Synthetic verified authority and evidence for local tests.';
 const user=row=>({...row,permissions:row.permissions});
 before(async()=>{
   pool=await connectTestDatabase();routes=await import('../services/governmentLeaveApprovalRoutes.js');commission=await import('../services/governmentLeaveCommissioning.js');w=await import('../services/governmentLeaveWorkflow.js');l=await import('../services/governmentLeave.js');jobs=await import('../services/governmentLeaveJobs.js');auth=await import('../services/authService.js');
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
 async function customRoute(stages=[{level:'department',label:'Treasury Head of Department'}],departmentId=department.id,expected=null){return routes.publishApprovalRoute(pool,{user:user(hr),actor:hr,data:{department_id:departmentId,expected_latest_id:expected,stages,source_reference:'Synthetic authorised Treasury route',reason}});}
 async function evidence(id,by=hr,changes={}){return w.verifyRequestEvidence(pool,{user:user(by),actor:by,id,data:{reason,evidence_reviewed:true,certificate_reviewed:true,justification_accepted:true,source_reference:'Synthetic independently verified personnel evidence',covers_start:'2026-01-01',covers_end:'2026-12-31',...changes}});}
 test('one nominated HoD grants once after separate private HR evidence verification',async()=>{
  const route=await customRoute(),r=await submit(application('special','2026-11-02'));
  const initial=await w.requestView(pool,user(hr),r.id);assert.equal(initial.stages.length,1);assert.equal(initial.stages[0].label,'Treasury Head of Department');assert.equal(initial.approval_route.id,route.id);assert.equal(initial.evidence_review_required,true);
  await assert.rejects(decide(r.id),/HR evidence verification is missing/);assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='special').balance,'3.000000');assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_decisions WHERE request_id=$1',[r.id])).rows[0].n,0);
  await assert.rejects(evidence(r.id,owner),e=>e.status===403);await assert.rejects(evidence(r.id,officers.department.account),e=>e.status===403);
  await evidence(r.id);await evidence(r.id);assert.equal((await call(`/requests/${r.id}`,null,officers.department.account)).body.reason,null);
  await decide(r.id);const granted=await w.getRequest(pool,r.id);assert.equal(granted.status,'approved');assert.equal(granted.grant_snapshot.stages.length,1);assert.equal(granted.grant_snapshot.evidence_review.actor_id,hr.id);assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='special').balance,'2.000000');assert.ok(granted.final_pdf.length>100);
 });
 test('a configured one-level Recreation route needs only its nominated final approver',async()=>{
  await customRoute();const r=await submit(),view=await w.requestView(pool,user(hr),r.id);assert.equal(view.stages.length,1);assert.equal(view.evidence_review_required,false);assert.equal(view.can_verify_evidence,false);await decide(r.id);assert.equal((await w.getRequest(pool,r.id)).status,'approved');assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_decisions WHERE request_id=$1',[r.id])).rows[0].n,1);
 });
 test('one division level selects each division nominee and grants once without a HoD stage',async()=>{
  const otherDivision=(await pool.query("INSERT INTO hr_divisions(name,department_id) VALUES('Synthetic second division',$1) RETURNING *",[department.id])).rows[0];
  const otherAccount=await account({hr_access:true,hr_leave_approve:true});
  const otherEmployee=(await pool.query("INSERT INTO hr_employees(display_name,reviewer_id,department_id,division_id) VALUES('Synthetic second division approver',$1,$2,$3) RETURNING *",[otherAccount.id,department.id,otherDivision.id])).rows[0];
  await pool.query("INSERT INTO hr_approval_assignments(level,department_id,division_id,approver_employee_id,effective_from,reason) VALUES('division',$1,$2,$3,'2026-01-01',$4)",[department.id,otherDivision.id,otherEmployee.id,reason]);
  await customRoute([{level:'division',label:'Divisional Chief'}]);
  const first=await submit(),firstView=await w.requestView(pool,user(hr),first.id);
  assert.deepEqual(firstView.stages.map(s=>s.level),['division']);assert.equal(firstView.stages[0].binding.reviewer_id,officers.division.account.id);
  await assert.rejects(decide(first.id,{},otherAccount),e=>e.status===403);
  await assert.rejects(decide(first.id,{},officers.department.account),e=>e.status===403);
  await decide(first.id,{},officers.division.account);const firstGranted=await w.getRequest(pool,first.id);
  assert.equal(firstGranted.status,'approved');assert.equal(firstGranted.grant_snapshot.stages.length,1);assert.ok(firstGranted.final_pdf.length>100);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_decisions WHERE request_id=$1',[first.id])).rows[0].n,1);
  await pool.query('UPDATE hr_employees SET division_id=$2,division_code=$3 WHERE id=$1',[employee.id,otherDivision.id,otherDivision.name]);
  const second=await submit(application('recreation','2026-11-05')),secondView=await w.requestView(pool,user(hr),second.id);
  assert.deepEqual(secondView.stages.map(s=>s.level),['division']);assert.equal(secondView.stages[0].binding.reviewer_id,otherAccount.id);
  await assert.rejects(decide(second.id,{},officers.division.account),e=>e.status===403);
  await decide(second.id,{},otherAccount);assert.equal((await w.getRequest(pool,second.id)).status,'approved');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_decisions WHERE request_id=$1',[second.id])).rows[0].n,1);
 });
 test('two levels remain ordered and revisions affect new applications only',async()=>{
  const two=[{level:'division',label:'Treasury first approver'},{level:'department',label:'Treasury HoD'}],route=await customRoute(two),r=await submit();
  await customRoute([{level:'department',label:'Revised HoD'}],department.id,route.id);
  await assert.rejects(customRoute(two,department.id,route.id),/route changed/);
  const old=await w.requestView(pool,user(hr),r.id);assert.deepEqual(old.stages.map(s=>s.label),two.map(s=>s.label));await assert.rejects(decide(r.id,{},officers.department.account),e=>e.status===403);
  await decide(r.id);await decide(r.id);assert.equal((await w.getRequest(pool,r.id)).status,'approved');
  const next=await submit(application('special','2026-11-05'));assert.deepEqual((await w.requestView(pool,user(hr),next.id)).stages.map(s=>s.label),['Revised HoD']);
 });
 test('route configuration validates scope and duplicate levels, retains revisions, and fails closed on stale authority',async()=>{
  const data={department_id:department.id,stages:[{level:'department',label:'HoD'}],source_reference:'Synthetic signed route',reason};
  assert.equal((await call('/approval-route',data,owner)).status,403);assert.equal((await call('/approval-route',{...data,stages:[data.stages[0],data.stages[0]]},hr)).status,400);
  await customRoute(undefined,null);const effective=await routes.approvalRouteSettings(pool,department.id);assert.equal(effective.latest,null);assert.equal(effective.effective.configured,true);
  const r=await submit(application('medical','2026-11-02')),hrEntry=await pool.query('SELECT reviewer_id FROM hr_employees WHERE id=$1',[employee.id]);assert.equal(hrEntry.rows[0].reviewer_id,owner.id);
  await assert.rejects(evidence(r.id,hr,{evidence_reviewed:false}),/confirm the source/);await evidence(r.id);
  await pool.query("UPDATE reviewers SET permissions=permissions||'{\"hr_admin\":false}'::jsonb WHERE id=$1",[hr.id]);await assert.rejects(decide(r.id),/verifier.*authority changed/);
 });
 test('short-route certificate review checks complete coverage and self-review, and evidence audit failure rolls back',async()=>{
  await customRoute();const r=await submit({...application('medical','2026-11-02'),medical_mode:'certificate'},[{file_name:'synthetic.pdf',content_type:'application/pdf',byte_size:5,sha256:'synthetic-certificate',file_data:Buffer.from('%PDF-')}]);
  await assert.rejects(evidence(r.id,hr,{covers_end:'2026-11-01'}),/complete absence/);
  await pool.query("CREATE FUNCTION synthetic_evidence_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='hr.gov.evidence.verified' THEN RAISE EXCEPTION 'synthetic evidence audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER synthetic_evidence_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_evidence_failure()");
  try{await assert.rejects(evidence(r.id),/synthetic evidence audit failure/);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_evidence_reviews')).rows[0].n,0);}finally{await pool.query('DROP TRIGGER synthetic_evidence_failure ON audit_log; DROP FUNCTION synthetic_evidence_failure()');}
  await evidence(r.id);await decide(r.id);assert.equal((await w.getRequest(pool,r.id)).status,'approved');
  await pool.query('UPDATE hr_employees SET reviewer_id=$1 WHERE id=$2',[hr.id,employee.id]);const assisted=await w.submitRequest(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{...application('special','2026-11-05'),assisted_reference:'Synthetic authorised assisted entry'}});await assert.rejects(evidence(assisted.id),/different HR officer/);
 });
 async function commissioningFixture(){
  await pool.query('TRUNCATE hr_gov_openings,hr_gov_workflow_configs,hr_gov_initial_setups CASCADE');await pool.query("UPDATE hr_employees SET leave_policy_regime='legacy' WHERE id=$1",[employee.id]);
  await pool.query("INSERT INTO hr_employee_external_ids(employee_id,source,external_id,verified_by,reason) VALUES($1,'techone_payroll','SYNTHETIC-TREASURY-01',$2,$3)",[employee.id,hr.id,reason]);
  const mappings=[];for(const [name,code,amount] of [['Synthetic Annual source','recreation','20'],['Synthetic certificate source','medical','7'],['Synthetic uncertified source','medical','3'],['Synthetic Special source','special','5']]){
   const type=(await pool.query('INSERT INTO hr_leave_types(name,default_days,is_active) VALUES($1,0,TRUE) ON CONFLICT(name) DO UPDATE SET is_active=TRUE RETURNING *',[name])).rows[0];mappings.push({leave_type_id:type.id,code});await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance) VALUES($1,$2,2026,$3)',[employee.id,type.id,amount]);
  }
  await pool.query("INSERT INTO hr_gov_initial_setups(status,plan,source_hash,summary,prepared_by,updated_by,reason) VALUES('adopted',$1,'synthetic','{}',$2,$2,$3)",[{policy_id:policy.id,start_date:'2026-10-01',mappings},hr.id,reason]);await customRoute();
  return {employees:[{employee_id:employee.id,medical_history:[]}],cutover_date:'2026-10-01',history_confirmed:true,source_reference:'Synthetic Treasury source register',payroll_reference:'Synthetic independently checked payroll balance',transition_reference:'Synthetic adopted full-credit transition',history_reference:'Synthetic complete zero-absence Medical review',reason};
 }
 test('initial admin migrates existing credits without Payroll IDs and approves only the first accrual plan',async()=>{
  const data={...await commissioningFixture(),initial_admin_setup:true};
  await assert.rejects(commission.previewCommissioning(pool,{user:user(hr),data}),e=>e.status===403);
  await pool.query("UPDATE reviewers SET role='admin' WHERE id=$1",[hr.id]);hr.role='admin';
  await pool.query('DELETE FROM hr_employee_external_ids WHERE employee_id=$1',[employee.id]);
  const before=(await pool.query('SELECT * FROM hr_leave_balances ORDER BY id')).rows;
  const preview=await commission.previewCommissioning(pool,{user:user(hr),data});assert.equal(preview.ready,1,preview.employees[0].issues.join(' '));assert.ok(preview.employees[0].warnings.some(v=>/Payroll/.test(v)));
  const review=await commission.prepareCommissioning(pool,{user:user(hr),actor:hr,data:{...data,snapshot_hash:preview.snapshot_hash}});
  await assert.rejects(commission.applyCommissioning(pool,{user:user(certifier),actor:certifier,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}}),e=>e.status===403);
  const args={user:user(hr),actor:hr,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}};
  const receipt=await commission.applyCommissioning(pool,args);assert.equal(receipt.result.length,1);assert.equal((await commission.applyCommissioning(pool,args)).id,receipt.id);
  assert.deepEqual((await pool.query('SELECT * FROM hr_leave_balances ORDER BY id')).rows,before);
  assert.deepEqual((await l.loadContext(pool,employee.id)).entitlements.map(e=>e.balance).sort(),['10.000000','20.000000','5.000000']);
  const planData={code:'medical',source_reference:'Synthetic initial renewal setup',reason};
  const initial=await jobs.prepareJobPlan(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:planData});assert.equal(initial.initial_setup_review_id,review.id);
  await jobs.approveJobPlan(pool,{user:user(hr),actor:hr,id:initial.id,reason});
  const later=await jobs.prepareJobPlan(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:planData});assert.equal(later.initial_setup_review_id,null);
  await assert.rejects(jobs.approveJobPlan(pool,{user:user(hr),actor:hr,id:later.id,reason}),/different central/);
 });
 test('Temporary cohort carries Medical and Special only, retains Annual history and cannot submit or accrue Recreation',async()=>{
  const data={...await commissioningFixture(),initial_admin_setup:true};await pool.query("UPDATE reviewers SET role='admin' WHERE id=$1",[hr.id]);hr.role='admin';
  await pool.query("UPDATE hr_employee_service_periods SET employment_category='temporary' WHERE employee_id=$1",[employee.id]);
  const before=(await pool.query('SELECT * FROM hr_leave_balances ORDER BY id')).rows;
  const preview=await commission.previewCommissioning(pool,{user:user(hr),data});assert.equal(preview.ready,1,preview.employees[0].issues.join(' '));
  assert.deepEqual(preview.employees[0].enabled_codes,['medical','special']);assert.deepEqual(preview.employees[0].targets.map(t=>t.code),['medical','special']);assert.equal(preview.employees[0].excluded_targets[0].sources[0].balance,'20.00');
  const review=await commission.prepareCommissioning(pool,{user:user(hr),actor:hr,data:{...data,snapshot_hash:preview.snapshot_hash}});
  await pool.query("UPDATE hr_employee_service_periods SET employment_category='permanent' WHERE employee_id=$1",[employee.id]);
  await assert.rejects(commission.applyCommissioning(pool,{user:user(hr),actor:hr,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}}),/changed/);
  await pool.query("UPDATE hr_employee_service_periods SET employment_category='temporary' WHERE employee_id=$1",[employee.id]);
  await pool.query("CREATE FUNCTION synthetic_temporary_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='hr.gov.commissioning.applied' THEN RAISE EXCEPTION 'synthetic temporary failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER synthetic_temporary_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_temporary_failure()");
  try{await assert.rejects(commission.applyCommissioning(pool,{user:user(hr),actor:hr,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}}),/synthetic temporary failure/);assert.equal((await l.loadContext(pool,employee.id)).employee.leave_policy_regime,'legacy');assert.equal((await l.loadContext(pool,employee.id)).entitlements.length,0);}finally{await pool.query('DROP TRIGGER synthetic_temporary_failure ON audit_log; DROP FUNCTION synthetic_temporary_failure()');}
  const receipt=await commission.applyCommissioning(pool,{user:user(hr),actor:hr,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}});assert.deepEqual(receipt.result[0].enabled_codes,['medical','special']);
  assert.deepEqual((await commission.applyCommissioning(pool,{user:user(hr),actor:hr,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}})).result,receipt.result);
  assert.deepEqual((await w.configurationFor(pool,employee.id)).enabled_codes,['medical','special']);assert.deepEqual((await l.loadContext(pool,employee.id)).entitlements.map(t=>t.code).sort(),['medical','special']);
  assert.deepEqual((await pool.query('SELECT * FROM hr_leave_balances ORDER BY id')).rows,before);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM hr_gov_credit_transfers WHERE code='recreation'")).rows[0].n,0);
  const {employeeReadiness}=await import('../services/governmentLeaveRollout.js');
  const readiness=await employeeReadiness(pool,employee.id);assert.equal(readiness.ready,true,readiness.issues.join(' '));
  await assert.rejects(submit(application('recreation')),/not activated/);
  await assert.rejects(jobs.prepareJobPlan(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{code:'recreation',source_reference:'Synthetic excluded Annual job attempt',reason}}),/opening/);
  const medical=await submit(application('medical'));await evidence(medical.id);await decide(medical.id);assert.equal((await w.getRequest(pool,medical.id)).status,'approved');assert.ok((await w.getRequest(pool,medical.id)).final_pdf.length>100);
  const special=await submit(application('special','2026-11-05'));await evidence(special.id);await decide(special.id);assert.equal((await w.getRequest(pool,special.id)).status,'approved');
  assert.deepEqual((await pool.query('SELECT * FROM hr_leave_balances ORDER BY id')).rows,before);
 });
 test('Temporary migration needs no Annual source, still checks Special and reservations, and rejects invalid partial targets',async()=>{
  const data={...await commissioningFixture(),initial_admin_setup:true};await pool.query("UPDATE reviewers SET role='admin' WHERE id=$1",[hr.id]);hr.role='admin';
  const payroll=await import('../services/governmentLeavePayroll.js');
  const original=await commission.previewCommissioning(pool,{user:user(hr),data}),pair=original.employees[0].targets.filter(t=>t.code!=='recreation');
  const perma=(await payroll.migrationState(pool,employee.id,data.cutover_date)).state;perma.context.employee.leave_policy_regime='government';
  assert.throws(()=>payroll.migrationPlan(perma,{...data,targets:pair,dispositions:[]}),e=>e.status===400);
  await pool.query("UPDATE hr_employee_service_periods SET employment_category='temporary' WHERE employee_id=$1",[employee.id]);
  const state=(await payroll.migrationState(pool,employee.id,data.cutover_date)).state;state.context.employee.leave_policy_regime='government';
  assert.equal(payroll.migrationPlan(state,{...data,targets:pair,dispositions:[]}).targets.length,2);
  for(const targets of [pair.slice(0,1),[pair[0],pair[0]],[]])assert.throws(()=>payroll.migrationPlan(state,{...data,targets,dispositions:[]}),e=>e.status===400);
  const annual=(await pool.query("SELECT b.* FROM hr_leave_balances b JOIN hr_leave_types t ON t.id=b.leave_type_id WHERE b.employee_id=$1 AND t.name='Synthetic Annual source'",[employee.id])).rows[0];
  await pool.query('DELETE FROM hr_leave_balances WHERE id=$1',[annual.id]);
  const missingAnnual=await commission.previewCommissioning(pool,{user:user(hr),data});assert.equal(missingAnnual.ready,1,missingAnnual.employees[0].issues.join(' '));assert.equal(missingAnnual.employees[0].excluded_targets[0].sources.length,0);
  const {recordInitialCredit}=await import('../services/governmentLeaveInitialFoundations.js');await assert.rejects(recordInitialCredit(pool,{user:user(hr),actor:hr,data:{employee_id:employee.id,leave_type_id:annual.leave_type_id,amount:'0',year:2026,source_reference:'Synthetic excluded Annual entry',reason}}),/Annual source credit is not required/);
  await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance,pending) VALUES($1,$2,2026,0.77,1)',[employee.id,annual.leave_type_id]);
  const reserved=await commission.previewCommissioning(pool,{user:user(hr),data});assert.equal(reserved.ready,0);assert.match(reserved.employees[0].issues.join(' '),/recreation pending reservation/);
  await pool.query('UPDATE hr_leave_balances SET pending=0 WHERE employee_id=$1',[employee.id]);
  await pool.query("DELETE FROM hr_leave_balances WHERE employee_id=$1 AND leave_type_id IN (SELECT id FROM hr_leave_types WHERE name='Synthetic Special source')",[employee.id]);
  const missingSpecial=await commission.previewCommissioning(pool,{user:user(hr),data});assert.equal(missingSpecial.ready,0);assert.match(missingSpecial.employees[0].issues.join(' '),/stored special credit/);assert.doesNotMatch(missingSpecial.employees[0].issues.join(' '),/stored recreation credit/);
 });
 test('initial admin mode rechecks authority and rolls back its entire migration on failure',async()=>{
  const data={...await commissioningFixture(),initial_admin_setup:true};await pool.query("UPDATE reviewers SET role='admin' WHERE id=$1",[hr.id]);hr.role='admin';
  const preview=await commission.previewCommissioning(pool,{user:user(hr),data}),review=await commission.prepareCommissioning(pool,{user:user(hr),actor:hr,data:{...data,snapshot_hash:preview.snapshot_hash}}),args={user:user(hr),actor:hr,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}};
  await pool.query("UPDATE reviewers SET role='user' WHERE id=$1",[hr.id]);await assert.rejects(commission.applyCommissioning(pool,args),e=>e.status===403);await pool.query("UPDATE reviewers SET role='admin' WHERE id=$1",[hr.id]);
  await pool.query('UPDATE hr_leave_balances SET balance=balance+1 WHERE employee_id=$1',[employee.id]);await assert.rejects(commission.applyCommissioning(pool,args),/changed/);await pool.query('UPDATE hr_leave_balances SET balance=balance-1 WHERE employee_id=$1',[employee.id]);
  await pool.query("CREATE FUNCTION synthetic_admin_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='hr.gov.commissioning.applied' THEN RAISE EXCEPTION 'synthetic admin failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER synthetic_admin_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_admin_failure()");
  try{await assert.rejects(commission.applyCommissioning(pool,args),/synthetic admin failure/);assert.equal((await l.loadContext(pool,employee.id)).employee.leave_policy_regime,'legacy');assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_credit_transfers')).rows[0].n,0);}finally{await pool.query('DROP TRIGGER synthetic_admin_failure ON audit_log; DROP FUNCTION synthetic_admin_failure()');}
  await commission.applyCommissioning(pool,args);
 });
 test('initial foundations require verified dates and schedule and retain current staff and credits',async()=>{
  await commissioningFixture();await pool.query("UPDATE reviewers SET role='admin' WHERE id=$1",[hr.id]);hr.role='admin';
  const foundations=await import('../services/governmentLeaveInitialFoundations.js');
  const pattern=(await pool.query('SELECT work_pattern_id FROM hr_employee_service_periods WHERE employee_id=$1',[employee.id])).rows[0].work_pattern_id;
  await pool.query('TRUNCATE hr_employee_service_periods,hr_gov_service_bases CASCADE');
  const data={employees:[{employee_id:employee.id,service_start:'2026-01-01'}],effective_from:'2026-10-01',employment_category:'permanent',anniversary_method:'calendar',leap_day_method:'feb28',work_pattern_id:pattern,source_reference:'Synthetic verified appointment record',facts_confirmed:true,reason};
  const before=(await pool.query('SELECT * FROM hr_employees WHERE id=$1',[employee.id])).rows[0],balances=(await pool.query('SELECT * FROM hr_leave_balances ORDER BY id')).rows;
  await assert.rejects(foundations.previewInitialFoundations(pool,{user:user(certifier),data}),e=>e.status===403);
  const missing=await foundations.previewInitialFoundations(pool,{user:user(hr),data:{...data,employees:[{employee_id:employee.id,service_start:''}]}});assert.equal(missing.ready,0);
  const preview=await foundations.previewInitialFoundations(pool,{user:user(hr),data});assert.equal(preview.ready,1);
  await assert.rejects(foundations.applyInitialFoundations(pool,{user:user(hr),actor:hr,data:{...data,snapshot_hash:'stale'}}),/changed/);
  await pool.query("CREATE FUNCTION synthetic_foundations_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='hr.gov.initial_foundations.applied' THEN RAISE EXCEPTION 'synthetic foundations failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER synthetic_foundations_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_foundations_failure()");
  try{await assert.rejects(foundations.applyInitialFoundations(pool,{user:user(hr),actor:hr,data:{...data,snapshot_hash:preview.snapshot_hash}}),/synthetic foundations failure/);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_employee_service_periods WHERE employee_id=$1',[employee.id])).rows[0].n,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_service_bases WHERE employee_id=$1',[employee.id])).rows[0].n,0);}finally{await pool.query('DROP TRIGGER synthetic_foundations_failure ON audit_log; DROP FUNCTION synthetic_foundations_failure()');}
  assert.equal((await foundations.applyInitialFoundations(pool,{user:user(hr),actor:hr,data:{...data,snapshot_hash:preview.snapshot_hash}})).prepared,1);
  assert.deepEqual((await pool.query('SELECT * FROM hr_employees WHERE id=$1',[employee.id])).rows[0],before);assert.deepEqual((await pool.query('SELECT * FROM hr_leave_balances ORDER BY id')).rows,balances);
  const again=await foundations.previewInitialFoundations(pool,{user:user(hr),data});assert.equal(again.ready,0);assert.match(again.employees[0].issues.join(' '),/already exists/);
 });
 test('initial import reuses database dates, detects changed dates and preserves staff and balances',async()=>{
  await commissioningFixture();await pool.query("UPDATE reviewers SET role='admin' WHERE id=$1",[hr.id]);hr.role='admin';
  const foundations=await import('../services/governmentLeaveInitialFoundations.js');
  const pattern=(await pool.query('SELECT work_pattern_id FROM hr_employee_service_periods WHERE employee_id=$1',[employee.id])).rows[0].work_pattern_id;
  await pool.query('TRUNCATE hr_employee_service_periods,hr_gov_service_bases CASCADE');
  const data={reuse_recorded_dates:true,employees:[{employee_id:employee.id,service_start:'1900-01-01'}],effective_from:'2026-10-01',employment_category:'permanent',anniversary_method:'calendar',leap_day_method:'mar1',work_pattern_id:pattern,source_reference:'Synthetic existing personnel register',facts_confirmed:true,reason};
  const missing=await foundations.previewInitialFoundations(pool,{user:user(hr),data:{...data,employees:[{employee_id:employee.id}]}});assert.equal(missing.ready,0);
  const entered=await foundations.previewInitialFoundations(pool,{user:user(hr),data});assert.equal(entered.ready,1);assert.equal(entered.employees[0].date_source,'entered_date');
  await pool.query("UPDATE hr_employees SET join_date='2026-01-01' WHERE id=$1",[employee.id]);
  const before=(await pool.query('SELECT * FROM hr_employees WHERE id=$1',[employee.id])).rows[0],balances=(await pool.query('SELECT * FROM hr_leave_balances ORDER BY id')).rows;
  const preview=await foundations.previewInitialFoundations(pool,{user:user(hr),data});assert.equal(preview.ready,1);assert.equal(preview.employees[0].service_start,'2026-01-01');assert.equal(preview.employees[0].date_source,'existing_register');
  await pool.query("UPDATE hr_employees SET join_date='2026-01-02' WHERE id=$1",[employee.id]);
  await assert.rejects(foundations.applyInitialFoundations(pool,{user:user(hr),actor:hr,data:{...data,snapshot_hash:preview.snapshot_hash}}),/changed/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_employee_service_periods WHERE employee_id=$1',[employee.id])).rows[0].n,0);
  await pool.query("UPDATE hr_employees SET join_date='2026-01-01' WHERE id=$1",[employee.id]);
  assert.equal((await foundations.applyInitialFoundations(pool,{user:user(hr),actor:hr,data:{...data,snapshot_hash:preview.snapshot_hash}})).prepared,1);
  const period=(await pool.query("SELECT to_char(start_date,'YYYY-MM-DD') AS start_date,work_pattern_id FROM hr_employee_service_periods WHERE employee_id=$1",[employee.id])).rows[0];assert.equal(period.start_date,'2026-01-01');assert.equal(period.work_pattern_id,pattern);
  const basis=(await pool.query("SELECT to_char(continuity_start,'YYYY-MM-DD') AS continuity_start FROM hr_gov_service_bases WHERE employee_id=$1",[employee.id])).rows[0];assert.equal(basis.continuity_start,'2026-01-01');
  const audit=(await pool.query("SELECT after FROM audit_log WHERE action='hr.gov.initial_foundations.applied' ORDER BY id DESC LIMIT 1")).rows[0].after;assert.equal(audit.employees[0].service_start,'2026-01-01');assert.equal(audit.employees[0].date_source,'existing_register');
  assert.deepEqual((await pool.query('SELECT * FROM hr_employees WHERE id=$1',[employee.id])).rows[0],before);assert.deepEqual((await pool.query('SELECT * FROM hr_leave_balances ORDER BY id')).rows,balances);
 });
 test('initial source credit records an actual missing amount, never seeds a default or overwrites history',async()=>{
  const data=await commissioningFixture();await pool.query("UPDATE reviewers SET role='admin' WHERE id=$1",[hr.id]);hr.role='admin';
  const source=(await pool.query("SELECT b.*,t.name FROM hr_leave_balances b JOIN hr_leave_types t ON t.id=b.leave_type_id WHERE employee_id=$1 AND t.name='Synthetic Special source'",[employee.id])).rows[0];await pool.query('DELETE FROM hr_leave_balances WHERE id=$1',[source.id]);
  const {recordInitialCredit}=await import('../services/governmentLeaveInitialFoundations.js');
  const input={employee_id:employee.id,leave_type_id:source.leave_type_id,year:2026,amount:'5',source_reference:'Synthetic actual missing source credit',reason},args={user:user(hr),actor:hr,data:input};
  await assert.rejects(recordInitialCredit(pool,{user:user(certifier),actor:certifier,data:input}),e=>e.status===403);
  await assert.rejects(recordInitialCredit(pool,{...args,data:{...input,amount:''}}),e=>e.status===400);
  await pool.query("CREATE FUNCTION synthetic_credit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='hr.gov.initial_credit.recorded' THEN RAISE EXCEPTION 'synthetic credit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER synthetic_credit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_credit_failure()");
  try{await assert.rejects(recordInitialCredit(pool,args),/synthetic credit failure/);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_leave_balances WHERE employee_id=$1 AND leave_type_id=$2',[employee.id,source.leave_type_id])).rows[0].n,0);}finally{await pool.query('DROP TRIGGER synthetic_credit_failure ON audit_log; DROP FUNCTION synthetic_credit_failure()');}
  assert.equal((await recordInitialCredit(pool,args)).balance,'5.00');await assert.rejects(recordInitialCredit(pool,args),/already exists/);
  const preview=await commission.previewCommissioning(pool,{user:user(hr),data:{...data,initial_admin_setup:true}});assert.equal(preview.ready,1,preview.employees[0].issues.join(' '));assert.equal(preview.employees[0].targets.find(t=>t.code==='special').amount,'5.000000');
 });
 test('cohort consolidation carries the original register into Government rules atomically without staging an employee pause',async()=>{
  const data=await commissioningFixture(),preview=await commission.previewCommissioning(pool,{user:user(hr),data});assert.equal(preview.ready,1,preview.employees[0].issues.join(' '));assert.deepEqual(preview.employees[0].targets.map(t=>t.amount),['20.000000','10.000000','5.000000']);
  const before=(await pool.query('SELECT * FROM hr_leave_balances ORDER BY id')).rows,review=await commission.prepareCommissioning(pool,{user:user(hr),actor:hr,data:{...data,snapshot_hash:preview.snapshot_hash}});
  assert.equal((await pool.query('SELECT leave_policy_regime FROM hr_employees WHERE id=$1',[employee.id])).rows[0].leave_policy_regime,'legacy');assert.equal((await l.loadContext(pool,employee.id)).entitlements.length,0);
  await assert.rejects(commission.applyCommissioning(pool,{user:user(hr),actor:hr,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}}),e=>e.status===403);
  const receipt=await commission.applyCommissioning(pool,{user:user(certifier),actor:certifier,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}});assert.equal(receipt.result.length,1);await commission.applyCommissioning(pool,{user:user(certifier),actor:certifier,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}});
  assert.deepEqual((await pool.query('SELECT * FROM hr_leave_balances ORDER BY id')).rows,before);assert.equal((await l.loadContext(pool,employee.id)).employee.leave_policy_regime,'government');assert.deepEqual((await w.configurationFor(pool,employee.id)).enabled_codes,['recreation','medical','special']);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_credit_transfers')).rows[0].n,3);
  const r=await submit(application('special','2026-11-02','2026-11-06'));await evidence(r.id);await decide(r.id);assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='special').balance,'0.000000');
 });
 test('cohort consolidation rejects changed balances and rolls back every employee on audit failure',async()=>{
  const data=await commissioningFixture(),preview=await commission.previewCommissioning(pool,{user:user(hr),data}),review=await commission.prepareCommissioning(pool,{user:user(hr),actor:hr,data:{...data,snapshot_hash:preview.snapshot_hash}});
  await pool.query('UPDATE hr_leave_balances SET balance=balance+1 WHERE employee_id=$1',[employee.id]);await assert.rejects(commission.applyCommissioning(pool,{user:user(certifier),actor:certifier,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}}),/changed/);assert.equal((await l.loadContext(pool,employee.id)).employee.leave_policy_regime,'legacy');
  await pool.query('UPDATE hr_leave_balances SET balance=balance-1 WHERE employee_id=$1',[employee.id]);
  await pool.query("CREATE FUNCTION synthetic_commission_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='hr.gov.commissioning.applied' THEN RAISE EXCEPTION 'synthetic consolidation audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER synthetic_commission_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_commission_failure()");
  try{await assert.rejects(commission.applyCommissioning(pool,{user:user(certifier),actor:certifier,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}}),/synthetic consolidation audit failure/);assert.equal((await l.loadContext(pool,employee.id)).employee.leave_policy_regime,'legacy');assert.equal((await l.loadContext(pool,employee.id)).entitlements.length,0);assert.equal((await w.configurationFor(pool,employee.id)),null);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_credit_transfers')).rows[0].n,0);}finally{await pool.query('DROP TRIGGER synthetic_commission_failure ON audit_log; DROP FUNCTION synthetic_commission_failure()');}
 });
 for(const initialAdmin of [false,true])test(`a 29-person ${initialAdmin?'initial admin':'independent'} cohort is consolidated once and a failure on the second employee rolls back the entire cohort`,async()=>{
  const data=await commissioningFixture(),sourcePeriod=(await pool.query('SELECT * FROM hr_employee_service_periods WHERE employee_id=$1',[employee.id])).rows[0],sourceBasis=(await pool.query('SELECT * FROM hr_gov_service_bases WHERE employee_id=$1',[employee.id])).rows[0];
  if(initialAdmin){data.initial_admin_setup=true;await pool.query("UPDATE reviewers SET role='admin' WHERE id=$1",[hr.id]);hr.role='admin';}
  const applier=initialAdmin?hr:certifier;
  for(let i=2;i<=29;i++){
   const person=(await pool.query("INSERT INTO hr_employees(display_name,department_id,division_id,leave_policy_regime) VALUES($1,$2,$3,'legacy') RETURNING *",[`Synthetic Treasury cohort ${i}`,department.id,division.id])).rows[0];
   await pool.query("INSERT INTO hr_employee_external_ids(employee_id,source,external_id,verified_by,reason) VALUES($1,'techone_payroll',$2,$3,$4)",[person.id,`SYNTHETIC-TREASURY-${i}`,hr.id,reason]);
   await pool.query("INSERT INTO hr_employee_service_periods(employee_id,start_date,employment_category,counts_for_service,work_pattern_id,reason) VALUES($1,'2026-01-01','permanent',TRUE,$2,$3)",[person.id,sourcePeriod.work_pattern_id,reason]);
   await l.addFoundationRecord(pool,{user:user(hr),actor:hr,employeeId:person.id,kind:'basis',data:{effective_from:'2026-01-01',continuity_start:'2026-01-01',anniversary_method:sourceBasis.anniversary_method,leap_day_method:sourceBasis.leap_day_method,schedule_mode:sourceBasis.schedule_mode,source_reference:'Synthetic verified cohort service record',reason}});
   await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance,pending) SELECT $1,leave_type_id,year,balance,pending FROM hr_leave_balances WHERE employee_id=$2',[person.id,employee.id]);data.employees.push({employee_id:person.id,medical_history:[]});
  }
  const preview=await commission.previewCommissioning(pool,{user:user(hr),data});assert.equal(preview.ready,29,preview.employees.flatMap(e=>e.issues).join(' '));const review=await commission.prepareCommissioning(pool,{user:user(hr),actor:hr,data:{...data,snapshot_hash:preview.snapshot_hash}});
  await pool.query("CREATE FUNCTION synthetic_second_employee_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='hr.gov.workflow.prepared' AND EXISTS(SELECT 1 FROM hr_gov_workflow_configs WHERE status='published') THEN RAISE EXCEPTION 'synthetic second employee failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER synthetic_second_employee_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_second_employee_failure()");
  try{await assert.rejects(commission.applyCommissioning(pool,{user:user(applier),actor:applier,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}}),/second employee failure/);assert.equal((await pool.query("SELECT count(*)::int AS n FROM hr_employees WHERE id=ANY($1) AND leave_policy_regime='legacy'",[data.employees.map(e=>e.employee_id)])).rows[0].n,29);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_entitlements')).rows[0].n,0);}finally{await pool.query('DROP TRIGGER synthetic_second_employee_failure ON audit_log; DROP FUNCTION synthetic_second_employee_failure()');}
  const receipt=await commission.applyCommissioning(pool,{user:user(applier),actor:applier,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}});assert.equal(receipt.result.length,29);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_credit_transfers')).rows[0].n,87);assert.equal((await pool.query("SELECT count(*)::int AS n FROM hr_gov_workflow_configs WHERE status='published'")).rows[0].n,29);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_leave_balances')).rows[0].n,116);
 });
 test('a nominated HoD can join the cohort but their own leave requires an explicit authorised substitute',async()=>{
  const data=await commissioningFixture();await pool.query("UPDATE reviewers SET permissions=permissions||'{\"hr_leave_approve\":true}'::jsonb WHERE id=$1",[owner.id]);owner.permissions.hr_leave_approve=true;await pool.query("UPDATE hr_approval_assignments SET approver_employee_id=$1 WHERE level='department'",[employee.id]);
  const preview=await commission.previewCommissioning(pool,{user:user(hr),data});assert.equal(preview.ready,1,preview.employees[0].issues.join(' '));assert.match(preview.employees[0].warnings[0],/authorised substitute/);const review=await commission.prepareCommissioning(pool,{user:user(hr),actor:hr,data:{...data,snapshot_hash:preview.snapshot_hash}});await commission.applyCommissioning(pool,{user:user(certifier),actor:certifier,id:review.id,data:{snapshot_hash:review.snapshot_hash,reason}});
  const r=await submit(application('special','2026-11-02'));await evidence(r.id);await assert.rejects(decide(r.id,{},owner),/Self-approval/);const view=await w.requestView(pool,user(hr),r.id);
  await w.rebindStage(pool,{user:user(hr),actor:hr,id:r.id,stageId:view.stages[0].id,data:{substitute_employee_id:officers.department.employee.id,source_reference:'Synthetic authorised HoD own-leave substitute',reason}});await decide(r.id,{},officers.department.account);assert.equal((await w.getRequest(pool,r.id)).status,'approved');
 });
 test('commissioning reports unresolved facts and reservations and never assumes unstored balances or service history',async()=>{
  const data=await commissioningFixture();await pool.query('UPDATE hr_employee_service_periods SET is_teacher=TRUE WHERE employee_id=$1',[employee.id]);const teacher=await commission.previewCommissioning(pool,{user:user(hr),data});assert.equal(teacher.ready,0);assert.ok(teacher.employees[0].issues.some(i=>/Education case route/.test(i)));await pool.query('UPDATE hr_leave_balances SET pending=1 WHERE employee_id=$1',[employee.id]);await pool.query('DELETE FROM hr_employee_service_periods WHERE employee_id=$1',[employee.id]);
  const preview=await commission.previewCommissioning(pool,{user:user(hr),data});assert.equal(preview.ready,0);assert.ok(preview.employees[0].issues.some(i=>/pending reservation/.test(i)));assert.ok(preview.employees[0].issues.some(i=>/appointment|service/i.test(i)));await assert.rejects(commission.prepareCommissioning(pool,{user:user(hr),actor:hr,data:{...data,snapshot_hash:preview.snapshot_hash}}),/preparation issues/);
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
  const saved=(await w.getRequest(pool,r.id)).grant_snapshot;assert.equal(saved.medical_mode,'certificate');assert.equal(saved.medical_uncertified.committed_including_this_request,0);assert.equal(saved.medical_tracking.certified.approved_days,'10.000000');assert.equal(saved.medical_tracking.certified.pending_days,'0.000000');assert.equal(saved.medical_tracking.shared.balance,'0.000000');
 });
 test('pending uncertified occasions reserve the counter, cancellation frees it, and roster adjacency rejects split absences',async()=>{
  const a=await submit(application('medical','2026-11-02')),b=await submit(application('medical','2026-11-04')),c=await submit(application('medical','2026-11-06'));
  await assert.rejects(submit(application('medical','2026-11-10')),/already committed/);
  await assert.rejects(submit({...application('medical','2026-11-09'),medical_mode:'certificate'},[{file_name:'synthetic.pdf',content_type:'application/pdf',byte_size:5,sha256:'example',file_data:Buffer.from('%PDF-')}]),/Adjacent/);
  await w.cancelRequest(pool,{user:user(owner),actor:owner,id:b.id,reason});const next=await submit(application('medical','2026-11-12'));assert.ok(next.id);await grant(a.id);await grant(c.id);
  const saved=(await w.getRequest(pool,a.id)).grant_snapshot;assert.equal(saved.medical_mode,'exemption');assert.equal(saved.medical_uncertified.committed_including_this_request,3);assert.equal(saved.medical_tracking.uncertified.approved_occasions,1);assert.equal(saved.medical_tracking.uncertified.pending_occasions,2);assert.equal(saved.medical_tracking.uncertified.remaining_occasions,0);
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
 test('approved replacement splits a payroll fortnight safely and retries create one posting',async()=>{
  await plan();
  const replacement=await l.createPolicy(pool,{user:user(hr),actor:hr,data:{label:'Approved payroll policy transition',effective_from:'2026-10-08',effective_to:'2027-12-31',rules:{...DEFAULT_RULES,recreation_annual_days:'26',recreation_cap_days:'90'},source_reference:'Signed replacement policy schedule',supersedes_policy_id:policy.id,authority_reference:'Signed replacement decision 2026/Payroll',reason}});
  await l.publishPolicy(pool,{user:user(certifier),actor:certifier,id:replacement.id,reason,expected_revision:1});
  const run=()=>jobs.runEmployeeJobs(pool,{user:user(hr),actor:hr,employeeId:employee.id,asOf:'2026-10-14',clockDate:'2026-10-14'});
  const posted=await run();assert.equal(posted.results[0].posts[0].amount,'0.884615');assert.equal(posted.results[0].posts[0].policy_segments.length,2);
  await run();assert.equal((await pool.query("SELECT count(*)::int AS n FROM hr_gov_job_posts WHERE code='recreation' AND event_kind='accrual'")).rows[0].n,1);
  assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='recreation').balance,'20.884615');
  const account=(await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='recreation');
  await l.correctLedger(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{entitlement_id:account.id,amount:'39.115385',effective_date:'2026-10-14',event_key:randomUUID(),source_reference:'Signed transition cap reconciliation',reason}});
  await jobs.runEmployeeJobs(pool,{user:user(hr),actor:hr,employeeId:employee.id,asOf:'2026-10-28',clockDate:'2026-10-28'});
  assert.equal((await l.loadContext(pool,employee.id)).entitlements.find(e=>e.code==='recreation').balance,'61.000000');
  const backdated=await l.createPolicy(pool,{user:user(hr),actor:hr,data:{label:'Backdated further replacement',effective_from:'2026-10-10',effective_to:'2027-12-31',rules:DEFAULT_RULES,source_reference:'Backdated signed replacement schedule',supersedes_policy_id:replacement.id,authority_reference:'Signed backdated replacement decision',reason}});
  await assert.rejects(l.publishPolicy(pool,{user:user(certifier),actor:certifier,id:backdated.id,reason,expected_revision:1}),/Posted jobs/);
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

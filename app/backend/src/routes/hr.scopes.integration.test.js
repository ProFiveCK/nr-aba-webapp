import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,describe,test} from 'node:test';
import {connectTestDatabase,createEmployee,resetLeaveTables,skipWithoutDatabase,upsertLeaveType,grantAccess,nominateApprover} from '../test-support/database.js';

describe('HR scope isolation through actual HTTP routes',{skip:skipWithoutDatabase},()=>{
  let pool,auth,access,central,staff,approver,owner,other,department,division,sibling,foreign,employee,peer,outsider,type,approved,pending,attachment,server,base;
  const reason='Synthetic HR access verified from appointment and identity records.';
  before(async()=>{
    pool=await connectTestDatabase();auth=await import('../services/authService.js');access=await import('../services/hrAccess.js');
    const express=(await import('express')).default,errors=await import('../middleware/errors.js');errors.enableAsyncErrors();
    const {default:router}=await import('./hr.js');const app=express();app.use(express.json());app.use('/api/hr',router);app.use(errors.errorHandler);
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}/api/hr`;
  });
  after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await pool?.end();});
  const account=async(name,permissions={})=>{const row=(await pool.query(`INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES ($1,$2,'user','x',$3) RETURNING *`,[`scope-${randomUUID()}@example.test`,name,permissions])).rows[0];await grantAccess(pool,row.id,permissions);return row;};
  async function token(row){const session=await auth.createSession(row.id);return auth.buildTokenPayload(row,session.tokenId,session.expiresAt);}
  async function call(row,path,body,method=body?'POST':'GET',bearer){const res=await fetch(`${base}${path}`,{method,headers:{Authorization:`Bearer ${bearer||await token(row)}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:res.status,body:(res.headers.get('content-type')||'').includes('json')?await res.json():await res.text(),cache:res.headers.get('cache-control')};}
  const grant=(row,caps,div=division.id,dept=department.id,extra={})=>access.grantHrScope(pool,{user:{id:central.id,permissions:{hr_admin:true}},actor:central,data:{reviewer_id:row.id,department_id:dept,division_id:div,capabilities:caps,effective_from:'2020-01-01',reason,...extra}});
  // An approver reaches people through Leave settings: a nomination, plus (for
  // older-rules records) being their reporting manager in the same unit.
  async function lineApprover(row,report=employee){const record=(await pool.query("INSERT INTO hr_employees(display_name,reviewer_id,department_id,division_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING *",[`Line approver ${randomUUID().slice(0,8)}`,row.id,report.department_id||department.id,report.division_id||division.id])).rows[0];await pool.query('UPDATE hr_employees SET manager_id=$2 WHERE id=$1',[report.id,record.id]);return nominateApprover(pool,row.id);}
  async function application(person,status='approved'){return(await pool.query(`INSERT INTO hr_leave_applications(employee_id,leave_type_id,start_date,end_date,days,reason,status,reviewed_by,reviewed_at) VALUES ($1,$2,'2026-10-08','2026-10-09',2,'Synthetic scoped leave',$3,$4,NOW()) RETURNING *`,[person.id,type.id,status,approver.id])).rows[0];}
  beforeEach(async()=>{
    await resetLeaveTables(pool);central=await account('Central HR',{hr_admin:true,hr_access:true});staff=await account('Scoped HR');approver=await account('Scoped approver');owner=await account('Applicant',{hr_access:true,hr_leave_apply:true});other=await account('Outside applicant',{hr_access:true,hr_leave_apply:true});
    department=(await pool.query("INSERT INTO hr_departments(name) VALUES ('Scope Finance') RETURNING *")).rows[0];foreign=(await pool.query("INSERT INTO hr_departments(name) VALUES ('Scope Health') RETURNING *")).rows[0];
    division=(await pool.query("INSERT INTO hr_divisions(department_id,name) VALUES ($1,'Treasury') RETURNING *",[department.id])).rows[0];sibling=(await pool.query("INSERT INTO hr_divisions(department_id,name) VALUES ($1,'Budget') RETURNING *",[department.id])).rows[0];
    employee=await createEmployee(pool,{name:'Treasury Person'});peer=await createEmployee(pool,{name:'Sibling Person'});outsider=await createEmployee(pool,{name:'Outside Person'});await createEmployee(pool,{name:'Unverified placement',department:department.name});
    await pool.query('UPDATE hr_employees SET department_id=$2,division_id=$3,department_code=$4,division_code=$5,reviewer_id=$6 WHERE id=$1',[employee.id,department.id,division.id,department.name,division.name,owner.id]);
    await pool.query('UPDATE hr_employees SET department_id=$2,division_id=$3,department_code=$4 WHERE id=$1',[peer.id,department.id,sibling.id,department.name]);
    await pool.query('UPDATE hr_employees SET department_id=$2,department_code=$3,reviewer_id=$4 WHERE id=$1',[outsider.id,foreign.id,foreign.name,other.id]);
    type=await upsertLeaveType(pool,{name:'T:Scope Leave',defaultDays:10});approved=await application(employee);pending=await application(employee,'pending');await application(peer);await application(outsider);
    attachment=(await pool.query(`INSERT INTO hr_leave_attachments(application_id,file_name,content_type,file_data,byte_size,uploaded_by,checksum) VALUES ($1,'synthetic-evidence.pdf','application/pdf',$2,5,$3,'synthetic-checksum') RETURNING *`,[approved.id,Buffer.from('%PDF-'),owner.id])).rows[0];
    await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance) VALUES ($1,$2,2026,10)',[employee.id,type.id]);
  });
  test('unified approval records keep department scope, evidence permissions and status filters',async()=>{
    const path='/government/workflow/requests?mode=queue&include_recorded=true';
    await grant(staff,['hr_officer']);assert.equal((await call(staff,path+'&status=all')).body.total,0);
    const nomination=await lineApprover(approver);
    const approvedList=await call(approver,path+'&status=approved');assert.equal(approvedList.status,200);assert.equal(approvedList.body.total,1);
    const row=approvedList.body.requests[0];assert.equal(row.id,approved.id);assert.equal(row.record_source,'recorded');assert.equal(row.can_pdf,true);assert.equal(row.recorded_application.attachments[0].id,attachment.id,'evidence follows the right to decide');
    assert.equal((await call(approver,path+'&status=pending')).body.requests[0].id,pending.id);
    assert.equal((await call(approver,path+'&status=all')).body.total,2);
    assert.equal((await call(approver,path+`&status=all&employee_id=${outsider.id}`)).body.total,0);
    assert.ok(!JSON.stringify(approvedList.body).includes('file_data'));
    assert.equal((await call(owner,path+'&status=all')).body.total,0);
    await pool.query("UPDATE hr_approval_assignments SET effective_to='2001-01-01' WHERE id=$1",[nomination]);assert.equal((await call(approver,path+'&status=all')).status,403,'ending the nomination ends the approver');
  });
  test('recorded PDF downloads contain one page and retain the complete application explanation',async()=>{
    const {PDFDocument}=await import('pdf-lib');
    const explanation='The full supporting explanation remains in this record. '.repeat(100);
    await pool.query('UPDATE hr_leave_applications SET reason=$2 WHERE id=$1',[approved.id,explanation]);
    const response=await fetch(`${base}/leaves/${approved.id}/application.pdf`,{headers:{Authorization:`Bearer ${await token(central)}`}});assert.equal(response.status,200);
    const pdf=await PDFDocument.load(await response.arrayBuffer());assert.equal(pdf.getPageCount(),1);
    assert.equal((await pool.query('SELECT reason FROM hr_leave_applications WHERE id=$1',[approved.id])).rows[0].reason,explanation);
  });
  test('an old staff, balance or report tick alone gives no records or exports',async()=>{
    const legacy=await account('Unscoped HR',{hr_access:true,hr_staff_manage:true,hr_balance_manage:true,hr_report_read:true});assert.equal((await call(legacy,'/employees')).status,403);assert.equal((await call(legacy,'/directory')).status,403);
    assert.equal((await call(legacy,`/directory/${employee.id}/profile`)).status,403);assert.equal((await call(legacy,`/employees/${employee.id}`,{position_title:'Unauthorized'},'PUT')).status,403);
    assert.equal((await call(legacy,'/report?from=2026-10-01&to=2026-10-31')).status,403);assert.equal((await call(legacy,'/adjustments',{employee_id:employee.id,leave_type_id:type.id,amount:1,reason})).status,404,'balance corrections are retired');
  });
  test('division scope filters both directories, references and calendar including guessed IDs',async()=>{
    await grant(staff,['hr_officer']);await pool.query('UPDATE hr_employees SET manager_id=$2 WHERE id=$1',[employee.id,outsider.id]);
    const list=await call(staff,'/directory');assert.equal(list.status,200);assert.equal(list.body.total,1);assert.equal(list.body.employees[0].id,employee.id);assert.equal(list.cache,'no-store');
    const old=await call(staff,'/employees');assert.equal(old.body.length,1);assert.equal(old.body[0].manager_name,null);
    assert.equal((await call(staff,`/directory?department_id=${foreign.id}`)).body.total,0);assert.equal((await call(staff,'/directory?search=Outside Person')).body.total,0);
    for(const person of [peer,outsider])assert.equal((await call(staff,`/directory/${person.id}/profile`)).status,404);
    const profile=await call(staff,`/directory/${employee.id}/profile`);assert.equal(profile.body.employee.manager_id,outsider.id);assert.match(profile.body.employee.manager_name,/Outside your assigned scope/);assert.equal(profile.body.employee.daily_rate,undefined);
    const org=await call(staff,'/org-units');assert.equal(org.body.length,1);assert.deepEqual(org.body[0].divisions.map(v=>v.id),[division.id]);
    assert.deepEqual((await call(staff,'/calendar?from=2026-10-01&to=2026-10-31')).body,[],'an HR officer with no staff record has no team calendar');
    assert.equal((await call(staff,'/calendar?from=2026-10-01&to=2026-10-31&view=all')).status,403,'all departments is for Central HR only');
  });
  test('calendar includes only approved and submitted leave overlapping the month, within the caller team',async()=>{
    await application(employee,'rejected');await application(employee,'cancelled');
    await application(peer,'pending');await application(outsider,'pending');
    const crossing=await application(employee,'pending');
    await pool.query("UPDATE hr_leave_applications SET start_date='2026-09-30',end_date='2026-10-01' WHERE id=$1",[crossing.id]);
    const nextMonth=await application(employee,'pending');
    await pool.query("UPDATE hr_leave_applications SET start_date='2026-11-01',end_date='2026-11-02' WHERE id=$1",[nextMonth.id]);
    const response=await call(owner,'/calendar?from=2026-10-01&to=2026-10-31');
    assert.equal(response.status,200);
    assert.deepEqual(response.body.map(a=>a.id).sort(),[approved.id,pending.id,crossing.id].sort());
    for(const row of response.body){assert.equal(row.employee_id,employee.id);assert.equal(row.reason,undefined);assert.equal(row.attachments,undefined);}
  });
  test('team calendar: same division only, colleagues read On leave, own leave keeps its type, study leave is study leave for everyone',async()=>{
    const mate=await account('Division colleague',{hr_access:true,hr_leave_apply:true});
    const colleague=await createEmployee(pool,{name:'Division Colleague'});
    await pool.query("UPDATE hr_employees SET department_id=$2,division_id=$3,reviewer_id=$4,leave_entitled=FALSE,ineligible_reason='study_leave',study_leave_start='2026-09-01' WHERE id=$1",[colleague.id,department.id,division.id,mate.id]);
    const path=view=>`/calendar?from=2026-10-01&to=2026-10-31&view=${view}`;
    const team=(await call(mate,path('team'))).body;
    assert.deepEqual(team.filter(a=>a.employee_id===employee.id).map(a=>a.id).sort(),[approved.id,pending.id].sort());
    assert.ok(team.every(a=>a.employee_id===employee.id||a.employee_id===colleague.id),'sibling divisions and other departments are not the team');
    for(const row of team.filter(a=>a.employee_id===employee.id)){assert.equal(row.leave_type_name,'On leave');assert.equal(row.own,false);assert.equal(row.reason,undefined);}
    const ownStudy=team.find(a=>a.employee_id===colleague.id);assert.equal(ownStudy.kind,'study_leave');assert.equal(ownStudy.own,true);
    const ownerTeam=(await call(owner,path('team'))).body;
    const study=ownerTeam.find(a=>a.employee_id===colleague.id);assert.equal(study.kind,'study_leave','study leave is not private, so it looks the same in every view');assert.equal(study.leave_type_name,'Study leave');
    assert.ok(ownerTeam.filter(a=>a.employee_id===employee.id).every(a=>a.leave_type_name==='T:Scope Leave'&&a.own===true));
    const all=(await call(central,path('all'))).body;
    assert.deepEqual(all.find(a=>a.employee_id===colleague.id),{...study,own:false},'Central HR sees study leave exactly as the team does');
    assert.ok(all.filter(a=>a.employee_id===employee.id).every(a=>a.leave_type_name==='T:Scope Leave'),'Central HR sees types');
    assert.equal((await call(other,path('team'))).body.some(a=>a.employee_id===employee.id),false);
    assert.equal((await call(mate,path('nobody'))).status,422);
  });
  test('a team covers the divisions under yours, and the team list names everyone in it and nobody else',async()=>{
    const child=(await pool.query("INSERT INTO hr_divisions(department_id,name,parent_division_id) VALUES ($1,'Treasury Systems',$2) RETURNING *",[department.id,division.id])).rows[0];
    const childAccount=await account('Child division member',{hr_access:true,hr_leave_apply:true});
    const childEmployee=await createEmployee(pool,{name:'Child Division Member'});
    await pool.query('UPDATE hr_employees SET department_id=$2,division_id=$3,reviewer_id=$4 WHERE id=$1',[childEmployee.id,department.id,child.id,childAccount.id]);
    const childLeave=await application(childEmployee);
    const team=(await call(owner,'/calendar?from=2026-10-01&to=2026-10-31&view=team')).body;
    assert.ok(team.some(a=>a.id===childLeave.id),'Treasury sees the division under it');
    assert.equal(team.find(a=>a.id===childLeave.id).leave_type_name,'On leave');
    assert.equal(team.some(a=>a.employee_id===peer.id),false,'a sibling division is not the team');
    const childTeam=(await call(childAccount,'/calendar?from=2026-10-01&to=2026-10-31&view=team')).body;
    assert.deepEqual(childTeam.map(a=>a.employee_id),[childEmployee.id],'the team does not reach up to the parent unit');

    const roster=(await call(owner,'/calendar/members?view=team')).body;
    assert.equal(roster.name,'Treasury');
    assert.deepEqual(roster.members.map(m=>m.name).sort(),['Child Division Member','Treasury Person']);
    assert.equal(roster.members.find(m=>m.name==='Treasury Person').own,true);
    for(const member of roster.members)assert.deepEqual(Object.keys(member).sort(),['department_name','division_name','employee_id','name','own'],'names and units only, no leave or record details');
    assert.deepEqual((await call(childAccount,'/calendar/members?view=team')).body.members.map(m=>m.name),['Child Division Member']);
    assert.deepEqual((await call(central,'/calendar/members?view=team')).body,{name:null,members:[]},'a login with no staff record has no team');assert.equal((await call(staff,'/calendar/members?view=team')).status,403,'the Leave app is still required');
  });
  test('department calendar: every division of your department, colleagues read On leave, other departments never',async()=>{
    const path='/calendar?from=2026-10-01&to=2026-10-31&view=department';
    const mate=await account('Sibling colleague',{hr_access:true,hr_leave_apply:true});
    await pool.query('UPDATE hr_employees SET reviewer_id=$2 WHERE id=$1',[peer.id,mate.id]);
    const seen=(await call(mate,path)).body;
    assert.deepEqual([...new Set(seen.map(a=>a.employee_id))].sort(),[employee.id,peer.id].sort(),'the sibling division is in the department; another department is not');
    for(const row of seen.filter(a=>a.employee_id===employee.id)){assert.equal(row.leave_type_name,'On leave');assert.equal(row.own,false);}
    assert.ok(seen.filter(a=>a.employee_id===peer.id).every(a=>a.own===true&&a.leave_type_name==='T:Scope Leave'),'your own leave keeps its type');
    assert.equal((await call(mate,'/calendar?from=2026-10-01&to=2026-10-31&view=team')).body.some(a=>a.employee_id===employee.id),false,'the team is narrower than the department');
    assert.equal((await call(other,path)).body.some(a=>a.employee_id===employee.id||a.employee_id===peer.id),false);
    const roster=(await call(mate,'/calendar/members?view=department')).body;
    assert.equal(roster.name,'Scope Finance');
    assert.deepEqual(roster.members.map(m=>m.name).sort(),['Sibling Person','Treasury Person']);
    assert.equal((await call(mate,'/calendar/members?view=all')).status,422,'the member list is for the team and department only');
  });
  test('a record carried into the government workflow shows once, while its new request is pending or approved',async()=>{
    // Submitted requests cannot be edited, so each status gets its own carried record.
    const review=randomUUID();
    await pool.query(`INSERT INTO hr_gov_migration_reviews(id,employee_id,cutover_date,prepared_by,source_reference,payroll_reference,transition_reference,history_reference,reason,payload_hash,context_hash,plan,snapshot)
      VALUES($1,$2,'2026-10-01',$3,'synthetic','synthetic','synthetic','synthetic','synthetic','synthetic','synthetic','{}','{}')`,[review,employee.id,central.id]);
    const carry=async(legacy,status)=>{
      const id=randomUUID();
      await pool.query(`INSERT INTO hr_gov_requests(id,employee_id,code,start_date,end_date,reason,medical_mode,payload_hash,application_snapshot,department_id,division_id,charge,submitted_by,status,submitted_at,completed_at)
        VALUES($1,$2,'official','2026-10-08','2026-10-09','Synthetic carried','not_applicable','synthetic','{}',$3,$4,0,$5,$6,'2026-09-20',$7)`,
        [id,employee.id,department.id,division.id,owner.id,status,status==='pending'?null:'2026-09-21']);
      await pool.query(`INSERT INTO hr_gov_legacy_transfers(legacy_request_id,request_id,employee_id,code,review_id,legacy_hash,source_reference,recorded_by,approval_preserved)
        VALUES($1,$2,$3,'official',$4,'synthetic','synthetic',$5,true)`,[legacy.id,id,employee.id,review,central.id]);
    };
    const refused=await application(employee);
    await carry(approved,'approved');await carry(pending,'pending');await carry(refused,'rejected');
    const shown=(await call(owner,'/calendar?from=2026-10-01&to=2026-10-31&view=team')).body.filter(a=>a.employee_id===employee.id).map(a=>a.id);
    assert.deepEqual(shown,[refused.id],'the government calendar shows the pending and approved requests instead; a refused carry-over leaves the original');
  });
  test('whole-department scope includes siblings, excludes unverified placement and other departments',async()=>{
    await grant(staff,['hr_officer'],null);assert.equal((await call(staff,'/directory')).body.total,2);assert.equal((await call(staff,'/org-units')).body[0].divisions.length,2);
  });
  test('scoped edits cannot transfer, link identities, set status or change central configuration',async()=>{
    await grant(staff,['hr_officer']);const details={display_name:'Verified Treasury Person',position_title:'Officer',status:'active',manager_id:null,email:null,reason};
    assert.equal((await call(staff,`/directory/${employee.id}/details`,details,'PUT')).status,200);
    assert.equal((await call(staff,`/directory/${outsider.id}/details`,details,'PUT')).status,404);assert.equal((await call(staff,`/directory/${employee.id}/details`,{...details,manager_id:outsider.id},'PUT')).status,404);
    assert.equal((await call(staff,`/directory/${employee.id}/details`,{...details,status:'inactive'},'PUT')).status,403);assert.equal((await call(staff,`/employees/${employee.id}`,{department_code:foreign.name},'PUT')).status,403);
    const blocked=[['/directory/accounts'],['/directory/imports'],['/directory/imports/preview',{csv:'x',export_date:'2026-10-07'}],['/employees',{display_name:'x'}],[`/employees/${employee.id}`,{},'DELETE'],[`/directory/${employee.id}/account-link`,{reviewer_id:staff.id,reason},'PUT'],[`/directory/${employee.id}/organisation`,{department_id:foreign.id,reason},'PUT'],[`/directory/${employee.id}/service-periods`,{start_date:'2026-01-01',employment_category:'permanent',reason}],['/directory/approval-assignments',{level:'chief_secretary',approver_employee_id:employee.id,effective_from:'2026-10-07',reason}],['/overview']];
    for(const[path,body,method]of blocked)assert.equal((await call(staff,path,body,method)).status,403,path);
    // The legacy import and policy admin routes do not exist at all any more (404, not a gate).
    assert.equal((await call(staff,'/policies')).status,404);assert.equal((await call(staff,'/employees/import',{rows:[{display_name:'x'}]})).status,404);
  });
  test('direct historical reporting-line edits cannot create a manager cycle',async()=>{
    await grant(staff,['hr_officer'],null);
    assert.equal((await call(staff,`/employees/${employee.id}`,{manager_id:peer.id},'PUT')).status,200);
    const result=await call(staff,`/employees/${peer.id}`,{manager_id:employee.id},'PUT');
    assert.equal(result.status,400);assert.match(result.body.message,/manager cycle/);
    assert.equal((await pool.query('SELECT manager_id FROM hr_employees WHERE id=$1',[peer.id])).rows[0].manager_id,null);
  });
  test('an HR officer has records, balances, reports and personnel PDFs for the unit; evidence follows leave decisions',async()=>{
    await grant(staff,['hr_officer']);assert.equal((await call(staff,`/employees/${employee.id}/balances`)).status,200);assert.equal((await call(staff,`/leaves/${approved.id}/payroll-form`)).status,200);assert.equal((await call(staff,`/leaves/${approved.id}/attachments/${attachment.id}`)).status,404,'an HR officer is not an approver');
    assert.equal((await call(staff,'/employees/balances?year=2026')).body.employees.length,1);assert.equal((await call(staff,`/employees/${outsider.id}/balances`)).status,404);
    assert.deepEqual((await call(staff,'/report?from=2026-10-01&to=2026-10-31')).body.rows.map(r=>r.employee_name),['Treasury Person']);assert.equal((await call(staff,`/leaves/${approved.id}/application.pdf`)).status,200);
    const foreignApp=(await pool.query('SELECT id FROM hr_leave_applications WHERE employee_id=$1',[outsider.id])).rows[0];assert.equal((await call(staff,`/leaves/${foreignApp.id}/payroll-form`)).status,404);
    assert.equal((await call(staff,`/leaves/${approved.id}/attachments/${attachment.id}`)).status,404);await lineApprover(staff);assert.equal((await call(staff,`/leaves/${approved.id}/attachments/${attachment.id}`)).status,200);
  });
  test('scoped balances use current entitlement credits and live holds without exposing retained or missing credit',async()=>{
    await grant(staff,['hr_officer'],null);
    const year=new Date(Date.now()+12*3600000).getUTCFullYear();
    const start=`${year}-01-01`,end=`${year}-12-31`;
    await pool.query("UPDATE hr_employees SET leave_policy_regime='government',daily_rate=123.45 WHERE id=ANY($1::uuid[])",[[employee.id,peer.id,outsider.id]]);
    await pool.query('UPDATE hr_leave_balances SET balance=999,pending=7,year=$2 WHERE employee_id=$1',[employee.id,year]);
    const {DEFAULT_RULES}=await import('../lib/governmentLeaveRules.js');
    const policy=(await pool.query("INSERT INTO hr_gov_policy_versions(label,effective_from,effective_to,rules,source_reference,status,reason) VALUES('Scoped policy','2020-01-01','2099-12-31',$1,'PRIVATE policy','published','PRIVATE reason') RETURNING id",[DEFAULT_RULES])).rows[0];
    async function entitlement(person,from,to,code='recreation',amount=25){
      const opening=(await pool.query(`INSERT INTO hr_gov_openings(employee_id,code,policy_version_id,period_start,period_end,as_of,amount,source_reference,payroll_reference,snapshot_hash,historical_snapshot,status,prepared_by,reason)
        VALUES($1,$2,$3,$4,$5,$4,$6,'PRIVATE source','PRIVATE payroll','test','[]','certified',$7,'PRIVATE reason') RETURNING id`,[person.id,code,policy.id,from,to,amount,central.id])).rows[0];
      const account=(await pool.query('INSERT INTO hr_gov_entitlements(employee_id,code,policy_version_id,period_start,period_end,as_of,opening_id) VALUES($1,$2,$3,$4,$5,$4,$6) RETURNING id',[person.id,code,policy.id,from,to,opening.id])).rows[0];
      await pool.query("INSERT INTO hr_gov_ledger(entitlement_id,kind,amount,effective_date,event_key,source_reference,actor_id,reason) VALUES($1,'opening',$2,$3,$4,'PRIVATE ledger',$5,'PRIVATE reason')",[account.id,amount,from,randomUUID(),central.id]);
      return account;
    }
    const balance=await entitlement(employee,start,end);
    await entitlement(employee,`${year-1}-01-01`,`${year-1}-12-31`,'medical',99);
    await entitlement(employee,`${year+1}-01-01`,`${year+1}-12-31`,'special',88);
    await entitlement(outsider,start,end,'recreation',777);
    for(const [status,amount] of [['held',3],['released',9]]){
      const id=randomUUID();await pool.query("INSERT INTO hr_gov_reservation_requests(id,employee_id,payload_hash,evaluation_snapshot,status) VALUES($1,$2,'test','{}',$3)",[id,employee.id,status]);
      await pool.query('INSERT INTO hr_gov_reservations(request_id,entitlement_id,amount) VALUES($1,$2,$3)',[id,balance.id,amount]);
    }
    const request=randomUUID();
    await pool.query(`INSERT INTO hr_gov_requests(id,employee_id,code,start_date,end_date,reason,medical_mode,payload_hash,application_snapshot,department_id,division_id,charge,submitted_by,status)
      VALUES($1,$2,'recreation_encashment',$3,$3,'PRIVATE request','not_applicable','test','{}',$4,$5,0,$6,'pending')`,[request,employee.id,start,department.id,division.id,central.id]);
    for(const [version,amount] of [[1,8],[2,2]]){
      const determination=(await pool.query("INSERT INTO hr_gov_case_determinations(request_id,version,prepared_by,source_reference,evidence_reference,reason,determination,context_hash) VALUES($1,$2,$3,'PRIVATE source','PRIVATE evidence','PRIVATE reason','{}','test') RETURNING id",[request,version,central.id])).rows[0];
      await pool.query('INSERT INTO hr_gov_case_credit_holds(determination_id,request_id,entitlement_id,amount) VALUES($1,$2,$3,$4)',[determination.id,request,balance.id,amount]);
    }
    const result=await call(staff,'/employees/balances');assert.equal(result.status,200);
    assert.deepEqual(result.body.employees.map(row=>row.id).sort(),[employee.id,peer.id].sort());
    const current=result.body.employees.find(row=>row.id===employee.id),missing=result.body.employees.find(row=>row.id===peer.id);
    assert.deepEqual(current.balances,{Recreation:{balance:25,pending:5}});
    assert.equal(current.can_adjust_balance,false);assert.deepEqual(missing.balances,{});assert.equal(missing.can_adjust_balance,false);
    assert.equal(current.daily_rate,undefined);assert.equal(current.reason,undefined);assert.ok(!JSON.stringify(result.body).includes('PRIVATE'));
    // Check balance amounts rather than random record IDs, which can contain
    // the same digits as the outsider's credit without exposing that credit.
    assert.ok(result.body.employees.every(row=>Object.values(row.balances).every(balance=>Number(balance.balance)!==777)));
    assert.deepEqual(result.body.leave_types,['Medical','Recreation','Special']);
    assert.equal(Number((await pool.query('SELECT balance FROM hr_leave_balances WHERE employee_id=$1',[employee.id])).rows[0].balance),999);
    assert.equal((await call(staff,`/government/employees/${employee.id}/corrections`,{reason})).status,403);
  });
  test('current balance reporting rejects a different year rather than mixing account periods',async()=>{
    await grant(staff,['hr_officer']);
    const year=new Date(Date.now()+12*3600000).getUTCFullYear();
    const current=await call(staff,`/employees/balances?year=${year}`);
    assert.equal(current.status,200);assert.equal(current.body.year,year);assert.equal(current.body.as_of.slice(0,4),String(year));
    for(const requestedYear of [year-1,year+1]){
      const result=await call(staff,`/employees/balances?year=${requestedYear}`);
      assert.equal(result.status,400);assert.match(result.body.message,/current balances only/);assert.equal(result.body.employees,undefined);
    }
  });
  test('revocation invalidates a live session and future/expired grants confer no access',async()=>{
    const scope=await grant(staff,['hr_officer']),bearer=await token(staff);assert.equal((await call(staff,'/directory',undefined,'GET',bearer)).body.total,1);
    assert.equal((await call(central,`/access-scopes/${scope.id}/revoke`,{reason})).status,200);assert.equal((await call(staff,'/directory',undefined,'GET',bearer)).status,401);
    await grant(staff,['hr_officer'],division.id,department.id,{effective_from:'2099-01-01'});assert.equal((await call(staff,'/directory')).status,403);await grant(staff,['hr_officer'],division.id,department.id,{effective_to:'2020-12-31'});assert.equal((await call(staff,'/directory')).status,403);
  });
  test('transfer immediately removes old access even for the original approver',async()=>{
    await lineApprover(approver);const bearer=await token(approver);assert.equal((await call(approver,`/leaves/${approved.id}/payroll-form`)).status,200);
    await pool.query('UPDATE hr_employees SET department_id=$2,division_id=NULL WHERE id=$1',[employee.id,foreign.id]);
    assert.equal((await call(approver,`/leaves/${approved.id}/payroll-form`)).status,404);assert.equal((await call(approver,`/leaves/${approved.id}/attachments/${attachment.id}`)).status,404);
    // Decisions themselves are retired: the endpoint answers 404 to everyone now.
    assert.equal((await call(approver,`/leaves/${pending.id}/decision`,{decision:'approved'})).status,404);
  });
  test('owners retain their documents; foreign manager links cannot bypass placement',async()=>{
    assert.equal((await call(owner,`/leaves/${approved.id}/payroll-form`)).status,200);assert.equal((await call(owner,`/leaves/${approved.id}/attachments/${attachment.id}`)).status,200);assert.equal((await call(other,`/leaves/${approved.id}/application.pdf`)).status,404);
    const manager=await createEmployee(pool,{name:'Foreign manager'});await pool.query('UPDATE hr_employees SET reviewer_id=$2,department_id=$3 WHERE id=$1',[manager.id,approver.id,foreign.id]);await nominateApprover(pool,approver.id);await pool.query('UPDATE hr_employees SET manager_id=$2 WHERE id=$1',[employee.id,manager.id]);
    assert.equal((await call(approver,`/leaves/${approved.id}/attachments/${attachment.id}`)).status,404);
  });
  test('scope assignment validates boundaries and denies central escalation; revoking the scope removes the access; audited',async()=>{
    const data={reviewer_id:staff.id,department_id:department.id,capabilities:['hr_officer'],effective_from:'2020-01-01',reason};assert.equal((await call(staff,'/access-scopes',data)).status,403);assert.equal((await call(central,'/access-scopes',{...data,department_id:foreign.id,division_id:division.id})).status,400);
    const escalation=await call(central,'/access-scopes',{...data,capabilities:['hr_admin']});assert.equal(escalation.status,201);
    assert.deepEqual(escalation.body.capabilities,['hr_officer'],'a requested right is ignored: an assignment only ever makes an HR officer');
    assert.equal((await call(staff,'/access-scopes')).status,403,'an HR officer gains no central HR');
    await access.revokeHrScope(pool,{user:{permissions:{hr_admin:true}},actor:central,scopeId:escalation.body.id,reason});
    const scope=await grant(staff,['hr_officer']);await pool.query('UPDATE reviewers SET permissions=$2 WHERE id=$1',[staff.id,{hr_officer:false}]);assert.equal((await call(staff,'/directory')).status,200,'a stored denial no longer overrides a scope');
    await access.revokeHrScope(pool,{user:{permissions:{hr_admin:true}},actor:central,scopeId:scope.id,reason});assert.equal((await call(staff,'/directory')).status,403);
    await assert.rejects(access.grantHrScope(pool,{user:{permissions:{hr_admin:true}},actor:{id:randomUUID()},data}),{code:'23503'});assert.equal((await call(central,'/access-scopes')).body.total,2);assert.equal((await pool.query("SELECT count(*)::int n FROM audit_log WHERE entity_id=$1 AND action='hr.access_scope.granted'",[scope.id])).rows[0].n,1);
  });
  test('an audit insert failure rolls back a grant and its session revocation',async()=>{
    const bearer=await token(staff);
    await pool.query(`CREATE OR REPLACE FUNCTION reject_scope_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='hr.access_scope.granted' THEN RAISE EXCEPTION 'Synthetic audit unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_scope_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_scope_audit()`);
    try {
      await assert.rejects(grant(staff,['hr_officer']),/Synthetic audit unavailable/);
      assert.equal((await pool.query('SELECT count(*)::int n FROM hr_access_scopes')).rows[0].n,0);
      const response=await call(staff,'/directory',undefined,'GET',bearer);assert.equal(response.status,403,'session remains valid, scope was not committed');
    } finally {await pool.query('DROP TRIGGER reject_scope_audit ON audit_log; DROP FUNCTION reject_scope_audit()');}
  });
});

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {connectTestDatabase,resetLeaveTables,skipWithoutDatabase,upsertLeaveType,createEmployee} from '../test-support/database.js';
let pool,overview;
before(async()=>{if(!skipWithoutDatabase){pool=await connectTestDatabase();overview=await import('./leaveOverview.js');}});
after(async()=>await pool?.end());
test('overview combines current and retained leave once, applies amendments, and reads current balances',{skip:skipWithoutDatabase},async()=>{
 await resetLeaveTables(pool);
 const user=(await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES($1,'Dashboard HR','user','x',$2) RETURNING *",[`${randomUUID()}@example.test`,{hr_admin:true}])).rows[0];
 const annual=await upsertLeaveType(pool,{name:'Annual',defaultDays:20,accruable:true});
 const legacy=await createEmployee(pool,{name:'Legacy staff',department:'FIN'});
 const government=await createEmployee(pool,{name:'Government staff',department:'HR'});
 await pool.query("UPDATE hr_employees SET leave_policy_regime='government' WHERE id=$1",[government.id]);
 const source=(await pool.query("INSERT INTO hr_leave_applications(employee_id,leave_type_id,start_date,end_date,days,status,applied_at,reason) VALUES($1,$2,'2026-10-01','2026-10-03',2,'approved','2026-09-20','PRIVATE source') RETURNING *",[government.id,annual.id])).rows[0];
 await pool.query("INSERT INTO hr_leave_applications(employee_id,leave_type_id,start_date,end_date,days,status,applied_at) VALUES($1,$2,'2026-10-01','2026-10-02',2,'approved','2026-09-20')",[legacy.id,annual.id]);
 const request=async({code='official',status='approved',start='2026-10-01',end='2026-10-03'}={})=>{
  const id=randomUUID();await pool.query(`INSERT INTO hr_gov_requests(id,employee_id,code,start_date,end_date,reason,medical_mode,payload_hash,application_snapshot,department_id,division_id,charge,submitted_by,status,grant_snapshot,submitted_at,completed_at)
   VALUES($1,$2,$3,$4,$5,'PRIVATE grant','not_applicable','synthetic','{}',$6,$7,0,$8,$9,$10,'2026-09-20','2026-09-21')`,[id,government.id,code,start,end,randomUUID(),randomUUID(),user.id,status,{evaluation:{segments:[{date:'2026-10-01',charge:'0.5'},{date:'2026-10-02',charge:'1.5'},{date:'2026-10-03',charge:'1'}]}}]);return id;
 };
 const carried=await request();
 const review=randomUUID();await pool.query(`INSERT INTO hr_gov_migration_reviews(id,employee_id,cutover_date,prepared_by,source_reference,payroll_reference,transition_reference,history_reference,reason,payload_hash,context_hash,plan,snapshot)
 VALUES($1,$2,'2026-10-01',$3,'synthetic','synthetic','synthetic','synthetic','synthetic','synthetic','synthetic','{}','{}')`,[review,government.id,user.id]);
 await pool.query("INSERT INTO hr_gov_legacy_transfers(legacy_request_id,request_id,employee_id,code,review_id,legacy_hash,source_reference,recorded_by,approval_preserved) VALUES($1,$2,$3,'official',$4,'synthetic','synthetic',$5,true)",[source.id,carried,government.id,review,user.id]);
 const effect=async(action,version)=>{const amendment=await request({code:'amendment'});await pool.query("INSERT INTO hr_gov_case_effects(request_id,original_request_id,effect,recorded_by,version) VALUES($1,$2,$3,$4,$5)",[amendment,carried,{action,effective_end:'2026-10-02'},user.id,version]);};
 await effect('shorten_grant',1);await request({code:'recreation_encashment'});await request({status:'pending',start:'2027-01-01',end:'2027-01-02'});
 const input={user,from:'2026-10-01',to:'2026-10-03'};
 const report=await overview.leaveOverview(pool,input);
 assert.equal(report.days_taken,4);assert.deepEqual(report.by_type,[{leave_type:'Annual',days:2,count:1},{leave_type:'Official',days:2,count:1}]);
 assert.equal(report.monthly_trend[0].days,4);assert.equal(report.exceptions.pending_approvals,1);
 assert.equal((await overview.leaveOverview(pool,{...input,from:'2026-09-01'})).applications.total,5);
 const detail=await overview.leaveOverviewBreakdown(pool,{...input,dimension:'department',value:'HR'});
 assert.equal(detail.rows.reduce((n,r)=>n+r.days,0),report.by_department.find(d=>d.department_code==='HR').days);
 assert.ok(!JSON.stringify(report).includes('PRIVATE'));assert.ok(!JSON.stringify(detail).includes('PRIVATE'));
 await effect('cancel_grant',2);assert.equal((await overview.leaveOverview(pool,input)).days_taken,2);
 await assert.rejects(overview.leaveOverview(pool,{...input,user:{...user,permissions:{hr_report_read:true}}}),/Central HR/);
 await assert.rejects(overview.leaveOverview(pool,{...input,to:'2026-09-01'}),/reversed/);
 const year=new Date(Date.now()+12*3600000).getUTCFullYear();
 await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,balance,pending,year) VALUES($1,$3,50,5,$4),($2,$3,999,0,$4)',[legacy.id,government.id,annual.id,year]);
 const {DEFAULT_RULES}=await import('../lib/governmentLeaveRules.js');
 const policy=(await pool.query("INSERT INTO hr_gov_policy_versions(label,effective_from,effective_to,rules,source_reference,status,reason) VALUES('Dashboard policy','2020-01-01','2099-12-31',$1,'synthetic','published','synthetic') RETURNING id",[DEFAULT_RULES])).rows[0];
 const opening=(await pool.query(`INSERT INTO hr_gov_openings(employee_id,code,policy_version_id,period_start,period_end,as_of,amount,source_reference,payroll_reference,snapshot_hash,historical_snapshot,status,prepared_by,reason)
 VALUES($1,'recreation',$2,$3,$4,$3,21.77,'synthetic','synthetic','synthetic','[]','certified',$5,'synthetic') RETURNING id`,[government.id,policy.id,`${year}-01-01`,`${year}-12-31`,user.id])).rows[0];
 const entitlement=(await pool.query("INSERT INTO hr_gov_entitlements(employee_id,code,policy_version_id,period_start,period_end,as_of,opening_id) VALUES($1,'recreation',$2,$3,$4,$3,$5) RETURNING id",[government.id,policy.id,`${year}-01-01`,`${year}-12-31`,opening.id])).rows[0];
 await pool.query("INSERT INTO hr_gov_ledger(entitlement_id,kind,amount,effective_date,event_key,source_reference,actor_id,reason) VALUES($1,'opening',21.77,$2,$3,'synthetic',$4,'synthetic')",[entitlement.id,`${year}-01-01`,randomUUID(),user.id]);
 const reservation=randomUUID();await pool.query("INSERT INTO hr_gov_reservation_requests(id,employee_id,payload_hash,evaluation_snapshot) VALUES($1,$2,'synthetic','{}')",[reservation,government.id]);
 await pool.query("INSERT INTO hr_gov_reservations(request_id,entitlement_id,amount) VALUES($1,$2,3)",[reservation,entitlement.id]);
 const planning=await overview.leavePlanning(pool,{user});
 assert.deepEqual(planning.employees.find(e=>e.id===government.id).balances,{Recreation:{balance:21.77,pending:3}});
 assert.deepEqual(planning.employees.find(e=>e.id===legacy.id).balances.Annual,{balance:50,pending:5});
 const current=await overview.leaveOverview(pool,input);
 assert.equal(current.balance_by_type.find(b=>b.leave_type==='Recreation').available_days,18.77);
 assert.equal(current.balance_by_type.find(b=>b.leave_type==='Annual').available_days,45);
 await assert.rejects(overview.leavePlanning(pool,{user:{...user,permissions:{}}}),/Central HR/);
});
test('current Government absences drive today and coverage; upcoming totals retain days beyond the next-month window',{skip:skipWithoutDatabase},async()=>{
 await resetLeaveTables(pool);
 const user=(await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES($1,'Current overview HR','user','x',$2) RETURNING *",[`${randomUUID()}@example.test`,{hr_admin:true}])).rows[0];
 const employee=await createEmployee(pool,{name:'Current Government staff',department:'TEST'});
 const today=new Date(Date.now()+12*3600000).toISOString().slice(0,10);
 const offset=n=>new Date(Date.parse(`${today}T00:00:00Z`)+n*86400000).toISOString().slice(0,10);
 for(const [status,start,end,segments] of [
  ['approved',today,today,[{date:today,charge:'1'}]],
  ['approved',offset(1),offset(40),[{date:offset(1),charge:'1'},{date:offset(40),charge:'1'}]],
  ['pending',offset(50),offset(51),[]],
 ])await pool.query(`INSERT INTO hr_gov_requests(id,employee_id,code,start_date,end_date,reason,medical_mode,payload_hash,application_snapshot,department_id,division_id,charge,submitted_by,status,grant_snapshot,submitted_at)
 VALUES($1,$2,'official',$3,$4,'Synthetic grant','not_applicable','synthetic','{}',$5,$6,0,$7,$8,$9,NOW()-INTERVAL '6 days')`,[randomUUID(),employee.id,start,end,randomUUID(),randomUUID(),user.id,status,{evaluation:{segments}}]);
 const report=await overview.leaveOverview(pool,{user,from:today,to:today});
 assert.equal(report.days_taken,1);assert.equal(report.headcount.on_leave_today,1);
 assert.equal(report.upcoming.length,1);assert.equal(report.upcoming[0].days,2);
 assert.equal(report.exceptions.pending_approvals,1);assert.equal(report.exceptions.pending_over_five_days,1);
 assert.ok(report.exceptions.coverage_risks.some(r=>r.day===offset(1)&&r.people_out===1));
});

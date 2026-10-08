import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {connectTestDatabase,resetLeaveTables,skipWithoutDatabase} from '../test-support/database.js';
let pool,governmentActivity;
before(async()=>{if(!skipWithoutDatabase){pool=await connectTestDatabase();({governmentActivity}=await import('./governmentLeaveReporting.js'));}});
after(async()=>await pool?.end());
test('Government activity scopes before aggregation and totals dated grants after latest amendment',{skip:skipWithoutDatabase},async()=>{
 await resetLeaveTables(pool);
 const account=(await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES($1,'Synthetic report user','user','x','{}') RETURNING *",[`${randomUUID()}@example.test`])).rows[0];
 const departments=(await pool.query("INSERT INTO hr_departments(name) VALUES('Report scope inside'),('Report scope outside') RETURNING *")).rows;
 const employees=[];for(const d of departments)employees.push((await pool.query("INSERT INTO hr_employees(display_name,department_id) VALUES($1,$2) RETURNING *",[d.name,d.id])).rows[0]);
 await pool.query("INSERT INTO hr_access_scopes(reviewer_id,department_id,capabilities,effective_from,granted_by,reason) VALUES($1,$2,ARRAY['hr_report_read'],'2020-01-01',$1,'Synthetic verified report scope')",[account.id,departments[0].id]);
 const requests=[];for(const e of employees){const id=randomUUID();requests.push(id);await pool.query(`INSERT INTO hr_gov_requests(id,employee_id,code,start_date,end_date,reason,medical_mode,payload_hash,application_snapshot,department_id,division_id,charge,submitted_by,status,grant_snapshot)
 VALUES($1,$2,'official','2026-10-01','2026-10-03','PRIVATE MUST NOT APPEAR','not_applicable','synthetic','{}',$3,$4,0,$5,'approved',$6)`,[id,e.id,e.department_id,randomUUID(),account.id,{evaluation:{segments:[1,2,3].map(n=>({date:`2026-10-0${n}`,charge:'1.000000'}))}}]);}
 const amendment=randomUUID();await pool.query(`INSERT INTO hr_gov_requests(id,employee_id,code,start_date,end_date,reason,medical_mode,payload_hash,application_snapshot,department_id,division_id,charge,submitted_by,status)
 VALUES($1,$2,'amendment','2026-10-01','2026-10-02','PRIVATE AMENDMENT','not_applicable','synthetic','{}',$3,$4,0,$5,'approved')`,[amendment,employees[0].id,departments[0].id,randomUUID(),account.id]);
 await pool.query("INSERT INTO hr_gov_case_effects(request_id,original_request_id,effect,recorded_by,version) VALUES($1,$2,$3,$4,1)",[amendment,requests[0],{action:'shorten_grant',effective_end:'2026-10-02'},account.id]);
 const input={user:{...account,permissions:{hr_report_read:true}},from:'2026-10-02',to:'2026-10-03'};
 const report=await governmentActivity(pool,input);assert.equal(report.total,1);assert.equal(report.rows[0].id,requests[0]);assert.equal(report.rows[0].policy_days,'1.000000');assert.equal(report.rows[0].end_date,'2026-10-02');assert.equal(report.summary.total,2);assert.ok(!JSON.stringify(report).includes('PRIVATE'));
 assert.equal((await governmentActivity(pool,{...input,user:{...account,permissions:{}}})).summary.total,0);
 assert.equal((await governmentActivity(pool,{...input,user:{...account,permissions:{hr_admin:true}}})).total,2);
 const future=randomUUID();await pool.query(`INSERT INTO hr_gov_requests(id,employee_id,code,start_date,end_date,reason,medical_mode,payload_hash,application_snapshot,department_id,division_id,charge,submitted_by)
 VALUES($1,$2,'official','2027-01-01','2027-01-02','PRIVATE FUTURE','not_applicable','synthetic','{}',$3,$4,0,$5)`,[future,employees[0].id,departments[0].id,randomUUID(),account.id]);
 await pool.query("INSERT INTO hr_gov_request_stages(request_id,ordinal,level) VALUES($1,0,'chief_secretary')",[future]);
 const currentQueues=await governmentActivity(pool,input);assert.equal(currentQueues.summary.pending,1);assert.equal(currentQueues.total,1);assert.deepEqual(currentQueues.queue,[{level:'chief_secretary',applications:1}]);
 await assert.rejects(governmentActivity(pool,{...input,from:'2026-10-03',to:'2026-10-02'}),/reversed/);
});

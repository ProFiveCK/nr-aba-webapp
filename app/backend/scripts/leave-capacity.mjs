// Local-only, synthetic rehearsal. Never accepts an existing database or URL.
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import assert from 'node:assert/strict';
const backend=resolve(fileURLToPath(new URL('..',import.meta.url))),name=`ron-leave-capacity-${randomBytes(5).toString('hex')}`,output=mkdtempSync(join(tmpdir(),'leave-capacity-'));
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const samples={};let server,pool,log;
const freePort=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;};
async function parallel(count,limit,work){let cursor=0;await Promise.all(Array.from({length:Math.min(count,limit)},async()=>{for(;;){const i=cursor++;if(i>=count)return;await work(i);}}));}
async function measured(label,work){const start=performance.now();const result=await work();(samples[label]||=[]).push(performance.now()-start);return result;}
try{
 const password=randomBytes(24).toString('base64url');
 docker('run','-d','--rm','--name',name,'-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_USER=capacity','-e','POSTGRES_DB=leave_capacity','-p','127.0.0.1::5432','postgres:15');
 let ready=false;for(let i=0;i<60;i++){try{docker('exec',name,'pg_isready','-h','127.0.0.1','-U','capacity');ready=true;break;}catch{await delay(500);}}assert.ok(ready,'Disposable database did not become ready.');
 const dbPort=docker('port',name,'5432/tcp').trim().split(':').at(-1);
 Object.assign(process.env,{DATABASE_URL:`postgres://capacity:${password}@127.0.0.1:${dbPort}/leave_capacity`,JWT_SECRET:randomBytes(32).toString('hex'),NODE_ENV:'test',BCRYPT_ROUNDS:'12',SMTP_HOST:'',ACCRUAL_SCHEDULER:'off',GOVERNMENT_LEAVE_SCHEDULER:'off',AI_HELPER_ENABLED:'false',DEFAULT_ADMIN_EMAIL:'',DEFAULT_ADMIN_PASSWORD:''});
 const db=await import('../src/db.js');pool=db.pool;await db.initSchema();
 const auth=await import('../src/services/authService.js'),passwordHash=await auth.hashPassphrase(password);
 const hr=(await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES('hr@capacity.example.test','Synthetic capacity HR','user',$1,'{\"hr_admin\":true,\"hr_access\":true}') RETURNING *",[passwordHash])).rows[0];
 const _certifier=(await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES('certifier@capacity.example.test','Synthetic independent HR','user',$1,'{\"hr_admin\":true,\"hr_access\":true}') RETURNING *",[passwordHash])).rows[0];
 const people=Array.from({length:2000},(_,i)=>({id:randomUUID(),account:randomUUID(),name:`Synthetic employee ${String(i).padStart(4,'0')}`,payroll:`00${String(i).padStart(4,'0')}-A`,email:`employee${i}@capacity.example.test`}));
 const departments=(await pool.query("INSERT INTO hr_departments(name) SELECT 'Synthetic capacity department '||n FROM generate_series(1,10)n RETURNING id,name")).rows;
 const divisions=[];for(const d of departments)divisions.push((await pool.query("INSERT INTO hr_divisions(department_id,name) VALUES($1,'Synthetic capacity division') RETURNING id",[d.id])).rows[0].id);
 people.forEach((p,i)=>{p.department=departments[i%10].id;p.division=divisions[i%10];});
 const fixture=JSON.stringify(people);
 await pool.query(`INSERT INTO reviewers(id,email,display_name,role,password_hash,permissions,account_type,login_alias)
 SELECT account::uuid,email,name,'user',$2,'{"hr_access":true,"hr_leave_apply":true}'::jsonb,'employee',payroll FROM jsonb_to_recordset($1) AS p(account text,email text,name text,payroll text)`,[fixture,passwordHash]);
 await pool.query(`INSERT INTO hr_employees(id,display_name,reviewer_id,department_id,division_id,leave_policy_regime) SELECT id::uuid,name,account::uuid,department::uuid,division::uuid,'government' FROM jsonb_to_recordset($1) AS p(id text,name text,account text,department text,division text)`,[fixture]);
 await pool.query(`INSERT INTO hr_employee_external_ids(employee_id,source,external_id,verified_by,reason) SELECT id::uuid,'techone_payroll',payroll,$2,'Disposable synthetic capacity fixture' FROM jsonb_to_recordset($1) AS p(id text,payroll text)`,[fixture,hr.id]);
 const pattern=(await pool.query("INSERT INTO hr_work_patterns(name,working_weekdays,hours_per_day) VALUES('Synthetic capacity five-day schedule',ARRAY[1,2,3,4,5],7) RETURNING id")).rows[0];
 await pool.query("INSERT INTO hr_employee_service_periods(employee_id,start_date,employment_category,counts_for_service,work_pattern_id,reason) SELECT id,'2026-01-01','permanent',TRUE,$1,'Synthetic capacity fixture' FROM hr_employees",[pattern.id]);
 await pool.query("INSERT INTO hr_gov_service_bases(employee_id,effective_from,continuity_start,anniversary_method,leap_day_method,schedule_mode,source_reference,recorded_by,reason) SELECT id,'2026-01-01','2026-01-01','calendar','feb28','weekly','Synthetic capacity fixture',$1,'Synthetic capacity fixture' FROM hr_employees",[hr.id]);
 await pool.query("INSERT INTO hr_gov_pattern_approvals(work_pattern_id,source_reference,recorded_by,reason) VALUES($1,'Synthetic capacity fixture',$2,'Synthetic capacity fixture')",[pattern.id,hr.id]);
 const ledger=await import('../src/services/governmentLeave.js'),{DEFAULT_RULES}=await import('../src/lib/governmentLeaveRules.js'),reason='Disposable synthetic capacity fixture, not a policy authority.',args={user:hr,actor:{id:hr.id}};
 const policy=await ledger.createPolicy(pool,{...args,data:{label:'Synthetic capacity policy',effective_from:'2026-01-01',effective_to:'2027-12-31',rules:DEFAULT_RULES,source_reference:reason,reason}});await ledger.publishPolicy(pool,{...args,id:policy.id,reason});
 await ledger.createCalendar(pool,{...args,data:{label:'Synthetic capacity calendar',effective_from:'2026-01-01',effective_to:'2027-12-31',holidays:[],source_reference:reason,reason}});
 await pool.query("INSERT INTO hr_gov_entitlements(employee_id,code,policy_version_id,period_start,period_end,as_of) SELECT e.id,c.code,$1,'2026-01-01','2026-12-31','2026-10-01' FROM hr_employees e CROSS JOIN (VALUES('recreation'),('medical'),('special'))c(code)",[policy.id]);
 await pool.query("INSERT INTO hr_gov_ledger(entitlement_id,kind,amount,effective_date,event_key,source_reference,actor_id,reason) SELECT id,'opening',CASE code WHEN 'recreation' THEN 20 WHEN 'medical' THEN 10 ELSE 3 END,'2026-10-01','synthetic-opening:'||id,$1,$2,$1 FROM hr_gov_entitlements",[reason,hr.id]);
 const segments=Array.from({length:14},(_,i)=>({date:`2026-11-${String(i+1).padStart(2,'0')}`,charge:[0,6].includes(new Date(`2026-11-${String(i+1).padStart(2,'0')}T00:00:00Z`).getUTCDay())?'0.000000':'1.000000',scheduled_hours:[0,6].includes(new Date(`2026-11-${String(i+1).padStart(2,'0')}T00:00:00Z`).getUTCDay())?0:7,policy_version_id:policy.id}));
 const grants=people.map(p=>({id:randomUUID(),employee:p.id,department:p.department,division:p.division,snapshot:{employee:{id:p.id,name:p.name},evaluation:{segments}}}));
 await pool.query(`INSERT INTO hr_gov_requests(id,employee_id,code,start_date,end_date,reason,medical_mode,payload_hash,application_snapshot,department_id,division_id,charge,submitted_by,status,grant_snapshot,final_pdf)
 SELECT id::uuid,employee::uuid,'official','2026-11-01','2026-11-14',$2,'not_applicable','synthetic',snapshot,department::uuid,division::uuid,0,$3,'approved',snapshot,decode('255044462d312e372073796e746865746963','hex') FROM jsonb_to_recordset($1) AS p(id text,employee text,department text,division text,snapshot jsonb)`,[JSON.stringify(grants),reason,hr.id]);
 await parallel(people.length,10,async i=>{const session=await auth.createSession(people[i].account);people[i].token=auth.buildTokenPayload({id:people[i].account,role:'user'},session.tokenId,session.expiresAt);});
 const hrSession=await auth.createSession(hr.id),hrToken=auth.buildTokenPayload(hr,hrSession.tokenId,hrSession.expiresAt);
 const port=await freePort(),base=`http://127.0.0.1:${port}`;log=openSync(join(output,'api.log'),'w',0o600);
 server=spawn(process.execPath,['src/server.js'],{cwd:backend,env:{...process.env,PORT:String(port),FRONTEND_BASE_URL:base,CORS_ORIGIN:base},stdio:['ignore',log,log]});
 ready=false;for(let i=0;i<120;i++){if(server.exitCode!==null)break;try{if((await fetch(`${base}/health`)).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready,'Disposable API did not start; see api.log.');
 async function get(path,token,validate){const r=await fetch(base+path,{headers:{Authorization:`Bearer ${token}`}});assert.equal(r.status,200,path);const body=await r.json();validate?.(body);return body;}
 // Real password login, bcrypt cost 12, valid accounts through shared-NAT limits.
 await parallel(50,10,async i=>measured('password_login_10_concurrent',async()=>{const r=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({login_alias:people[i].payroll,password})});assert.equal(r.status,200);const body=await r.json();assert.equal(body.reviewer.id,people[i].account);}));
 await parallel(2000,50,async i=>measured('own_foundations_50_concurrent',()=>get(`/api/hr/government/employees/${people[i].id}`,people[i].token,b=>assert.equal(b.employee.id,people[i].id))));
 await parallel(120,30,async i=>measured('directory_30_concurrent',()=>get(`/api/hr/directory?page=${i%40+1}`,hrToken,b=>{assert.equal(b.total,2000);assert.equal(b.employees.length,50);})));
 await parallel(80,20,async()=>measured('approval_register_20_concurrent',()=>get('/api/hr/government/workflow/requests?mode=all&status=approved',hrToken,b=>assert.equal(b.total,2000))));
 const payroll=await import('../src/services/governmentLeavePayroll.js');
 const batch=await measured('payroll_28000_lines',()=>payroll.preparePayroll(pool,{...args,data:{batch_id:randomUUID(),period_start:'2026-11-01',period_end:'2026-11-14',source_reference:reason,reason}}));
 assert.equal(batch.snapshot.lines.length,28000);
 await parallel(2,2,async()=>measured('payroll_export_2_concurrent',()=>get(`/api/hr/government/payroll/registers/${batch.id}/export`,hrToken,b=>assert.equal(b.snapshot.lines.length,28000))));
 const denied=await fetch(`${base}/api/hr/government/employees/${people[1].id}`,{headers:{Authorization:`Bearer ${people[0].token}`}});assert.equal(denied.status,404);
 const unauthorized=await fetch(`${base}/api/hr/government/rollout/operations`,{headers:{Authorization:`Bearer ${people[0].token}`}});assert.equal(unauthorized.status,403);
 const summary=Object.fromEntries(Object.entries(samples).map(([key,values])=>{values.sort((a,b)=>a-b);return [key,{requests:values.length,p50_ms:Math.round(values[Math.floor(values.length*.5)]),p95_ms:Math.round(values[Math.min(values.length-1,Math.floor(values.length*.95))]),max_ms:Math.round(values.at(-1))}];}));
 const limits={password_login_10_concurrent:10000,own_foundations_50_concurrent:2000,directory_30_concurrent:2000,approval_register_20_concurrent:2000,payroll_28000_lines:15000,payroll_export_2_concurrent:10000};
 const passed=Object.entries(summary).every(([key,value])=>value.p95_ms<=limits[key]);
 const report={format:'ron-leave-capacity-rehearsal-1',at:new Date().toISOString(),employees:2000,active_sessions:2000,max_concurrent_http:50,node:process.version,host:'Local workstation, disposable PostgreSQL 15 and actual API server; no production sizing claim',password_cost:Number(passwordHash.split('$')[2]),summary,p95_budgets_ms:limits,zero_http_errors:true,cross_employee_access_denied:true,payroll_lines:28000,passed,memory_rss_mb:Math.round(process.memoryUsage().rss/1024/1024)};
 writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({output,...report},null,2));if(!passed)process.exitCode=1;
}finally{
 if(server){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),delay(3000)]);if(server.exitCode===null)server.kill('SIGKILL');}
 if(log!==undefined)closeSync(log);await pool?.end();try{docker('rm','-f',name);}catch{}
}

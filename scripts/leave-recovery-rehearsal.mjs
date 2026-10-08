import {execFileSync,spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,chmodSync,openSync,closeSync,readdirSync,statSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const image='ron-leave-review-api:local',db='leave_production_review',role='restore_rehearsal';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
const sql=(container,statement)=>execFileSync('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U',role,'-d',db],{input:statement,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
const delay=()=>new Promise(r=>setTimeout(r,500));
const protectedFile=(path,data)=>{writeFileSync(path,data,{mode:0o600});chmodSync(path,0o600);};
const files=directory=>readdirSync(directory,{recursive:true}).filter(path=>statSync(resolve(directory,path)).isFile()).sort().map(path=>({path,sha256:sha(readFileSync(resolve(directory,path)))}));
export async function runDisposableRecovery() {
 const suffix=randomBytes(5).toString('hex'),prefix=`ron-leave-recovery-${suffix}`,source=`${prefix}-source`,restored=`${prefix}-restored`,api=`${prefix}-api`,gateway=`${prefix}-gateway`,network=`${prefix}-internal`,frontend=`${prefix}-frontend`;
 const output=resolve(root,'.leave-review',`full-recovery-${Date.now()}`),bundle=resolve(output,'source-bundle'),recovered=resolve(output,'restored-bundle');
 for(const dir of [output,bundle,recovered,resolve(bundle,'runtime'),resolve(bundle,'uploads')]){mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);}
 const dump=resolve(output,'database.dump'),archive=resolve(output,'application-files.tar');
 const secret={password:randomBytes(24).toString('base64url'),dbPassword:randomBytes(24).toString('hex'),jwt:randomBytes(32).toString('hex'),dataKey:randomBytes(32).toString('hex'),smtpKey:randomBytes(32).toString('hex'),encryptedValue:randomBytes(16).toString('hex')};
 protectedFile(resolve(bundle,'runtime/private.json'),JSON.stringify(secret));
 const postgresEnv=resolve(output,'postgres.env');protectedFile(postgresEnv,`POSTGRES_USER=${role}\nPOSTGRES_DB=${db}\nPOSTGRES_PASSWORD=${secret.dbPassword}\n`);
 let snapshotHolder,dumpFd;const started=performance.now();
 function appEnv(host,restoredSecrets) {
  const path=resolve(output,`${host}.env`);
  protectedFile(path,Object.entries({NODE_ENV:'development',LOCAL_REVIEW_ONLY:'production-copy',RECOVERY_REHEARSAL:'isolated-fixture',DB_HOST:host,DB_NAME:db,DB_USER:role,DB_PASSWORD:restoredSecrets.dbPassword,JWT_SECRET:restoredSecrets.jwt,DATA_ENC_KEY:restoredSecrets.dataKey,SMTP_ENC_KEY:restoredSecrets.smtpKey,SMTP_HOST:'',DEFAULT_ADMIN_EMAIL:'',DEFAULT_ADMIN_PASSWORD:'',ACCRUAL_SCHEDULER:'off',GOVERNMENT_LEAVE_SCHEDULER:'off',AI_HELPER_ENABLED:'false',PORT:'4000',TZ:'UTC'}).map(([key,value])=>`${key}=${value}`).join('\n')+'\n');return path;
 }
 const mounts=directory=>['-v',`${resolve(root,'app/backend/src')}:/app/src:ro`,'-v',`${resolve(root,'scripts/leave-recovery-fixture.mjs')}:/app/leave-recovery-fixture.mjs:ro`,'-v',`${directory}:/rehearsal`,'-v',`${resolve(directory,'uploads')}:/app/uploads`];
 async function startDatabase(name) {
  docker('run','-d','--rm','--network',network,'--name',name,'--env-file',postgresEnv,'postgres:15');
  for(let i=0;i<60;i++){try{docker('exec',name,'pg_isready','-h','127.0.0.1','-U',role);return;}catch{await delay();}}throw new Error('Disposable database readiness timed out.');
 }
 function fixture(container,directory,env,mode) {
  const fd=openSync(resolve(output,`${mode}.log`),'a',0o600);
  try{execFileSync('docker',['run','--rm','--name',container,'--network',network,'--env-file',env,...mounts(directory),image,'node','leave-recovery-fixture.mjs',mode],{stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
 }
 try {
  docker('image','inspect',image);docker('network','create','--internal',network);docker('network','create',frontend);
  await startDatabase(source);const sourceEnv=appEnv(source,secret);
  fixture(`${prefix}-seed`,bundle,sourceEnv,'seed');
  // Export one database snapshot. Source writers are already stopped, so the
  // application-file archive and its references form the same quiescent point.
  snapshotHolder=spawn('docker',['exec','-i',source,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U',role,'-d',db],{stdio:['pipe','pipe','pipe']});
  const lines=createInterface({input:snapshotHolder.stdout});
  const snapshot=await new Promise((r,reject)=>{const timer=setTimeout(()=>reject(new Error('Snapshot timed out.')),15000);snapshotHolder.once('error',reject);snapshotHolder.once('exit',()=>{clearTimeout(timer);reject(new Error('Snapshot holder exited.'));});lines.on('line',line=>{if(/^[0-9A-F]+-[0-9A-F]+-\d+$/i.test(line)){clearTimeout(timer);r(line);}});snapshotHolder.stdin.write('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n');});
  const snapshotPrefix=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '${snapshot}';\n`;
  const tables=JSON.parse(sql(source,snapshotPrefix+"SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'; COMMIT;"));
  const queries=tables.map(table=>{const identifier='"'+table.replaceAll('"','""')+'"',literal="'"+table.replaceAll("'","''")+"'";return `SELECT ${literal} AS table_name,count(*)::bigint AS rows,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) AS row_set_md5 FROM (SELECT md5(row_to_json(t)::text) AS h FROM public.${identifier} t) q`;}).join(' UNION ALL ');
  const manifestSql=`SELECT json_agg(row_to_json(m) ORDER BY table_name COLLATE "C") FROM (${queries}) m;`,original=JSON.parse(sql(source,snapshotPrefix+manifestSql+' COMMIT;'));
  dumpFd=openSync(dump,'w',0o600);execFileSync('docker',['exec',source,'pg_dump','-U',role,'-d',db,'--format=custom','--no-owner','--no-privileges',`--snapshot=${snapshot}`],{stdio:['ignore',dumpFd,'pipe']});closeSync(dumpFd);dumpFd=undefined;
  snapshotHolder.stdin.end('COMMIT;\n');await new Promise((r,reject)=>snapshotHolder.once('exit',code=>code===0?r():reject(new Error('Snapshot holder failed.'))));snapshotHolder=null;
  const originalFiles=files(bundle);execFileSync('tar',['-cf',archive,'-C',bundle,'.']);chmodSync(archive,0o600);
  // Source is removed before starting the restored application: all following
  // successful login, decrypt and downloads must come from recovered material.
  docker('rm','-f',source);
  await startDatabase(restored);docker('cp',dump,`${restored}:/tmp/database.dump`);
  docker('exec',restored,'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U',role,'-d',db,'/tmp/database.dump');
  assert.deepEqual(JSON.parse(sql(restored,manifestSql)),original,'Restored row hashes differ.');
  assert.equal(sql(restored,"SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('hr_gov_ledger_immutable','hr_gov_request_facts_guard','hr_gov_rollout_waves_immutable','hr_gov_policy_immutable','hr_gov_policy_transition_immutable');"),'5','Immutable history triggers were not restored.');
  assert.equal(sql(restored,`SELECT count(*) FROM hr_gov_entitlements e WHERE COALESCE((SELECT sum(l.amount) FROM hr_gov_ledger l WHERE l.entitlement_id=e.id),0)<COALESCE((SELECT sum(h.amount) FROM hr_gov_reservations h JOIN hr_gov_reservation_requests r ON r.id=h.request_id WHERE h.entitlement_id=e.id AND r.status='held'),0)+COALESCE((SELECT sum(h.amount) FROM hr_gov_case_credit_holds h JOIN hr_gov_requests r ON r.id=h.request_id WHERE h.entitlement_id=e.id AND r.status='pending' AND h.determination_id=(SELECT id FROM hr_gov_case_determinations d WHERE d.request_id=r.id ORDER BY version DESC LIMIT 1)),0);`),'0','Restored credit is over-held.');

  execFileSync('tar',['-xf',archive,'-C',recovered]);assert.deepEqual(files(recovered),originalFiles,'Recovered application files or key material differ.');
  const restoredSecrets=JSON.parse(readFileSync(resolve(recovered,'runtime/private.json'),'utf8')),metadata=JSON.parse(readFileSync(resolve(recovered,'runtime/fixture.json'),'utf8'));
  const restoreEnv=appEnv(restored,restoredSecrets);
  docker('run','-d','--rm','--name',api,'--network',network,'--env-file',restoreEnv,...mounts(recovered),image,'node','src/server.js');
  docker('run','-d','--rm','--name',gateway,'--network',frontend,'-e',`RECOVERY_API_HOST=${api}`,'-p','127.0.0.1::4000','-v',`${resolve(root,'scripts/leave-recovery-proxy.mjs')}:/app/recovery-proxy.mjs:ro`,image,'node','recovery-proxy.mjs');
  docker('network','connect',network,gateway);
  const apiNetworks=JSON.parse(docker('inspect',api))[0].NetworkSettings.Networks;assert.deepEqual(Object.keys(apiNetworks),[network]);
  const portBinding=docker('port',gateway,'4000/tcp');assert.match(portBinding,/^127\.0\.0\.1:\d+$/);const url=`http://${portBinding}`;
  let healthy=false;for(let i=0;i<60;i++){try{if((await fetch(url+'/health',{signal:AbortSignal.timeout(1500)})).ok){healthy=true;break;}}catch{}await delay();}assert.ok(healthy,'Restored actual API startup failed.');
  const request=async(path,data,token)=>{
   const response=await fetch(url+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(15000)});
   assert.equal(response.status,200,`Restored API operation failed: ${path}`);return response;
  };
  await request('/api/auth/me',null,metadata.existingToken);
  const login=await request('/api/auth/login',{email:metadata.admin_email,password:restoredSecrets.password});assert.ok(login.headers.get('set-cookie')?.includes('HttpOnly'));const auth=await login.json();assert.ok(auth.token);
  const employeeLogin=await request('/api/auth/login',{login_alias:'RECOVERY-EMPLOYEE',password:restoredSecrets.password});assert.ok((await employeeLogin.json()).token);
  const pdf=Buffer.from(await (await request(`/api/hr/government/workflow/requests/${metadata.granted_id}/pdf`,null,auth.token)).arrayBuffer());assert.equal(sha(pdf),metadata.pdf_sha256);
  const evidence=Buffer.from(await (await request(`/api/hr/government/workflow/requests/${metadata.granted_id}/documents/${metadata.document_id}`,null,auth.token)).arrayBuffer());assert.equal(sha(evidence),metadata.evidence_sha256);
  const batch=await (await request('/api/batches/RECOVERY-ARCHIVE',null,auth.token)).json();assert.equal(sha(Buffer.from(batch.file_base64,'base64')),metadata.archive_sha256);
  for(let i=0;i<2;i++){const replay=await (await request(`/api/hr/government/workflow/employees/${metadata.employee_id}/run-jobs`,{as_of:metadata.day},auth.token)).json();assert.ok(replay.results.every(r=>!r.posts?.length&&!r.renewals?.length));}
  fixture(`${prefix}-verify`,recovered,restoreEnv,'verify');const verified=JSON.parse(readFileSync(resolve(recovered,'verification.json'),'utf8'));
  const networkConfig=JSON.parse(docker('network','inspect',network));assert.equal(networkConfig[0].Internal,true);
  const smtpGuard=docker('exec',api,'node','--input-type=module','-e',"const {localProductionReview}=await import('./src/services/localReviewMode.js');if(!localProductionReview)process.exit(1);");assert.equal(smtpGuard,'');
  const runtime={node:docker('exec',api,'node','-e','process.stdout.write(process.version)'),postgres:sql(restored,'SHOW server_version;')};
  const dockerResources=JSON.parse(docker('info','--format','{"cpus":{{.NCPU}},"memory_bytes":{{.MemTotal}},"architecture":{{json .Architecture}},"operating_system":{{json .OperatingSystem}}}'));
  const report={runtime,docker_resources:dockerResources,format:'ron-leave-full-recovery-rehearsal-1',at:new Date().toISOString(),source:'self-contained synthetic disposable fixture',snapshot_consistent:true,application_files_quiescent_snapshot:true,source_removed_before_restored_startup:true,tables:original.length,source_manifest:original,all_restored_row_hashes_match:true,dump_sha256:sha(readFileSync(dump)),application_archive_sha256:sha(readFileSync(archive)),file_manifest:originalFiles,all_restored_file_hashes_match:true,actual_api_startup:true,restored_password_login:true,restored_payroll_alias_login:true,pre_backup_session_and_jwt_restored:true,http_only_login_cookie:true,immutable_triggers_preserved:true,held_entitlement_invariant:true,approved_pdf_api_hash_match:true,evidence_api_hash_match:true,batch_archive_api_hash_match:true,restored_generated_key_material:true,...verified,loopback_only_api:true,internal_network:true,mail_and_schedulers_disabled:true,measurement_scope:'Entire synthetic fixture creation, backup, restore and application verification; excludes cleanup.',restore_seconds:Math.round((performance.now()-started)/1000),production_recovery_acceptance:false,external_offhost_backup_acceptance:false};
  protectedFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({output:relative(root,output),tables:report.tables,all_restored_row_hashes_match:true,all_restored_file_hashes_match:true,actual_api_startup:true,password_and_payroll_alias_login:true,approved_pdf_and_evidence_hash_match:true,encryption_key_decrypt_roundtrip:true,job_replay_idempotent:true,pending_hold_preserved:true,restore_seconds:report.restore_seconds,production_recovery_acceptance:false},null,2));
 } catch(error) {
  try{protectedFile(resolve(output,'failure.json'),JSON.stringify({at:new Date().toISOString(),message:error.message.split('\n')[0]}));if(docker('ps','-a','--filter',`name=^${api}$`,'-q'))protectedFile(resolve(output,'api.log'),docker('logs',api));}catch{}
  throw new Error(`Recovery rehearsal failed; private diagnostics: ${output}`,{cause:undefined});
 } finally {
  if(dumpFd!==undefined)closeSync(dumpFd);if(snapshotHolder){snapshotHolder.stdin.end('ROLLBACK;\n');snapshotHolder.kill('SIGTERM');}
  for(const container of [gateway,api,`${prefix}-seed`,`${prefix}-verify`,source,restored]){try{docker('rm','-f',container);}catch{}}
  for(const item of [network,frontend]){try{docker('network','rm',item);}catch{}}
 }
}

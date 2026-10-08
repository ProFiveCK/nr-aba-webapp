// --local-review: snapshot-consistent backup of ONLY ron-leave-review.
// --disposable-fixture: full API/files/keys recovery of an isolated synthetic source.
// Neither mode restores, truncates or targets a production database.
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,openSync,closeSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
if(process.argv[2]==='--disposable-fixture') {
 if(process.argv.length!==3)throw new Error('Disposable recovery accepts no source or target arguments.');
 await (await import('./leave-recovery-rehearsal.mjs')).runDisposableRecovery();
 process.exit(0);
}
if(process.argv[2]!=='--local-review')throw new Error('Use --local-review or --disposable-fixture; this tool cannot target production.');
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),name=`ron-leave-restore-${randomBytes(5).toString('hex')}`;
const output=resolve(root,'.leave-review',`restore-${Date.now()}`),dump=resolve(output,'database.dump');
mkdirSync(output,{recursive:true,mode:0o700});chmodSync(output,0o700);
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']});
const compose=['compose','--env-file',resolve(root,'.leave-review/runtime.env'),'-f',resolve(root,'docker-compose.leave-review.yml')];
const source=docker(...compose,'ps','-q','postgres').trim();assert.ok(source,'Local review database is not running.');
assert.equal(docker('inspect','--format','{{index .Config.Labels "com.docker.compose.project"}}',source).trim(),'ron-leave-review');
const psql=(container,user,db,sql)=>execFileSync('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U',user,'-d',db],{input:sql,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(psql(source,'leave_review','leave_review','SELECT current_database();'),'leave_review');
let holder,dumpFd;
try{
 // Keep the source transaction open while pg_dump and the manifest both import
 // the same exported snapshot. Concurrent walkthrough writes do not invalidate it.
 holder=spawn('docker',['exec','-i',source,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','leave_review','-d','leave_review'],{stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:holder.stdout});
 const snapshot=await new Promise((resolveSnapshot,reject)=>{const timer=setTimeout(()=>reject(new Error('Snapshot export timed out.')),15000);holder.once('error',reject);holder.once('exit',()=>{clearTimeout(timer);reject(new Error('Snapshot holder exited.'));});lines.on('line',line=>{if(/^[0-9A-F]+-[0-9A-F]+-\d+$/i.test(line)){clearTimeout(timer);resolveSnapshot(line);}});holder.stdin.write('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n');});
 const prefix=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '${snapshot}';\n`;
 const tables=JSON.parse(psql(source,'leave_review','leave_review',prefix+"SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'; COMMIT;"));
 // Hash each complete row, including BYTEA documents, then hash the sorted set
 // of row hashes. No employee values, passwords or document contents in manifest.
 const manifests=tables.map(table=>{const identifier='"'+table.replaceAll('"','""')+'"',literal="'"+table.replaceAll("'","''")+"'";return `SELECT ${literal} AS table_name,count(*)::bigint AS rows,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) AS row_set_md5 FROM (SELECT md5(row_to_json(t)::text) AS h FROM public.${identifier} t) q`;}).join(' UNION ALL ');
 const manifestSql=`SELECT json_agg(row_to_json(m) ORDER BY table_name COLLATE "C") FROM (${manifests}) m;`;
 const original=JSON.parse(psql(source,'leave_review','leave_review',prefix+manifestSql+' COMMIT;'));
 dumpFd=openSync(dump,'w',0o600);
 execFileSync('docker',['exec',source,'pg_dump','-U','leave_review','-d','leave_review','--format=custom','--no-owner','--no-privileges',`--snapshot=${snapshot}`],{stdio:['ignore',dumpFd,'pipe']});closeSync(dumpFd);dumpFd=undefined;
 holder.stdin.end('COMMIT;\n');await new Promise((r,reject)=>{holder.once('exit',code=>code===0?r():reject(new Error('Snapshot holder failed.')));});holder=null;
 const start=performance.now(),password=randomBytes(24).toString('hex');
 docker('run','-d','--rm','--name',name,'-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_USER=restore_rehearsal','-e','POSTGRES_DB=leave_restored','postgres:15');
 let ready=false;for(let i=0;i<60;i++){try{docker('exec',name,'pg_isready','-h','127.0.0.1','-U','restore_rehearsal');ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}assert.ok(ready,'Disposable restore database did not become ready.');
 docker('cp',dump,`${name}:/tmp/database.dump`);
 docker('exec',name,'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','restore_rehearsal','-d','leave_restored','/tmp/database.dump');
 const restored=JSON.parse(psql(name,'restore_rehearsal','leave_restored',manifestSql));
 assert.deepEqual(restored,original,'Restored table counts or row hashes differ.');
 const invariants=psql(name,'restore_rehearsal','leave_restored',`SELECT count(*) FROM hr_gov_entitlements e WHERE COALESCE((SELECT sum(l.amount) FROM hr_gov_ledger l WHERE l.entitlement_id=e.id),0)<COALESCE((SELECT sum(h.amount) FROM hr_gov_reservations h JOIN hr_gov_reservation_requests r ON r.id=h.request_id WHERE h.entitlement_id=e.id AND r.status='held'),0)+COALESCE((SELECT sum(h.amount) FROM hr_gov_case_credit_holds h JOIN hr_gov_requests r ON r.id=h.request_id WHERE h.entitlement_id=e.id AND r.status='pending' AND h.determination_id=(SELECT id FROM hr_gov_case_determinations d WHERE d.request_id=r.id ORDER BY version DESC LIMIT 1)),0);`);
 assert.equal(invariants,'0','A restored entitlement is over-held.');
 const immutability=psql(name,'restore_rehearsal','leave_restored',`SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('hr_gov_ledger_immutable','hr_gov_request_facts_guard','hr_gov_rollout_waves_immutable');`);assert.equal(immutability,'3','Required immutable-history triggers were not restored.');
 const report={format:'ron-leave-restore-rehearsal-1',at:new Date().toISOString(),source:'ron-leave-review / leave_review',snapshot_consistent:true,dump_sha256:createHash('sha256').update(readFileSync(dump)).digest('hex'),tables:original.length,source_manifest:original,all_restored_row_hashes_match:true,documents_and_pdfs_included:true,held_entitlement_invariant:true,immutable_triggers_preserved:true,restore_seconds:Math.round((performance.now()-start)/1000),production_recovery_acceptance:false};
 writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({output,tables:report.tables,all_restored_row_hashes_match:true,restore_seconds:report.restore_seconds,dump_sha256:report.dump_sha256},null,2));
}finally{
 if(dumpFd!==undefined)closeSync(dumpFd);if(holder){holder.stdin.end('ROLLBACK;\n');holder.kill('SIGTERM');}try{docker('rm','-f',name);}catch{}
}

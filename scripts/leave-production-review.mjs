// Restore only into a fresh, fixed local COPY. No existing database is replaced.
import {execFileSync,spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import dotenv from '../app/backend/node_modules/dotenv/lib/main.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const runtime=resolve(root,'.leave-production-review'),envFile=resolve(runtime,'runtime.env');
mkdirSync(runtime,{recursive:true,mode:0o700});chmodSync(runtime,0o700);
if(!existsSync(envFile)){
  const commonDir=resolve(root,execFileSync('git',['rev-parse','--git-common-dir'],{cwd:root,encoding:'utf8'}).trim());
  const sourceEnv=resolve(dirname(commonDir),'.env.prod');
  const prior=existsSync(sourceEnv)?dotenv.parse(readFileSync(sourceEnv)):{};
  const smtpKey=prior.SMTP_ENC_KEY||randomBytes(32).toString('hex');
  writeFileSync(envFile,`LEAVE_COPY_DB_PASSWORD=${randomBytes(24).toString('hex')}\nLEAVE_COPY_JWT_SECRET=${randomBytes(32).toString('hex')}\nLEAVE_COPY_SMTP_KEY=${smtpKey}\nLEAVE_COPY_DATA_KEY=${prior.DATA_ENC_KEY||smtpKey}\n`,{mode:0o600});
}
const compose=['compose','--env-file',envFile,'-f',resolve(root,'docker-compose.leave-production-review.yml')];
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']});
const container=()=>{const id=docker(...compose,'ps','-q','postgres').trim();assert.ok(id,'Start the isolated copy database first.');assert.equal(docker('inspect','--format','{{index .Config.Labels "com.docker.compose.project"}}',id).trim(),'ron-leave-production-review');return id;};
const sql=(text)=>{const id=container();return execFileSync('docker',['exec','-i',id,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','leave_review','-d','leave_production_review'],{input:text,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}).trim();};
const write=(name,data)=>writeFileSync(resolve(runtime,name),JSON.stringify(data,null,2),{mode:0o600});
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const snapshot=(tables,excludeLocal=false)=>Object.fromEntries(tables.map(({name,columns})=>{const filter=!excludeLocal?'':name==='reviewers'?" WHERE email IS DISTINCT FROM 'local-migration-review@localhost.invalid'":name==='reviewer_sessions'?" WHERE reviewer_id NOT IN (SELECT id FROM reviewers WHERE email='local-migration-review@localhost.invalid')":'';return [name,JSON.parse(sql(`SELECT json_build_object('rows',count(*),'hash',md5(COALESCE(string_agg(h,'' ORDER BY h),''))) FROM (SELECT md5(row_to_json(t)::text) AS h FROM (SELECT ${columns.map(quote).join(',')} FROM public.${quote(name)}${filter}) t) q;`))];}));
const action=process.argv[2];
if(action==='restore'){
  const backup=resolve(process.argv[3]||'');assert.ok(backup.endsWith('.sql.gz')&&existsSync(backup),'Provide the saved .sql.gz backup.');
  // Validate COPY boundaries and psql commands without displaying personal data.
  const tables=[];let copying=false,rows=0,totalRows=0;
  const reader=createInterface({input:createReadStream(backup).pipe(createGunzip()),crlfDelay:Infinity});
  for await(const line of reader){
    if(copying){if(line==='\\.'){tables.at(-1).source_rows=rows;totalRows+=rows;copying=false;}else rows++;continue;}
    const match=line.match(/^COPY public\.([a-zA-Z0-9_]+) \(([^)]+)\) FROM stdin;$/);
    if(match){tables.push({name:match[1],columns:match[2].split(',').map(x=>x.trim().replace(/^"|"$/g,'')),source_rows:0});copying=true;rows=0;continue;}
    if(line.startsWith('\\'))assert.match(line,/^\\(?:unrestrict|restrict) [a-zA-Z0-9]+$/, 'Unexpected psql command in backup.');
    assert.ok(!/^(?:CREATE DATABASE|DROP DATABASE|\\connect|COPY .*PROGRAM)/i.test(line),'Unexpected database or program command.');
  }
  assert.ok(!copying&&tables.length>0,'Incomplete or unsupported SQL backup.');
  docker(...compose,'up','-d','--wait','--wait-timeout','120','postgres');
  assert.equal(sql('SELECT current_database();'),'leave_production_review');
  assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public';"),'0','Copy database already contains records; restore refuses to overwrite it.');
  const id=container(),restoreLog=resolve(runtime,'restore.log');
  const output=[];const proc=spawn('docker',['exec','-i',id,'psql','-X','-q','--single-transaction','-v','ON_ERROR_STOP=1','-U','leave_review','-d','leave_production_review'],{stdio:['pipe','pipe','pipe']});
  proc.stdout.on('data',x=>output.push(x));proc.stderr.on('data',x=>output.push(x));
  const done=new Promise((r,reject)=>{proc.once('error',reject);proc.once('exit',code=>code===0?r():reject(new Error('Restore failed; details retained in restricted local restore.log.')));});
  createReadStream(backup).pipe(createGunzip()).pipe(proc.stdin);
  try{await done;}finally{writeFileSync(restoreLog,Buffer.concat(output),{mode:0o600});}
  const baseline=snapshot(tables);
  for(const t of tables)assert.equal(baseline[t.name].rows,t.source_rows,`Restored row count differs: ${t.name}`);
  const metadata={backup:backup.split('/').at(-1),sha256:createHash('sha256').update(readFileSync(backup)).digest('hex'),tables,totalRows,baseline,restored_at:new Date().toISOString()};write('baseline.json',metadata);
  console.log(`Restored ${tables.length} tables and ${totalRows} rows into the isolated local copy. Source row counts match.`);
}else if(action==='up'){
  assert.ok(existsSync(resolve(runtime,'baseline.json')),'Restore and validate the backup before starting the application.');
  const demo=['compose','--env-file',resolve(root,'.leave-review/runtime.env'),'-f',resolve(root,'docker-compose.leave-review.yml')];
  docker(...demo,'stop');
  docker(...compose,'up','-d','--wait','--wait-timeout','180');
  console.log('Production-copy review available at http://localhost:8081/review/local');
}else if(action==='audit'){
  const source=JSON.parse(readFileSync(resolve(runtime,'baseline.json'),'utf8')),after=snapshot(source.tables,true);
  const differences=source.tables.filter(t=>JSON.stringify(after[t.name])!==JSON.stringify(source.baseline[t.name])).map(t=>({table:t.name,before:source.baseline[t.name],after:after[t.name]}));
  const report={backup:source.backup,sha256:source.sha256,checked_at:new Date().toISOString(),excluded_local_review_account_and_sessions:true,tables:source.tables.length,unchanged_tables:source.tables.length-differences.length,differences};write('upgrade-audit.json',report);console.log(JSON.stringify(report,null,2));
}else if(action==='status')console.log(docker(...compose,'ps'));
else if(action==='stop'){docker(...compose,'stop');console.log('Local production-copy services stopped; databases retained.');}
else throw new Error('Use restore <backup.sql.gz>, up, audit, status or stop.');

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function run(source,override={}){
  return spawnSync(process.execPath,['--input-type=module','-e',source],{
    cwd:new URL('../..',import.meta.url),encoding:'utf8',
    env:{PATH:process.env.PATH,NODE_ENV:'development',DB_NAME:'leave_production_review',DB_USER:'local_test',DB_PASSWORD:'local_test',JWT_SECRET:'0123456789abcdef0123456789abcdef',SMTP_ENC_KEY:'a'.repeat(64),LOCAL_REVIEW_ONLY:'production-copy',...override},
  });
}
test('restored SMTP settings cannot load a transport or send mail in the isolated copy',()=>{
  const result=run("const mail=await import('./src/services/mailService.js'); if(await mail.reloadMailTransport()!==null || mail.mailTransport!==null)throw Error('Transport enabled'); await mail.sendMail({to:'nobody@example.invalid',subject:'Blocked local review'}); console.log('blocked');",{SMTP_HOST:'smtp.example.invalid'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/blocked/);assert.doesNotMatch(result.stdout,/nobody@example/);
});
test('copy mode refuses to run in production',()=>{
  const result=run("await import('./src/services/localReviewMode.js');",{NODE_ENV:'production'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/isolated development database/);
});
test('copy mode refuses an ordinary database name',()=>{
  const result=run("await import('./src/services/localReviewMode.js');",{DB_NAME:'aba'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/isolated development database/);
});
test('normal deployments retain their mail behavior',()=>{
  const result=run("const mode=await import('./src/services/localReviewMode.js'); if(mode.localProductionReview)throw Error('Unexpected copy mode'); console.log('normal');",{LOCAL_REVIEW_ONLY:'',NODE_ENV:'production',DB_NAME:'aba'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/normal/);
});

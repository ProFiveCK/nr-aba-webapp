// Synthetic API only. Run against local Vite with PLAYWRIGHT_MODULE and LEAVE_CHECK_URL.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],writes=[];
  page.on('pageerror',error=>errors.push(error.message));
  const permissions={hr_access:true,hr_admin:true},defaults={ordinary_recreation_months:3,temporary_recreation_months:12,recreation_annual_days:'20',recreation_cap_days:'60',recreation_notice_days:14,medical_annual_days:'10',special_annual_days:'3',medical_uncertified_occasions:3};
  let policy={id:'policy',label:'Current leave policy',effective_from:'2026-10-09',effective_to:'2027-10-09',status:'published',rules:defaults,source_reference:'Existing recorded policy source',revision:1,next_change_date:'2026-12-01'};
  let failExtension=false;
  await page.route('**/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;let body;
   if(request.method()!=='GET')writes.push({path,body:request.postDataJSON()});
   if(path==='/api/auth/me')body={reviewer:{id:'admin',email:'admin@example.test',display_name:'Administrator',role:'admin',permissions,account_type:'staff'},permissions};
   else if(path==='/api/hr/access-scopes/context')body={central:true,scopes:[]};
   else if(path==='/api/hr/org-units'||path==='/api/hr/directory/work-patterns')body=[];
   else if(path==='/api/hr/directory/leave-policy-usage')body={current_policy:policy,counts:{}};
   else if(path==='/api/hr/government/configuration')body={defaults,codes:[],policies:[policy],deleted_policies:[],calendars:[],patterns:[]};
   else if(path==='/api/hr/government/policies/policy/coverage'){
    if(failExtension){await route.fulfill({status:409,json:{error:'The policy dates changed. Refresh and review the current dates.'}});return;}
    policy={...policy,effective_to:request.postDataJSON().effective_to};body=policy;
   }else if(path==='/api/hr/government/policies/save'){
    const data=request.postDataJSON();policy={...policy,...data,id:'replacement',status:'published'};body=policy;
   }else if(path==='/api/hr/government/policies/draft/publish'){policy={...policy,status:'published'};body=policy;}
   else throw new Error(`Unexpected synthetic request: ${request.method()} ${path}`);
   await route.fulfill({json:body});
  });
  const base=process.env.LEAVE_CHECK_URL || 'http://127.0.0.1:5187';
  await page.goto(base+'/leave/settings?view=policies');
  await page.getByRole('button',{name:'Extend dates',exact:true}).waitFor({timeout:10000}).catch(async error=>{await page.screenshot({path:'/tmp/aba-policy-settings-failure.png',fullPage:true});console.error('Page:',page.url(),await page.locator('body').innerText(),'Errors:',errors);throw error;});
  await page.getByRole('button',{name:'Extend dates',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Extend policy dates'});
  assert.ok((await dialog.textContent()).includes('09/10/2027'));
  assert.equal(await dialog.getByLabel(/verification reason|authority|signed/i).count(),0);
  await dialog.getByLabel('No end date',{exact:true}).check();
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  assert.equal(writes.length,1);assert.equal(writes[0].body.effective_to,'9999-12-31');assert.equal(writes[0].body.expected_effective_to,'2027-10-09');
  assert.equal(await page.getByRole('button',{name:'Approve replacement'}).count(),0);
  await page.getByRole('button',{name:'Change allowances',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Change leave allowances'});
  assert.equal(await dialog.getByLabel('Effective from',{exact:true}).inputValue(),'01/12/2026');
  assert.equal(await dialog.getByLabel('Recreation qualifying period (months)',{exact:true}).isVisible(),false);
  assert.equal(await dialog.getByLabel(/signed|verification reason/i).count(),0);
  await dialog.getByLabel('Special days per year',{exact:true}).fill('4');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  assert.equal(writes.length,2);assert.equal(writes[1].path,'/api/hr/government/policies/save');assert.equal(writes[1].body.rules.special_annual_days,'4');assert.equal(writes[1].body.rules.temporary_recreation_months,12);
  assert.equal(Object.hasOwn(writes[1].body,'authority_reference'),false);
  // A failed extension keeps the form open; there is no success toast or approval step.
  policy={...policy,id:'policy',effective_to:'2027-10-09'};failExtension=true;
  await page.goto(base+'/leave/settings?view=policies');await page.getByRole('button',{name:'Extend dates',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Extend policy dates'});await dialog.getByLabel('No end date',{exact:true}).check();await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await dialog.getByRole('alert').waitFor();assert.equal(await dialog.isVisible(),true);await page.keyboard.press('Escape');
  // Already saved drafts can be applied directly without another reason dialog.
  policy={...policy,id:'draft',status:'draft',supersedes_policy_id:'prior',prepared_by:'admin'};
  await page.goto(base+'/leave/settings?view=policies');await page.getByRole('button',{name:'Apply Current leave policy',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Policy changes applied.'}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);
  for(const width of [390,1280]){
   await page.setViewportSize({width,height:900});await page.getByRole('button',{name:'Change allowances',exact:true}).click();
   await page.getByRole('dialog',{name:'Change leave allowances'}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: one-step extension, no end date, one-step administrator save, no signed reference or verification prompt, preserved advanced rules, direct draft application, error retention and mobile layout. All API calls synthetic.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

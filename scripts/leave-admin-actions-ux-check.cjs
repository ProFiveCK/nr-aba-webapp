// Run against Vite. Every API response is synthetic; no real account or leave changes.
// PLAYWRIGHT_MODULE=/path/to/playwright LEAVE_CHECK_URL=http://127.0.0.1:5187 node scripts/leave-admin-actions-ux-check.cjs
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],assignments=[],uploads=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.text().includes('Encountered two children'))errors.push(message.text());});
  const permissions={admin:true,hr_admin:true,hr_access:true,hr_leave_approve:true};
  const reviewer={id:'admin',email:'admin@example.test',role:'admin',display_name:'Administrator',account_type:'staff',permissions};
  const accounts=[{id:'new-login',email:'new@example.test',display_name:'New login',role:'user',account_type:'employee',status:'active',division_code:'00',capabilities:[],permissions:{}},{id:'old-login',email:'old@example.test',display_name:'Old login',role:'reviewer',status:'active',division_code:'00',capabilities:[],permissions:{}}];
  let employees=[{id:'previous-person',display_name:'Previous person',department_code:'01',reviewer_id:'new-login'},{id:'target-person',display_name:'Target person',department_code:'01',reviewer_id:'old-login'}];
  let failAssignment=true,creates=0,grantCancelled=false;
  const summary=()=>({id:'grant',employee_id:'target-person',employee_name:'Target person',code:'recreation',start_date:'2026-11-16',end_date:'2026-11-20',charge:'5',status:'approved',stage_index:0,submitted_at:'2026-10-07T00:00:00Z',can_pdf:true});
  await page.route('**/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;let body={};
   if(path==='/api/auth/me')body={reviewer,permissions};
   else if(path==='/api/reviewers'&&request.method()==='GET')body=accounts;
   else if(path==='/api/reviewers'&&request.method()==='POST'){creates++;const row={...accounts[0],id:'created-login',email:'created@example.test',role:'reviewer',account_type:'staff'};accounts.push(row);body={reviewer:row};}
   else if(path.startsWith('/api/reviewers/')&&request.method()==='PUT')body={};
   else if(path==='/api/capability-catalogue')body={groups:[],role_capabilities:{}};
   else if(path==='/api/hr/employees')body=employees;
   else if(path.endsWith('/employee-link')){
    const data=JSON.parse(request.postData());assignments.push(data);
    if(failAssignment)return route.fulfill({status:409,json:{message:'The staff login assignment changed. Reopen the account.'}});
    const id=path.split('/').at(-2);
    employees=employees.map(e=>({...e,reviewer_id:e.id===data.employee_id?id:e.reviewer_id===id?null:e.reviewer_id}));
    body={employee_id:data.employee_id,reviewer_id:id};
   }else if(path==='/api/hr/government/workflow/requests')body={requests:[summary()],total:1};
   else if(path==='/api/hr/government/workflow/requests/grant')body={...summary(),stages:[],documents:[],reason:'Approved family leave.',private_access:true,can_cancel:false,can_amend:!grantCancelled,medical_mode:'not_applicable',amendment:{request_id:'first-amendment',action:grantCancelled?'cancel_grant':'shorten_grant',effective_end:'2026-11-18'}};
   else if(path==='/api/hr/government/workflow/requests/cancellation')body={...summary(),id:'cancellation',code:'amendment',status:'pending',stages:[],documents:[],private_access:true,can_cancel:true,can_amend:false,can_prepare:true,case:true,amendment_action:'cancel_grant',event_reference:'Personnel file authority',related_request_id:'grant',tasks:[]};
   else if(path.endsWith('/notifications'))body={notifications:[]};
   else if(path==='/api/hr/government/workflow/employees/target-person/cases') {uploads.push(request.postData());body={id:'cancellation'};}
   else throw new Error(`Unexpected synthetic request: ${request.method()} ${path}`);
   await route.fulfill({json:body});
  });
  const base=process.env.LEAVE_CHECK_URL||'http://127.0.0.1:5187';
  const edit=async()=>{await page.locator('tr').filter({hasText:'new@example.test'}).getByTitle('Edit user').click();await page.getByRole('dialog',{name:'Edit user'}).waitFor();};
  const choose=async value=>{await page.getByLabel('Leave staff record (optional)').selectOption(value);await page.getByLabel('Reason for staff login change').fill('Verified employee and new login ownership.');};
  await page.goto(base+'/admin/accounts');await edit();await choose('target-person');
  await page.getByText('This will replace old@example.test on Target person.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Account details saved, but staff assignment was not changed.'}).waitFor();
  assert.equal(await page.getByLabel('Leave staff record (optional)').inputValue(),'target-person');
  assert.deepEqual(assignments[0],{employee_id:'target-person',expected_employee_id:'previous-person',expected_reviewer_id:'old-login',reason:'Verified employee and new login ownership.'});
  failAssignment=false;await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByRole('dialog',{name:'Edit user'}).waitFor({state:'hidden'});
  await edit();assert.equal(await page.getByLabel('Leave staff record (optional)').inputValue(),'target-person');
  await choose('');await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByRole('dialog',{name:'Edit user'}).waitFor({state:'hidden'});
  assert.equal(assignments.at(-1).employee_id,null);assert.equal(assignments.at(-1).expected_employee_id,'target-person');
  // A failed link after account creation must retry the created account, not POST another account.
  await page.getByRole('button',{name:'Add user',exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill('created@example.test');await choose('target-person');failAssignment=true;
  await page.getByRole('button',{name:'Create user',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'staff assignment was not changed'}).waitFor();
  failAssignment=false;await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(creates,1);
  // An already shortened grant must still offer cancellation using its current dates.
  await page.goto(base+'/leave/approvals');await page.getByRole('button',{name:'View application',exact:true}).click();
  await page.getByText('Leave shortened through 18/11/2026 by an approved amendment.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Cancel or shorten approved leave',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Cancel or shorten approved leave',exact:true});
  await dialog.getByLabel('Change to approved leave').selectOption('cancel_grant');
  assert.equal(await dialog.getByLabel('Currently approved end date').inputValue(),'18/11/2026');
  assert.equal(await dialog.getByLabel('Currently approved end date').getAttribute('readonly'),'');
  await dialog.getByLabel('Amendment personnel-file reference').fill('Personnel file authority');
  await dialog.getByLabel('Employee early-return / cancellation authority').fill('Signed employee cancellation request');
  await dialog.getByRole('textbox',{name:/reason/i}).fill('Employee has cancelled the remaining approved leave.');
  await dialog.getByRole('button',{name:'Request leave cancellation',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.getByRole('status').filter({hasText:'Amendment submitted.'}).first().waitFor();
  await page.getByText('Requested change: Cancel approved leave and restore remaining deducted balance',{exact:true}).waitFor();
  await page.getByRole('dialog',{name:'Review leave application',exact:true}).getByRole('button',{name:'Review case details',exact:true}).waitFor();
  assert.ok(uploads[0].includes('name="amendment_action"\r\n\r\ncancel_grant'));
  assert.ok(uploads[0].includes('name="end_date"\r\n\r\n2026-11-18'));
  grantCancelled=true;await page.reload();await page.getByRole('button',{name:'View application',exact:true}).click();
  await page.getByText('Leave cancelled by an approved amendment.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Cancel or shorten approved leave',exact:true}).count(),0);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: replacement, failure feedback, unlink, creation retry, successive amendment, cancellation dates, effective status and mobile overflow. All API calls synthetic.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

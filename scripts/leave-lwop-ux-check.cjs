// Synthetic responses only. Run against local Vite, never against live records.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],decisions=[];
  page.on('pageerror',error=>errors.push(error.message));
  const permissions={hr_access:true,hr_leave_approve:true};let approved=false;
  const summary=()=>({id:'lwop',employee_id:'employee',employee_name:'Example Employee',code:'lwop',start_date:'2027-01-11',end_date:'2028-01-10',charge:'0',status:approved?'approved':'pending',stage_index:0,submitted_at:'2026-10-21T00:00:00Z',current_level:'division',current_label:'Supervisor',current_approver:'Example Supervisor',unassigned_stages:0});
  await page.route('**/api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;let body;
   if(path==='/api/auth/me')body={reviewer:{id:'supervisor',email:'supervisor@example.test',display_name:'Example Supervisor',role:'user',account_type:'staff',permissions},permissions};
   else if(path==='/api/hr/government/workflow/requests')body={requests:[summary()],total:1};
   else if(path==='/api/hr/government/workflow/requests/lwop')body={...summary(),case:true,standard_lwop:true,can_prepare:false,can_amend:false,can_cancel:false,private_access:true,reason:'Family circumstances requiring unpaid leave.',documents:[{id:'letter',file_name:'Application letter.pdf',byte_size:100}],medical_mode:'not_applicable',tasks:[],stages:[{id:'stage',ordinal:0,level:'division',label:'Supervisor',binding:{id:'binding',reviewer_id:'supervisor',approver_name:'Example Supervisor'},decision:approved?{decision:'approved',decided_at:'2026-10-21T00:10:00Z'}:null,issue:null,can_decide:!approved}]};
   else if(path.endsWith('/notifications'))body={notifications:[]};
   else if(path.endsWith('/decisions')){decisions.push(req.postDataJSON());approved=true;body={id:'lwop',status:'approved'};}
   else throw new Error(`Unexpected synthetic request: ${req.method()} ${path}`);
   await route.fulfill({json:body});
  });
  const base=process.env.LEAVE_CHECK_URL||'http://127.0.0.1:5187';
  await page.goto(base+'/leave/approvals');await page.getByRole('button',{name:'Review application',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  await dialog.getByText('Awaiting Supervisor · Example Supervisor.',{exact:true}).waitFor();
  assert.equal(await dialog.getByText(/HR factual and pay determination|HR must assign|independent verification/).count(),0);
  assert.equal(await dialog.getByLabel('Decision reason',{exact:true}).count(),0);
  await dialog.getByText('Family circumstances requiring unpaid leave.',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Download Application letter.pdf'}).waitFor();
  await dialog.getByText(/0% salary/).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Approve leave',exact:true}).isEnabled(),false);
  await dialog.getByRole('checkbox',{name:'I certify that I have verified the application details and supporting information.'}).check();
  await page.screenshot({path:'/tmp/aba-lwop-supervisor-mobile.png',fullPage:true});
  await dialog.getByRole('button',{name:'Approve leave',exact:true}).click();await dialog.getByText('Leave approved.',{exact:true}).waitFor();
  assert.equal(decisions.length,1);assert.equal(decisions[0].certification_confirmed,true);assert.equal(decisions[0].stage_id,'stage');
  await dialog.getByText('Approval progress and history · 1 of 1 completed',{exact:true}).waitFor();
  for(const width of [390,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);}
  assert.deepEqual(errors,[]);
  console.log('PASS: Supervisor-only LWOP approval, supporting documents, zero-pay summary, optional comment, no HR determination or extra approval stages, approval history and mobile layout. All API calls synthetic.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

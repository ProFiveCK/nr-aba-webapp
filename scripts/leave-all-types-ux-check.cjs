// All requests are synthetic. Never submit real approvals from this script.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],decisions=[];
  page.on('pageerror',error=>errors.push(error.message));
  const permissions={hr_access:true,hr_leave_approve:true};let code='medical',approved=false;
  const summary=()=>({id:code,employee_id:'employee',employee_name:'Example Employee',code,start_date:'2026-11-16',end_date:'2026-11-16',charge:'1',status:approved?'approved':'pending',stage_index:0,submitted_at:'2026-10-21T00:00:00Z',current_level:'division',current_label:'Supervisor',current_approver:'Example Supervisor',unassigned_stages:0});
  await page.route('**/api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;let body;
   if(path==='/api/auth/me')body={reviewer:{id:'supervisor',email:'supervisor@example.test',display_name:'Example Supervisor',role:'user',account_type:'staff',permissions},permissions};
   else if(path==='/api/hr/government/workflow/requests')body={requests:[summary()],total:1};
   else if(path===`/api/hr/government/workflow/requests/${code}`)body={...summary(),case:!['recreation','medical','special'].includes(code),simple_approval:true,can_prepare:false,can_amend:false,can_cancel:false,private_access:true,reason:'Example leave reason and supporting information.',documents:[{id:'evidence',file_name:'Supporting evidence.pdf',byte_size:100}],medical_mode:code==='medical'?'certificate':'not_applicable',evidence_review_required:false,can_verify_evidence:false,case_details:code==='maternity'?{pregnancy_number:1,expected_birth_date:'2026-12-20'}:['paternity','adoption'].includes(code)?{child_birth_date:'2026-10-01'}:{},approval_checks:['Review the required supporting information for this leave type.'],tasks:[],stages:[{id:'stage',ordinal:0,level:'division',label:'Supervisor',binding:{id:'binding',reviewer_id:'supervisor',approver_name:'Example Supervisor'},decision:approved?{decision:'approved',decided_at:'2026-10-21T00:10:00Z'}:null,issue:null,can_decide:!approved}]};
   else if(path.endsWith('/decisions')){decisions.push({code,...req.postDataJSON()});approved=true;body={id:code,status:'approved'};}
   else throw new Error(`Unexpected synthetic API call ${req.method()} ${path}`);
   await route.fulfill({json:body});
  });
  for(const type of ['recreation','medical','special','teacher_recreation','extended_medical','extended_medical_minister','maternity','paternity','adoption','official','lwop','long_service','furlough','recreation_encashment','recreation_separation','witness_republic','witness_other','attendance','amendment']){
   code=type;approved=false;
   await page.goto((process.env.LEAVE_CHECK_URL||'http://127.0.0.1:5187')+'/leave/approvals');
   await page.getByRole('button',{name:'Review application',exact:true}).click();
   const dialog=page.getByRole('dialog');await dialog.getByText('Awaiting Supervisor · Example Supervisor.',{exact:true}).waitFor();
   assert.equal(await dialog.getByText(/HR factual and pay determination|awaiting HR verification|independent verification|Chief Secretary must/).count(),0,type);
   assert.equal(await dialog.getByLabel('Decision reason',{exact:true}).count(),0,type);
   assert.equal(await dialog.getByRole('button',{name:'Approve leave',exact:true}).isEnabled(),false,type);
   for(const field of await dialog.locator('input[required]:not([type="checkbox"])').all())if(!await field.inputValue())await field.fill(await field.getAttribute('type')==='number'?'1':'Example actual source record');
   // Payout fields are conditional policy requirements, completed inline.
   for(const name of ['payable_amount','salary_percent']){const field=dialog.locator(`[name="detail_${name}"]`);if(await field.count())await field.fill(name==='salary_percent'?'50':'100');}
   const valuation=dialog.locator('[name="detail_salary_valuation_reference"]');if(await valuation.count())await valuation.fill('Example payroll calculation');
   await dialog.getByRole('checkbox',{name:'I certify that I have verified the application details and supporting information.'}).check();
   await dialog.getByRole('button',{name:'Approve leave',exact:true}).click();await dialog.getByText('Leave approved.',{exact:true}).waitFor();
   assert.equal(decisions.at(-1).certification_confirmed,true);assert.equal(decisions.at(-1).verify_evidence,undefined);
   await dialog.getByText('Approval progress and history · 1 of 1 completed',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,type);
  }
  assert.equal(decisions.length,19);assert.deepEqual(errors,[]);
  console.log('PASS: all 19 leave/application types use the same Supervisor decision screen, inline details, one certification, optional comment and mobile layout. All API calls synthetic.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

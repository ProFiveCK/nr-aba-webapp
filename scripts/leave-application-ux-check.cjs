// Start Vite, then run with Playwright installed. All API calls use synthetic
// responses, so this applicant/approver walkthrough never changes real leave.
// PLAYWRIGHT_MODULE=/path/to/playwright LEAVE_CHECK_URL=http://127.0.0.1:5186 node scripts/leave-application-ux-check.cjs
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[],uploads=[],decisions=[],queries=[];page.on('pageerror',e=>errors.push(e.message));
 const permissions={hr_access:true,hr_admin:true,hr_report_read:true,hr_evidence_read:true,hr_leave_apply:true,hr_leave_approve:true};
 const reviewer={id:'reviewer',email:'test@example.test',display_name:'Applicant Example',role:'admin',account_type:'staff',permissions};
 const employee={id:'employee',display_name:'Applicant Example',leave_policy_regime:'government'};
 const accounts=['recreation','medical','special'].map(code=>({id:code,code,period_start:'2026-01-01',period_end:'2026-12-31',as_of:'2026-10-01',days_in:'20',days_out:'0',balance:'20',held:'0',available:'20',policy_label:'Leave policy',rules:{[code+'_annual_days']:20}}));
 let submitted=false,uploadFailure='',decisionFailure='',decisionCount=0,blocked=false,previews=0,pdfs=0;
 let recordedMode=false,recordedDecisions=[];
 let leaveCode='recreation',levels=['department','chief_secretary'],canVerify=false,evidenceRequired=false,evidenceVerified=false,canDecide=true,evidenceReviews=0;
 const certification='I certify that I have verified the application details and supporting information.';
 const summary=()=>({id:'application-123',employee_id:'employee',employee_name:'Applicant Example',code:leaveCode,start_date:'2026-11-16',end_date:'2026-11-16',charge:'0.5',duration_unit:'hours',hours:'3.5',status:decisionCount===levels.length?'approved':'pending',submitted_at:'2026-10-15T01:00:00Z',current_level:decisionCount?'chief_secretary':'department',current_label:decisionCount?'Chief Secretary':'Head of Department',current_approver:decisionCount?'Final Approver':'Department Approver',unassigned_stages:0,stage_index:Math.min(decisionCount,levels.length-1),can_pdf:decisionCount===levels.length});
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;let body={};
  if(path==='/api/auth/me')body={reviewer,permissions};
  else if(path==='/api/hr/me')body={employee,balances:[],year:2026};
  else if(path==='/api/hr/government/workflow/me')body={enabled_codes:['recreation','medical','special'],medical_rule:'single_calendar_date_nonadjacent_scheduled_days',policy:{label:'Leave policy',recreation_notice_days:14}};
  else if(path==='/api/hr/government/employees/employee/account')body={employee,accounts,movements:[],total:0,page_size:50,as_of:'2026-10-15'};
  else if(path.endsWith('/preview')){previews++;body={eligible_for_preview:true,charge:'0.5',requested_hours:3.5,scheduled_hours:7,issues:[],requirements:[]};}
  else if(path==='/api/hr/government/workflow/requests'&&request.method()==='POST'){
   uploads.push(request.postData());await new Promise(resolve=>setTimeout(resolve,100));
   if(uploadFailure)return route.fulfill({status:409,json:{message:uploadFailure}});
   submitted=true;body={id:'application-123'};
  }else if(path==='/api/hr/government/workflow/requests'){
   queries.push(url.searchParams.toString());const search=url.searchParams.get('search'),status=url.searchParams.get('status');
   const rows=(url.searchParams.get('mode')!=='mine'||submitted)&&(!search||search==='application-123')&&(status==='all'||status===summary().status)?[recordedMode?{...summary(),id:'recorded-123',record_source:'recorded',recorded_application:{id:'recorded-123',employee_name:'Applicant Example',leave_type_name:'Annual',start_date:'2026-11-16',end_date:'2026-11-16',days:1,status:'pending',can_decide:true,reason:'Recorded family appointment.'}}:summary()]:[];body={requests:rows,total:rows.length};
  }else if(path==='/api/hr/government/workflow/requests/application-123')body={...summary(),stages:levels.map((level,ordinal)=>({id:`stage-${ordinal}`,ordinal,level,label:ordinal?'Chief Secretary':'Head of Department',binding:{id:`binding-${ordinal}`,approver_name:ordinal?'Final Approver':'Department Approver',reviewer_id:'reviewer'},decision:ordinal<decisionCount?{decision:'approved',decided_at:'2026-10-15T02:00:00Z',note:'Reviewed application'}:null,issue:blocked?'The assigned officeholder changed.':null,can_decide:canDecide&&!blocked&&decisionCount===ordinal})),documents:[],reason:'Family appointment during working hours.',medical_mode:leaveCode==='medical'?'certificate':'not_applicable',evidence_review_required:evidenceRequired,evidence_review:evidenceVerified?{actor_id:'reviewer',recorded_at:'2026-10-15T02:00:00Z'}:null,can_verify_evidence:canVerify&&!evidenceVerified,private_access:true,can_cancel:decisionCount===0,case:false};
  else if(path.endsWith('/decisions')){
   decisions.push(JSON.parse(request.postData()));await new Promise(resolve=>setTimeout(resolve,150));if(decisionFailure)return route.fulfill({status:409,json:{message:decisionFailure}});
   if(decisions.at(-1).verify_evidence)evidenceVerified=true;decisionCount++;body={id:'application-123',status:summary().status};
  }else if(path.endsWith('/evidence-review')){evidenceReviews++;evidenceVerified=true;body={request_id:'application-123'};
  }else if(path.endsWith('/pdf')){pdfs++;return route.fulfill({contentType:'application/pdf',body:'%PDF-1.4\n%%EOF'});}
  else if(path==='/api/hr/leaves/recorded-123/decision'){recordedDecisions.push(JSON.parse(request.postData()));return route.fulfill({json:{status:'approved'}});}
  else if(path==='/api/hr/leaves')body=[];
  else throw new Error(`Unexpected API request: ${request.method()} ${path}`);
  await route.fulfill({json:body});
 });
 const base=process.env.LEAVE_CHECK_URL||'http://127.0.0.1:5173';
 await page.goto(base+'/leave/my-leave');await page.getByRole('heading',{name:'Apply for leave',exact:true}).waitFor();
 await page.getByLabel('Apply in',{exact:true}).selectOption('hours');await page.locator('input[type="date"]').first().fill('2026-11-16');
 await page.getByLabel('Hours requested',{exact:true}).fill('3.5');
 const reason=page.getByRole('textbox',{name:'Reason for leave',exact:true});await reason.fill('Family appointment during working hours.');
 const submit=()=>page.getByRole('button',{name:'Submit application',exact:true});assert.equal(await submit().isEnabled(),true);
 uploadFailure='Insufficient available balance. Choose fewer hours.';await submit().click();
 await page.getByRole('alert').filter({hasText:'Insufficient available balance'}).waitFor();
 assert.equal(previews,0);assert.equal(await reason.inputValue(),'Family appointment during working hours.');assert.equal(await page.getByLabel('Leave date',{exact:true}).inputValue(),'16/11/2026');
 await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.parentElement===document.activeElement);
 assert.equal(await page.getByRole('alert').evaluate(el=>el.parentElement===document.activeElement),true);
 const requestId=body=>body.match(/name="request_id"\r\n\r\n([^\r]+)/)[1];
 uploadFailure='';await submit().evaluate(button=>{button.click();button.click();});await page.getByRole('status').filter({hasText:'Application submitted successfully'}).waitFor();
 assert.equal(uploads.length,2);assert.equal(requestId(uploads[0]),requestId(uploads[1]));assert.equal(previews,0);assert.match(uploads[1],/name="hours"\r\n\r\n3.5/);
 assert.equal(await reason.inputValue(),'');assert.equal(await page.getByLabel('Leave date',{exact:true}).inputValue(),'');
 await page.getByRole('link',{name:'Go to my applications'}).click();await page.getByRole('button',{name:'View application',exact:true}).click();
 await page.getByRole('dialog',{name:'Leave application',exact:true}).getByText(/Awaiting Head of Department/).waitFor();await page.keyboard.press('Escape');
 await page.locator('input[type="date"]').first().fill('2026-11-17');await page.getByLabel('Hours requested',{exact:true}).fill('2');await reason.fill('Another appointment during working hours.');
 await page.getByRole('button',{name:'Check dates & balance (optional)',exact:true}).click();await page.getByRole('status').filter({hasText:'Ready for submission'}).waitFor();
 await reason.fill('Updated reason after checking balance.');assert.equal(await submit().isEnabled(),true);assert.equal(await page.getByText('Ready for submission',{exact:false}).count(),0);
 await page.getByLabel('Leave type',{exact:true}).first().selectOption('medical');const before=uploads.length;await submit().click();await page.getByRole('alert').filter({hasText:'Attach your medical certificate'}).waitFor();assert.equal(uploads.length,before);
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Applicant overflow at ${width}`);}
 await page.goto(base+'/leave/approvals');await page.getByRole('button',{name:'Review application',exact:true}).click();
 let review=page.getByRole('dialog',{name:'Review leave application',exact:true});await review.waitFor();
 assert.equal(await page.getByRole('dialog').count(),1);
 assert.equal(await review.getByRole('button',{name:'Recommend leave',exact:true}).isDisabled(),true);
 await review.getByRole('checkbox',{name:certification,exact:true}).check();
 await review.getByRole('button',{name:'Recommend leave',exact:true}).evaluate(button=>{button.click();button.click();});
 await page.keyboard.press('Escape');assert.equal(await review.count(),1);
 await review.getByRole('status').filter({hasText:'Recommendation recorded.'}).waitFor();await review.getByText(/Awaiting Chief Secretary/).waitFor();
 assert.equal(decisions.length,1);assert.equal(decisions[0].stage_id,'stage-0');assert.equal(decisions[0].binding_id,'binding-0');assert.equal(decisions[0].decision,'approved');assert.equal(decisions[0].certification_confirmed,true);assert.ok(decisions[0].note.includes(certification));
 assert.equal(await review.getByRole('checkbox',{name:certification,exact:true}).isChecked(),false);
 decisionFailure='HR must verify supporting records before final approval.';
 await review.getByRole('checkbox',{name:certification,exact:true}).check();
 await review.getByText('Add a comment (optional)',{exact:true}).click();await review.getByRole('textbox',{name:'Review comment (optional)',exact:true}).fill('Checked the dates and remaining balance.');
 await review.getByRole('button',{name:'Approve leave',exact:true}).click();await review.getByRole('alert').filter({hasText:decisionFailure}).waitFor();assert.equal(decisionCount,1);
 assert.equal(await review.getByRole('checkbox',{name:certification,exact:true}).isChecked(),true);assert.equal(await review.getByRole('textbox',{name:'Review comment (optional)',exact:true}).inputValue(),'Checked the dates and remaining balance.');
 await page.waitForFunction(()=>document.querySelector('[role="dialog"] [role="alert"]')===document.activeElement);
 assert.equal(await review.getByRole('alert').evaluate(el=>el===document.activeElement),true);assert.equal(await page.getByRole('dialog').count(),1);
 decisionFailure='';await review.getByRole('button',{name:'Approve leave',exact:true}).click();
 review=page.getByRole('dialog',{name:'Leave application',exact:true});await review.getByRole('status').filter({hasText:'Leave approved.'}).waitFor();assert.equal(decisions[1].event_key,decisions[2].event_key);
 const pdfResponse=page.waitForResponse(r=>r.url().endsWith('/pdf'));await review.getByRole('button',{name:'Download approved PDF',exact:true}).click();await pdfResponse;assert.equal(pdfs,1);await page.keyboard.press('Escape');
 await page.getByLabel('Application status',{exact:true}).selectOption('approved');await page.getByLabel('Find an application',{exact:true}).fill('application-123');await page.getByRole('button',{name:'Search applications',exact:true}).click();
 await page.getByRole('button',{name:'View application',exact:true}).waitFor();assert.ok(queries.some(q=>q.includes('search=application-123')&&q.includes('status=approved')&&q.includes('page=1')));
 await page.getByRole('button',{name:'View application',exact:true}).click();
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),`Approval overflow at ${width}`);}
 await page.keyboard.press('Escape');await page.getByLabel('Find an application',{exact:true}).fill('missing');await page.getByRole('button',{name:'Search applications',exact:true}).click();await page.getByText('No matching applications. Try another search or application status.').waitFor();
 await page.getByRole('button',{name:'Clear search',exact:true}).click();await page.getByRole('button',{name:'View application',exact:true}).waitFor();
 blocked=true;decisionCount=0;await page.getByLabel('Application status',{exact:true}).selectOption('pending');await page.getByRole('button',{name:'Review application',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Contact HR to resolve this'}).waitFor();assert.equal(await page.getByRole('button',{name:'Recommend leave',exact:true}).count(),0);
 await page.keyboard.press('Escape');blocked=false;levels=['department'];leaveCode='medical';evidenceRequired=true;
 await page.getByRole('button',{name:'Refresh applications',exact:true}).click();await page.getByRole('button',{name:'Review application',exact:true}).click();
 review=page.getByRole('dialog',{name:'Review leave application',exact:true});await review.getByText(/Contact HR to complete this review/).waitFor();
 assert.equal(await review.getByRole('button',{name:'Approve leave',exact:true}).isDisabled(),true);await page.keyboard.press('Escape');
 canVerify=true;await page.getByRole('button',{name:'Review application',exact:true}).click();
 await review.getByText(/Supporting evidence will be verified together/).waitFor();assert.equal(await review.getByRole('button',{name:'Verify supporting evidence',exact:true}).count(),0);
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.ok(await review.evaluate(el=>el.scrollWidth<=el.clientWidth),`Certification overflow at ${width}`);}
 await page.setViewportSize({width:390,height:844});
 if(process.env.LEAVE_CHECK_SCREENSHOT)await page.screenshot({path:process.env.LEAVE_CHECK_SCREENSHOT,fullPage:true});
 await review.getByRole('checkbox',{name:certification,exact:true}).check();await review.getByRole('button',{name:'Approve leave',exact:true}).click();
 review=page.getByRole('dialog',{name:'Leave application',exact:true});await review.getByRole('status').filter({hasText:'Leave approved.'}).waitFor();assert.equal(decisions.at(-1).verify_evidence,true);assert.equal(decisions.at(-1).verification_comment,certification);assert.equal(evidenceReviews,0);await page.keyboard.press('Escape');
 decisionCount=0;evidenceVerified=false;canDecide=false;await page.getByRole('button',{name:'Refresh applications',exact:true}).click();await page.getByRole('button',{name:'Review application',exact:true}).click();
 review=page.getByRole('dialog',{name:'Review leave application',exact:true});await review.getByRole('checkbox',{name:certification,exact:true}).check();await review.getByRole('button',{name:'Verify supporting evidence',exact:true}).click();
 await review.getByRole('status').filter({hasText:'Supporting evidence verified.'}).waitFor();assert.equal(evidenceReviews,1);assert.equal(decisionCount,0);assert.equal(await page.getByRole('dialog').count(),1);await page.keyboard.press('Escape');
 canDecide=true;canVerify=false;evidenceRequired=false;evidenceVerified=false;levels=['hr_verifier','chief_secretary'];
 await page.getByRole('button',{name:'Refresh applications',exact:true}).click();await page.getByRole('button',{name:'Review application',exact:true}).click();
 review=page.getByRole('dialog',{name:'Review leave application',exact:true});await review.getByRole('checkbox',{name:certification,exact:true}).check();await review.getByRole('button',{name:'Verify evidence',exact:true}).click();
 await review.getByRole('status').filter({hasText:'Evidence verification recorded.'}).waitFor();assert.equal(decisions.at(-1).verification_comment,certification);assert.equal(await page.getByRole('dialog').count(),1);
 await page.keyboard.press('Escape');recordedMode=true;decisionCount=0;
 await page.getByRole('button',{name:'Refresh applications',exact:true}).click();await page.getByRole('button',{name:'Review application',exact:true}).click();
 review=page.getByRole('dialog',{name:'Review leave application',exact:true});await review.getByText('Recorded family appointment.',{exact:true}).waitFor();
 assert.equal(await review.getByRole('button',{name:'Approve leave',exact:true}).isDisabled(),true);
 await review.getByRole('button',{name:'Reject application',exact:true}).click();await review.getByRole('alert').filter({hasText:'Enter a reason for rejecting'}).waitFor();assert.equal(recordedDecisions.length,0);
 await review.getByRole('checkbox',{name:certification,exact:true}).check();await review.getByRole('button',{name:'Approve leave',exact:true}).evaluate(button=>{button.click();button.click();});
 await review.waitFor({state:'hidden'});assert.equal(recordedDecisions.length,1);assert.equal(recordedDecisions[0].reviewer_note,certification);
 assert.deepEqual(errors,[]);console.log('Passed: direct submission, optional preview, error feedback and retained values, retry keys, duplicate prevention, certificate validation, single-modal certification, recommendation, final approval errors/retry and retained comment, duplicate prevention, combined verification/approval, HR-only verification, assigned HR stage, recorded-leave certification and rejection validation, PDF download, search/status retrieval, blocked-stage explanation, mobile/desktop layouts.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});

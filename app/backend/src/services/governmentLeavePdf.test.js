import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {medicalPdfLines,governmentPdfDate,generateGovernmentLeavePdf,governmentApprovalFormSnapshot} from './governmentLeavePdf.js';
const fixture=mode=>({id:'medical-example',employee:{name:'Review Employee',department_name:'Finance',division_name:'Treasury'},code:'medical',medical_mode:mode,start_date:'2026-11-02',end_date:'2026-11-02',charge:'1',reason:'Medical absence',submitted_at:'2026-10-08T01:00:00Z',granted_at:'2026-10-08T03:00:00Z',stages:[],balances:[],engine_version:'review',regime:'government',evaluation:{snapshot_hash:'example',scheduled_hours:'8',segments:[{date:'2026-11-02',charge:'1',scheduled_hours:'8',policy_version_id:'policy'}],policy_versions:[{id:'policy',label:'Approved rules',source_reference:'Reviewed source',rules:{medical_annual_days:'10',medical_uncertified_occasions:3}}]},medical_uncertified:{limit:3,committed_including_this_request:2},medical_tracking:{period_start:'2026-01-01',period_end:'2026-12-31',certified:{approved_days:'2',pending_days:'0',baseline_days:'1'},uncertified:{approved_days:'1',pending_days:'1',baseline_days:'0'},baseline_reviewed:true}});
test('Medical PDF identifies certificate route and does not assign a separate 7/3 entitlement',()=>{
 const certified=medicalPdfLines(fixture('certificate')).join('\n');assert.match(certified,/\[X\] With medical certificate/);assert.match(certified,/\[ \] Without medical certificate/);assert.match(certified,/no uncertified occasion/);assert.match(certified,/Shared Medical entitlement: 10/);assert.match(certified,/2 of 3/);
 const exempt=medicalPdfLines(fixture('exemption')).join('\n');assert.match(exempt,/\[X\] Without medical certificate/);assert.match(exempt,/uses one occasion/);assert.match(exempt,/2 approved days/);assert.match(exempt,/01\/01\/2026 to 31\/12\/2026/);
});
test('Medical PDF uses actual governing quantum and preserves unknown historical evidence',()=>{
 const data=fixture('exemption');data.evaluation.policy_versions[0].rules.medical_annual_days='12';delete data.medical_mode;data.input={medical_mode:'certificate'};assert.match(medicalPdfLines(data).join('\n'),/Shared Medical entitlement: 12/);assert.match(medicalPdfLines(data).join('\n'),/\[X\] With medical/);
 delete data.input;data.medical_tracking.baseline_reviewed=false;const text=medicalPdfLines(data).join('\n');assert.match(text,/Evidence route not recorded/);assert.match(text,/baseline is not determined/);assert.doesNotMatch(text,/\[X\]/);assert.deepEqual(medicalPdfLines({...data,code:'recreation'}),[]);
});
test('Government Medical approval PDF stays valid A4 across multi-page detailed usage',async()=>{
 const data=fixture('certificate');data.reason='A detailed application explanation. '.repeat(150);const bytes=await generateGovernmentLeavePdf(data),pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>1);for(const page of pdf.getPages()){assert.equal(page.getWidth(),595.28);assert.equal(page.getHeight(),841.89);}assert.equal(governmentPdfDate('2026-10-08'),'08/10/2026');assert.equal(governmentPdfDate(null),'Not recorded');
});

test('Treasury approval form selects MC and non-MC from the immutable Medical mode',async()=>{
 const {leaveApplicationFormKind}=await import('./leaveApplicationPdf.js');
 for(const [mode,expected] of [['certificate','sickWithMc'],['exemption','sickWithoutMc']]){
  const data=fixture(mode);data.stages=[{binding:{approver_name:'Actual HoD'}}];data.balances=[{before:'10',after:'9',used:'1'}];
  const form=governmentApprovalFormSnapshot(data);assert.equal(leaveApplicationFormKind(form.leave_type_name),expected);assert.equal(form.approved_by_name,'Actual HoD');assert.equal(form.balances[0].before,10);assert.equal(form.balances[0].after,9);assert.equal(form.regime,'government');
 }
 const unknown=fixture(undefined);assert.equal(leaveApplicationFormKind(governmentApprovalFormSnapshot(unknown).leave_type_name),'sickUnspecified');
});

test('approved hourly PDFs retain hours and balances and use Naoero on form and continuation pages',async()=>{
 const {generatedPdfText}=await import('../test-support/pdfText.js');
 const data=fixture('certificate');data.input={duration_unit:'hours',hours:'3.5',medical_mode:'certificate'};
 data.charge='0.5';data.evaluation.requested_hours=3.5;data.evaluation.scheduled_hours=7;
 data.evaluation.segments[0]={...data.evaluation.segments[0],charge:'0.5',scheduled_hours:7,leave_hours:3.5};
 const form=governmentApprovalFormSnapshot(data);assert.equal(form.hours,'3.5');assert.equal(form.days,'0.5');
 const text=await generatedPdfText(await generateGovernmentLeavePdf(data));
 assert.match(text,/REPUBLIC OF NAOERO/);assert.match(text,/Naoero Public Service/);
 assert.match(text,/3.5 hours \(0.5 days from the leave balance\)/);assert.match(text,/0.5 days from the leave balance/);
 assert.match(text,/3.5 leave hours/);assert.doesNotMatch(text,/NAURU|Nauru|Acknowledgement is recorded separately/);
});

test('downloaded approval form is one A4 page while the full retained PDF and grant remain intact',async()=>{
 const {generatedPdfText}=await import('../test-support/pdfText.js');
 const data=fixture('certificate');data.reason='Detailed supporting explanation. '.repeat(150);
 data.input={duration_unit:'hours',hours:'3.5',medical_mode:'certificate'};data.charge='0.5';
 const before=JSON.stringify(data);
 const retained=await PDFDocument.load(await generateGovernmentLeavePdf(data));assert.ok(retained.getPageCount()>1);
 const bytes=await generateGovernmentLeavePdf(data,{firstPageOnly:true}),download=await PDFDocument.load(bytes);
 assert.equal(download.getPageCount(),1);assert.deepEqual(download.getPage(0).getSize(),{width:595.28,height:841.89});
 const text=await generatedPdfText(bytes);assert.match(text,/Naoero Public Service/);assert.match(text,/3.5 hours \(0.5 days from the leave balance\)/);
 assert.match(text,/Full explanation is retained in the application record/);assert.doesNotMatch(text,/page 2|Daily absence charges|Calculation and policy references/);
 assert.equal(JSON.stringify(data),before);
});


test('paternity PDF uses approved working days and service-year remaining balance even for a zero-charge historic grant',async()=>{
 const {generatedPdfText}=await import('../test-support/pdfText.js');
 const data={...fixture('certificate'),code:'paternity',charge:'0',start_date:'2026-11-12',end_date:'2026-11-25'};
 data.evaluation.segments=Array.from({length:14},(_,i)=>({date:new Date(Date.UTC(2026,10,12+i)).toISOString().slice(0,10),scheduled_hours:[0,6].includes(new Date(Date.UTC(2026,10,12+i)).getUTCDay())?0:7,holiday:false}));
 const original=JSON.stringify(data);
 assert.equal(governmentApprovalFormSnapshot(data).days,10);
 // Notes wrap in the Section 4 panel; wrapping only breaks at spaces.
 const flat=async bytes=>(await generatedPdfText(bytes)).replace(/\n/g,' ');
 assert.match(await flat(await generateGovernmentLeavePdf(data,{firstPageOnly:true})),/10 approved working days.*Balance not determined/);
 data.paternity={basis:'current_recorded_applications',as_of:'2026-11-16',periods:[{period_start:'2026-05-01',period_end:'2027-04-30',available_days:0}]};
 const text=await flat(await generateGovernmentLeavePdf(data,{firstPageOnly:true}));
 assert.match(text,/10 approved working days/);assert.match(text,/10 working days per service year/);assert.match(text,/Current balance: 0 days/);assert.match(text,/CURRENT BALANCE/);
 delete data.paternity;assert.equal(JSON.stringify(data),original);
});
test('Maternity and Adoption PDFs show calendar duration independently of a zero ledger charge',()=>{
 for(const code of ['maternity','adoption']){
  const data={...fixture('certificate'),code,charge:'0',start_date:'2026-11-02',end_date:'2027-01-24'};
  const form=governmentApprovalFormSnapshot(data);assert.equal(form.days,84);assert.match(form.parental_note,/84 approved calendar days/);
 }
});

test('approval form prints the employee email, position and next service anniversary when supplied',()=>{
 const form=governmentApprovalFormSnapshot(fixture('certificate'),{email:'review@example.test',position_title:'Accountant',next_due_date:'2027-05-01'});
 assert.equal(form.email,'review@example.test');assert.equal(form.position_title,'Accountant');assert.equal(form.next_due_date,'2027-05-01');
 const bare=governmentApprovalFormSnapshot(fixture('certificate'));assert.equal(bare.email,null);assert.equal(bare.next_due_date,null);
});

test('department prints with its top-level unit when the directory supplies them',()=>{
 const form=governmentApprovalFormSnapshot(fixture('certificate'),{department_name:'Finance',unit_name:'Treasury'});
 assert.equal(form.department_code,'Finance');assert.equal(form.division_code,'Treasury');
});

test('an amendment prints as the approved leave it changed, with the change noted beside Section 4',async()=>{
 const {generatedPdfText}=await import('../test-support/pdfText.js');
 const {leaveApplicationFormKind}=await import('./leaveApplicationPdf.js');
 const original={id:'0a1b2c3d-0000-4000-8000-000000000000',code:'recreation',medical_mode:'not_applicable',start_date:'2026-11-02',end_date:'2026-11-06',charge:'5.000000',
  segments:['02','03','04','05','06'].map(d=>({date:`2026-11-${d}`,charge:'1.000000'}))};
 const grant={...fixture('certificate'),code:'amendment',start_date:'2026-11-02',end_date:'2026-11-03',charge:'0',balances:[],reason:'Returned to work early.'};
 const shortened=governmentApprovalFormSnapshot(grant,{amendment:{action:'shorten_grant',original}});
 assert.equal(leaveApplicationFormKind(shortened.leave_type_name),'annual');assert.equal(shortened.days,2);
 assert.equal(shortened.start_date,'2026-11-02');assert.equal(shortened.end_date,'2026-11-03');
 assert.match(shortened.amendment_note,/shortened to end 03\/11\/2026; 3 days returned/);
 const cancelled=governmentApprovalFormSnapshot(grant,{amendment:{action:'cancel_grant',original}});
 assert.equal(cancelled.days,0);assert.equal(cancelled.end_date,'2026-11-06');assert.match(cancelled.amendment_note,/was cancelled; 5 days returned/);
 const text=(await generatedPdfText(await generateGovernmentLeavePdf(grant,{firstPageOnly:true,details:{amendment:{action:'shorten_grant',original}}}))).replace(/\n/g,' ');
 assert.match(text,/Returned to work early/);assert.match(text,/Amendment: approved leave ref 0a1b2c3d/);assert.doesNotMatch(text,/Other approved leave type|not listed on this form/);
});

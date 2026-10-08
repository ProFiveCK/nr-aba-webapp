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

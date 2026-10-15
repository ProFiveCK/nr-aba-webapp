import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evidenceReviewInput} from './governmentLeaveEvidence.js';
test('one HR comment attests to the actual application and retains detailed confirmations',()=>{
 const request={code:'medical',medical_mode:'certificate',start_date:'2026-11-02',end_date:'2026-11-03'};
 const data={verification_comment:' I have reviewed the evidence and confirmed it '};
 const result=evidenceReviewInput(request,data);
 assert.equal(result.source_reference,data.verification_comment.trim());assert.equal(result.evidence_reviewed,true);
 assert.equal(result.certificate_reviewed,true);assert.equal(result.covers_start,request.start_date);assert.equal(result.covers_end,request.end_date);
 assert.equal(evidenceReviewInput({...request,code:'special'},data).justification_accepted,true);
 const detailed={evidence_reviewed:true,source_reference:'Original source'};assert.equal(evidenceReviewInput(request,detailed),detailed);
 for(const verification_comment of ['',null,'short','x'.repeat(501)])assert.throws(()=>evidenceReviewInput(request,{verification_comment}),error=>error.status===400);
});

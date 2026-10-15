import {badRequest} from './serviceError.js';
// A single explicit confirmation attests to the evidence for the submitted absence.
// Existing detailed confirmations remain readable and supported.
export function evidenceReviewInput(request,data) {
 if(data.verification_comment===undefined)return data;
 const comment=String(data.verification_comment).trim();
 if(comment.length<10||comment.length>500)throw badRequest('Enter a verification comment between 10 and 500 characters.');
 return {...data,source_reference:comment,evidence_reviewed:true,
  certificate_reviewed:request.code==='medical'&&request.medical_mode==='certificate',
  justification_accepted:request.code==='special',
  covers_start:request.code==='medical'&&request.medical_mode==='certificate'?request.start_date:null,
  covers_end:request.code==='medical'&&request.medical_mode==='certificate'?request.end_date:null};
}

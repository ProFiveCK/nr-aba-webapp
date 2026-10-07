import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
const printable=value=>String(value??'').replace(/[^\x20-\x7e\n]/g,'?');
const officeLabels={division:'Divisional approver',department:'Head of Department',hr_verifier:'HR verifier',relevant_secretary:'Relevant Secretary',chief_secretary:'Chief Secretary',minister:'Minister statutory decision'};
const label=value=>officeLabels[value]||printable(value).replace(/_/g,' ').replace(/^./,s=>s.toUpperCase());
export async function generateGovernmentLeavePdf(grant) {
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const width=595.28,height=841.89,margin=44,maxWidth=width-2*margin;
  let page,y,pageNumber=0;
  function nextPage() {
    page=pdf.addPage([width,height]);pageNumber++;y=height-margin;
    page.drawText('REPUBLIC OF NAURU - PUBLIC SERVICE',{x:margin,y,size:11,font:bold,color:rgb(0.03,0.17,0.39)});y-=20;
    page.drawText('APPROVED GOVERNMENT LEAVE',{x:margin,y,size:14,font:bold});y-=22;
    page.drawText(`Application: ${grant.id}`,{x:margin,y,size:8,font});y-=23;
    page.drawText(`Personnel file copy | Page ${pageNumber}`,{x:margin,y:23,size:8,font,color:rgb(.4,.4,.4)});
  }
  function line(value,{strong=false,size=10}={}) {
    const face=strong?bold:font;
    for(const paragraph of printable(value).split('\n')) {
      let buffer='';
      for(const word of paragraph.split(/\s+/)) {
        let token=word;
        while(face.widthOfTextAtSize(token,size)>maxWidth) {
          let cut=token.length;while(cut>1&&face.widthOfTextAtSize(token.slice(0,cut),size)>maxWidth)cut--;
          if(buffer){draw(buffer);buffer='';}draw(token.slice(0,cut));token=token.slice(cut);
        }
        if(buffer&&face.widthOfTextAtSize(`${buffer} ${token}`,size)>maxWidth){draw(buffer);buffer=token;}else buffer=buffer?`${buffer} ${token}`:token;
      }
      draw(buffer);
    }
    function draw(text){if(y<65)nextPage();page.drawText(text,{x:margin,y,size,font:face});y-=size+5;}
  }
  function heading(text){if(y<95)nextPage();y-=8;line(text,{strong:true,size:11});}
  nextPage();
  line(`Employee: ${grant.employee.name}`,{strong:true});
  line(`Payroll ID: ${grant.employee.payroll_id||'Not recorded'}`);
  line(`Department: ${grant.employee.department_name||''} | Division: ${grant.employee.division_name||''}`);
  line(`Leave: ${label(grant.code)} | ${grant.start_date} to ${grant.end_date}`);
  line(grant.case_determination?`Event case | Scheduled hours: ${grant.evaluation.scheduled_hours} | No annual balance assigned`:`Granted charge: ${grant.charge} policy days | Scheduled hours: ${grant.evaluation.scheduled_hours}`);
  line(`Submitted: ${new Date(grant.submitted_at).toISOString()} | Final grant: ${grant.granted_at}`,{size:9});
  heading('Chief Secretary final grant and recorded approvals');
  for(const stage of grant.stages) {
    line(`${stage.ordinal+1}. ${label(stage.level)} - ${stage.binding?.approver_name||'Recorded officeholder'}`,{strong:true,size:9});
    line(`Approved: ${stage.decision?.decided_at||''} | Decision ${stage.decision?.id||''}`,{size:8});
  }
  line('These are recorded electronic decisions. No handwritten signature is represented.',{size:9});
  heading('Explanation supplied by the employee');line(grant.reason,{size:9});
  if(grant.case_determination){heading('Reviewed case and pay determination');line(`Authority: ${grant.case_determination.source_reference}`,{size:9});line(`Evidence: ${grant.case_determination.evidence_reference}`,{size:9});for(const segment of grant.case_determination.pay_segments)line(`${segment.start_date} to ${segment.end_date}: ${segment.salary_percent}% salary`,{size:9});if(grant.case_determination.facts.payable_amount!==undefined)line(`Reviewed valuation: ${grant.case_determination.facts.payable_amount} AUD | ${grant.case_determination.facts.salary_valuation_reference}`,{size:9});if(grant.case_determination.facts.allowance_amount!==undefined)line(`Approved official allowance: ${grant.case_determination.facts.allowance_amount} AUD | ${grant.case_determination.facts.allowance_reference}`,{size:9});if(grant.case_determination.benefit)line(`Committed benefit: ${grant.case_determination.benefit.requested} ${grant.case_determination.benefit.unit} | Action: ${label(grant.case_determination.benefit.action)} | Prior history: ${grant.case_determination.benefit.prior}`,{size:9});if(grant.effect?.action)line(`Amendment: ${label(grant.effect.action)} | Original application: ${grant.case_determination.facts.original_request_id}`,{size:9});for(const task of grant.case_determination.tasks)line(`Follow-up: ${task.description} | Due: ${task.due_date||'As soon as practicable / reviewed reference'}`,{size:9});}
  if(grant.balances.length)heading('Balance reconciliation');
  for(const balance of grant.balances)line(`Credit before: ${balance.before} | Used: ${balance.used} | Credit after: ${balance.after} policy days`,{size:9});
  heading('Calculation and policy references');
  line(`Evaluator: ${grant.engine_version} | Regime: ${grant.regime}`,{size:9});
  line(`Calculation: ${grant.evaluation.snapshot_hash}`,{size:8});
  for(const policy of grant.evaluation.policy_versions)line(`Policy ${policy.id}: ${policy.label} | ${policy.source_reference}`,{size:8});
  heading(grant.case_determination?'Dated schedule for payroll review (no annual balance debit)':'Daily absence charges');
  for(const segment of grant.evaluation.segments)line(`${segment.date} | ${segment.charge} policy days | ${segment.scheduled_hours} scheduled hours${segment.holiday_exempt?' | Public holiday exempt':''}`,{size:8});
  heading('Salary Unit');line('Acknowledgement is recorded separately after the final grant. This leave record does not initiate a payment.',{size:9});
  pdf.setTitle(`Government leave - ${printable(grant.employee.name)}`);
  pdf.setSubject('Chief Secretary final grant; immutable personnel-file snapshot');
  return pdf.save();
}

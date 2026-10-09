import {fingerprint, units, decimal} from './governmentLeaveRules.js';

export const PAYROLL_FORMAT = 'ron-leave-payroll-1';
export const HANDOVER_FORMAT = 'ron-leave-handover-1';
const financialCodes = ['long_service','furlough','recreation_encashment','recreation_separation'];

/** Salary instructions use the granted calculation, never today's evaluator. */
export function payrollLines(requests, identities, from, to) {
  const lines = [], issues = [];
  for (const r of requests) {
    if (r.code === 'amendment') continue;
    const grant = r.grant_snapshot, d = grant?.case_determination;
    if (!grant?.evaluation || !Array.isArray(grant.evaluation.segments)) {
      issues.push(`Grant ${r.id} has no retained calculation.`); continue;
    }
    if (r.amendment?.action === 'cancel_grant') continue;
    const end = r.amendment?.effective_end || r.end_date;
    const absence = !d || grant.effect?.absence === true;
    const candidates = [];
    if (absence || r.code === 'attendance') {
      for (const s of grant.evaluation.segments) {
        if (s.date < from || s.date > to || s.date > end) continue;
        const pay = d ? d.pay_segments.find(p => p.start_date <= s.date && p.end_date >= s.date) : {salary_percent:'100.000000'};
        if (!pay) {issues.push(`Grant ${r.id} has no salary instruction for ${s.date}.`); continue;}
        candidates.push({key:`${r.id}:${s.date}:salary`,kind:r.code === 'attendance'?'attendance_instruction':'absence',date:s.date,
          salary_percent:pay.salary_percent,scheduled_hours:String(s.scheduled_hours),policy_days:s.charge,
          annual_debit:d||grant.legacy_approval?.balance_already_deducted?'0.000000':s.charge,payable_aud:'0.00',policy_version_id:s.policy_version_id,
          service_basis_id:s.service_basis_id,source_request_id:r.id,correction_request_id:r.amendment_request_id || null});
      }
    }
    if (r.start_date >= from && r.start_date <= to && d) {
      if (financialCodes.includes(r.code) && d.facts.action !== 'take_leave') candidates.push({key:`${r.id}:benefit`,kind:'benefit_instruction',date:r.start_date,
        salary_percent:null,scheduled_hours:'0',policy_days:d.benefit.requested,annual_debit:['recreation_encashment','recreation_separation'].includes(r.code)?d.benefit.requested:'0.000000',payable_aud:d.facts.payable_amount});
      if (r.code === 'official' && d.facts.allowance_amount !== undefined) candidates.push({key:`${r.id}:allowance`,kind:'allowance_instruction',date:r.start_date,
        salary_percent:null,scheduled_hours:'0',policy_days:'0.000000',annual_debit:'0.000000',payable_aud:d.facts.allowance_amount});
    }
    if (!candidates.length) continue;
    const identity = identities[r.employee_id];
    if (!identity?.payroll_id) {issues.push(`Verify one Payroll ID for ${r.employee_id} before exchange.`); continue;}
    for (const row of candidates) lines.push({...row,employee_id:r.employee_id,payroll_id:identity.payroll_id,employee_name:identity.name,
      code:r.code,source_request_id:r.id,correction_request_id:r.amendment_request_id || null,
      department_id:grant.employee.department_id,division_id:grant.employee.division_id});
  }
  return {lines:lines.sort((a,b)=>a.key.localeCompare(b.key)),issues:[...new Set(issues)]};
}
export function payrollDiff(previous, current) {
  const old = new Map(previous.map(l=>[l.key,l])), next = new Map(current.map(l=>[l.key,l])), changes=[];
  for (const key of [...new Set([...old.keys(),...next.keys()])].sort()) {
    const before=old.get(key)||null,after=next.get(key)||null;
    if (fingerprint(before)!==fingerprint(after)) changes.push({key,action:!before?'add':!after?'remove':'replace',before,after});
  }
  return changes;
}
export function payrollTotals(lines) {
  const groups=new Map();
  for (const l of lines) {
    const key=JSON.stringify([l.employee_id,l.payroll_id,l.code,l.kind,l.salary_percent]);
    const row=groups.get(key)||{employee_id:l.employee_id,payroll_id:l.payroll_id,code:l.code,kind:l.kind,salary_percent:l.salary_percent,rows:0,days:0n,debit:0n,hours:0n,money:0n};
    row.rows++;row.days+=units(l.policy_days);row.debit+=units(l.annual_debit);row.hours+=units(l.scheduled_hours);row.money+=units(l.payable_aud);groups.set(key,row);
  }
  return [...groups.values()].map(({days,debit,hours,money,...row})=>({...row,policy_days:decimal(days),annual_debit:decimal(debit),scheduled_hours:decimal(hours),payable_aud:decimal(money)}));
}
const columns=['batch_id','version','snapshot_hash','supersedes_id','action','key','employee_id','payroll_id','employee_name','code','kind','date','salary_percent','scheduled_hours','policy_days','annual_debit','payable_aud','source_request_id','correction_request_id'];
/** Formula-looking text stays literal in spreadsheet viewers; JSON retains exact raw IDs. */
export function csvCell(value) {
  let s=String(value??'');if (/^[\s]*[=+\-@\t\r]/.test(s)) s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function payrollCsv(batch, corrections=false) {
  const meta={batch_id:batch.id,version:batch.version,snapshot_hash:batch.snapshot_hash,supersedes_id:batch.supersedes_id};
  const rows=corrections?batch.snapshot.changes.flatMap(c=>[...(c.before?[{...c.before,action:'reverse_previous_instruction'}]:[]),...(c.after?[{...c.after,action:'apply_replacement_instruction'}]:[])]):batch.snapshot.lines.map(l=>({...l,action:'period_replacement_register'}));
  return '\uFEFF'+[columns.map(csvCell).join(','),...rows.map(row=>columns.map(c=>csvCell({...meta,...row}[c])).join(','))].join('\r\n')+'\r\n';
}

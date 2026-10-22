import type { MedicalReview } from './MedicalRequestReview';
import type { LeaveApplication } from './types';
import type { RecreationForecast } from './RecreationForecast';
export type GovernmentRequestSummary={medical_mode?:string|null;amendment?:{request_id:string;action:string;effective_end:string}|null;record_source?:'workflow'|'recorded';leave_type_name?:string|null;can_pdf?:boolean;recorded_application?:(LeaveApplication&{can_decide?:boolean})|null;id:string;employee_id:string;employee_name:string;code:string;duration_unit?:'days'|'hours'|null;hours?:string|null;start_date:string;end_date:string;charge:string;status:string;submitted_at:string;stage_index:number;current_level:string|null;current_label?:string|null;current_approver:string|null;unassigned_stages:number;};
export type GovernmentStage={id:string;ordinal:number;level:string;label?:string|null;binding:{id:string;approver_name:string;reviewer_id:string}|null;decision:{decision:string;decided_at:string;note?:string}|null;issue:string|null;can_decide:boolean};
export type GovernmentRequest=GovernmentRequestSummary&{
 medical_review?:MedicalReview;
 forecast?:RecreationForecast|null;
 legacy_approval?:{application_id:string;approved_by_name:string|null;approved_at:string}|null;
 approval_route?:{id:string|null;configured:boolean;stages:{level:string;label:string}[]}|null;evidence_review_required?:boolean;evidence_review?:{actor_id:string;recorded_at:string}|null;can_verify_evidence?:boolean;
 simple_approval?:boolean;case_details?:Record<string,unknown>;approval_checks?:string[];benefit_basis?:{id:string;unit:string;prior_units:string;source_reference:string}|null;standard_lwop?:boolean;case?:boolean;amendment_action?:'cancel_grant'|'shorten_grant'|null;event_reference?:string;related_request_id?:string;assisted_entry?:boolean;can_prepare?:boolean;can_continue?:boolean;can_amend?:boolean;
 amendment?:{request_id:string;action:string;effective_end:string}|null;
 determination?:{id:string;prepared_by:string;version:number;source_reference:string;evidence_reference?:string;reason?:string;facts?:Record<string,unknown>;pay_segments:{start_date:string;end_date:string;salary_percent:string}[];discretion:string[];benefit:{requested:string;unit:string;action:string;service_years:number;prior:string}|null}|null;
 tasks?:{id:string;kind:string;due_date:string|null;description:string;status:string;reference:string|null}[];can_manage_tasks?:boolean;
stages:GovernmentStage[];reason:string|null;medical_mode:string;short_notice?:{required_days:number;given_days:number}|null;private_access:boolean;can_cancel:boolean;can_cancel_own?:boolean;can_pdf:boolean;documents:{id:string;file_name:string;byte_size:number}[]};
export type WorkflowConfiguration={draft_revision?:number;discarded?:boolean;id:string;employee_id:string;display_name:string;enabled_codes:string[];medical_rule:string;medical_history:{start_date:string;end_date:string;uncertified:boolean;charge:string}[];medical_period_start:string;medical_as_of:string;legacy_resolution_reference:string;reason:string;status:string;prepared_by:string;source_reference:string};
export type ConsentOffice={id:string;level:string;display_name:string;department_id:string|null;effective_from:string;effective_to:string|null;closed_office_id:string|null;source_reference:string};
export type GovernmentJobPlan={initial_setup_review_id?:string|null;draft_revision?:number;discarded?:boolean;id:string;employee_id:string;display_name:string;code:string;status:string;prepared_by:string;method:string;first_post_end:string|null;payroll_anchor:string|null;temporary_start:string|null;reason:string;source_reference:string};
const officeLabels:Record<string,string>={division:'Divisional approver',parent_division:'Treasury / parent unit approver',department:'Head of Department',hr_verifier:'HR verifier',relevant_secretary:'Relevant Secretary',chief_secretary:'Chief Secretary',minister:'Minister statutory decision'};
export const staffCaseCodes = ['teacher_recreation', 'extended_medical', 'extended_medical_minister', 'maternity', 'paternity', 'adoption', 'official', 'lwop', 'furlough', 'witness_republic', 'witness_other'];
const leaveLabels: Record<string, string> = {
    teacher_recreation: 'Teacher recreation leave',
    extended_medical: 'Extended medical leave',
    extended_medical_minister: 'Further extended medical leave',
    maternity: 'Maternity leave', paternity: 'Paternity leave', adoption: 'Adoption leave',
    official: 'Official duty leave', lwop: 'Leave without pay',
    long_service: 'Long service benefit',
    recreation_encashment: 'Recreation leave cash-out',
    recreation_separation: 'Recreation payout on leaving employment',
    witness_republic: 'Witness for the Republic', witness_other: 'Other witness leave',
    attendance: 'Attendance review', amendment: 'Change approved leave',
};
export const governmentLabel=(value:string)=>officeLabels[value]||leaveLabels[value]||value.replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());

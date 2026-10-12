import { LeaveAccount } from './LeaveAccount';
import { useAuth } from '../../contexts/useAuth';
import { MedicalTracking } from './MedicalTracking';
import type { MedicalTrackingSummary } from './MedicalTracking';
import { policyVersionLabel } from './policyVersionLabel';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../../lib/api';
import { formatDate } from '../../lib/date';
import { Button, LoadingState } from '../../components/Ui';
import { EmployeeDetails } from './EmployeeDetails';
import { EmployeeOnboarding } from './EmployeeOnboarding';
import { GovernmentFoundation } from './GovernmentFoundation';
import { GovernmentWorkflowManagement } from './GovernmentWorkflowManagement';
import { reviewRecordLabel } from './reviewRecordNames';
import type { EmployeeProfile, WorkPattern } from './managementTypes';
import type { OrgDepartment } from './types';

type LegacyPolicy = {id:string;name:string;default_days:number;is_accruable:boolean;accrual_days_per_fortnight:string;max_balance:string|null;reset_period:string;is_active:boolean};
type Summary = {
    regime:string;account_type:string|null;restricted:boolean;as_of:string;reporting_manager:{name:string|null;description:string};
    legacy:null|{operational:boolean;leave_entitled:boolean;ineligible_reason:string|null;study_leave_start:string|null;study_leave_end:string|null;eligibility_note:string|null;join_date:string|null;daily_rate?:number|string|null;
        effective_balances:{leave_type_id:string;leave_type_name:string;year:number;balance:string;pending:string;source:string}[];
        balances:{id:string;leave_type_name:string;year:number;balance:string;pending:string}[];policies:LegacyPolicy[];settings:{accrual_anchor_date:string|null};application_counts:{status:string;count:number}[]};
    government:null|{medical_tracking:MedicalTrackingSummary;policy:null|{label:string;effective_from:string;effective_to:string};operational_status:string;
        activation:{status:string;enabled_codes:string[]};entitlements:{id:string;code:string;as_of:string;period_start:string;period_end:string;balance:string;held:string;available:string}[];
        application_counts:{status:string;count:number}[];applicability:{code:string;enabled:boolean;opening_certified:boolean;detail:string}[];
        route:{stages:{level:string;label?:string|null;approver_name:string|null;issue:string|null;conditional:boolean;applies_to:string[]}[]}};
    preparation:{key:string;label:string;status:string;detail:string}[];
};
export type EmployeeSection = 'arrangements'|'details'|'applications'|'prepare';
export type PreparationStep = 'identity'|'login'|'balances'|'activation';
const stages:Record<string,string>={division:'Divisional approver',parent_division:'Treasury / parent unit approver',department:'Head of Department',hr_verifier:'HR evidence verifier',relevant_secretary:'Relevant Secretary',minister:'Minister',chief_secretary:'Chief Secretary'};
const leaveName=(code:string)=>code.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const steps: [PreparationStep, string][] = [['balances', 'Service & balances'], ['login', 'Account access'], ['activation', 'Leave access & schedules']];

export function EmployeeLeaveWorkspace({profile,departments,patterns,central,section,step,onNavigate,onClose,onChanged}:{profile:EmployeeProfile;departments:OrgDepartment[];patterns:WorkPattern[];central:boolean;section:EmployeeSection;step:PreparationStep;onNavigate:(section:EmployeeSection,step?:PreparationStep)=>void;onClose:()=>void;onChanged:()=>Promise<void>}) {
    const { user } = useAuth();
    const canReadBalances=central||user?.permissions?.hr_balance_manage===true;
    const id=profile.employee.id;
    const [summary,setSummary]=useState<Summary|null>(null),[error,setError]=useState(''),[version,setVersion]=useState(0);
    useEffect(()=>{let live=true;void apiClient.get<Summary>(`/hr/directory/${id}/leave-arrangements`).then(data=>{if(live){setSummary(data);setError('');}}).catch((err:Error)=>{if(live)setError(err.message);});return()=>{live=false;};},[id,version,profile,section,step]);
    async function refresh(){await onChanged();setVersion(v=>v+1);}
    const legacy=summary?.legacy,government=summary?.government;
    const state = summary?.regime === 'government' ? (summary.restricted ? 'Access restricted' : government?.activation.status === 'active' ? 'Leave access active' : government?.activation.status === 'paused' ? 'Leave access paused' : 'Setup incomplete') : summary ? 'Employee record' : 'Loading…';
    return <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><Button variant="ghost" onClick={onClose}>← Employees</Button><h2 className="mt-2 break-words text-xl font-semibold text-gray-900">{reviewRecordLabel(profile.employee.display_name)}</h2><p className="break-words text-sm text-gray-600">{reviewRecordLabel(profile.employee.department_code||'Department unverified')} / {reviewRecordLabel(profile.employee.division_code||'Division unverified')} · {profile.employee.status}</p></div><span className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-900">{state}</span></div>
        <nav aria-label="Employee management" className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">{([['arrangements',canReadBalances?'Balances & policy':'Overview'],['details','Details & appointment'],['applications','Applications'],...(central?[['prepare','Leave setup']]:[])] as [EmployeeSection,string][]).map(([key,label])=><Button key={key} variant={section===key?'primary':'secondary'} aria-current={section === key ? 'page' : undefined} onClick={()=>onNavigate(key, key === 'prepare' ? 'balances' : undefined)}>{label}</Button>)}</nav>
        {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!summary&&!error&&<LoadingState label="Loading current leave arrangements…"/>}
        {section==='arrangements'&&summary&&<>
            <div className="app-panel space-y-3 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Leave summary</h3><Button variant="secondary" onClick={()=>void refresh()}>Refresh</Button></div>
                {summary.regime === 'government' && government?.activation.status !== 'active' && <p className="text-sm text-gray-600">Review this employee’s appointment, certified balances and leave access before they apply.</p>}
                {government?.policy && summary.regime === 'government' && <p className="text-sm text-gray-600">Policy: <strong>{reviewRecordLabel(policyVersionLabel(government.policy.label,'published'))}</strong> · {formatDate(government.policy.effective_from)} to {formatDate(government.policy.effective_to)}.</p>}
                {summary.regime !== 'government' && <p className="text-sm text-gray-600">Reporting manager: <strong>{reviewRecordLabel(summary.reporting_manager.name || 'Not assigned')}</strong>.</p>}
            </div>

            {canReadBalances&&<LeaveAccount key={id} employeeId={id} refreshVersion={version}/>}
            {government?.medical_tracking&&<MedicalTracking tracking={government.medical_tracking} legacy={summary.regime==='legacy'}/>}
            {government&&<details open={summary.regime==='government'} className="app-panel space-y-3 p-4"><summary className="cursor-pointer text-sm font-semibold">Leave approvers · {formatDate(summary.as_of)}</summary><p className="text-sm text-gray-600">Each application follows the approval route recorded when it is submitted.</p><ol className="space-y-2">{government.route.stages.filter(s=>s.applies_to.some(code=>['recreation','medical','special'].includes(code))).map(s=><li key={s.level} className="rounded-lg border border-gray-200 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{s.label||stages[s.level]||leaveName(s.level)}</strong><span>{reviewRecordLabel(s.approver_name||'Unassigned')}</span></div>{s.conditional&&<p className="mt-1 text-xs text-gray-500">Required for: {s.applies_to.map(leaveName).join(', ')}</p>}{s.issue&&<p className="mt-1 text-xs text-amber-800">{s.issue}</p>}</li>)}</ol><Link className="text-sm text-brand underline" to="/leave/settings?view=organisation">Manage organisation and approvers</Link></details>}

        </>}
        {section==='details'&&<EmployeeDetails embedded profile={profile} central={central} departments={departments} patterns={patterns} onClose={onClose} onChanged={refresh}/>}
        {section==='applications'&&<>{legacy&&<p className="text-sm text-gray-600">Leave records before migration: {legacy.application_counts.length?legacy.application_counts.map(c=>`${c.count} ${c.status}`).join(' · '):'none'}. These counts refer to the original records and decisions; current applications appear below.</p>}{central?<GovernmentWorkflowManagement key={id} selectedEmployeeId={id} view="applications"/>:<p className="text-sm text-gray-600">Application review follows your assigned HR permissions. Open Approvals or Reports to view the records available to you.</p>}</>}
        {section==='prepare'&&central&&<>
            <div className="app-panel space-y-4 p-5"><div><h3 className="font-semibold">Complete this employee’s leave setup</h3><p className="mt-1 text-sm leading-6 text-gray-600">First record the appointment and work schedule in Details &amp; appointment. Then confirm service and balances, account access, and the leave types this employee can use.</p></div><nav aria-label="Employee leave setup" className="flex flex-wrap gap-2">{steps.map(([key,label])=><Button key={key} variant={(step==='identity'?'balances':step)===key?'primary':'secondary'} aria-current={step===key?'page':undefined} onClick={()=>onNavigate('prepare',key)}>{label}</Button>)}</nav></div>
            {(step==='balances'||step==='identity')&&<GovernmentFoundation key={id} selectedEmployeeId={id}/>}
            {step==='login'&&<EmployeeOnboarding key={id} departments={departments} selectedEmployeeId={id}/>}
            {step==='activation'&&<GovernmentWorkflowManagement key={id} selectedEmployeeId={id} view="activation"/>}
        </>}

    </div>;
}

import { MedicalTracking } from './MedicalTracking';
import type { MedicalTrackingSummary } from './MedicalTracking';
import { policyVersionLabel } from './policyVersionLabel';
import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { LeaveAccount } from './LeaveAccount';
import { Link } from 'react-router-dom';
import { apiClient } from '../../lib/api';
import { formatDate } from '../../lib/date';
import { Button, LoadingState } from '../../components/Ui';
import { inputClass } from './ManagementFields';
import { EmployeeDetails } from './EmployeeDetails';
import { EmployeeOnboarding } from './EmployeeOnboarding';
import { GovernmentFoundation } from './GovernmentFoundation';
import { GovernmentPayroll } from './GovernmentPayroll';
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
export type PreparationStep = 'identity'|'login'|'balances'|'reconciliation'|'activation';
const stages:Record<string,string>={division:'Divisional approver',parent_division:'Treasury / parent unit approver',department:'Head of Department',hr_verifier:'HR evidence verifier',relevant_secretary:'Relevant Secretary',minister:'Minister',chief_secretary:'Chief Secretary'};
const leaveName=(code:string)=>code.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const steps:[PreparationStep,string][]=[['identity','1. Identity & appointment'],['login','2. Login & enrolment'],['balances','3. Service & balances'],['reconciliation','4. Retained leave reconciliation'],['activation','5. Activation & accrual']];

export function EmployeeLeaveWorkspace({profile,departments,patterns,central,section,step,onNavigate,onClose,onChanged}:{profile:EmployeeProfile;departments:OrgDepartment[];patterns:WorkPattern[];central:boolean;section:EmployeeSection;step:PreparationStep;onNavigate:(section:EmployeeSection,step?:PreparationStep)=>void;onClose:()=>void;onChanged:()=>Promise<void>}) {
    const { user } = useAuth();
    const canReadBalances=central||user?.permissions?.hr_balance_manage===true;
    const id=profile.employee.id;
    const [summary,setSummary]=useState<Summary|null>(null),[error,setError]=useState(''),[version,setVersion]=useState(0);
    useEffect(()=>{let live=true;void apiClient.get<Summary>(`/hr/directory/${id}/leave-arrangements`).then(data=>{if(live){setSummary(data);setError('');}}).catch((err:Error)=>{if(live)setError(err.message);});return()=>{live=false;};},[id,version,profile,section,step]);
    async function refresh(){await onChanged();setVersion(v=>v+1);}
    const legacy=summary?.legacy,government=summary?.government;
    const state=summary?.regime==='government'?(summary.restricted?'Government Leave assigned':government?.activation.status==='active'?'Government Leave activated':government?.activation.status==='paused'?'Government Leave paused':'Preparing Government Leave'):summary?.account_type==='employee'?'Government preparation required':summary?'Leave setup needs review':'Checking leave arrangements…';
    return <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><Button variant="ghost" onClick={onClose}>← Employees</Button><h2 className="mt-2 break-words text-xl font-semibold text-gray-900">{reviewRecordLabel(profile.employee.display_name)}</h2><p className="break-words text-sm text-gray-600">{reviewRecordLabel(profile.employee.department_code||'Department unverified')} / {reviewRecordLabel(profile.employee.division_code||'Division unverified')} · {profile.employee.status}</p></div><span className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-900">{state}</span></div>
        <nav aria-label="Employee management" className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">{([['arrangements',canReadBalances?'Balances & policy':'Policy & approvers'],['details','Employee details'],['applications','Applications'],...(central?[['prepare',summary?.regime==='government'?'Balance & setup changes':'Transfer & exceptions']]:[])] as [EmployeeSection,string][]).map(([key,label])=><Button key={key} variant={section===key?'primary':'secondary'} onClick={()=>onNavigate(key)}>{label}</Button>)}</nav>
        {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!summary&&!error&&<LoadingState label="Loading current leave arrangements…"/>}
        {section==='arrangements'&&summary&&<>
            <div className="app-panel space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Policy & status</h3><Button variant="secondary" onClick={()=>void refresh()}>Refresh status</Button></div><p className="text-sm text-gray-700">{summary.regime!=='government'?'Leave setup needs review. Central HR must confirm the transfer and activation before current policy leave can be used.':government?.activation.status==='active'?'Leave is active under the published policy.':government?.activation.status==='paused'?'Leave is paused. Ask central HR to review activation.':'Leave activation is still being completed.'}</p>{summary.regime==='legacy'&&<p className="text-sm text-gray-600">Reporting manager: <strong>{reviewRecordLabel(summary.reporting_manager.name||'Not assigned')}</strong>. {summary.reporting_manager.description}</p>}
                {government?.policy&&<p className="text-sm text-gray-600">Published Government rules: <strong>{reviewRecordLabel(policyVersionLabel(government.policy.label,'published'))}</strong> · {formatDate(government.policy.effective_from)} to {formatDate(government.policy.effective_to)}. {summary.regime==='legacy'?'Complete leave setup to apply these rules.':'Actual applications use the policy effective on their dates.'}</p>}
                {legacy&&summary.regime==='legacy'&&<p className="text-sm text-gray-600">Recorded eligibility: {legacy.leave_entitled?'Entitled':`Restricted${legacy.ineligible_reason?` — ${leaveName(legacy.ineligible_reason)}`:''}`}. Historical values and decisions are retained in the personnel record.</p>}
            </div>

            {canReadBalances&&<LeaveAccount key={id} employeeId={id} refreshVersion={version}/>}
            {government?.medical_tracking&&<MedicalTracking tracking={government.medical_tracking} legacy={summary.regime==='legacy'}/>}
            {government&&<details open={summary.regime==='government'} className="app-panel space-y-3 p-4"><summary className="cursor-pointer text-sm font-semibold">Leave approvers · {formatDate(summary.as_of)}</summary><p className="text-sm text-gray-600">These are the nominated approvers for current Government leave. Each request follows the route recorded when it was submitted.</p><ol className="space-y-2">{government.route.stages.filter(s=>s.applies_to.some(code=>['recreation','medical','special'].includes(code))).map(s=><li key={s.level} className="rounded-lg border border-gray-200 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{s.label||stages[s.level]||leaveName(s.level)}</strong><span>{reviewRecordLabel(s.approver_name||'Unassigned')}</span></div>{s.conditional&&<p className="mt-1 text-xs text-gray-500">Required for: {s.applies_to.map(leaveName).join(', ')}</p>}{s.issue&&<p className="mt-1 text-xs text-amber-800">{s.issue}</p>}</li>)}</ol><Link className="text-sm text-brand underline" to="/leave/settings?view=organisation">Manage organisation and approvers</Link></details>}
            {central&&summary.preparation.length>0&&<details className="app-panel p-4"><summary className="cursor-pointer text-sm font-semibold">Setup checks</summary><div className="mt-3 space-y-3">{summary.preparation.map(p=><div key={p.key} className="text-sm"><p><strong>{p.label}</strong> · {p.status==='ready'?'Recorded':p.status==='needs_review'?'Review required':'Preparation required'}</p><p className="mt-1 text-gray-600">{p.detail}</p></div>)}<Button onClick={()=>onNavigate('prepare')}>Continue preparation for this employee</Button></div></details>}

        </>}
        {section==='details'&&<EmployeeDetails embedded profile={profile} central={central} departments={departments} patterns={patterns} onClose={onClose} onChanged={refresh}/>}
        {section==='applications'&&<>{legacy&&<p className="text-sm text-gray-600">Retained existing applications: {legacy.application_counts.length?legacy.application_counts.map(c=>`${c.count} ${c.status}`).join(' · '):'none'}. Original decisions remain in the personnel history.</p>}{central?<GovernmentWorkflowManagement key={id} selectedEmployeeId={id} view="applications"/>:<p className="text-sm text-gray-600">Application review follows your assigned HR permissions. Open Approvals or Reports to view the records available to you.</p>}</>}
        {section==='prepare'&&central&&<><p className="app-panel p-4 text-sm text-gray-700">For ordinary existing staff, <Link className="font-semibold text-brand underline" to="/leave/settings?view=rollout">use Staff transfer</Link> to carry balances and apply the Government policy together. Use the individual tools below for new employees, balance corrections or cases that need separate handling.</p><label className="block text-sm font-medium">Preparation step<select className={`${inputClass} mt-2`} aria-label="Preparation step" value={step} onChange={e=>onNavigate('prepare',e.target.value as PreparationStep)}>{steps.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
            {step==='identity'&&<EmployeeDetails embedded profile={profile} central departments={departments} patterns={patterns} onClose={onClose} onChanged={refresh}/>}
            {step==='login'&&<EmployeeOnboarding key={id} departments={departments} selectedEmployeeId={id}/>}
            {step==='balances'&&<GovernmentFoundation key={id} selectedEmployeeId={id}/>}
            {step==='reconciliation'&&<GovernmentPayroll key={id} selectedEmployeeId={id}/>}
            {step==='activation'&&<GovernmentWorkflowManagement key={id} selectedEmployeeId={id} view="activation"/>}
        </>}

    </div>;
}

import { policyVersionLabel } from './policyVersionLabel';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../../lib/api';
import { formatDate } from '../../lib/date';
import { AustralianDateInput } from '../../components/AustralianDateInput';
import { Button, LoadingState, Pager } from '../../components/Ui';
import { useConfirm } from '../../contexts/useConfirm';
import { Field, inputClass } from './ManagementFields';

const root = '/hr/government/initial-setup';
type Policy = { id: string; label: string; effective_from: string; effective_to: string; source_reference: string; rules: Record<string, string | number> };
type Mapping = { leave_type_id: string; code: string | null };
type Plan = { policy_id: string | null; start_date: string; mappings: Mapping[]; adopt_employee_ids: string[] };
type LeaveType = { id: string; name: string; default_days: string; is_accruable: boolean; accrual_days_per_fortnight: string; reset_period: string; max_balance: string | null; is_active: boolean; suggested_code: string | null };
type Group = { key: string; retained_department: string | null; retained_division: string | null; department_id: string | null; division_id: string | null; match_status: string; issue: string | null; can_adopt: boolean; employee_count: number; employee_ids: string[] };
type Draft = { id: string; status: string; revision: number; plan: Plan; source_hash: string; reason: string; freshness?: string; adopted_at?: string | null };
type State = { policies: Policy[]; summary: Record<string, number>; leave_types: LeaveType[]; placement_groups: Group[]; latest_draft: Draft | null; adopted: Draft | null; default_plan: Plan };
type Preview = { source_hash: string; plan: Plan; policy: Policy | null; summary: Record<string, number>; blockers: string[]; ready_to_adopt: boolean };
type Employee = { id: string; display_name: string; status: string; regime: string; reviewer_id: string | null; join_date: string | null; missing_facts: string[]; balances: { id: string; leave_type_name: string; year: number; balance: string; pending: string; proposed_target: null }[] };
type Page = { employees: Employee[]; total: number; page_size: number };
const codes = ['recreation', 'medical', 'special', 'teacher_recreation', 'extended_medical', 'extended_medical_minister', 'maternity', 'paternity', 'adoption', 'official', 'lwop', 'long_service', 'furlough', 'recreation_encashment', 'recreation_separation', 'attendance', 'amendment', 'witness_republic', 'witness_other'];
const label = (code: string) => code === 'lwop' ? 'Leave without pay' : code.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const summaryLabels: Record<string, string> = { employees: 'employees', total_employees: 'employees', balances: 'stored balances', historical_balances: 'stored balances', applications: 'applications', historical_applications: 'applications', linked_logins: 'linked logins', legacy_employees: 'using existing leave', missing_service: 'missing service facts', missing_payroll_id: 'missing Payroll IDs' };

function policyRule(code: string | null, policy: Policy | undefined) {
    if (!code) return 'Choose a mapping';
    if (!policy) return 'Select the target policy';
    if (code === 'retain_history') return 'Historical record retained';
    const r = policy.rules;
    if (code === 'recreation') return `${r.recreation_annual_days} days/year · cap ${r.recreation_cap_days} · ordinary ${r.ordinary_recreation_months} months / temporary ${r.temporary_recreation_months} months`;
    if (code === 'medical') return `${r.medical_annual_days} days in one pool · ${r.medical_uncertified_occasions} uncertified occasions`;
    if (code === 'special') return `${r.special_annual_days} days/year · sufficient-cause justification`;
    return 'Assessed through the Government leave case workflow';
}

export function GovernmentInitialSetup({ onAdopted }: { onAdopted: () => Promise<void> }) {
    const { confirm } = useConfirm();
    const [state, setState] = useState<State | null>(null), [plan, setPlan] = useState<Plan | null>(null), [draft, setDraft] = useState<Draft | null>(null);
    const [preview, setPreview] = useState<Preview | null>(null), [reason, setReason] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
    const [groupSearch, setGroupSearch] = useState(''), [groupPage, setGroupPage] = useState(0);
    const [page, setPage] = useState(0), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [employees, setEmployees] = useState<Page | null>(null), [employeeError, setEmployeeError] = useState(''), [employeeLoading, setEmployeeLoading] = useState(false);
    async function load() {
        const next = await apiClient.get<State>(root);
        const saved = next.adopted || next.latest_draft;
        setState(next); setDraft(saved); setPlan(saved?.plan || next.default_plan); setReason(saved?.reason || ''); setPreview(null);
    }
    useEffect(() => { let live = true; void apiClient.get<State>(root).then(next => { if (live) { const saved = next.adopted || next.latest_draft; setState(next); setDraft(saved); setPlan(saved?.plan || next.default_plan); setReason(saved?.reason || ''); } }).catch((e: Error) => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
    const start = plan?.start_date;
    useEffect(() => {
        if (!start) return;
        let live = true; setEmployeeLoading(true); setEmployeeError('');
        void apiClient.get<Page>(`${root}/employees?${new URLSearchParams({ page: String(page + 1), search, start_date: start })}`).then(next => { if (live) setEmployees(next); }).catch((e: Error) => { if (live) setEmployeeError(e.message); }).finally(() => { if (live) setEmployeeLoading(false); });
        return () => { live = false; };
    }, [start, page, search]);
    function change(next: Plan) { setPlan(next); setPreview(null); setMessage(''); }
    async function run(work: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
    if (!state || !plan) return <div className="space-y-3">{error ? <><p role="alert" className="text-sm text-red-700">{error}</p><Button onClick={() => void run(load)}>Retry initial setup</Button></> : <LoadingState label="Reading the existing Leave database…" />}</div>;
    const adopted = draft?.status === 'adopted';
    const policy = state.policies.find(p => p.id === plan.policy_id);
    const selected = new Set(plan.adopt_employee_ids);
    const unresolved = plan.mappings.filter(m => !m.code).length;
    const filteredGroups = state.placement_groups.filter(g => `${g.retained_department || ''} ${g.retained_division || ''}`.toLowerCase().includes(groupSearch.trim().toLowerCase()));
    const visibleGroups = filteredGroups.slice(groupPage * 10, (groupPage + 1) * 10);
    const candidates = state.placement_groups.filter(g => g.can_adopt).flatMap(g => g.employee_ids);
    const save = () => run(async () => {
        if (!preview) throw new Error('Review the current setup before saving.');
        const body = { ...plan, source_hash: preview.source_hash, reason: reason.trim() };
        const next = draft ? await apiClient.put<Draft>(`${root}/drafts/${draft.id}`, { ...body, expected_revision: draft.revision }) : await apiClient.post<Draft>(`${root}/drafts`, body);
        setDraft(next); setMessage('Setup draft saved. You can edit or delete it before adopting the database.');
    });
    return <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-xl font-semibold text-gray-900">{adopted?'Setup record':'Initial setup'}</h2><p className="mt-1 text-sm text-gray-600">{adopted?'Database adoption is recorded. This record preserves the policy mapping and organisation decisions.':'Bring the existing employees and leave settings into one reviewed setup. You can complete this step yourself.'}</p></div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-900">{adopted ? 'Database adopted · existing leave operating' : draft ? `Saved draft · revision ${draft.revision}` : 'Ready to configure'}</span>
        </div>
        {error && <p role="alert" className="break-words rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
        <div className="app-panel p-4"><p className="text-sm font-medium text-gray-900">{Object.entries(state.summary).filter(([key]) => summaryLabels[key]).map(([key, amount]) => `${amount} ${summaryLabels[key]}`).join(' · ') || 'Existing records loaded'}</p><p className="mt-2 text-sm text-gray-600">Employee records, linked logins, nominated managers and recorded balances carry forward. Initial setup records the target policy and mappings; new calculations start only after an employee’s cutover is completed.</p></div>
        {draft?.freshness === 'stale' && !adopted && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The database has changed since this draft was saved. Review the current setup and save a refreshed draft before adoption.</p>}
        <form className="space-y-5" onSubmit={e => { e.preventDefault(); void run(async () => { const fresh = await apiClient.get<State>(`${root}?${new URLSearchParams({ start_date: plan.start_date })}`); const current = { ...plan, mappings: fresh.leave_types.map(t => ({ leave_type_id: t.id, code: plan.mappings.find(m => m.leave_type_id === t.id)?.code || null })) }; setState(fresh); setPlan(current); setGroupPage(0); setPreview(await apiClient.post<Preview>(`${root}/preview`, current)); setMessage('Current database reviewed. Check the mappings and selected organisation matches below.'); }); }}>
            <div className="app-panel space-y-3 p-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
                    <Field label="Target Government policy"><select aria-label="Target Government policy" className={inputClass} disabled={adopted || busy} value={plan.policy_id || ''} onChange={e => change({ ...plan, policy_id: e.target.value || null })}><option value="">Choose a published policy</option>{state.policies.map(p => <option key={p.id} value={p.id}>{policyVersionLabel(p.label,'published')}</option>)}</select></Field>
                    <Field label="Intended start date"><AustralianDateInput aria-label="Intended start date" name="start_date" className={inputClass} value={plan.start_date} required disabled={adopted || busy} onChange={e => change({ ...plan, start_date: e.target.value })} /></Field>
                </div>
                {policy && <p className="break-words text-xs text-gray-600">Policy covers {formatDate(policy.effective_from)} to {formatDate(policy.effective_to)}. Source: {policy.source_reference}</p>}
                <p className="text-xs text-gray-600">Choose the published corrected policy already here. The start date is a planning date; it does not enrol staff or backdate their balances.</p>
            </div>
            <div className="app-panel overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4"><h3 className="font-semibold text-gray-900">Existing leave types → Government rules</h3>{!adopted && <Button type="button" variant="secondary" disabled={busy} onClick={() => change({ ...plan, mappings: state.leave_types.map(t => ({ leave_type_id: t.id, code: t.suggested_code })) })}>Use suggested mappings</Button>}</div>
                <p className="px-4 pb-3 text-sm text-gray-600">Review each mapping. Old names and historical records remain available; “Retain history only” carries them forward without creating a new entitlement.</p>
                <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-y border-gray-200 bg-gray-50 text-gray-600"><tr><th className="px-4 py-2 font-medium">Current setting</th><th className="px-4 py-2 font-medium">Going forward</th><th className="px-4 py-2 font-medium">Target rule</th></tr></thead><tbody className="divide-y divide-gray-100">{state.leave_types.map(t => { const mapping = plan.mappings.find(m => m.leave_type_id === t.id); return <tr key={t.id}><td className="px-4 py-3 align-top"><p className="font-medium text-gray-900">{t.name}{!t.is_active && <span className="ml-2 text-xs text-gray-500">Inactive</span>}</p><p className="mt-1 text-xs text-gray-600">{t.default_days} default days{t.is_accruable ? ` · ${t.accrual_days_per_fortnight}/fortnight` : ''}{t.max_balance ? ` · cap ${t.max_balance}` : ''} · {label(t.reset_period)}</p></td><td className="px-4 py-3 align-top"><select aria-label={`Map ${t.name}`} className={`${inputClass} min-w-44`} disabled={adopted || busy} value={mapping?.code || ''} onChange={e => change({ ...plan, mappings: plan.mappings.map(m => m.leave_type_id === t.id ? { ...m, code: e.target.value || null } : m) })}><option value="">Needs a decision</option>{codes.map(code => <option key={code} value={code}>{label(code)}</option>)}<option value="retain_history">Retain history only</option></select></td><td className="max-w-80 px-4 py-3 align-top text-gray-600">{policyRule(mapping?.code || null, policy)}</td></tr>; })}</tbody></table></div>
                <p className="border-t border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">Medical is one annual pool. The old certified, uncertified and inactive Sick records stay separate during comparison. Setup does not add these balances together or reduce recorded Special balances to the target annual rule.</p>
            </div>
            <div className="app-panel space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-gray-900">Organisation matches</h3>{!adopted && !!candidates.length && <Button type="button" variant="secondary" disabled={busy} onClick={() => change({ ...plan, adopt_employee_ids: candidates.every(id => selected.has(id)) ? [] : candidates })}>{candidates.every(id => selected.has(id)) ? 'Clear matches' : 'Select exact matches'}</Button>}</div>
                <p className="text-sm text-gray-600">Adopt matching departments and divisions from the existing records. Only unique exact matches can be selected here; uncertain matches remain for review.</p>
                <Field label="Find a department or division"><input className={inputClass} value={groupSearch} onChange={e => { setGroupSearch(e.target.value); setGroupPage(0); }} maxLength={100} /></Field>
                <div className="divide-y divide-gray-100">{visibleGroups.map(g => <label key={g.key} className="flex items-start gap-3 py-3 text-sm"><input type="checkbox" className="mt-1" aria-label={`Adopt ${g.retained_department || 'unrecorded department'} / ${g.retained_division || 'unrecorded division'}`} disabled={adopted || busy || !g.can_adopt} checked={g.employee_ids.every(id => selected.has(id))} onChange={e => { const next = new Set(plan.adopt_employee_ids); g.employee_ids.forEach(id => { if (e.target.checked) next.add(id); else next.delete(id); }); change({ ...plan, adopt_employee_ids: [...next] }); }} /><span className="min-w-0"><span className="font-medium">{g.retained_department || 'Department unrecorded'} / {g.retained_division || 'Division unrecorded'}</span><span className="mt-1 block text-xs text-gray-600">{g.employee_count} employees · {g.match_status === 'exact' ? 'Unique exact department and division match' : g.match_status === 'partial' ? 'Department matches; division still unverified' : label(g.match_status)}{g.issue ? ` · ${g.issue}` : ''}</span></span></label>)}</div>
                <Pager page={groupPage} pageCount={Math.ceil(filteredGroups.length / 10)} total={filteredGroups.length} pageSize={10} setPage={setGroupPage} />
                <p className="text-xs text-gray-600">{plan.adopt_employee_ids.length} employee placements selected. Nominated managers and login permissions are retained; new approval offices are configured under Organisation & approvers.</p>
            </div>
            {!adopted && <div className="app-panel space-y-3 p-4">
                <Field label="Setup note"><textarea className={inputClass} aria-label="Setup note" rows={2} minLength={10} maxLength={1000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} placeholder="Describe the existing database and the policy you are adopting." /></Field>
                {preview && <div className="space-y-2 text-sm"><p className="font-medium text-gray-900">{preview.ready_to_adopt ? 'Configuration ready to adopt' : 'Draft can be saved; complete the decisions before adoption'}</p>{preview.blockers.length > 0 && <ul className="list-disc space-y-1 pl-5 text-amber-900">{preview.blockers.map(issue => <li key={issue}>{issue}</li>)}</ul>}<p className="text-gray-600">Adoption saves the policy mapping and links {plan.adopt_employee_ids.length} selected placements. Employee eligibility, balances and the current calculation engine are retained until cutover.</p></div>}
                {preview && draft && preview.source_hash !== draft.source_hash && <p className="text-sm text-amber-900">Save this reviewed configuration as a new draft revision before adoption.</p>}
                <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>Review current setup</Button><Button type="button" variant="secondary" disabled={busy || !preview || reason.trim().length < 10} onClick={() => void save()}>{draft ? 'Save changes' : 'Save setup draft'}</Button>{draft && <Button type="button" variant="secondary" disabled={busy || reason.trim().length < 10} onClick={() => void run(async () => { if (!(await confirm('Delete this initial setup draft? The existing employee and leave records will be retained.'))) return; await apiClient.delete(`${root}/drafts/${draft.id}`, { body: JSON.stringify({ expected_revision: draft.revision, reason: reason.trim() }) }); await load(); setMessage('Setup draft deleted. Existing records retained.'); })}>Delete draft</Button>}{draft && <Button type="button" disabled={busy || !preview?.ready_to_adopt || unresolved > 0 || preview.source_hash !== draft.source_hash || reason.trim().length < 10} onClick={() => void run(async () => { if (!preview || !(await confirm(`Adopt this setup for the existing database? This saves the Government policy mapping and links ${plan.adopt_employee_ids.length} selected placements. Current balances, eligibility, logins and leave calculations remain as recorded until cutover.`))) return; await apiClient.post(`${root}/drafts/${draft.id}/adopt`, { expected_revision: draft.revision, source_hash: preview.source_hash, reason: reason.trim() }); await load(); await onAdopted(); setMessage('Existing database adopted. Continue with the missing employee facts shown below before switching calculations.'); })}>Adopt existing database</Button>}</div>
                <p className="text-xs text-gray-500">Review → save draft → adopt. You can save incomplete setup work without a Payroll ID or another HR officer.</p>
            </div>}
        </form>
        <details className="app-panel p-4"><summary className="cursor-pointer font-semibold text-gray-900">Employee facts and stored balance comparison</summary><p className="my-3 text-sm text-gray-600">Review the source year and pending amounts separately. Government opening targets need the employee’s verified service year; blank targets mean they have not been determined.</p>
            <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); setPage(0); setSearch(query.trim()); }}><Field label="Find an existing employee"><input className={inputClass} value={query} onChange={e => setQuery(e.target.value)} maxLength={100} /></Field><Button type="submit" variant="secondary">Search</Button></form>
            {employeeError && <p role="alert" className="my-3 text-sm text-red-700">{employeeError}</p>}
            {employeeLoading ? <LoadingState label="Reading employee facts…" /> : employees && <><div className="mt-3 divide-y divide-gray-100">{employees.employees.map(e => <details key={e.id} className="py-3"><summary className="cursor-pointer text-sm"><span className="font-medium">{e.display_name}</span><span className="ml-2 text-xs text-gray-600">{e.status} · {e.regime === 'legacy' ? 'Existing leave' : 'Government leave'} · {e.reviewer_id ? 'Login retained' : 'Login unlinked'}</span></summary><div className="mt-3 space-y-3"><p className="text-xs text-gray-600">Recorded join date: {e.join_date ? formatDate(e.join_date) : 'Not recorded'}. A join date alone does not certify continuous service.</p>{e.missing_facts.length > 0 && <p className="text-sm text-amber-900">Outstanding preparation and Payroll facts: {e.missing_facts.join('; ')}</p>}<div className="overflow-x-auto"><table className="w-full min-w-[460px] text-left text-xs"><thead><tr className="border-b border-gray-200 text-gray-600"><th className="py-2 font-medium">Existing type / source year</th><th className="py-2 font-medium">Balance</th><th className="py-2 font-medium">Pending</th><th className="py-2 font-medium">Government target</th></tr></thead><tbody>{e.balances.map(b => <tr className="border-b border-gray-100" key={b.id}><td className="py-2">{b.leave_type_name} / {b.year}</td><td className="py-2">{b.balance}</td><td className="py-2">{b.pending}</td><td className="py-2 text-gray-500">Not determined</td></tr>)}</tbody></table></div>{!e.balances.length && <p className="text-xs text-gray-500">No stored balance rows. Rule defaults are not certified opening balances.</p>}<Link className="inline-block text-sm font-semibold text-brand underline" to={`/leave/employees?employee=${e.id}&section=details`}>Open existing employee record</Link></div></details>)}</div><Pager page={page} pageCount={Math.ceil(employees.total / employees.page_size)} total={employees.total} pageSize={employees.page_size} setPage={setPage} /></>}
        </details>
        {adopted && <p className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">Initial configuration is recorded. The employee comparison lists the facts still needed for calculation cutover. <Link className="font-semibold underline" to="/leave/employees">Continue with the existing employee records</Link>.</p>}
    </div>;
}

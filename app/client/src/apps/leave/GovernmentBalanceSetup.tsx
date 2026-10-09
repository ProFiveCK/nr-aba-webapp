import { useState } from 'react';
import { apiClient } from '../../lib/api';
import { Button } from '../../components/Ui';
import { AustralianDateInput } from '../../components/AustralianDateInput';
import { formatDate, todayIsoDate } from '../../lib/date';
import { Field, inputClass } from './ManagementFields';
import { ReviewRecordName } from './ReviewRecordName';

type Preview = { snapshot_hash: string; ready: number; total: number; employees: { employee_id: string; display_name: string; issues: string[]; schedules: { code: string; status: string; first_post_end?: string | null }[] }[] };
export function GovernmentBalanceSetup({ selected, onChanged }: { selected: string[]; onChanged: () => void }) {
    const [anchor, setAnchor] = useState(todayIsoDate()), [confirmed, setConfirmed] = useState(false);
    const [preview, setPreview] = useState<Preview | null>(null), [selection, setSelection] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const currentPreview = selection === selected.join(',') ? preview : null;
    const body = { employee_ids: selected, payroll_anchor: anchor, calculation_confirmed: confirmed };
    async function run(apply: boolean) {
        setBusy(true); setError(''); setNotice('');
        try {
            if (apply && currentPreview) {
                const result = await apiClient.post<{ created: number; retained: number }>('/hr/government/workflow/balance-setup/apply', { ...body, snapshot_hash: currentPreview.snapshot_hash });
                setPreview(null); setNotice(`${result.created} balance schedules saved. ${result.retained} existing schedules retained. Due updates follow the Government scheduler setting.`); onChanged();
            } else { setPreview(await apiClient.post<Preview>('/hr/government/workflow/balance-setup/preview', body)); setSelection(selected.join(',')); }
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }
    return <section className="app-panel space-y-4 p-4 sm:p-5" aria-label="Automatic balance setup">
        <div><h3 className="text-lg font-semibold text-gray-950">Set up automatic balances</h3><p className="mt-2 text-sm text-gray-600">Select migrated staff above and set their first balance schedules together. Recreation accrues each fortnight; Medical and Special renew on the employee’s service anniversary. Existing schedules are retained.</p></div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
        <Field label="A date on the fortnightly payroll cycle"><AustralianDateInput value={anchor} required className={inputClass} onChange={e => { setAnchor(e.target.value); setPreview(null); }} /></Field>
        <p className="text-xs text-gray-600">Choose a confirmed payroll date. Each employee’s first posting is aligned to that cycle on or after their transferred opening balance date.</p>
        <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e => { setConfirmed(e.target.checked); setPreview(null); }} />I checked this payroll cycle and the policy’s balance updates for these staff.</label>
        <Button variant="secondary" disabled={!selected.length || !confirmed || !anchor || busy} loading={busy} onClick={() => void run(false)}>Review balance schedules · {selected.length} selected</Button>
        {currentPreview && <div className="space-y-3"><p className="font-semibold">{currentPreview.ready} of {currentPreview.total} ready</p>{currentPreview.employees.map(person => <article key={person.employee_id} className="border-t border-gray-100 pt-3 text-sm"><p className="font-semibold"><ReviewRecordName name={person.display_name} /></p>{person.schedules.map(s => <p key={s.code} className="mt-1 capitalize">{s.code}: {s.status === 'retained' ? 'Existing schedule retained' : s.first_post_end ? `First posting ${formatDate(s.first_post_end)}` : 'Service anniversary renewal'}</p>)}{person.issues.map(issue => <p key={issue} className="mt-1 text-amber-800">{issue}</p>)}</article>)}<Button disabled={currentPreview.ready !== currentPreview.total || busy} loading={busy} onClick={() => void run(true)}>Save reviewed balance schedules</Button></div>}
        <p className="text-xs text-gray-500">This batch action is for the first schedules after your initial staff transfer. Review later changes in the employee’s record.</p>
    </section>;
}

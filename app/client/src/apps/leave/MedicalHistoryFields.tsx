import { AustralianDateInput } from '../../components/AustralianDateInput';
import { Button } from '../../components/Ui';
import { Field, inputClass } from './ManagementFields';
import { todayIsoDate } from '../../lib/date';

export type MedicalHistoryEntry = { start_date: string; end_date: string; uncertified: boolean };
export function MedicalHistoryFields({ entries, onChange }: { entries: MedicalHistoryEntry[]; onChange: (entries: MedicalHistoryEntry[]) => void }) {
    const change = (index: number, patch: Partial<MedicalHistoryEntry>) => onChange(entries.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
    return <div className="space-y-3">
        {!entries.length && <p className="text-sm text-gray-500">No earlier Medical absence entered.</p>}
        {entries.map((entry, index) => <div key={index} className="grid items-end gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-2">
            <Field label="Absence starts"><AustralianDateInput required className={inputClass} max={todayIsoDate()} value={entry.start_date} onChange={e => change(index, { start_date: e.target.value, end_date: entry.end_date || e.target.value })} /></Field>
            <Field label="Absence ends"><AustralianDateInput required className={inputClass} min={entry.start_date} max={todayIsoDate()} value={entry.end_date} onChange={e => change(index, { end_date: e.target.value })} /></Field>
            <Field label="Medical certificate"><select className={inputClass} value={String(entry.uncertified)} onChange={e => change(index, { uncertified: e.target.value === 'true' })}><option value="false">With MC</option><option value="true">Without MC</option></select></Field>
            <Button variant="secondary" onClick={() => onChange(entries.filter((_, i) => i !== index))}>Remove absence</Button>
        </div>)}
        <Button variant="secondary" disabled={entries.length >= 50} onClick={() => onChange([...entries, { start_date: '', end_date: '', uncertified: false }])}>Add earlier Medical absence</Button>
    </div>;
}

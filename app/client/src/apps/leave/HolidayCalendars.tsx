import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { AustralianDateInput } from '../../components/AustralianDateInput';
import { Button } from '../../components/Ui';
import { apiClient } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/date';
import { weekdayName } from './calendarDays';
import {
    addableYears, byDate, checkHolidayRows, copiedHolidays, coverageName, coverageSummary, currentCalendars,
    earlierVersions, MAX_HOLIDAYS, planHolidaySave,
} from './holidayYears';
import type { Holiday, HolidayCalendar, HolidayRow } from './holidayYears';
import { ActionDialog, Field, inputClass } from './ManagementFields';
import { value } from './managementForm';
import { ReviewRecordName, ReviewRecordReference } from './ReviewRecordName';
import { isReviewRecord } from './reviewRecordNames';

const newRow = (date = '', name = ''): HolidayRow => ({ key: crypto.randomUUID(), date, name });
const count = (holidays: Holiday[]) => holidays.length === 1 ? '1 holiday' : `${holidays.length} holidays`;
function byYear(holidays: Holiday[]) {
    const years = new Map<string, Holiday[]>();
    for (const h of byDate(holidays)) years.set(h.date.slice(0, 4), [...(years.get(h.date.slice(0, 4)) ?? []), h]);
    return [...years];
}

/** One list of public holidays. Each year is saved as its own version, so earlier lists stay in the history. */
export function HolidayCalendars({ calendars, today, onSaved }: { calendars: HolidayCalendar[]; today: string; onSaved: (message: string) => void }) {
    const [editing, setEditing] = useState(false);
    const current = currentCalendars(calendars), history = earlierVersions(calendars);
    const holidays = current.flatMap(c => c.holidays);
    const fictional = calendars.some(c => c.holidays.some(h => h.name === 'Synthetic holiday for charge verification'));

    return <>
        <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold">Public holidays</h4>
            <Button onClick={() => setEditing(true)}>{current.length ? 'Edit holidays' : 'Add holidays'}</Button>
        </div>
        <p className="text-sm text-gray-600">Enter the Gazetted public holidays. Leave calculations use them to work out which days count as leave.{fictional && ' The example holiday below is fictional.'}</p>
        {!current.length ? <p className="text-sm text-gray-500">No public holidays have been entered yet. Choose Add holidays to enter them from the Gazette.</p>
            : <article className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
                <div className="space-y-1">
                    <p className="text-sm font-medium">Covers {coverageSummary(current)} · {count(holidays)}</p>
                    <Sources current={current} />
                </div>
                {!holidays.length && <p className="text-sm text-gray-500">No public holidays in this period.</p>}
                {byYear(holidays).map(([year, list]) => <section key={year} className="space-y-1">
                    <h5 className="text-sm font-semibold text-gray-700">{year}</h5>
                    <HolidayList holidays={list} />
                </section>)}
                {history.length > 0 && <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-gray-600">History ({history.length} earlier {history.length === 1 ? 'version' : 'versions'})</summary>
                    <div className="mt-3 space-y-2">{history.map(version => <div key={version.id} className="space-y-1 rounded-lg border border-gray-200 p-3">
                        <p className="font-medium">{coverageName(version)} · saved {formatDateTime(version.recorded_at)} · {count(version.holidays)}</p>
                        {version.reason && <p className="break-words text-gray-600">{version.reason}</p>}
                        <Source calendar={version} />
                        <HolidayList holidays={version.holidays} />
                    </div>)}</div>
                </details>}
            </article>}
        {editing && <HolidayEditor calendars={calendars} today={today} onClose={() => setEditing(false)}
            onSaved={message => { setEditing(false); onSaved(message); }} />}
    </>;
}

function Sources({ current }: { current: HolidayCalendar[] }) {
    const demo = current.filter(c => isReviewRecord(c.label)), recorded = current.filter(c => !isReviewRecord(c.label));
    const sources = new Set(recorded.map(c => c.source_reference));
    return <>
        {demo.map(c => <div key={c.id}><p className="text-sm"><ReviewRecordName name={c.label} /></p><Source calendar={c} /></div>)}
        {sources.size === 1 && <p className="break-words text-sm text-gray-600">Source: {[...sources][0]}</p>}
        {sources.size > 1 && <p className="break-words text-sm text-gray-600">Sources: {recorded.map(c => `${coverageName(c)}: ${c.source_reference}`).join(' · ')}</p>}
    </>;
}

function Source({ calendar }: { calendar: HolidayCalendar }) {
    return isReviewRecord(calendar.label) ? <ReviewRecordReference name={calendar.label} source={calendar.source_reference} />
        : <p className="break-words text-sm text-gray-600">Source: {calendar.source_reference}</p>;
}

function HolidayList({ holidays }: { holidays: Holiday[] }) {
    if (!holidays.length) return <p className="text-sm text-gray-500">No public holidays in this period.</p>;
    return <ul className="divide-y divide-gray-100 text-sm">{byDate(holidays).map(h => <li key={h.date} className="flex flex-wrap gap-x-4 py-1.5">
        <span className="w-32 shrink-0 tabular-nums text-gray-600">{weekdayName(h.date)} {formatDate(h.date)}</span>
        <span className="min-w-0 break-words"><ReviewRecordName name={h.name} /></span>
    </li>)}</ul>;
}

/** Edits the whole list. Saving records a new version of each year that changed, and starts any new year. */
export function HolidayEditor({ calendars, today, onClose, onSaved }: { calendars: HolidayCalendar[]; today: string; onClose: () => void; onSaved: (message: string) => void }) {
    const current = currentCalendars(calendars);
    const [rows, setRows] = useState<HolidayRow[]>(() => {
        const saved = byDate(current.flatMap(c => c.holidays)).map(h => newRow(h.date, h.name));
        return saved.length ? saved : [newRow()];
    });
    // Pre-filled from the most recent save; changed when the dates come from a new Gazette.
    const [source, setSource] = useState(() => [...current].sort((a, b) => (a.recorded_at ?? '').localeCompare(b.recorded_at ?? '')).at(-1)?.source_reference ?? '');
    const [copied, setCopied] = useState<{ from: number; to: number; count: number } | null>(null), [checked, setChecked] = useState(false), [focus, setFocus] = useState('');
    const check = checkHolidayRows(rows, current, today);
    // Offer to start the year after the latest listed year from that year's holidays.
    const latest = Number(check.holidays.at(-1)?.date.slice(0, 4) ?? 0), nextYear = latest + 1;
    const canCopy = latest > 0 && nextYear <= addableYears(today).last && !current.some(c => c.effective_to >= `${nextYear}-01-01` && c.effective_from <= `${nextYear}-12-31`);

    function update(key: string, change: Partial<HolidayRow>) { setRows(list => list.map(row => row.key === key ? { ...row, ...change } : row)); }
    function add() { const row = newRow(); setRows(list => [...list, row]); setFocus(row.key); }
    function copy() {
        const from = check.holidays.filter(h => h.date.startsWith(String(latest)));
        setRows(list => [...list.filter(row => row.date || row.name.trim()), ...copiedHolidays(from, nextYear).map(h => newRow(h.date, h.name))]);
        setCopied({ from: latest, to: nextYear, count: from.length });
    }
    async function save(form: FormData) {
        setChecked(true);
        const problems = Object.keys(check.errors).length;
        if (problems) throw new Error(problems === 1 ? 'Check the highlighted holiday.' : `Check the ${problems} highlighted holidays.`);
        const changed = planHolidaySave({ holidays: check.holidays, current, source, note: value(form, 'setup_note') });
        if (!changed.length) throw new Error('Nothing has changed. Add, change or remove a holiday before saving.');
        const crowded = changed.find(c => c.holidays.length > MAX_HOLIDAYS);
        if (crowded) throw new Error(`${coverageName(crowded)} has more than ${MAX_HOLIDAYS} holidays. Remove some before saving.`);
        await apiClient.post('/hr/government/calendars/batch', { calendars: changed });
        onSaved('Public holidays saved.');
    }

    // The reason for each year is written by planHolidaySave; the dialog's own reason is not sent.
    return <ActionDialog title="Public holidays" saveLabel="Save holidays" automaticReason="Saved public holidays." onClose={onClose} onSave={save}>
        <p className="text-sm text-gray-600">Add, change or remove holidays, then save. A date in a year that is not listed yet adds that whole year, so enter all of its holidays. The previous list stays in History.</p>
        {canCopy && <Button variant="secondary" onClick={copy}>Copy {latest}'s holidays into {nextYear}</Button>}
        {copied && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Added {copied.count === 1 ? '1 holiday' : `${copied.count} holidays`} for {copied.to} from {copied.from}. Check each date against the Gazette: some holidays, such as Easter, move every year.</p>}
        <HolidayRowsField rows={rows} errors={checked ? check.errors : {}} focus={focus} onChange={update} onRemove={key => setRows(list => list.filter(row => row.key !== key))} onAdd={add} />
        <div className="space-y-1">
            <Field label="Gazette or source"><input name="source_reference" className={inputClass} required minLength={5} maxLength={500} value={source} onChange={e => setSource(e.target.value)} placeholder="For example, Gazette No. 45 of 2026" /></Field>
            <p className="text-xs text-gray-500">Recorded with each year you change, as the record of where the dates came from.</p>
        </div>
    </ActionDialog>;
}

/** One row per holiday: a date, a name and a remove button, with any problem shown under its row. */
export function HolidayRowsField({ rows, errors, focus, onChange, onRemove, onAdd }: {
    rows: HolidayRow[]; errors: Record<string, string>; focus?: string;
    onChange: (key: string, change: Partial<HolidayRow>) => void; onRemove: (key: string) => void; onAdd: () => void;
}) {
    return <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium text-gray-700">Holidays</legend>
        {rows.length > 0 && <div aria-hidden="true" className="hidden grid-cols-[10.5rem_minmax(0,1fr)_2.75rem] gap-2 text-xs font-medium text-gray-500 sm:grid"><span>Date</span><span>Holiday name</span></div>}
        {rows.map((row, index) => {
            const n = index + 1, error = errors[row.key], errorId = `holiday-${row.key}-error`;
            const invalid = { 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined };
            return <div key={row.key} className="space-y-1">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[10.5rem_minmax(0,1fr)_auto]">
                    <AustralianDateInput name={`holiday_date_${n}`} className={`${inputClass} aria-[invalid=true]:border-red-500`} value={row.date}
                        onChange={e => onChange(row.key, { date: e.target.value })} aria-label={`Date of holiday ${n}`} autoFocus={row.key === focus} {...invalid} />
                    <input className={`${inputClass} col-span-2 row-start-2 aria-[invalid=true]:border-red-500 sm:col-span-1 sm:row-start-auto`} value={row.name} maxLength={120}
                        onChange={e => onChange(row.key, { name: e.target.value })} aria-label={`Name of holiday ${n}`} placeholder="Holiday name" {...invalid} />
                    <button type="button" onClick={() => onRemove(row.key)} aria-label={`Remove ${row.name.trim() || `holiday ${n}`}`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700">
                        <Trash2 size={16} aria-hidden="true" />
                    </button>
                </div>
                {error && <p id={errorId} className="text-sm text-red-700">{error}</p>}
            </div>;
        })}
        {!rows.length && <p className="text-sm text-gray-500">No holidays listed.</p>}
        <Button variant="secondary" onClick={onAdd}><Plus size={16} aria-hidden="true" />Add holiday</Button>
    </fieldset>;
}

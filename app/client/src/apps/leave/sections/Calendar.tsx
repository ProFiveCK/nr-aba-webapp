import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../../../lib/api';
import { useAuth } from '../../../contexts/useAuth';
import { useToast } from '../../../contexts/useToast';
import { Button, EmptyState, LoadingState } from '../../../components/Ui';
import { toIsoDate } from '../../../lib/date';
import { useHolidays } from '../calendarDays';
import { governmentLabel } from '../governmentWorkflowTypes';

interface CalendarEntry {
    id: string;
    employee_id?: string;
    employee_name: string;
    department_code: string | null;
    department_name?: string | null;
    division_name?: string | null;
    leave_type_name: string;
    start_date: string;
    end_date: string | null;
    days: string | null;
    status: 'pending' | 'approved';
    kind?: 'leave' | 'study_leave';
    /** The caller's own leave. */
    own?: boolean;
    /** Government leave code, sent only where the viewer may know the type. */
    leave_code?: string | null;
}

/** Team and Department for everyone; All departments for Central HR. The server enforces the same. */
export type CalendarView = 'team' | 'department' | 'all';

/** A member of the caller's team or department, shown whether or not they are away. */
export interface TeamMember { employee_id: string; name: string; own?: boolean; department_name?: string | null; division_name?: string | null }
interface Roster { name: string | null; members: TeamMember[] }

interface OrgUnit { id: string; name: string; divisions: { id: string; name: string }[] }

function monthBounds(offset: number) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    return { from: toIsoDate(start), to: toIsoDate(end), start, end };
}

export function Calendar() {
    const { user } = useAuth();
    const { addToast } = useToast();
    const [params, setParams] = useSearchParams();
    const central = user?.permissions?.hr_admin === true;
    const views: [CalendarView, string][] = [['team', 'Team'], ['department', 'Department'], ...(central ? [['all', 'All departments'] as [CalendarView, string]] : [])];
    const requested = params.get('view');
    const view: CalendarView = views.some(([id]) => id === requested) ? requested as CalendarView : 'team';
    const departmentId = view === 'all' ? params.get('department') || '' : '';
    const divisionId = view === 'all' ? params.get('division') || '' : '';

    const [offset, setOffset] = useState(0);
    const [entries, setEntries] = useState<CalendarEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [units, setUnits] = useState<OrgUnit[]>([]);
    const [rosters, setRosters] = useState<Partial<Record<CalendarView, Roster>>>({});
    const loadVersion = useRef(0);
    const holidays = useHolidays();
    const bounds = useMemo(() => monthBounds(offset), [offset]);
    const roster = rosters[view];

    useEffect(() => {
        if (view !== 'all') return;
        let live = true;
        apiClient.get<OrgUnit[]>('/hr/org-units')
            .then((rows) => { if (live) setUnits(rows); })
            // Without the list the calendar still shows every department; only the filter is missing.
            .catch(() => undefined);
        return () => { live = false; };
    }, [view]);

    useEffect(() => {
        if (view === 'all' || roster) return;
        let live = true;
        apiClient.get<Roster>(`/hr/calendar/members?view=${view}`)
            .then((next) => { if (live) setRosters((current) => ({ ...current, [view]: next })); })
            // Without the roster the calendar still shows who is away; only the available rows are missing.
            .catch(() => undefined);
        return () => { live = false; };
    }, [view, roster]);

    const load = useCallback(async () => {
        const requestVersion = ++loadVersion.current;
        setLoading(true);
        setError('');
        const query = new URLSearchParams({ from: bounds.from, to: bounds.to, view });
        if (departmentId) query.set('department_id', departmentId);
        if (divisionId) query.set('division_id', divisionId);
        try {
            const data = await apiClient.get<CalendarEntry[]>(`/hr/calendar?${query}`);
            if (requestVersion !== loadVersion.current) return;
            const government: CalendarEntry[] = [];
            for (let page = 1; ; page++) {
                query.set('page', String(page));
                const result = await apiClient.get<{ entries: CalendarEntry[]; has_more: boolean }>(`/hr/government/workflow/calendar?${query}`);
                if (requestVersion !== loadVersion.current) return;
                government.push(...result.entries);
                if (!result.has_more) break;
            }
            setEntries([...(data || []), ...government]);
        } catch (err) {
            if (requestVersion !== loadVersion.current) return;
            setEntries([]);
            setError((err as Error)?.message || 'Unable to load the leave calendar.');
            addToast((err as Error)?.message || 'Unable to load the leave calendar.', 'error');
        } finally {
            if (requestVersion === loadVersion.current) setLoading(false);
        }
    }, [addToast, bounds.from, bounds.to, view, departmentId, divisionId]);

    useEffect(() => {
        void load();
        return () => { loadVersion.current += 1; };
    }, [load]);

    const monthLabel = bounds.start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const department = units.find((unit) => unit.id === departmentId);
    const showUnits = (next: { department?: string; division?: string }) => {
        const values: Record<string, string> = { view: 'all' };
        if (next.department) values.department = next.department;
        if (next.department && next.division) values.division = next.division;
        setParams(values);
    };
    const select = 'rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900';

    return (
        <div className="space-y-3">
            <div className="app-panel flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <h2 className="text-base font-semibold text-gray-900">
                    {view === 'all' ? 'All departments' : `${view === 'team' ? 'Team' : 'Department'} calendar`}
                    {view !== 'all' && roster?.name && <span className="font-normal text-gray-500"> · {roster.name}</span>}
                </h2>
                <nav aria-label="Calendar views" className="flex rounded-lg border border-gray-200 p-0.5">
                    {views.map(([id, label]) => (
                        <button key={id} type="button" aria-current={view === id ? 'page' : undefined}
                            onClick={() => setParams(id === 'team' ? {} : { view: id })}
                            className={`rounded-md px-3 py-1 text-sm font-medium ${view === id ? 'bg-brand text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
                            {label}
                        </button>
                    ))}
                </nav>
                {view === 'all' && units.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        <select aria-label="Department" className={select} value={departmentId} onChange={(e) => showUnits({ department: e.target.value })}>
                            <option value="">All departments</option>
                            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                        </select>
                        {department && department.divisions.length > 0 && (
                            <select aria-label="Division" className={select} value={divisionId} onChange={(e) => showUnits({ department: departmentId, division: e.target.value })}>
                                <option value="">Whole department</option>
                                {department.divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
                            </select>
                        )}
                    </div>
                )}
                <div className="ml-auto flex items-center gap-1">
                    <Button variant="secondary" onClick={() => setOffset(offset - 1)} aria-label="Previous month">←</Button>
                    <span className="min-w-32 text-center text-sm font-semibold text-gray-900" aria-live="polite">{monthLabel}</span>
                    <Button variant="secondary" onClick={() => setOffset(offset + 1)} aria-label="Next month">→</Button>
                    {offset !== 0 && <Button variant="ghost" onClick={() => setOffset(0)}>Today</Button>}
                </div>
            </div>

            {loading ? (
                <LoadingState label="Loading calendar…" />
            ) : error ? (
                <div className="app-panel p-5"><p role="alert" className="text-sm text-red-700">{error}</p><button type="button" className="toolbar-button mt-3" onClick={() => void load()}>Try again</button></div>
            ) : (
                <CalendarMonth entries={entries} start={bounds.start} end={bounds.end} view={view} holidays={holidays} members={roster?.members} />
            )}
        </div>
    );
}

// ---- One look for every view: colour shows status and kind, never the leave type. ----

type DayStatus = 'approved' | 'pending' | 'study';
const STATUSES: DayStatus[] = ['approved', 'pending', 'study'];
const STATUS_LABEL: Record<DayStatus, string> = { approved: 'Approved leave', pending: 'Awaiting approval', study: 'Study leave' };
// Awaiting approval is striped so it reads as provisional at a glance and in print.
const STRIPES: CSSProperties = { backgroundImage: 'repeating-linear-gradient(135deg, rgb(124 58 237 / 0.55) 0 3px, transparent 3px 7px)' };
const STATUS_LOOK: Record<DayStatus, { className: string; style?: CSSProperties }> = {
    approved: { className: 'bg-brand' },
    pending: { className: 'bg-violet-100', style: STRIPES },
    study: { className: 'bg-amber-400' },
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Swatch({ status, className = 'h-3 w-3 rounded-sm' }: { status: DayStatus; className?: string }) {
    return <span aria-hidden="true" className={`inline-block shrink-0 ${className} ${STATUS_LOOK[status].className} ${status === 'pending' ? 'ring-1 ring-inset ring-violet-400' : ''}`} style={STATUS_LOOK[status].style} />;
}

const statusOf = (entry: CalendarEntry): DayStatus => entry.kind === 'study_leave' ? 'study' : entry.status === 'pending' ? 'pending' : 'approved';

/** The leave type when the viewer may know it; otherwise the server's label. */
function leaveLabel(entry: CalendarEntry) {
    return entry.leave_code ? governmentLabel(entry.leave_code) : entry.leave_type_name;
}

const shortDate = (iso: string, year: number) => {
    const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
    return date.toLocaleDateString('en-GB', date.getFullYear() === year ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
};

/** "4–6 Nov", "30 Oct – 2 Nov", "from 1 Sep". */
function dateRange(from: string, to: string | null, year: number) {
    if (!to) return `from ${shortDate(from, year)}`;
    if (from.slice(0, 7) === to.slice(0, 7)) {
        return from.slice(0, 10) === to.slice(0, 10) ? shortDate(from, year) : `${Number(from.slice(8, 10))}–${shortDate(to, year)}`;
    }
    return `${shortDate(from, year)} – ${shortDate(to, year)}`;
}

/** What one period says under a person's name. Colleagues' leave is "Away", not its type. */
function periodText(entry: CalendarEntry, year: number) {
    const status = statusOf(entry);
    const dates = dateRange(entry.start_date, entry.end_date, year);
    if (status === 'study') return `Study leave ${entry.end_date ? `until ${shortDate(entry.end_date, year)}` : dates}`;
    const masked = entry.leave_type_name === 'On leave' && !entry.leave_code;
    if (masked) return `${status === 'pending' ? 'Requested' : 'Away'} ${dates}`;
    return `${leaveLabel(entry)} ${dates}${status === 'pending' ? ' (pending)' : ''}`;
}

interface PersonRow {
    id: string; name: string; own: boolean; unit: string;
    marks: Record<DayStatus, Set<number>>;
    periods: string[];
}

export function CalendarMonth({ entries, start, end, view = 'team', holidays = new Map(), today = new Date(), members }: {
    entries: CalendarEntry[]; start: Date; end: Date; view?: CalendarView; holidays?: Map<string, string>;
    /** Injected for tests; the real calendar marks the actual date. */
    today?: Date;
    /** The team calendar lists everyone in the team, away or not. */
    members?: TeamMember[];
}) {
    const monthLabel = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const year = start.getFullYear();
    const todayDay = today.getFullYear() === year && today.getMonth() === start.getMonth() ? today.getDate() : null;
    const days = Array.from({ length: end.getDate() }, (_, i) => {
        const date = new Date(year, start.getMonth(), i + 1);
        return { day: i + 1, weekday: WEEKDAYS[(date.getDay() + 6) % 7], weekend: date.getDay() === 0 || date.getDay() === 6, holiday: holidays.get(toIsoDate(date)) };
    });
    const monthHolidays = days.filter((d) => d.holiday);

    const unitOf = useCallback((row: { department_name?: string | null; division_name?: string | null }) => view === 'all'
        ? [row.department_name, row.division_name].filter(Boolean).join(' · ') || 'No department recorded'
        : row.division_name || row.department_name || 'Your team', [view]);

    // One row per person; days marked per status so overlaps stay visible.
    const people = useMemo(() => {
        const rows = new Map<string, PersonRow>();
        const blank = (id: string, name: string, own: boolean, unit: string): PersonRow =>
            ({ id, name, own, unit, marks: { approved: new Set(), pending: new Set(), study: new Set() }, periods: [] });
        for (const member of members ?? []) rows.set(member.employee_id, blank(member.employee_id, member.name, member.own === true, unitOf(member)));
        for (const entry of entries) {
            const key = entry.employee_id || entry.employee_name;
            const row = rows.get(key) ?? blank(key, entry.employee_name, entry.own === true, unitOf(entry));
            row.periods.push(periodText(entry, year));
            const from = new Date(`${entry.start_date.slice(0, 10)}T00:00:00`);
            const to = entry.end_date ? new Date(`${entry.end_date.slice(0, 10)}T00:00:00`) : new Date(end);
            for (const cursor = new Date(Math.max(from.getTime(), start.getTime())); cursor <= to && cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
                row.marks[statusOf(entry)].add(cursor.getDate());
            }
            rows.set(key, row);
        }
        return [...rows.values()].sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name));
    }, [entries, members, start, end, year, unitOf]);

    // Grouped by unit: your own unit first, then by name.
    const groups = useMemo(() => {
        const byUnit = new Map<string, PersonRow[]>();
        for (const person of people) byUnit.set(person.unit, [...(byUnit.get(person.unit) ?? []), person]);
        return [...byUnit.entries()].sort(([a, ar], [b, br]) => Number(br.some((p) => p.own)) - Number(ar.some((p) => p.own)) || a.localeCompare(b));
    }, [people]);

    const awayToday = todayDay === null ? [] : people.filter((p) => p.marks.approved.has(todayDay) || p.marks.study.has(todayDay));

    if (!people.length) {
        return (
            <div className="app-panel p-4">
                <EmptyState title={view === 'all'
                    ? 'No approved or submitted leave this month'
                    : `Your login is not linked to a ${view === 'team' ? 'team' : 'department'} yet, so there is no calendar to show`} />
            </div>
        );
    }

    return (
        <div className="app-panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-gray-200 px-4 py-2 text-xs text-gray-600">
                <p role="status" className="min-w-0 truncate">
                    {todayDay === null ? `${people.length} ${view === 'all' ? 'people on leave' : 'people'}`
                        : awayToday.length
                            ? <><span className="font-semibold text-gray-900">Away today ({awayToday.length}):</span> {awayToday.map((p) => p.name).join(', ')}</>
                            : <span className="font-semibold text-gray-900">Nobody is away today</span>}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {STATUSES.map((status) => <span key={status} className="inline-flex items-center gap-1"><Swatch status={status} className="h-2.5 w-2.5 rounded-sm" />{STATUS_LABEL[status]}</span>)}
                    {monthHolidays.length > 0 && <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-rose-200" />Public holiday</span>}
                </div>
            </div>

            <PhoneMonth key={start.toISOString()} people={people} days={days} start={start} monthLabel={monthLabel} todayDay={todayDay} />

            {/* Bounded height: the grid scrolls inside the page, with dates and names kept in view. */}
            <div className="hidden max-h-[calc(100vh-15rem)] min-h-64 overflow-auto md:block">
                <table className="w-full min-w-[960px] table-fixed border-separate border-spacing-0 text-[13px]">
                    <caption className="sr-only">Leave for {monthLabel}: approved, awaiting approval and study leave</caption>
                    <colgroup><col className="w-52" />{days.map(({ day }) => <col key={day} />)}</colgroup>
                    <thead>
                        <tr>
                            <th scope="col" className="sticky left-0 top-0 z-30 border-b border-gray-200 bg-white px-3 text-left text-xs font-medium text-gray-500">
                                {view === 'all' ? `${people.length} on leave` : `${people.length} people`}
                            </th>
                            {days.map(({ day, weekday, weekend, holiday }) => (
                                <th key={day} scope="col" aria-current={day === todayDay ? 'date' : undefined}
                                    title={[day === todayDay && 'Today', holiday].filter(Boolean).join(' — ') || undefined}
                                    className={`sticky top-0 z-20 border-b border-gray-200 py-1 text-center font-normal ${holiday ? 'bg-rose-50' : weekend ? 'bg-gray-50' : 'bg-white'}`}>
                                    <span className={`block text-[9px] uppercase leading-3 ${holiday ? 'text-rose-600' : weekend ? 'text-gray-400' : 'text-gray-500'}`}>{weekday.slice(0, 1)}</span>
                                    <span className={`mx-auto flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${day === todayDay ? 'bg-brand font-semibold text-white' : holiday ? 'font-semibold text-rose-700' : weekend ? 'text-gray-400' : 'text-gray-800'}`}>{day}</span>
                                    {day === todayDay && <span className="sr-only"> (today)</span>}
                                    {holiday && <span className="sr-only"> ({holiday}, public holiday)</span>}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    {groups.map(([unit, rows]) => (
                        <tbody key={unit}>
                            {groups.length > 1 && (
                                <tr>
                                    <th scope="colgroup" colSpan={days.length + 1} className="sticky left-0 border-b border-gray-200 bg-gray-100 px-3 py-0.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                                        {unit} <span className="font-normal normal-case text-gray-500">· {rows.length}</span>
                                    </th>
                                </tr>
                            )}
                            {rows.map((person) => (
                                <tr key={person.id}>
                                    <th scope="row" title={person.periods.join(' · ') || undefined}
                                        className={`sticky left-0 z-10 h-7 truncate border-b border-gray-100 px-3 text-left font-normal text-gray-900 ${person.own ? 'bg-sky-50 font-medium' : 'bg-white'}`}>
                                        {person.name}{person.own && <span className="font-normal text-gray-500"> (you)</span>}
                                    </th>
                                    {days.map(({ day, weekend, holiday }) => {
                                        const statuses = STATUSES.filter((status) => person.marks[status].has(day));
                                        const label = statuses.length ? `${person.name}: ${statuses.map((s) => STATUS_LABEL[s]).join('; ')} on ${day} ${monthLabel}` : undefined;
                                        return (
                                            <td key={day} className={`h-7 border-b border-gray-100 p-0 ${day === todayDay ? 'border-x border-x-brand/50' : ''} ${holiday ? 'bg-rose-50' : weekend ? 'bg-gray-50' : person.own ? 'bg-sky-50' : ''}`}>
                                                {statuses.length > 0 && (
                                                    <div role="img" aria-label={label} title={label} className="flex h-4 flex-col gap-px">
                                                        {statuses.map((status) => {
                                                            // Continuous bars: rounded and inset only where a period starts or ends.
                                                            const startsHere = !person.marks[status].has(day - 1);
                                                            const endsHere = !person.marks[status].has(day + 1);
                                                            // An awaiting bar is outlined as one shape, its stripes aligned across days.
                                                            const outline = status === 'pending' ? `border-y border-violet-400 ${startsHere ? 'border-l' : ''} ${endsHere ? 'border-r' : ''}` : '';
                                                            return <span key={status} style={status === 'pending' ? { ...STRIPES, backgroundAttachment: 'fixed' } : STATUS_LOOK[status].style}
                                                                className={`min-h-0 flex-1 ${STATUS_LOOK[status].className} ${outline} ${startsHere ? 'ml-0.5 rounded-l' : ''} ${endsHere ? 'mr-0.5 rounded-r' : ''}`} />;
                                                        })}
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    ))}
                </table>
            </div>
        </div>
    );
}

/**
 * The month as a seven-column calendar for phones, where a 31-column table
 * cannot fit. Each day shows how many people are away; choosing a day lists
 * them underneath.
 */
function PhoneMonth({ people, days, start, monthLabel, todayDay }: {
    people: PersonRow[];
    days: { day: number; weekend: boolean; holiday?: string }[];
    start: Date;
    monthLabel: string;
    todayDay: number | null;
}) {
    const month = start.toLocaleDateString('en-GB', { month: 'long' });
    const awayOn = (day: number) => people.flatMap((person) => {
        const statuses = STATUSES.filter((status) => person.marks[status].has(day));
        return statuses.length ? [{ id: person.id, name: person.name, own: person.own, statuses }] : [];
    });
    // Today when someone is away today, otherwise the first day anyone is.
    const firstBusy = days.find(({ day }) => awayOn(day).length)?.day ?? 1;
    const [chosen, setChosen] = useState<number>(todayDay !== null && awayOn(todayDay).length ? todayDay : firstBusy);
    const day = Math.min(chosen, days.length);
    const leading = (start.getDay() + 6) % 7;
    const selected = awayOn(day);
    const holiday = days[day - 1]?.holiday;

    return (
        <div className="p-3 md:hidden">
            <div className="grid grid-cols-7 gap-1 text-center text-xs" role="group" aria-label={`Days in ${monthLabel}`}>
                {WEEKDAYS.map((name) => <div key={name} className="py-1 font-medium text-gray-500" aria-hidden="true">{name.slice(0, 1)}</div>)}
                {Array.from({ length: leading }, (_, i) => <div key={`blank-${i}`} aria-hidden="true" />)}
                {days.map(({ day: d, weekend, holiday: name }) => {
                    const away = awayOn(d);
                    const kinds = STATUSES.filter((kind) => away.some((a) => a.statuses.includes(kind)));
                    return (
                        <button
                            key={d}
                            type="button"
                            onClick={() => setChosen(d)}
                            aria-pressed={d === day}
                            aria-current={d === todayDay ? 'date' : undefined}
                            aria-label={`${d} ${month}${d === todayDay ? ' (today)' : ''}${name ? `, ${name} (public holiday)` : ''}: ${away.length ? `${away.length} ${away.length === 1 ? 'person' : 'people'} away` : 'nobody away'}`}
                            className={`flex min-h-12 flex-col items-center justify-start gap-1 rounded-md border py-1 ${d === day ? 'border-brand ring-1 ring-brand' : 'border-transparent'} ${name ? 'bg-rose-50 text-rose-700' : weekend ? 'bg-gray-50 text-gray-400' : 'bg-white text-gray-900'}`}
                        >
                            <span className={d === todayDay ? 'flex h-6 w-6 items-center justify-center rounded-full bg-brand font-semibold text-white' : name ? 'font-semibold' : ''}>{d}</span>
                            {away.length > 0 && (
                                <span className="flex items-center gap-0.5" aria-hidden="true">
                                    {kinds.map((kind) => <Swatch key={kind} status={kind} className="h-1.5 w-1.5 rounded-full" />)}
                                    <span className="ml-0.5 text-[10px] text-gray-600">{away.length}</span>
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
            <div className="mt-3 border-t border-gray-100 pt-3 text-sm" aria-live="polite">
                <h4 className="font-semibold text-gray-900">{day} {month}{day === todayDay ? ' (today)' : ''}{holiday ? ` — ${holiday}` : ''}</h4>
                {selected.length ? (
                    <div role="list" className="mt-2 space-y-1.5">
                        {selected.map((person) => (
                            <div role="listitem" key={person.id} className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-gray-900">{person.name}{person.own ? ' (you)' : ''}</span>
                                {person.statuses.map((status) => (
                                    <span key={status} className="inline-flex items-center gap-1 text-xs text-gray-600">
                                        <Swatch status={status} className="h-2 w-2 rounded-full" />{STATUS_LABEL[status]}
                                    </span>
                                ))}
                            </div>
                        ))}
                    </div>
                ) : <p className="mt-1 text-gray-600">Nobody is away.</p>}
            </div>
        </div>
    );
}

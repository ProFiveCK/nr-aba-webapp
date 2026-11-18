import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    leave_type_name: string;
    start_date: string;
    end_date: string | null;
    days: string | null;
    status: 'pending' | 'approved';
    kind?: 'leave' | 'study_leave';
    /** The caller's own leave. */
    own?: boolean;
    /** Government leave code, sent for the caller's own leave only. */
    leave_code?: string | null;
}

/** Who the calendar shows; the server enforces the same three audiences. */
export type CalendarView = 'team' | 'mine' | 'scope';

interface OrgUnit { id: string; name: string; divisions: { id: string; name: string }[] }

function monthBounds(offset: number) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    return { from: toIsoDate(start), to: toIsoDate(end), start, end };
}

/** A member of the caller's team, shown on the team calendar whether or not they are away. */
export interface TeamMember { employee_id: string; name: string; own?: boolean }

const EMPTY_TITLES: Record<CalendarView, string> = {
    team: 'Your login is not linked to a team yet, so there is no team calendar to show',
    mine: 'You have no approved or submitted leave this month',
    scope: 'No approved or submitted leave this month',
};

export function Calendar() {
    const { user } = useAuth();
    const { addToast } = useToast();
    const [params, setParams] = useSearchParams();
    const permissions = user?.permissions || {};
    // Everyone gets their team and their own leave. Only HR looks wider: central
    // HR across every department, an HR officer across the units assigned to them.
    const central = permissions.hr_admin === true;
    const officer = permissions.hr_officer === true;
    const canFilterUnits = central || officer;
    const views: [CalendarView, string][] = [['team', 'Team calendar'], ['mine', 'My leave'],
        ...(canFilterUnits ? [['scope', central ? 'All departments' : 'My HR units'] as [CalendarView, string]] : [])];
    const requested = params.get('view');
    const view: CalendarView = views.some(([id]) => id === requested) ? requested as CalendarView : 'team';
    const departmentId = view === 'scope' ? params.get('department') || '' : '';
    const divisionId = view === 'scope' ? params.get('division') || '' : '';

    const [offset, setOffset] = useState(0);
    const [entries, setEntries] = useState<CalendarEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [units, setUnits] = useState<OrgUnit[]>([]);
    const [team, setTeam] = useState<{ name: string | null; members: TeamMember[] } | null>(null);
    const loadVersion = useRef(0);
    const holidays = useHolidays();

    const bounds = useMemo(() => monthBounds(offset), [offset]);

    useEffect(() => {
        if (view !== 'scope' || !canFilterUnits) return;
        let live = true;
        apiClient.get<OrgUnit[]>('/hr/org-units')
            .then((rows) => { if (live) setUnits(rows); })
            // Without the list the calendar still shows everyone in scope; only the filter is missing.
            .catch(() => undefined);
        return () => { live = false; };
    }, [view, canFilterUnits]);

    useEffect(() => {
        if (view !== 'team' || team) return;
        let live = true;
        apiClient.get<{ name: string | null; members: TeamMember[] }>('/hr/calendar/team')
            .then((roster) => { if (live) setTeam(roster); })
            // Without the roster the calendar still shows who is away; only the available rows are missing.
            .catch(() => undefined);
        return () => { live = false; };
    }, [view, team]);

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
                const result = await apiClient.get<{entries: CalendarEntry[]; has_more: boolean}>(`/hr/government/workflow/calendar?${query}`);
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
    const changeView = (next: CalendarView) => setParams(next === 'team' ? {} : { view: next });
    const changeUnit = (next: { department?: string; division?: string }) => {
        const values: Record<string, string> = { view: 'scope' };
        if (next.department) values.department = next.department;
        if (next.department && next.division) values.division = next.division;
        setParams(values);
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 app-panel p-5 sm:p-6">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                        {view === 'team' ? `Team calendar${team?.name ? ` — ${team.name}` : ''}` : view === 'mine' ? 'My leave' : central ? 'All departments' : 'My HR units'} · {monthLabel}
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">
                        {view === 'team' ? 'Everyone in your team and when they are away. Colleagues’ leave shows dates only, not the type of leave.'
                            : view === 'mine' ? 'Your own approved and submitted leave.'
                                : central ? 'Leave across every department. Choose a department or division to narrow it.' : 'Leave in the departments and divisions you look after as an HR officer.'}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setOffset(offset - 1)} className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium hover:bg-gray-50">
                        ← Previous
                    </button>
                    <button type="button" onClick={() => setOffset(0)} className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium hover:bg-gray-50">
                        This month
                    </button>
                    <button type="button" onClick={() => setOffset(offset + 1)} className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium hover:bg-gray-50">
                        Next →
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3">
                <nav aria-label="Calendar views" className="flex flex-wrap gap-2">
                    {views.map(([id, label]) => (
                        <Button key={id} variant={view === id ? 'primary' : 'secondary'} aria-current={view === id ? 'page' : undefined} onClick={() => changeView(id)}>
                            {label}
                        </Button>
                    ))}
                </nav>
                {view === 'scope' && canFilterUnits && units.length > 0 && (
                    <div className="flex flex-wrap gap-2 text-sm">
                        <label className="flex flex-col gap-1 text-gray-600">
                            Department
                            <select className="rounded-lg border border-gray-300 px-2 py-2 text-gray-900" value={departmentId}
                                onChange={(e) => changeUnit({ department: e.target.value })}>
                                <option value="">{central ? 'All departments' : 'All I can see'}</option>
                                {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                            </select>
                        </label>
                        {department && department.divisions.length > 0 && (
                            <label className="flex flex-col gap-1 text-gray-600">
                                Division
                                <select className="rounded-lg border border-gray-300 px-2 py-2 text-gray-900" value={divisionId}
                                    onChange={(e) => changeUnit({ department: departmentId, division: e.target.value })}>
                                    <option value="">Whole department</option>
                                    {department.divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
                                </select>
                            </label>
                        )}
                    </div>
                )}
            </div>

            {loading ? (
                <LoadingState label="Loading calendar…" />
            ) : error ? (
                <div className="app-panel p-5"><p role="alert" className="text-sm text-red-700">{error}</p><button type="button" className="toolbar-button mt-3" onClick={() => void load()}>Try again</button></div>
            ) : (
                <CalendarMonth entries={entries} start={bounds.start} end={bounds.end} view={view} holidays={holidays}
                    members={view === 'team' ? team?.members : undefined} />
            )}
        </div>
    );
}

const pendingDayClass = 'border border-dashed border-violet-600 bg-violet-100';

/** The caller's own government leave names its type; everything else keeps the server's label. */
type DayStatus = 'approved' | 'pending' | 'study';
const STATUS_LABEL: Record<DayStatus, string> = { approved: 'Approved leave', pending: 'Submitted — awaiting approval', study: 'Study leave' };
const STATUS_DOT: Record<DayStatus, string> = { approved: 'bg-brand', pending: pendingDayClass, study: 'bg-amber-500' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The month as a seven-column calendar for phones, where a 31-column table
 * cannot fit. Each day shows how many people are away; choosing a day lists
 * them underneath.
 */
function PhoneMonth({ people, days, start, monthLabel, todayDay }: {
    people: { id: string; name: string; days: Set<number>; pendingDays: Set<number>; studyDays: Set<number> }[];
    days: { day: number; weekend: boolean; holiday?: string }[];
    start: Date;
    monthLabel: string;
    todayDay: number | null;
}) {
    const awayOn = (day: number) => people.flatMap((person) => {
        const statuses: DayStatus[] = [];
        if (person.days.has(day)) statuses.push('approved');
        if (person.pendingDays.has(day)) statuses.push('pending');
        if (person.studyDays.has(day)) statuses.push('study');
        return statuses.length ? [{ id: person.id, name: person.name, statuses }] : [];
    });
    // Today when someone is away today, otherwise the first day anyone is.
    const firstBusy = days.find(({ day }) => awayOn(day).length)?.day ?? 1;
    const [chosen, setChosen] = useState<number>(todayDay !== null && awayOn(todayDay).length ? todayDay : firstBusy);
    const day = Math.min(chosen, days.length);
    const leading = (start.getDay() + 6) % 7;
    const selected = awayOn(day);
    const holiday = days[day - 1]?.holiday;
    const dayLabel = `${day} ${start.toLocaleDateString('en-GB', { month: 'long' })}`;

    return (
        <div className="app-panel p-3 md:hidden">
            <div className="grid grid-cols-7 gap-1 text-center text-xs" role="group" aria-label={`Days in ${monthLabel}`}>
                {WEEKDAYS.map((name) => <div key={name} className="py-1 font-medium text-gray-500" aria-hidden="true">{name}</div>)}
                {Array.from({ length: leading }, (_, i) => <div key={`blank-${i}`} aria-hidden="true" />)}
                {days.map(({ day: d, weekend, holiday: name }) => {
                    const away = awayOn(d);
                    const kinds = (['approved', 'pending', 'study'] as DayStatus[]).filter((kind) => away.some((a) => a.statuses.includes(kind)));
                    return (
                        <button
                            key={d}
                            type="button"
                            onClick={() => setChosen(d)}
                            aria-pressed={d === day}
                            aria-current={d === todayDay ? 'date' : undefined}
                            aria-label={`${d} ${start.toLocaleDateString('en-GB', { month: 'long' })}${d === todayDay ? ' (today)' : ''}${name ? `, ${name} (public holiday)` : ''}: ${away.length ? `${away.length} ${away.length === 1 ? 'person' : 'people'} away` : 'nobody away'}`}
                            className={`flex min-h-12 flex-col items-center justify-start gap-1 rounded-md border py-1 ${d === day ? 'border-brand ring-1 ring-brand' : 'border-transparent'} ${name ? 'bg-rose-50 text-rose-700' : weekend ? 'bg-gray-50 text-gray-400' : 'bg-white text-gray-900'}`}
                        >
                            <span className={d === todayDay ? 'flex h-6 w-6 items-center justify-center rounded-full bg-brand font-semibold text-white' : name ? 'font-semibold' : ''}>{d}</span>
                            {away.length > 0 && (
                                <span className="flex items-center gap-0.5" aria-hidden="true">
                                    {kinds.map((kind) => <span key={kind} className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[kind]}`} />)}
                                    <span className="ml-0.5 text-[10px] text-gray-600">{away.length}</span>
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
            <div className="mt-3 border-t border-gray-100 pt-3 text-sm" aria-live="polite">
                <h4 className="font-semibold text-gray-900">{dayLabel}{day === todayDay ? ' (today)' : ''}{holiday ? ` — ${holiday}` : ''}</h4>
                {selected.length ? (
                    <div role="list" className="mt-2 space-y-1.5">
                        {selected.map((person) => (
                            <div role="listitem" key={person.id} className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-gray-900">{person.name}</span>
                                {person.statuses.map((status) => (
                                    <span key={status} className="inline-flex items-center gap-1 text-xs text-gray-600">
                                        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />{STATUS_LABEL[status]}
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

function leaveLabel(entry: CalendarEntry) {
    return entry.own && entry.leave_code ? governmentLabel(entry.leave_code) : entry.leave_type_name;
}

export function CalendarMonth({ entries, start, end, view = 'scope', holidays = new Map(), today = new Date(), members }: {
    entries: CalendarEntry[]; start: Date; end: Date; view?: CalendarView; holidays?: Map<string, string>;
    /** The team calendar lists everyone in the team, away or not. */
    members?: TeamMember[];
    /** Injected for tests; the real calendar marks the actual date. */
    today?: Date;
}) {
    const monthLabel = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    // The day of this month that is today, or null when another month is shown.
    const todayDay = today.getFullYear() === start.getFullYear() && today.getMonth() === start.getMonth() ? today.getDate() : null;
    const daysInMonth = end.getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => {
        const date = new Date(start.getFullYear(), start.getMonth(), i + 1);
        const holiday = holidays.get(toIsoDate(date));
        return { day: i + 1, weekend: date.getDay() === 0 || date.getDay() === 6, holiday };
    });
    const monthHolidays = days.filter((d) => d.holiday);

    // Keep each status separate so overlapping entries remain visible.
    const byPerson = useMemo(() => {
        type Row = { id: string; name: string; own: boolean; days: Set<number>; pendingDays: Set<number>; studyDays: Set<number>; types: Set<string> };
        const blank = (id: string, name: string, own = false): Row =>
            ({ id, name, own, days: new Set<number>(), pendingDays: new Set<number>(), studyDays: new Set<number>(), types: new Set<string>() });
        const map = new Map<string, Row>();
        // Team members with no leave still get a row: an empty row means available.
        for (const member of members ?? []) map.set(member.employee_id, blank(member.employee_id, member.name, member.own === true));
        for (const entry of entries) {
            const record = map.get(entry.employee_id || entry.employee_name)
                ?? blank(entry.employee_id || entry.employee_name, entry.employee_name, entry.own === true);
            record.types.add(leaveLabel(entry));
            const studying = entry.kind === 'study_leave';
            const target = studying ? record.studyDays : entry.status === 'pending' ? record.pendingDays : record.days;
            const from = new Date(`${entry.start_date.slice(0, 10)}T00:00:00`);
            const to = entry.end_date ? new Date(`${entry.end_date.slice(0, 10)}T00:00:00`) : new Date(end);
            if (from < start) from.setTime(start.getTime());
            if (to > end) to.setTime(end.getTime());
            for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
                if (cursor.getMonth() === start.getMonth() && cursor.getFullYear() === start.getFullYear()) {
                    target.add(cursor.getDate());
                }
            }
            map.set(entry.employee_id || entry.employee_name, record);
        }
        // Your own row first, then everyone else by name.
        return [...map.values()].sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name));
    }, [entries, members, start, end]);

    return (
        <div className="space-y-5">
            {!byPerson.length ? (
                <div className="app-panel p-4">
                    <EmptyState title={EMPTY_TITLES[view]} />
                </div>
            ) : (<>
                <PhoneMonth key={start.toISOString()} people={byPerson} days={days} start={start} monthLabel={monthLabel} todayDay={todayDay} />
                <div className="hidden overflow-x-auto app-panel md:block">
                    <table className="min-w-[1100px] text-sm"><caption className="sr-only">Approved leave, submitted leave awaiting approval and study leave for {monthLabel}</caption>
                        <thead className="bg-gray-50 text-xs text-gray-500">
                            <tr>
                                <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left font-medium">Person</th>
                                {days.map(({ day, weekend, holiday }) => (
                                    <th key={day} title={day === todayDay ? `Today${holiday ? ` — ${holiday}` : ''}` : holiday}
                                        aria-current={day === todayDay ? 'date' : undefined}
                                        className={`w-7 py-2 text-center font-normal ${day === todayDay ? 'bg-brand/10' : ''} ${holiday ? 'font-semibold text-rose-700' : weekend ? 'text-gray-300' : ''}`}>
                                        {day === todayDay
                                            ? <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-brand font-semibold text-white">{day}</span>
                                            : day}
                                        {day === todayDay && <span className="sr-only"> (today)</span>}
                                        {holiday && <span className="sr-only"> ({holiday}, public holiday)</span>}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {byPerson.map((person) => (
                                <tr key={person.id}>
                                    <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-2 font-medium text-gray-900">
                                        {person.name}{person.own && <span className="font-normal text-gray-500"> (you)</span>}
                                        <span className="mt-1 block max-w-56 truncate text-xs font-normal text-gray-500">
                                            {[...person.types].join(', ')}
                                        </span>
                                    </td>
                                    {days.map(({ day, weekend, holiday }) => {
                                        const away = person.days.has(day);
                                        const pending = person.pendingDays.has(day);
                                        const studying = person.studyDays.has(day);
                                        const statuses = [away && 'Approved leave', pending && 'Submitted — awaiting approval', studying && 'Study leave'].filter(Boolean);
                                        return (
                                            <td key={day} className={`p-0.5 ${day === todayDay ? 'border-x-2 border-brand/60 bg-brand/10' : ''}`}>
                                                <div
                                                    className={`flex h-5 flex-col gap-px overflow-hidden rounded-sm ${statuses.length ? '' : holiday ? 'bg-rose-100' : weekend ? 'bg-gray-100' : 'bg-gray-50'}`}
                                                    role={statuses.length ? 'img' : undefined}
                                                    aria-label={statuses.length ? `${person.name}: ${statuses.join('; ')} on ${day} ${monthLabel}` : undefined}
                                                    title={statuses.length ? `${person.name}: ${statuses.join('; ')} on ${day} ${monthLabel}` : holiday}
                                                >
                                                    {away && <span className="min-h-0 flex-1 bg-brand" />}
                                                    {pending && <span className={`min-h-0 flex-1 ${pendingDayClass}`} />}
                                                    {studying && <span className="min-h-0 flex-1 bg-amber-500" />}
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </>)}

            {byPerson.length > 0 && (
                <p className="flex flex-wrap items-center gap-4 px-1 text-xs text-gray-600">
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-brand" aria-hidden="true" />Approved leave</span>
                    <span className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded-sm ${pendingDayClass}`} aria-hidden="true" />Submitted — awaiting approval</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-amber-500" aria-hidden="true" />Study leave</span>
                    {monthHolidays.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-rose-100" aria-hidden="true" />Public holiday</span>}
                    {todayDay !== null && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-brand" aria-hidden="true" />Today</span>}
                </p>
            )}

            {monthHolidays.length > 0 && (
                <p className="px-1 text-xs text-gray-600">
                    Public holidays: {monthHolidays.map((d) => `${d.day} ${start.toLocaleDateString('en-GB', { month: 'short' })} — ${d.holiday}`).join(' · ')}
                </p>
            )}

        </div>
    );
}

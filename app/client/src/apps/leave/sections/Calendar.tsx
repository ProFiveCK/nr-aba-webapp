import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../../../lib/api';
import { useToast } from '../../../contexts/useToast';
import { EmptyState, LoadingState } from '../../../components/Ui';
import { formatDate } from '../types';
import { toIsoDate } from '../../../lib/date';

interface CalendarEntry {
    id: string;
    employee_id?: string;
    employee_name: string;
    department_code: string | null;
    leave_type_name: string;
    start_date: string;
    end_date: string | null;
    days: string | null;
    kind?: 'leave' | 'study_leave';
}

function monthBounds(offset: number) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    return { from: toIsoDate(start), to: toIsoDate(end), start, end };
}

export function Calendar() {
    const { addToast } = useToast();
    const [offset, setOffset] = useState(0);
    const [entries, setEntries] = useState<CalendarEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const loadVersion = useRef(0);

    const bounds = useMemo(() => monthBounds(offset), [offset]);

    const load = useCallback(async () => {
        const requestVersion = ++loadVersion.current;
        setLoading(true);
        setError('');
        try {
            const data = await apiClient.get<CalendarEntry[]>(
                `/hr/calendar?from=${bounds.from}&to=${bounds.to}`
            );
            if (requestVersion !== loadVersion.current) return;
            const government: CalendarEntry[] = [];
            for (let page = 1; ; page++) {
                const result = await apiClient.get<{entries: CalendarEntry[]; has_more: boolean}>(`/hr/government/workflow/calendar?from=${bounds.from}&to=${bounds.to}&page=${page}`);
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
    }, [addToast, bounds.from, bounds.to]);

    useEffect(() => {
        void load();
        return () => { loadVersion.current += 1; };
    }, [load]);

    const monthLabel = bounds.start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const daysInMonth = bounds.end.getDate();

    // One row per person, with the days they are away shaded.
    const byPerson = useMemo(() => {
        const map = new Map<string, { id: string; name: string; days: Set<number>; studyDays: Set<number>; types: Set<string> }>();
        for (const entry of entries) {
            const record = map.get(entry.employee_id || entry.employee_name) ?? {
                id: entry.employee_id || entry.employee_name,
                name: entry.employee_name,
                days: new Set<number>(),
                studyDays: new Set<number>(),
                types: new Set<string>(),
            };
            record.types.add(entry.leave_type_name);
            const studying = entry.kind === 'study_leave';
            const target = studying ? record.studyDays : record.days;
            const from = new Date(`${entry.start_date.slice(0, 10)}T00:00:00`);
            const to = entry.end_date ? new Date(`${entry.end_date.slice(0, 10)}T00:00:00`) : new Date(bounds.end);
            if (from < bounds.start) from.setTime(bounds.start.getTime());
            if (to > bounds.end) to.setTime(bounds.end.getTime());
            for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
                if (cursor.getMonth() === bounds.start.getMonth() && cursor.getFullYear() === bounds.start.getFullYear()) {
                    target.add(cursor.getDate());
                }
            }
            map.set(entry.employee_id || entry.employee_name, record);
        }
        return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [entries, bounds.start, bounds.end]);

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 app-panel p-5 sm:p-6">
                <h2 className="text-lg font-semibold text-gray-900">Who is away — {monthLabel}</h2>
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

            {loading ? (
                <LoadingState label="Loading calendar…" />
            ) : error ? (
                <div className="app-panel p-5"><p role="alert" className="text-sm text-red-700">{error}</p><button type="button" className="toolbar-button mt-3" onClick={() => void load()}>Try again</button></div>
            ) : !byPerson.length ? (
                <div className="app-panel p-4">
                    <EmptyState title="Nobody is away this month" />
                </div>
            ) : (
                <div className="hidden overflow-x-auto app-panel md:block">
                    <table className="min-w-[1100px] text-sm"><caption className="sr-only">Approved leave and study leave for {monthLabel}</caption>
                        <thead className="bg-gray-50 text-xs text-gray-500">
                            <tr>
                                <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left font-medium">Person</th>
                                {Array.from({ length: daysInMonth }, (_, i) => {
                                    const date = new Date(bounds.start.getFullYear(), bounds.start.getMonth(), i + 1);
                                    const weekend = date.getDay() === 0 || date.getDay() === 6;
                                    return (
                                        <th key={i} className={`w-7 py-2 text-center font-normal ${weekend ? 'text-gray-300' : ''}`}>
                                            {i + 1}
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {byPerson.map((person) => (
                                <tr key={person.id}>
                                    <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-2 font-medium text-gray-900">
                                        {person.name}
                                        <span className="mt-1 block max-w-56 truncate text-xs font-normal text-gray-500">
                                            {[...person.types].join(', ')}
                                        </span>
                                    </td>
                                    {Array.from({ length: daysInMonth }, (_, i) => {
                                        const day = i + 1;
                                        const date = new Date(bounds.start.getFullYear(), bounds.start.getMonth(), day);
                                        const weekend = date.getDay() === 0 || date.getDay() === 6;
                                        const away = person.days.has(day);
                                        const studying = person.studyDays.has(day);
                                        return (
                                            <td key={i} className="p-0.5">
                                                <div
                                                    className={`h-5 rounded-sm ${
                                                        away ? 'bg-brand' : studying ? 'bg-amber-500' : weekend ? 'bg-gray-100' : 'bg-gray-50'
                                                    }`}
                                                    title={away || studying ? `${person.name} ${studying && !away ? 'on study leave' : 'away'} on ${day} ${monthLabel}` : undefined}
                                                />
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {!loading && byPerson.length > 0 && (
                <p className="flex flex-wrap items-center gap-4 px-1 text-xs text-gray-600">
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-brand" aria-hidden="true" />Approved leave</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-amber-500" aria-hidden="true" />Study leave</span>
                </p>
            )}

            {!loading && entries.length > 0 && (
                <div className="app-panel p-5 text-sm sm:p-6">
                    <h3 className="mb-4 text-lg font-semibold text-gray-900">Absences this month</h3>
                    <ul className="divide-y divide-gray-100 text-gray-600">
                        {entries.map((entry) => (
                            <li key={`${entry.kind || 'leave'}-${entry.id}`} className="py-3 first:pt-0 last:pb-0">
                                <span className="font-medium text-gray-900">{entry.employee_name}</span> —{' '}
                                {entry.kind === 'study_leave'
                                    ? `Study leave from ${formatDate(entry.start_date)}${entry.end_date ? ` to ${formatDate(entry.end_date)}` : ', return date not set'}`
                                    : `${entry.leave_type_name}, ${formatDate(entry.start_date)} to ${formatDate(entry.end_date as string)} (${entry.days} days)`}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

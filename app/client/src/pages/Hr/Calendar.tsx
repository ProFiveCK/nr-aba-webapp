import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { EmptyState, LoadingState } from '../../components/Ui';
import { formatDate } from '../../features/hr/types';
import { toIsoDate } from '../../lib/date';

interface CalendarEntry {
    id: string;
    employee_name: string;
    department_code: string | null;
    leave_type_name: string;
    start_date: string;
    end_date: string;
    days: string;
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

    const bounds = useMemo(() => monthBounds(offset), [offset]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiClient.get<CalendarEntry[]>(
                `/hr/calendar?from=${bounds.from}&to=${bounds.to}`
            );
            setEntries(data || []);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to load the leave calendar.', 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast, bounds.from, bounds.to]);

    useEffect(() => {
        load();
    }, [load]);

    const monthLabel = bounds.start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const daysInMonth = bounds.end.getDate();

    // One row per person, with the days they are away shaded.
    const byPerson = useMemo(() => {
        const map = new Map<string, { name: string; days: Set<number>; types: Set<string> }>();
        for (const entry of entries) {
            const record = map.get(entry.employee_name) ?? {
                name: entry.employee_name,
                days: new Set<number>(),
                types: new Set<string>(),
            };
            record.types.add(entry.leave_type_name);
            const from = new Date(entry.start_date);
            const to = new Date(entry.end_date);
            for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
                if (cursor.getMonth() === bounds.start.getMonth() && cursor.getFullYear() === bounds.start.getFullYear()) {
                    record.days.add(cursor.getDate());
                }
            }
            map.set(entry.employee_name, record);
        }
        return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [entries, bounds.start]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 app-panel px-4 py-3">
                <h2 className="text-sm font-semibold text-zinc-900">Who is away — {monthLabel}</h2>
                <div className="flex gap-2">
                    <button type="button" onClick={() => setOffset(offset - 1)} className="rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50">
                        ← Previous
                    </button>
                    <button type="button" onClick={() => setOffset(0)} className="rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50">
                        This month
                    </button>
                    <button type="button" onClick={() => setOffset(offset + 1)} className="rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50">
                        Next →
                    </button>
                </div>
            </div>

            {loading ? (
                <LoadingState label="Loading calendar…" />
            ) : !byPerson.length ? (
                <div className="app-panel p-4">
                    <EmptyState title="Nobody is on approved leave this month" />
                </div>
            ) : (
                <div className="overflow-x-auto app-panel">
                    <table className="min-w-full text-sm">
                        <thead className="bg-zinc-50 text-xs text-zinc-500">
                            <tr>
                                <th className="sticky left-0 bg-zinc-50 px-3 py-2 text-left font-medium">Person</th>
                                {Array.from({ length: daysInMonth }, (_, i) => {
                                    const date = new Date(bounds.start.getFullYear(), bounds.start.getMonth(), i + 1);
                                    const weekend = date.getDay() === 0 || date.getDay() === 6;
                                    return (
                                        <th key={i} className={`w-7 py-2 text-center font-normal ${weekend ? 'text-zinc-300' : ''}`}>
                                            {i + 1}
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {byPerson.map((person) => (
                                <tr key={person.name}>
                                    <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-2 font-medium text-zinc-900">
                                        {person.name}
                                        <span className="ml-2 text-xs font-normal text-zinc-400">
                                            {[...person.types].join(', ')}
                                        </span>
                                    </td>
                                    {Array.from({ length: daysInMonth }, (_, i) => {
                                        const day = i + 1;
                                        const date = new Date(bounds.start.getFullYear(), bounds.start.getMonth(), day);
                                        const weekend = date.getDay() === 0 || date.getDay() === 6;
                                        const away = person.days.has(day);
                                        return (
                                            <td key={i} className="p-0.5">
                                                <div
                                                    className={`h-5 rounded-sm ${
                                                        away ? 'bg-[#002B7F]' : weekend ? 'bg-zinc-100' : 'bg-zinc-50'
                                                    }`}
                                                    title={away ? `${person.name} away on ${day} ${monthLabel}` : undefined}
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

            {!loading && entries.length > 0 && (
                <div className="app-panel p-4 text-sm">
                    <h3 className="mb-2 text-sm font-semibold text-zinc-900">Detail</h3>
                    <ul className="space-y-1 text-zinc-600">
                        {entries.map((entry) => (
                            <li key={entry.id}>
                                <span className="font-medium text-zinc-900">{entry.employee_name}</span> —{' '}
                                {entry.leave_type_name}, {formatDate(entry.start_date)} to {formatDate(entry.end_date)} ({entry.days} days)
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

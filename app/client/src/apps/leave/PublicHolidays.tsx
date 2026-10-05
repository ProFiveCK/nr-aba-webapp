import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { useConfirm } from '../../contexts/useConfirm';
import { Card, CardHeading, LoadingState } from '../../components/Ui';
import { formatDate } from './types';
import type { PublicHoliday } from './types';

/**
 * Days the office is closed, which leave is not charged for.
 *
 * Enter them ahead of the year they apply to: a holiday declared after leave
 * has been approved does not give anyone their day back, because the
 * entitlement was already spent against the calendar as it stood.
 */
export function PublicHolidays() {
    const { addToast } = useToast();
    const { confirm } = useConfirm();
    const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [date, setDate] = useState('');
    const [name, setName] = useState('');
    const [year, setYear] = useState(() => new Date().getFullYear());

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setHolidays((await apiClient.get<PublicHoliday[]>('/hr/public-holidays')) || []);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to load public holidays.', 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast]);

    useEffect(() => {
        load();
    }, [load]);

    const years = useMemo(() => {
        const found = new Set(holidays.map((h) => Number(h.holiday_date.slice(0, 4))));
        found.add(new Date().getFullYear());
        return [...found].sort((a, b) => b - a);
    }, [holidays]);

    const shown = useMemo(
        () => holidays.filter((h) => h.holiday_date.startsWith(String(year))),
        [holidays, year]
    );

    const add = async () => {
        if (!date || !name.trim()) {
            addToast('Give the holiday a date and a name.', 'error');
            return;
        }
        setSaving(true);
        try {
            await apiClient.post('/hr/public-holidays', { holiday_date: date, name: name.trim() });
            addToast('Public holiday added.', 'success');
            setDate('');
            setName('');
            setYear(Number(date.slice(0, 4)));
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to add the public holiday.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const remove = async (holiday: PublicHoliday) => {
        if (!(await confirm(`Remove ${holiday.name} on ${formatDate(holiday.holiday_date)}?`))) return;
        try {
            await apiClient.delete(`/hr/public-holidays/${holiday.id}`);
            addToast('Public holiday removed.', 'success');
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to remove the public holiday.', 'error');
        }
    };

    return (
        <Card>
            <CardHeading
                title="Public holidays"
                subtitle="Leave is not charged for a day the office is closed. Enter them before the year they apply to."
            >
                {years.length > 1 && (
                    <select
                        value={year}
                        onChange={(e) => setYear(Number(e.target.value))}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
                        aria-label="Year"
                    >
                        {years.map((y) => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                )}
            </CardHeading>

            <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="text-sm">
                    <span className="mb-1 block font-medium text-zinc-700">Date</span>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                    />
                </label>
                <label className="flex-1 text-sm">
                    <span className="mb-1 block font-medium text-zinc-700">Name</span>
                    <input
                        type="text"
                        value={name}
                        maxLength={120}
                        placeholder="Independence Day"
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                    />
                </label>
                <button
                    type="button"
                    onClick={add}
                    disabled={saving}
                    className="rounded-md bg-[#002B7F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#001f5c] disabled:opacity-50"
                >
                    {saving ? 'Adding…' : 'Add holiday'}
                </button>
            </div>

            {loading ? (
                <LoadingState label="Loading public holidays…" />
            ) : shown.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-500">
                    No public holidays recorded for {year}. Until they are entered, leave taken over them is
                    charged as ordinary working days.
                </p>
            ) : (
                <ul className="mt-4 divide-y divide-zinc-100">
                    {shown.map((holiday) => (
                        <li key={holiday.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                            <span className="w-36 shrink-0 tabular-nums text-zinc-600">
                                {formatDate(holiday.holiday_date)}
                            </span>
                            <span className="flex-1 font-medium text-zinc-900">{holiday.name}</span>
                            <button
                                type="button"
                                onClick={() => remove(holiday)}
                                className="text-sm font-medium text-red-600 hover:underline"
                            >
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}

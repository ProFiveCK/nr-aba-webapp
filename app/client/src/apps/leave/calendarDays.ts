import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';

/** `Fri`, or `Friday` with `long`, for a `YYYY-MM-DD` day. */
export function weekdayName(iso: string, style: 'short' | 'long' = 'short') {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { weekday: style });
}

export function isWeekend(iso: string) {
    const day = new Date(`${iso}T00:00:00`).getDay();
    return day === 0 || day === 6;
}

/** Published public holidays by date. The list is short and the same for everyone, so it is loaded once. */
export function useHolidays() {
    const [holidays, setHolidays] = useState<Map<string, string>>(() => new Map());
    useEffect(() => {
        let live = true;
        apiClient.get<{ date: string; name: string }[]>('/hr/government/workflow/holidays')
            .then(rows => { if (live) setHolidays(new Map(rows.map(h => [h.date, h.name]))); })
            // Without the list the calendar only loses its holiday marks; the date check still applies holidays.
            .catch(() => undefined);
        return () => { live = false; };
    }, []);
    return holidays;
}

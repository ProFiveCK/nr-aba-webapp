import { useState } from 'react';
import { formatDate, toIsoDate, todayIsoDate } from '../../lib/date';
import { isWeekend, weekdayName } from './calendarDays';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Props = {
    start: string;
    end: string;
    holidays: Map<string, string>;
    /** Saturday and Sunday cannot be chosen. */
    blockWeekends: boolean;
    onPick: (date: string) => void;
};

/** A month of the leave dates: weekdays named, weekends and public holidays marked, today outlined. */
export function LeaveDateCalendar({ start, end, holidays, blockWeekends, onPick }: Props) {
    const today = todayIsoDate();
    // Follow the start date when it is typed into another month; otherwise keep the month the user browsed to.
    const [shown, setShown] = useState({ start, month: (start || today).slice(0, 7) });
    if (start !== shown.start) setShown({ start, month: start ? start.slice(0, 7) : shown.month });
    const [year, month] = shown.month.split('-').map(Number);
    const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7;
    const days = Array.from({ length: new Date(year, month, 0).getDate() }, (_, i) => toIsoDate(new Date(year, month - 1, i + 1)));
    const last = end && end >= start ? end : start;
    const monthHolidays = days.filter(day => holidays.has(day));
    const go = (step: number) => setShown(s => ({ ...s, month: toIsoDate(new Date(year, month - 1 + step, 1)).slice(0, 7) }));
    const label = new Date(year, month - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

    return <div className="max-w-sm rounded-lg border border-gray-200 p-3">
        <div className="mb-2 flex items-center justify-between">
            <button type="button" className="icon-button" aria-label="Previous month" onClick={() => go(-1)}>‹</button>
            <p className="text-sm font-semibold" aria-live="polite">{label}</p>
            <button type="button" className="icon-button" aria-label="Next month" onClick={() => go(1)}>›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((name, i) => <span key={name} aria-hidden="true" className={`text-xs font-semibold ${i >= 5 ? 'text-gray-400' : 'text-gray-600'}`}>{name}</span>)}
            {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} />)}
            {days.map(day => {
                const weekend = isWeekend(day), holiday = holidays.get(day), isToday = day === today;
                const chosen = !!start && day >= start && day <= last, edge = day === start || day === last;
                const blocked = blockWeekends && weekend;
                const tone = edge && chosen ? 'bg-brand font-semibold text-white'
                    : chosen ? 'bg-brand/15 text-gray-900'
                    : weekend ? 'bg-gray-100 text-gray-400'
                    : holiday ? 'bg-accent/15 font-semibold text-gray-900 hover:bg-accent/25'
                    : 'text-gray-800 hover:bg-gray-100';
                return <button key={day} type="button" disabled={blocked} onClick={() => onPick(day)} title={holiday}
                    aria-pressed={chosen} aria-current={isToday ? 'date' : undefined}
                    aria-label={`${weekdayName(day, 'long')} ${formatDate(day)}${isToday ? ', today' : ''}${holiday ? `, ${holiday}` : ''}${blocked ? ', weekend, not available' : ''}`}
                    className={`relative h-9 rounded-md text-sm disabled:cursor-not-allowed ${tone} ${isToday ? 'ring-2 ring-accent ring-offset-1' : ''}`}>
                    {Number(day.slice(8))}
                    {holiday && <span aria-hidden="true" className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />}
                </button>;
            })}
        </div>
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600" aria-hidden="true">
            <span><span className="mr-1 inline-block h-3 w-3 rounded-sm ring-2 ring-accent align-middle" />Today</span>
            <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-brand align-middle" />Your leave</span>
            <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-accent/30 align-middle" />Public holiday</span>
            <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-gray-200 align-middle" />Weekend{blockWeekends ? ' (not counted)' : ''}</span>
        </p>
        {monthHolidays.length > 0 && <ul className="mt-2 space-y-0.5 text-sm">
            {monthHolidays.map(day => <li key={day}><span className="font-medium">{weekdayName(day)} {formatDate(day)}</span> · {holidays.get(day)}</li>)}
        </ul>}
    </div>;
}

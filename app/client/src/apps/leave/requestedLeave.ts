import { isCalendarDate, toDateInputValue } from '../../lib/date';
import { leaveDays } from './leaveBalances';

type RequestedLeave = { code: string; start_date: string; end_date: string; charge: string; duration_unit?: 'days' | 'hours' | null; hours?: string | null };
const calendarCodes = ['maternity', 'paternity', 'adoption', 'teacher_recreation', 'extended_medical', 'extended_medical_minister', 'official', 'lwop', 'witness_republic', 'witness_other'];

export function requestedLeave(request: RequestedLeave): string {
    if (request.duration_unit === 'hours') return `${leaveDays(request.hours || '0')} ${Number(request.hours) === 1 ? 'hour' : 'hours'} · ${leaveDays(request.charge)} ${Number(request.charge) === 1 ? 'day' : 'days'}`;
    if (calendarCodes.includes(request.code)) {
        const start = toDateInputValue(request.start_date), end = toDateInputValue(request.end_date);
        if (isCalendarDate(start) && isCalendarDate(end)) {
            const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
            if (days > 0) return `${days} calendar ${days === 1 ? 'day' : 'days'}`;
        }
        return 'Duration not determined';
    }
    return Number(request.charge) > 0 ? `${leaveDays(request.charge)} ${Number(request.charge) === 1 ? 'day' : 'days'}` : 'Leave application';
}

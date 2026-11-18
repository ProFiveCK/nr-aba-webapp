import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarMonth } from './Calendar';

const start = new Date(2026, 10, 1);
const end = new Date(2026, 10, 30);
const pending = {
    id: 'pending', employee_id: 'ana', employee_name: 'Ana', department_code: null,
    leave_type_name: 'Submitted government leave', start_date: '2026-10-30',
    end_date: '2026-11-02', days: '1', status: 'pending' as const,
};

it('shows submitted dates and a status badge without marking them approved', () => {
    const html = renderToStaticMarkup(<CalendarMonth entries={[pending]} start={start} end={end} />);
    const table = html.match(/<tbody[^>]*>(.*?)<\/tbody>/)?.[1] || '';
    const list = html.match(/<li[^>]*>(.*?)<\/li>/)?.[1] || '';
    expect(table).toContain('Ana: Submitted — awaiting approval on 1 November 2026');
    expect(table).toContain('Ana: Submitted — awaiting approval on 2 November 2026');
    expect(table).not.toContain('on 3 November');
    expect(table).not.toContain('October 2026');
    expect(table).toContain('border-dashed');
    expect(table).not.toContain('flex-1 bg-brand');
    expect(list).toContain('Submitted — awaiting approval');
    expect(list).not.toContain('Approved leave');
    expect(list).toContain('30/10/2026 to 02/11/2026');
});

it('keeps overlapping approved, submitted and open-ended study leave visible', () => {
    const entries = [
        pending,
        { ...pending, id: 'approved', status: 'approved' as const },
        { ...pending, id: 'study', kind: 'study_leave' as const, status: 'approved' as const, end_date: null },
    ];
    const html = renderToStaticMarkup(<CalendarMonth entries={entries} start={start} end={end} />);
    expect(html).toContain('Ana: Approved leave; Submitted — awaiting approval; Study leave on 1 November 2026');
    expect(html).toContain('Ana: Study leave on 30 November 2026');
    expect(html.match(/<tbody[^>]*>(.*?)<\/tbody>/)?.[1].match(/<tr>/g)).toHaveLength(1);
    const firstCell = html.match(/aria-label="Ana: Approved leave; Submitted[^>]*>(.*?)<\/div>/)?.[1] || '';
    expect(firstCell).toContain('bg-brand');
    expect(firstCell).toContain('border-dashed');
    expect(firstCell).toContain('bg-amber-500');
    expect(html).toContain('return date not set');
});

it('shows approved dates after a submitted application is approved', () => {
    const html = renderToStaticMarkup(<CalendarMonth entries={[{ ...pending, status: 'approved' }]} start={start} end={end} />);
    expect(html).toContain('Ana: Approved leave on 1 November 2026');
    expect(html).not.toContain('Ana: Submitted');
    expect(html.match(/<li[^>]*>(.*?)<\/li>/)?.[1]).toContain('Approved leave');
});

it('does not display an uncalculated pending case as zero days', () => {
    const html = renderToStaticMarkup(<CalendarMonth entries={[{ ...pending, days: '0' }]} start={start} end={end} />);
    expect(html).toContain('Submitted — awaiting approval');
    expect(html).not.toContain('(0 days)');
});

it('uses an empty state that covers submitted as well as approved leave', () => {
    const html = renderToStaticMarkup(<CalendarMonth entries={[]} start={start} end={end} />);
    expect(html).toContain('No approved or submitted leave this month');
});

it('names your own government leave and keeps a colleague’s as On leave', () => {
    const entries = [
        { ...pending, id: 'mine', status: 'approved' as const, own: true, leave_code: 'maternity' },
        { ...pending, id: 'theirs', employee_id: 'ben', employee_name: 'Ben', leave_type_name: 'On leave', own: false, leave_code: null },
    ];
    const html = renderToStaticMarkup(<CalendarMonth entries={entries} start={start} end={end} view="team" />);
    expect(html).toContain('Maternity leave, 30/10/2026 to 02/11/2026');
    expect(html).toContain('On leave, 30/10/2026 to 02/11/2026');
    expect(html).not.toContain('Submitted government leave');
});

it('marks public holidays in the grid and lists them for the month', () => {
    const holidays = new Map([['2026-11-02', 'Synthetic Holiday'], ['2026-12-25', 'Next Month Holiday']]);
    const html = renderToStaticMarkup(<CalendarMonth entries={[pending]} start={start} end={end} holidays={holidays} />);
    expect(html).toContain('(Synthetic Holiday, public holiday)');
    expect(html).toContain('2 Nov — Synthetic Holiday');
    expect(html).toContain('Public holiday');
    expect(html).not.toContain('Next Month Holiday');
});

it('says whose leave is missing when a view is empty', () => {
    expect(renderToStaticMarkup(<CalendarMonth entries={[]} start={start} end={end} view="team" />))
        .toContain('Nobody in your team has approved or submitted leave this month');
    expect(renderToStaticMarkup(<CalendarMonth entries={[]} start={start} end={end} view="mine" />))
        .toContain('You have no approved or submitted leave this month');
});

it('gives phones a month grid that counts who is away and lists them for the chosen day', () => {
    const approved = { ...pending, id: 'approved', employee_id: 'ben', employee_name: 'Ben', status: 'approved' as const,
        start_date: '2026-11-02', end_date: '2026-11-03' };
    const html = renderToStaticMarkup(<CalendarMonth entries={[pending, approved]} start={start} end={end} />);
    const phone = html.match(/<div class="app-panel p-3 md:hidden">(.*?)<\/div><div class="hidden overflow-x-auto/)?.[1] || '';
    expect(phone).toContain('aria-label="1 November: 1 person away"');
    expect(phone).toContain('aria-label="2 November: 2 people away"');
    expect(phone).toContain('aria-label="3 November: 1 person away"');
    expect(phone).toContain('aria-label="4 November: nobody away"');
    // 1 November 2026 is a Sunday, so six blank cells lead the Monday-first grid.
    expect(phone.match(/<div aria-hidden="true"><\/div>/g)?.length).toBe(6);
    // The first busy day is chosen and lists who is away and how.
    expect(phone).toContain('aria-pressed="true" aria-label="1 November');
    expect(phone).toMatch(/<h4[^>]*>1 November<\/h4>/);
    expect(phone).toContain('Ana');
    expect(phone).toContain('Submitted — awaiting approval');
});

it('marks today in the grid and the phone view, and only in the current month', () => {
    const today = new Date(2026, 10, 18);
    const html = renderToStaticMarkup(<CalendarMonth entries={[pending]} start={start} end={end} today={today} />);
    const table = html.match(/<table[^>]*>(.*?)<\/table>/)?.[1] || '';
    expect(table).toMatch(/<th[^>]*aria-current="date"[^>]*><span[^>]*bg-brand[^>]*>18<\/span><span class="sr-only"> \(today\)<\/span>/);
    expect(table.match(/aria-current="date"/g)?.length).toBe(1);
    expect(table.match(/border-x-2 border-brand/g)?.length).toBe(1);
    expect(html).toContain('aria-label="18 November (today): nobody away"');
    expect(html).toContain('>Today</span>');

    const otherMonth = renderToStaticMarkup(<CalendarMonth entries={[pending]} start={start} end={end} today={new Date(2026, 11, 3)} />);
    expect(otherMonth).not.toContain('aria-current="date"');
    expect(otherMonth).not.toContain('(today)');
    expect(otherMonth).not.toContain('>Today</span>');
});

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
    expect(table).not.toContain('bg-brand');
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

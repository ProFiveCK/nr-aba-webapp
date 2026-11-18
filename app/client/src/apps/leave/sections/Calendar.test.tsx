import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarMonth, type TeamMember } from './Calendar';

const start = new Date(2026, 10, 1);
const end = new Date(2026, 10, 30);
// A month other than the one shown, so "today" does not appear unless a test asks for it.
const elsewhere = new Date(2027, 0, 15);
const pending = {
    id: 'pending', employee_id: 'ana', employee_name: 'Ana', department_code: null,
    department_name: 'Finance', division_name: 'Accounting',
    leave_type_name: 'On leave', start_date: '2026-10-30',
    end_date: '2026-11-02', days: '1', status: 'pending' as const,
};
const study = { ...pending, id: 'study-cia', employee_id: 'cia', employee_name: 'Cia', leave_type_name: 'Study leave',
    kind: 'study_leave' as const, status: 'approved' as const, start_date: '2026-09-01', end_date: null, days: null };
const render = (props: Partial<Parameters<typeof CalendarMonth>[0]> = {}) =>
    renderToStaticMarkup(<CalendarMonth entries={[pending]} start={start} end={end} today={elsewhere} {...props} />);
const body = (html: string) => (html.match(/<tbody[^>]*>.*<\/tbody>/)?.[0] || '');
/** The bar segments drawn for one person on one day. */
const cell = (html: string, label: string) => html.match(new RegExp(`aria-label="${label}"[^>]*>(.*?)</div>`))?.[1] || '';

it('shows submitted dates as awaiting approval, never in the approved colour', () => {
    const table = body(render());
    expect(table).toContain('Ana: Awaiting approval on 1 November 2026');
    expect(table).toContain('Ana: Awaiting approval on 2 November 2026');
    expect(table).not.toContain('on 3 November');
    expect(table).not.toContain('October 2026');
    expect(table).toContain('border-violet-400');
    expect(table).not.toContain('flex-1 bg-brand');
});

it('draws a period as one continuous bar, rounded only where it starts and ends', () => {
    const approved = { ...pending, status: 'approved' as const, start_date: '2026-11-04', end_date: '2026-11-06' };
    const html = render({ entries: [approved] });
    expect(cell(html, 'Ana: Approved leave on 4 November 2026')).toMatch(/ml-0.5 rounded-l /);
    expect(cell(html, 'Ana: Approved leave on 4 November 2026')).not.toMatch(/rounded-r/);
    expect(cell(html, 'Ana: Approved leave on 5 November 2026')).not.toMatch(/rounded/);
    expect(cell(html, 'Ana: Approved leave on 6 November 2026')).toMatch(/mr-0.5 rounded-r/);
});

it('keeps overlapping approved, awaiting and open-ended study leave visible', () => {
    const entries = [pending, { ...pending, id: 'approved', status: 'approved' as const }, { ...study, employee_id: 'ana', employee_name: 'Ana' }];
    const html = render({ entries });
    const both = cell(html, 'Ana: Approved leave; Awaiting approval; Study leave on 1 November 2026');
    expect(both).toContain('bg-brand');
    expect(both).toContain('border-violet-400');
    expect(both).toContain('bg-amber-400');
    expect(html).toContain('Ana: Study leave on 30 November 2026');
    expect(body(html).match(/scope="row"/g)).toHaveLength(1);
});

it('draws study leave the same way in the team calendar and in all departments', () => {
    const team = render({ entries: [study], view: 'team' });
    const all = render({ entries: [study], view: 'all' });
    const label = 'Cia: Study leave on 18 November 2026';
    expect(cell(team, label)).toContain('bg-amber-400');
    expect(cell(team, label)).toBe(cell(all, label));
    expect(team).toContain('Study leave from 1 Sep');
});

it('names your own leave, says only when a colleague is away, and gives Central HR the type', () => {
    const entries = [
        { ...pending, id: 'mine', employee_id: 'me', employee_name: 'Me', status: 'approved' as const, own: true, leave_code: 'maternity', leave_type_name: 'Approved government leave' },
        { ...pending, id: 'theirs', employee_id: 'ben', employee_name: 'Ben', leave_code: null },
    ];
    const team = body(render({ entries, view: 'team' }));
    // Dates live in the name's tooltip; nothing is printed under the names.
    expect(team).toMatch(/title="Maternity leave 30 Oct – 2 Nov"[^>]*>Me<span[^>]*> \(you\)<\/span><\/th>/);
    expect(team).toContain('title="Requested 30 Oct – 2 Nov"');
    expect(team.indexOf('Me<')).toBeLessThan(team.indexOf('Ben<'));
    expect(team).not.toContain('government leave');

    const all = body(render({ view: 'all', entries: [{ ...pending, status: 'approved' as const, leave_code: 'medical', leave_type_name: 'Approved government leave' }] }));
    expect(all).toContain('title="Medical 30 Oct – 2 Nov"');
});

it('lists every team member, away or not, grouped by division with your own group and row first', () => {
    const members: TeamMember[] = [
        { employee_id: 'zed', name: 'Zed', department_name: 'Finance', division_name: 'Accounting' },
        { employee_id: 'ana', name: 'Ana', department_name: 'Finance', division_name: 'Accounting' },
        { employee_id: 'yo', name: 'Yolanda', own: true, department_name: 'Finance', division_name: 'Treasury' },
        { employee_id: 'ray', name: 'Ray', department_name: 'Finance', division_name: 'Treasury' },
    ];
    const table = body(render({ view: 'team', members }));
    expect(table.match(/scope="row"/g)).toHaveLength(4);
    const order = ['Treasury', 'Yolanda', 'Ray', 'Accounting', 'Ana', 'Zed'].map((text) => table.indexOf(text));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(table).not.toContain('Zed:');

    const oneUnit = body(render({ view: 'team', members: members.filter((m) => m.division_name === 'Accounting') }));
    expect(oneUnit).not.toContain('scope="colgroup"');
});

it('groups all departments by department and division', () => {
    const entries = [pending, { ...pending, id: 'x', employee_id: 'kim', employee_name: 'Kim', department_name: 'Health', division_name: null }];
    const table = body(render({ view: 'all', entries }));
    expect(table).toContain('Finance · Accounting');
    expect(table.indexOf('Finance · Accounting')).toBeLessThan(table.indexOf('Health'));
});

it('marks public holidays in the grid, named on hover, without a list below', () => {
    const holidays = new Map([['2026-11-02', 'Synthetic Holiday'], ['2026-12-25', 'Next Month Holiday']]);
    const html = render({ holidays });
    expect(html).toContain('(Synthetic Holiday, public holiday)');
    expect(html).toContain('title="Synthetic Holiday"');
    expect(html).toContain('Public holiday');
    expect(html).not.toContain('Next Month Holiday');
    expect(html).not.toContain('Public holidays:');
});

it('keeps the grid compact: one line per person, bounded height, sticky dates and names', () => {
    const html = render();
    expect(html).toContain('max-h-[calc(100vh-15rem)]');
    expect(html).toMatch(/<th[^>]*sticky top-0[^>]*aria-current|<th[^>]*class="sticky top-0/);
    const row = body(html).match(/<th scope="row"[^>]*>(.*?)<\/th>/)?.[1] || '';
    expect(row).toBe('Ana');
    expect(html).not.toContain('Colleagues’ leave shows');
});

it('says why a view is empty', () => {
    expect(render({ entries: [], view: 'team' })).toContain('Your login is not linked to a team yet');
    expect(render({ entries: [], view: 'department' })).toContain('Your login is not linked to a department yet');
    expect(render({ entries: [], view: 'all' })).toContain('No approved or submitted leave this month');
});

it('marks today, says who is away today, and only in the current month', () => {
    const away = { ...pending, status: 'approved' as const, start_date: '2026-11-17', end_date: '2026-11-19' };
    const html = render({ entries: [away, study], today: new Date(2026, 10, 18) });
    expect(html).toMatch(/<th[^>]*aria-current="date"[^>]*>.*?<span[^>]*bg-brand[^>]*>18<\/span><span class="sr-only"> \(today\)<\/span>/);
    expect(html.match(/<th[^>]*aria-current="date"/g)).toHaveLength(1);
    expect(html).toContain('Away today (2):</span> Ana, Cia');
    expect(html).toContain('aria-label="18 November (today): 2 people away"');

    const later = render({ entries: [away] });
    expect(later).not.toContain('aria-current="date"');
    expect(later).not.toContain('Away today');
});

it('gives phones a month grid that counts who is away and lists them for the chosen day', () => {
    const ben = { ...pending, id: 'ben', employee_id: 'ben', employee_name: 'Ben', status: 'approved' as const,
        start_date: '2026-11-02', end_date: '2026-11-03' };
    const html = render({ entries: [pending, ben] });
    const phone = html.match(/<div class="p-3 md:hidden">(.*?)<\/div><div class="hidden max-h/)?.[1] || '';
    expect(phone).toContain('aria-label="1 November: 1 person away"');
    expect(phone).toContain('aria-label="2 November: 2 people away"');
    expect(phone).toContain('aria-label="3 November: 1 person away"');
    expect(phone).toContain('aria-label="4 November: nobody away"');
    // 1 November 2026 is a Sunday, so six blank cells lead the Monday-first grid.
    expect(phone.match(/<div aria-hidden="true"><\/div>/g)?.length).toBe(6);
    expect(phone).toContain('aria-pressed="true" aria-label="1 November');
    expect(phone).toMatch(/<h4[^>]*>1 November<\/h4>/);
    expect(phone).toContain('Awaiting approval');
});

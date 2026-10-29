import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { HolidayCalendars, HolidayEditor, HolidayRowsField } from './HolidayCalendars';
import type { HolidayCalendar } from './holidayYears';

vi.mock('../../components/Ui', async () => {
    const original = await vi.importActual<typeof import('../../components/Ui')>('../../components/Ui');
    // The portal modal manages browser focus; the dialog's fields are tested here.
    return { ...original, Modal: ({ title, children }: { title: ReactNode; children: ReactNode }) => <section><h2>{title}</h2>{children}</section> };
});

const noop = () => {};
const today = '2026-10-29';
const first: HolidayCalendar = {
    id: 'v1', label: 'Public holidays 2026', effective_from: '2026-01-01', effective_to: '2026-12-31', supersedes_id: null,
    holidays: [{ date: '2026-10-26', name: 'Old holiday name' }], source_reference: 'Gazette No. 1 of 2026',
    recorded_at: '2026-01-05T01:00:00Z', reason: 'Saved the public holidays for 2026 (1 holiday).',
};
const y2026: HolidayCalendar = {
    ...first, id: 'v2', supersedes_id: 'v1', source_reference: 'Gazette No. 45 of 2026', recorded_at: '2026-03-02T01:00:00Z',
    reason: 'Updated the public holidays for 2026: 1 added, 1 renamed.',
    holidays: [{ date: '2026-12-25', name: 'Christmas Day' }, { date: '2026-10-26', name: 'National Youth Day' }],
};
const y2027: HolidayCalendar = {
    id: 'n1', label: 'Public holidays 2027', effective_from: '2027-01-01', effective_to: '2027-12-31', supersedes_id: null,
    holidays: [{ date: '2027-01-31', name: 'Independence Day' }], source_reference: 'Gazette No. 50 of 2026', recorded_at: '2026-09-01T01:00:00Z',
};
const details = (html: string) => html.slice(html.indexOf('<details'), html.indexOf('</details>'));

describe('holiday page', () => {
    const html = renderToStaticMarkup(<HolidayCalendars calendars={[y2026, first, y2027]} today={today} onSaved={noop} />);

    it('shows one list of every year, in date order, with one edit button', () => {
        expect(html).toContain('Covers 2026 to 2027 · 3 holidays');
        expect(html).toMatch(/<h5[^>]*>2026<\/h5>.*National Youth Day.*Christmas Day.*<h5[^>]*>2027<\/h5>.*Independence Day/);
        expect(html).toContain('Mon 26/10/2026');
        expect(html).toContain('>Edit holidays</button>');
        expect(html.match(/<button/g)).toHaveLength(1);
        expect(html).toContain('Sources: 2026: Gazette No. 45 of 2026 · 2027: Gazette No. 50 of 2026');
        for (const word of ['Approve', 'Replace', 'Effective', 'Add a year']) expect(html).not.toContain(word);
    });

    it('keeps replaced lists under a closed history toggle', () => {
        expect(html).toContain('History (1 earlier version)');
        expect(html).not.toContain('<details open');
        expect(details(html)).toContain('Old holiday name');
        expect(details(html)).toContain('Gazette No. 1 of 2026');
        expect(details(html)).toContain('Saved the public holidays for 2026 (1 holiday).');
        expect(html.replace(details(html), '')).not.toContain('Old holiday name');
    });

    it('starts with Add holidays when nothing is entered', () => {
        const empty = renderToStaticMarkup(<HolidayCalendars calendars={[]} today={today} onSaved={noop} />);
        expect(empty).toContain('>Add holidays</button>');
        expect(empty).toContain('No public holidays have been entered yet.');
    });
});

describe('holiday editor', () => {
    it('edits every year as rows, keeping the latest source and asking for no dates or reason', () => {
        const html = renderToStaticMarkup(<HolidayEditor calendars={[y2026, first, y2027]} today={today} onClose={noop} onSaved={noop} />);
        expect(html).toContain('<h2>Public holidays</h2>');
        expect(html.match(/aria-label="Date of holiday \d+"/g)).toHaveLength(3);
        expect(html.indexOf('value="26/10/2026"')).toBeLessThan(html.indexOf('value="25/12/2026"'));
        expect(html.indexOf('value="25/12/2026"')).toBeLessThan(html.indexOf('value="31/01/2027"'));
        expect(html).not.toContain('Old holiday name');
        expect(html).toContain('value="Gazette No. 50 of 2026"');
        expect(html).toContain('adds that whole year, so enter all of its holidays');
        expect(html).toContain("Copy 2027&#x27;s holidays into 2028");
        expect(html).toContain('>Save holidays</button>');
        expect(html).toContain('Add a note (optional)');
        expect(html).not.toContain('name="reason"');
        expect(html).not.toContain('Effective');
    });

    it('starts an empty list with one blank row and a blank source', () => {
        const html = renderToStaticMarkup(<HolidayEditor calendars={[]} today={today} onClose={noop} onSaved={noop} />);
        expect(html.match(/aria-label="Date of holiday \d+"/g)).toHaveLength(1);
        expect(html).toMatch(/name="source_reference"[^>]*value=""/);
        expect(html).not.toContain('Copy ');
    });
});

describe('holiday rows', () => {
    const rows = [
        { key: 'a', date: '2027-01-01', name: "New Year's Day" },
        { key: 'b', date: '', name: 'Angam Day' },
    ];

    it('shows a problem under the row that has it and marks only that row', () => {
        const html = renderToStaticMarkup(<HolidayRowsField rows={rows} errors={{ b: 'Enter the date as DD/MM/YYYY.' }} onChange={noop} onRemove={noop} onAdd={noop} />);
        const second = html.slice(html.indexOf('aria-label="Date of holiday 2"'));
        expect(second).toMatch(/aria-invalid="true"[^>]*aria-describedby="holiday-b-error"|aria-describedby="holiday-b-error"[^>]*aria-invalid="true"/);
        expect(html).toContain('<p id="holiday-b-error" class="text-sm text-red-700">Enter the date as DD/MM/YYYY.</p>');
        expect(html.slice(0, html.indexOf('aria-label="Date of holiday 2"'))).not.toContain('aria-invalid');
    });

    it('names each remove button after its holiday and offers to add another', () => {
        const html = renderToStaticMarkup(<HolidayRowsField rows={rows} errors={{}} onChange={noop} onRemove={noop} onAdd={noop} />);
        expect(html).toContain('aria-label="Remove New Year&#x27;s Day"');
        expect(html).toContain('aria-label="Remove Angam Day"');
        expect(html).toContain('Add holiday</button>');
        expect(html).not.toContain('aria-invalid');
    });
});

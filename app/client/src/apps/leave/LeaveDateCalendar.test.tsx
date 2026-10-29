import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeaveDateCalendar } from './LeaveDateCalendar';

afterEach(() => { vi.useRealTimers(); });

// Fri 6 to Mon 9 November 2026, with today Wednesday 4 November and a holiday on Tuesday 10.
function render(blockWeekends = true) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 9));
    return renderToStaticMarkup(<LeaveDateCalendar start="2026-11-06" end="2026-11-09"
        holidays={new Map([['2026-11-10', 'Example holiday']])} blockWeekends={blockWeekends} onPick={() => {}} />);
}
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}[^"]*"[^>]*>`))?.[0] ?? '';

it('names the weekdays Monday first and shows the month of the start date', () => {
    const html = render();
    expect(html).toContain('November 2026');
    expect(html.indexOf('>Mon<')).toBeLessThan(html.indexOf('>Sun<'));
});

it('blocks weekend days, but shades them inside a chosen Friday-to-Monday range', () => {
    const html = render();
    const saturday = button(html, 'Saturday 07/11/2026');
    expect(saturday).toContain('disabled=""');
    expect(saturday).toContain('aria-pressed="true"');
    expect(button(html, 'Friday 06/11/2026')).not.toContain('disabled=""');
    expect(button(render(false), 'Saturday 07/11/2026')).not.toContain('disabled=""');
});

it('outlines today and names public holidays', () => {
    const html = render();
    expect(button(html, 'Wednesday 04/11/2026, today')).toContain('aria-current="date"');
    expect(button(html, 'Tuesday 10/11/2026, Example holiday')).toContain('title="Example holiday"');
    expect(html).toContain('Tue 10/11/2026</span> · Example holiday');
});

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ParentalEntitlements } from './ParentalEntitlements';
import type { ParentalEntitlementSummary } from './ParentalEntitlements';

const summary: ParentalEntitlementSummary = { as_of: '2026-11-16', status: 'conditional', reason: 'Eligibility and evidence are confirmed for each qualifying event.', six_month_service_date: '2020-07-01', items: [
    { code: 'paternity', calendar_days: 14, maximum: false, event: 'Per eligible birth or adoption', conditions: 'Parenthood and supporting evidence are checked.' },
    { code: 'maternity', calendar_days: 84, maximum: false, event: 'Per eligible pregnancy', conditions: 'Pregnancy details and evidence are checked.' },
    { code: 'adoption', calendar_days: 84, maximum: true, event: 'Per eligible adoption', conditions: 'Age and relationship are checked.' },
] };

it('shows each parental allowance per event without presenting an accrued or remaining balance', () => {
    const html = renderToStaticMarkup(<ParentalEntitlements summary={summary} />);
    for (const text of ['Paternity leave', 'Maternity leave', 'Adoption leave', '14', '84', 'Up to', 'calendar days', 'Per eligible birth or adoption', 'do not accrue', 'opening balance', 'Eligibility checked per event', '01/07/2020']) expect(html).toContain(text);
    expect(html).not.toContain('days available');expect(html).not.toContain('remaining balance');
});
it('labels missing service and excluded appointments explicitly', () => {
    const html = renderToStaticMarkup(<ParentalEntitlements summary={{ ...summary, status: 'review_required', reason: 'Review the appointment record.', six_month_service_date: null }} />);
    expect(html).toContain('Eligibility needs review');expect(html).toContain('not determined');expect(html).toContain('Review the appointment record.');
    expect(renderToStaticMarkup(<ParentalEntitlements summary={{ ...summary, status: 'unavailable' }} />)).toContain('Unavailable under the current appointment');
});

import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AmendmentFields } from './GovernmentCases';
const request = { start_date: '2026-11-02', end_date: '2026-11-06', amendment: { request_id: 'earlier', action: 'shorten_grant', effective_end: '2026-11-04' } };
it('offers cancellation explicitly and retains the effective dates after a previous shortening', () => {
 const html=renderToStaticMarkup(<AmendmentFields request={request} action="cancel_grant" onActionChange={()=>{}}/>);
 expect(html).toContain('Cancel approved leave and restore balance');
 expect(html).toContain('name="amendment_action"');
 expect(html).toContain('2026-11-04');
 expect(html).not.toContain('2026-11-06');
 expect(html).toContain('does not yet change the balance');
});
it('asks for the last leave date when shortening', () => {
 const html=renderToStaticMarkup(<AmendmentFields request={request} action="shorten_grant" onActionChange={()=>{}}/>);
 expect(html).toContain('Last date of leave taken');
 expect(html).toContain('earlier than the currently approved end date');
});

import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CalendarRequirement} from './GovernmentCalendarSetting';

it('calendar enforcement is an optional checkbox with clear schedule treatment',()=>{
 const html=renderToStaticMarkup(<CalendarRequirement checked={false} disabled={false} onChange={()=>{}}/>);
 const input=html.match(/<input[^>]*>/)?.[0];
 expect(input).toContain('type="checkbox"');expect(input).not.toContain('checked');expect(input).not.toContain('required');
 expect(html).toContain('dates without a calendar');expect(html).toContain('Holidays in entered calendars still apply');
});
it('an administrator choice is visibly checked and can be disabled while saving',()=>{
 const html=renderToStaticMarkup(<CalendarRequirement checked disabled onChange={()=>{}}/>);
 const input=html.match(/<input[^>]*>/)?.[0];expect(input).toContain('checked');expect(input).toContain('disabled');
});

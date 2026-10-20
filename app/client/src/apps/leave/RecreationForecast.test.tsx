import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {RecreationForecastSummary} from './RecreationForecast';

it('distinguishes projected accrual, date-specific availability and credit used',()=>{
 const html=renderToStaticMarkup(<RecreationForecastSummary forecast={{through_date:'2026-11-11',projected_accrual:'2.307692',available:'2.307692',forecast_used:'2'}} submitted/>);
 expect(html).toContain('11/11/2026');expect(html).toContain('at submission');expect(html).toContain('Projected accrual:');expect(html).toContain('Available for these dates:');expect(html).toContain('This application uses 2 days of projected accrual');expect(html).toContain('posted on their scheduled dates');
});

import { formatDate } from '../../lib/date';
import { leaveDays } from './leaveBalances';

export type RecreationForecast = { through_date: string; projected_accrual: string; available: string; forecast_used: string };

export function RecreationForecastSummary({ forecast, submitted = false }: { forecast: RecreationForecast; submitted?: boolean }) {
    return <div className="space-y-1 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
        <p className="font-semibold">Recreation forecast through {formatDate(forecast.through_date)}{submitted ? ' · at submission' : ''}</p>
        <p>Projected accrual: {leaveDays(forecast.projected_accrual)} days. Available for these dates: {leaveDays(forecast.available)} days, allowing for existing applications.</p>
        {Number(forecast.forecast_used) > 0 && <p>This application uses {leaveDays(forecast.forecast_used)} days of projected accrual.</p>}
        <p className="text-gray-600">Credits follow the approved payroll schedule and are posted on their scheduled dates.</p>
    </div>;
}

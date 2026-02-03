import type { AbaControl } from '../../lib/abaParser';
import { formatMoney } from '../../lib/utils';

interface ReaderControlProps {
    control: AbaControl;
}

export function ReaderControl({ control }: ReaderControlProps) {
    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
            <h3 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wider">Control Record</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                    <div className="text-xs text-gray-500">Net Total</div>
                    <div className="font-medium text-gray-900">{formatMoney(control.net)}</div>
                </div>
                <div>
                    <div className="text-xs text-gray-500">Credit Total</div>
                    <div className="font-medium text-green-600">{formatMoney(control.credits)}</div>
                </div>
                <div>
                    <div className="text-xs text-gray-500">Debit Total</div>
                    <div className="font-medium text-red-600">{formatMoney(control.debits)}</div>
                </div>
                <div>
                    <div className="text-xs text-gray-500">Record Count</div>
                    <div className="font-medium text-gray-900">{control.count}</div>
                </div>
            </div>
        </div>
    );
}

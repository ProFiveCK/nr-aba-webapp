import type { AbaHeader } from '../../lib/abaParser';
import { formatMoney } from '../../lib/utils';

interface ReaderHeaderProps {
    header: AbaHeader;
    balancing?: {
        bsb: string;
        account: string;
        amount: number;
        title: string;
    } | null;
}

export function ReaderHeader({ header, balancing }: ReaderHeaderProps) {
    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
            <h3 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wider">Header Record</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
                <div>
                    <div className="text-xs text-gray-500">Financial Institution</div>
                    <div className="font-medium text-gray-900">{header.fi}</div>
                </div>
                <div className="col-span-2">
                    <div className="text-xs text-gray-500">User Name</div>
                    <div className="font-medium text-gray-900">{header.user}</div>
                </div>
                <div>
                    <div className="text-xs text-gray-500">APCA ID</div>
                    <div className="font-medium text-gray-900">{header.apca}</div>
                </div>
                <div>
                    <div className="text-xs text-gray-500">Description</div>
                    <div className="font-medium text-gray-900">{header.desc}</div>
                </div>
                <div>
                    <div className="text-xs text-gray-500">Process Date</div>
                    <div className="font-medium text-gray-900">{header.proc}</div>
                </div>
            </div>

            {balancing && (
                <div className="border-t border-gray-100 pt-4">
                    <h4 className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Balancing Account (Charged)</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 p-3 rounded-md">
                        <div>
                            <div className="text-xs text-gray-500">Account Name</div>
                            <div className="font-medium text-gray-900">{balancing.title}</div>
                        </div>
                        <div>
                            <div className="text-xs text-gray-500">BSB</div>
                            <div className="font-medium text-gray-900 font-mono">{balancing.bsb}</div>
                        </div>
                        <div>
                            <div className="text-xs text-gray-500">Account Number</div>
                            <div className="font-medium text-gray-900 font-mono">{balancing.account}</div>
                        </div>
                        <div>
                            <div className="text-xs text-gray-500">Amount</div>
                            <div className="font-medium text-gray-900 font-mono">{formatMoney(balancing.amount)}</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

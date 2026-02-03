import type { AbaTransaction } from '../../lib/abaParser';

interface ReaderTableProps {
    transactions: AbaTransaction[];
}

export function ReaderTable({ transactions }: ReaderTableProps) {
    if (transactions.length === 0) {
        return (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-gray-500">
                No transactions found.
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Line</th>
                            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">BSB</th>
                            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Account</th>
                            <th scope="col" className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
                            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reference</th>
                            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trace BSB</th>
                            <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trace Acct</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {transactions.map((tx, idx) => (
                            <tr key={idx} className={`hover:bg-gray-50 ${tx.isDuplicate ? 'bg-yellow-50' : ''}`}>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 border-r border-gray-100">
                                    {tx.line}
                                    {tx.isDuplicate && (
                                        <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                                            dup
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 border-r border-gray-100 font-mono">{tx.bsb}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 border-r border-gray-100 font-mono">{tx.account}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 border-r border-gray-100 text-right font-mono">{tx.amount}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 border-r border-gray-100">{tx.accountTitle}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 border-r border-gray-100">{tx.lodgementRef}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 border-r border-gray-100 text-center">{tx.txnCode}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 border-r border-gray-100 font-mono">{tx.trace_bsb}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 font-mono">{tx.trace_acct}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

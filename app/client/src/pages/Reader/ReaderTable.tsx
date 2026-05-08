import type { AbaTransaction } from '../../lib/abaParser';
import { EmptyState } from '../../components/Ui';

interface ReaderTableProps {
    transactions: AbaTransaction[];
}

export function ReaderTable({ transactions }: ReaderTableProps) {
    if (transactions.length === 0) {
        return (
            <div className="data-table-wrap">
                <EmptyState title="No transactions found." detail="Upload or paste an ABA file to inspect records." />
            </div>
        );
    }

    return (
        <div className="data-table-wrap">
            <div className="data-table-scroll">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th scope="col">Line</th>
                            <th scope="col">BSB</th>
                            <th scope="col">Account</th>
                            <th scope="col" className="text-right">Amount</th>
                            <th scope="col">Title</th>
                            <th scope="col">Reference</th>
                            <th scope="col">Code</th>
                            <th scope="col">Trace BSB</th>
                            <th scope="col">Trace Acct</th>
                        </tr>
                    </thead>
                    <tbody>
                        {transactions.map((tx, idx) => (
                            <tr key={idx} className={`hover:bg-gray-50 ${tx.isDuplicate ? 'bg-yellow-50' : ''}`}>
                                <td className="text-gray-500">
                                    {tx.line}
                                    {tx.isDuplicate && (
                                        <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                                            dup
                                        </span>
                                    )}
                                </td>
                                <td className="font-mono text-gray-900">{tx.bsb}</td>
                                <td className="font-mono text-gray-900">{tx.account}</td>
                                <td className="text-right font-mono text-gray-900">{tx.amount}</td>
                                <td className="text-gray-900">{tx.accountTitle}</td>
                                <td className="text-gray-900">{tx.lodgementRef}</td>
                                <td className="text-center text-gray-500">{tx.txnCode}</td>
                                <td className="font-mono text-gray-500">{tx.trace_bsb}</td>
                                <td className="font-mono text-gray-500">{tx.trace_acct}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

import { useState, useRef, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import { parseAba } from '../lib/abaParser';
import type { ParsedAbaResult } from '../lib/abaParser';
import { ReaderHeader } from './Reader/ReaderHeader';
import { ReaderControl } from './Reader/ReaderControl';
import { ReaderTable } from './Reader/ReaderTable';
import { fromBase64 } from '../lib/utils';

interface ReaderProps {
    onTabChange: (tab: string) => void;
}

export function Reader({ onTabChange }: ReaderProps) {
    const [parsedData, setParsedData] = useState<ParsedAbaResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Allow other tabs to hand off ABA content via localStorage
    useEffect(() => {
        const stored = localStorage.getItem('aba_reader_import');
        if (!stored) return;
        localStorage.removeItem('aba_reader_import');
        try {
            const text = fromBase64(stored);
            const result = parseAba(text);
            setParsedData(result);
            setError(null);
        } catch {
            setError('Failed to load shared ABA file.');
            setParsedData(null);
        }
    }, []);

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const text = ev.target?.result as string;
                const result = parseAba(text);
                setParsedData(result);
                setError(null);
            } catch (err) {
                console.error('Failed to parse ABA file:', err);
                setError('Failed to parse ABA file. Please ensure it is a valid ABA format.');
                setParsedData(null);
            }
        };
        reader.onerror = () => {
            setError('Failed to read file.');
        };
        reader.readAsText(file);
    };

    const handleClear = () => {
        setParsedData(null);
        setError(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleLoadIntoGenerator = () => {
        if (!parsedData) return;

        // Filter for credit transactions only (standard ABA generator behavior)
        const creditTransactions = parsedData.transactions
            .filter(t => ['50', '51', '52', '53', '54', '55', '56', '57'].includes(t.txnCode))
            .map(t => ({
                bsb: t.bsb,
                account: t.account,
                amount: t.cents / 100, // Convert cents to dollars
                accountTitle: t.accountTitle,
                lodgementRef: t.lodgementRef,
                txnCode: '53', // Default to 53 (Pay)
                withholdingCents: 0
            }));

        if (creditTransactions.length === 0) {
            alert('No credit transactions found to load.');
            return;
        }

        // Save to localStorage for Generator to pick up
        localStorage.setItem('aba_generator_import', JSON.stringify(creditTransactions));

        // Switch to Generator tab immediately
        onTabChange('generator');
    };

    return (
        <div className="space-y-6">
            <section className="rounded-2xl bg-white p-6 shadow space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">ABA Reader</h1>
                        <p className="text-sm text-gray-600">Inspect and validate ABA files before handing them off.</p>
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept=".aba,.txt"
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium shadow-sm transition-colors"
                        >
                            Open ABA File
                        </button>
                        {parsedData && (
                            <>
                                <button
                                    onClick={handleLoadIntoGenerator}
                                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium shadow-sm transition-colors"
                                >
                                    Load into Generator
                                </button>
                                <button
                                    onClick={handleClear}
                                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium shadow-sm transition-colors"
                                >
                                    Clear
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
                )}

                {!parsedData && !error && (
                    <div className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
                        <div className="mx-auto mb-4 h-12 w-12 text-gray-400">
                            <svg className="h-full w-full" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-medium text-gray-900">No file loaded</h3>
                        <p className="mt-1 text-gray-500">Upload an ABA file to view its contents.</p>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="mt-4 text-indigo-600 hover:text-indigo-500 font-medium"
                        >
                            Select a file
                        </button>
                    </div>
                )}
            </section>

            {parsedData && (
                <section className="rounded-2xl bg-white p-6 shadow space-y-6">
                    {parsedData.errors.length > 0 && (
                        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                            <h4 className="text-sm font-medium text-yellow-800 mb-2">Validation Issues</h4>
                            <ul className="list-disc list-inside text-sm text-yellow-700">
                                {parsedData.errors.map((err, idx) => (
                                    <li key={idx}>{err}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {parsedData.duplicates.sets > 0 && (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex items-center gap-2 text-blue-700">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-sm font-medium">
                                Found {parsedData.duplicates.sets} duplicate sets affecting {parsedData.duplicates.rows} rows.
                            </span>
                        </div>
                    )}

                    {parsedData.header && <ReaderHeader header={parsedData.header} balancing={parsedData.balancing} />}
                    {parsedData.control && <ReaderControl control={parsedData.control} />}
                    <ReaderTable transactions={parsedData.transactions} />
                </section>
            )}
        </div>
    );

}

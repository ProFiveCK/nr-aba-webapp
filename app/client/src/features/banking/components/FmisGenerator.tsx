import { useRef, useState, type ChangeEvent } from 'react';
import { readStatementText } from '../converters/csvUtils';
import type { FmisBuildResult } from '../converters/wbcFjConverter';

interface FmisGeneratorProps {
    title: string;
    description: string;
    accept: string;
    selectButtonLabel: string;
    generateButtonLabel: string;
    emptyErrorMessage: string;
    generateErrorPrefix: string;
    downloadBaseName: string;
    convert: (rawText: string) => FmisBuildResult;
    formatSummary: (result: FmisBuildResult) => string;
}

export function FmisGenerator({
    title,
    description,
    accept,
    selectButtonLabel,
    generateButtonLabel,
    emptyErrorMessage,
    generateErrorPrefix,
    downloadBaseName,
    convert,
    formatSummary,
}: FmisGeneratorProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [rawText, setRawText] = useState('');
    const [fileName, setFileName] = useState('');
    const [error, setError] = useState('');
    const [summary, setSummary] = useState('');
    const [output, setOutput] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    const handleSelect = () => inputRef.current?.click();

    const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const text = await readStatementText(file);
            setRawText(text);
            setFileName(file.name);
            setError('');
            setSummary('');
            setOutput('');
        } catch (err) {
            setError((err as Error)?.message || 'Failed to read file.');
            setRawText('');
            setFileName(file.name);
            setSummary('');
            setOutput('');
        }

        event.target.value = '';
    };

    const handleGenerate = () => {
        setError('');
        setSummary('');
        setIsGenerating(true);
        try {
            if (!rawText.trim()) throw new Error(emptyErrorMessage);
            const result = convert(rawText);
            setOutput(result.content);
            setSummary(formatSummary(result));
        } catch (err) {
            setOutput('');
            setError((err as Error)?.message || generateErrorPrefix);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDownload = () => {
        if (!output.trim()) return;
        const blob = new Blob([output], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const base = fileName.replace(/\.[^.]+$/, '') || downloadBaseName;
        link.href = url;
        link.download = `${base}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleCopy = async () => {
        if (!output.trim() || !navigator?.clipboard?.writeText) return;
        await navigator.clipboard.writeText(output);
        setSummary((prev) => (prev ? `${prev} • Output copied to clipboard` : 'Output copied to clipboard'));
        setTimeout(() => setSummary((prev) => prev?.replace(/ • Output copied to clipboard$/, '') || ''), 2500);
    };

    const handleClear = () => {
        setRawText('');
        setFileName('');
        setError('');
        setSummary('');
        setOutput('');
    };

    return (
        <section className="rounded-2xl bg-white p-6 shadow space-y-6">
            <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
                <p className="text-sm text-gray-600">{description}</p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleFileChange} />
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={handleSelect}
                        className="rounded-md bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
                    >
                        {selectButtonLabel}
                    </button>
                    <span className="text-xs text-gray-500">{fileName || 'No file selected.'}</span>
                </div>
                {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </div>

            <textarea
                value={output}
                readOnly
                rows={12}
                className="w-full rounded-xl border border-gray-200 bg-white font-mono text-xs text-gray-800 shadow-inner"
                placeholder="Generated FMIS statement output will appear here"
            />
            {summary && <p className="text-sm text-gray-600">{summary}</p>}

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="rounded-full bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-60"
                >
                    {isGenerating ? 'Generating…' : generateButtonLabel}
                </button>
                <button
                    type="button"
                    onClick={handleDownload}
                    disabled={!output}
                    className="rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-60"
                >
                    Download TXT
                </button>
                <button
                    type="button"
                    onClick={handleCopy}
                    disabled={!output}
                    className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                    Copy output
                </button>
                <button
                    type="button"
                    onClick={handleClear}
                    className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                    Clear
                </button>
            </div>
        </section>
    );
}

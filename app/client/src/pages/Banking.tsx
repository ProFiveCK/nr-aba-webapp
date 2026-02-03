import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface StatementEntry {
    rowNumber: number;
    date: Date;
    description: string;
    currency: string;
    signedCents: number;
    amountCents: number;
    isCredit: boolean;
}

interface ParsedStatement {
    entries: StatementEntry[];
    earliestDate: Date | null;
    latestDate: Date | null;
    currencies: string[];
    skippedRows: number;
    rowCount: number;
}

interface BaiMetadata {
    senderId: string;
    receiverId: string;
    fileId: string;
    groupStatus: string;
    accountNumber: string;
    currency: string;
    creditCode: string;
    debitCode: string;
    summaryCode: string;
    detailFundsType: string;
    asOfDate: Date;
    asOfDateModifier: string;
}

interface BaiBuildResult {
    content: string;
    creditTotalCents: number;
    debitTotalCents: number;
    netTotalCents: number;
    transactionCount: number;
    fileRecordCount: number;
}

interface BaiRecord {
    lineNumber: number;
    raw: string;
    fields: string[];
    type: string;
    hasTerminator: boolean;
    sanitizedRaw: string;
}

interface BaiIssue {
    message: string;
    lines?: number[];
}

interface BaiGroupState {
    startLine: number;
    netCents: number;
    transactions: number;
}

interface BaiAccountState {
    line: number;
    id: string;
    transactions: number;
}

const DEFAULT_METADATA = {
    senderId: 'CBA',
    receiverId: 'BANK',
    fileId: '1',
    groupStatus: '1',
    accountNumber: '',
    currency: 'AUD',
    creditCode: '399',
    debitCode: '699',
    summaryCode: '015',
    detailFundsType: '',
};

const PREVIEW_LIMIT = 250;

const TOOL_TABS = [
    { id: 'generator', label: 'BAI2 Generator' },
    { id: 'validator', label: 'BAI2 Validator' },
] as const;

export function Banking() {
    const { user } = useAuth();
    const [metadata, setMetadata] = useState(DEFAULT_METADATA);
    const [csvFileName, setCsvFileName] = useState('');
    const [csvRaw, setCsvRaw] = useState('');
    const [generatorError, setGeneratorError] = useState('');
    const [generatorSummary, setGeneratorSummary] = useState('');
    const [baiOutput, setBaiOutput] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    const [checkRaw, setCheckRaw] = useState('');
    const [checkFileName, setCheckFileName] = useState('');
    const [checkInput, setCheckInput] = useState('');
    const [checkSummary, setCheckSummary] = useState<string[]>([]);
    const [checkIssues, setCheckIssues] = useState<BaiIssue[]>([]);
    const [checkRecords, setCheckRecords] = useState<BaiRecord[]>([]);
    const [checkError, setCheckError] = useState('');
    const [sanitizedOutput, setSanitizedOutput] = useState('');
    const [checkMessage, setCheckMessage] = useState('');
    const [isChecking, setIsChecking] = useState(false);

    const csvInputRef = useRef<HTMLInputElement>(null);
    const baiInputRef = useRef<HTMLInputElement>(null);

    const issueLineSet = useMemo(() => {
        const set = new Set<number>();
        checkIssues.forEach((issue) => issue.lines?.forEach((line) => Number.isFinite(line) && set.add(line)));
        return set;
    }, [checkIssues]);

    if (!user || (user.role !== 'banking' && user.role !== 'reviewer' && user.role !== 'admin')) {
        return (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
                <h2 className="text-xl font-semibold">Banking access required</h2>
                <p className="mt-2 text-sm text-amber-800">Sign in with a banking, reviewer, or admin account to use these tools.</p>
            </div>
        );
    }

    const handleMetaChange = (field: keyof typeof metadata) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setMetadata((prev) => ({ ...prev, [field]: event.target.value }));
    };

    const handleSelectCsv = () => csvInputRef.current?.click();

    const handleCsvChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        readFile(file)
            .then((text) => {
                setCsvRaw(text);
                setCsvFileName(file.name);
                setGeneratorError('');
                setBaiOutput('');
                setGeneratorSummary('');
            })
            .catch(() => setGeneratorError('Failed to read CSV file.'))
            .finally(() => {
                event.target.value = '';
            });
    };

    const handleGenerate = () => {
        setGeneratorError('');
        setGeneratorSummary('');
        setIsGenerating(true);
        try {
            if (!csvRaw.trim()) throw new Error('Select a CSV file before generating the BAI2 output.');
            const missing = ['senderId', 'receiverId', 'accountNumber', 'currency', 'creditCode', 'debitCode'].filter(
                (field) => !metadata[field as keyof typeof metadata].trim()
            );
            if (missing.length) throw new Error(`Please fill in: ${missing.join(', ')}.`);
            const parsed = parseStatementCsv(csvRaw);
            const meta: BaiMetadata = {
                senderId: metadata.senderId.trim(),
                receiverId: metadata.receiverId.trim(),
                fileId: metadata.fileId.trim() || '1',
                groupStatus: metadata.groupStatus.trim() || '1',
                accountNumber: metadata.accountNumber.trim(),
                currency: metadata.currency.trim().toUpperCase() || 'AUD',
                creditCode: metadata.creditCode.trim() || '399',
                debitCode: metadata.debitCode.trim() || '699',
                summaryCode: metadata.summaryCode.trim() || '015',
                detailFundsType: metadata.detailFundsType.trim(),
                asOfDate: parsed.latestDate || parsed.earliestDate || new Date(),
                asOfDateModifier: '2',
            };
            const result = buildBaiFile(parsed, meta);
            setBaiOutput(result.content);
            const creditSummary = formatCurrencyFromCents(result.creditTotalCents, meta.currency);
            const debitSummary = formatCurrencyFromCents(result.debitTotalCents, meta.currency);
            const netSummary = formatCurrencyFromCents(result.netTotalCents, meta.currency);
            const pieces = [
                `${result.transactionCount} transactions`,
                `Credits ${creditSummary}`,
                `Debits ${debitSummary}`,
                `Net ${netSummary}`,
                `${result.fileRecordCount} file records`,
            ];
            if (parsed.currencies.length && (parsed.currencies.length > 1 || parsed.currencies[0] !== meta.currency)) {
                pieces.push(`Currencies found: ${parsed.currencies.join(', ')}`);
            }
            if (parsed.skippedRows) pieces.push(`${parsed.skippedRows} rows skipped`);
            setGeneratorSummary(pieces.join(' • '));
        } catch (err) {
            setBaiOutput('');
            setGeneratorError((err as Error)?.message || 'Unable to generate BAI2 output.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDownloadBai = () => {
        if (!baiOutput.trim()) return;
        const blob = new Blob([baiOutput], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const base = csvFileName.replace(/\.csv$/i, '') || 'statement';
        link.href = url;
        link.download = `${base}.bai`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleCopyBai = async () => {
        if (!baiOutput.trim() || !navigator?.clipboard?.writeText) return;
        await navigator.clipboard.writeText(baiOutput);
        setGeneratorSummary((prev) => (prev ? `${prev} • Output copied to clipboard` : 'Output copied to clipboard'));
        setTimeout(() => setGeneratorSummary((prev) => prev?.replace(/ • Output copied to clipboard$/, '') || ''), 2500);
    };

    const handleClearGenerator = () => {
        setCsvRaw('');
        setCsvFileName('');
        setBaiOutput('');
        setGeneratorSummary('');
        setGeneratorError('');
    };

    const handleSelectBai = () => baiInputRef.current?.click();

    const handleBaiFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        readFile(file)
            .then((text) => {
                setCheckRaw(text);
                setCheckFileName(file.name);
                setCheckInput(text);
                resetCheckState();
            })
            .catch(() => setCheckError('Failed to read BAI2 file.'))
            .finally(() => {
                event.target.value = '';
            });
    };

    const handleRunCheck = () => {
        setCheckError('');
        setCheckMessage('');
        setIsChecking(true);
        try {
            const source = checkInput.trim() || checkRaw.trim();
            if (!source) throw new Error('Select a BAI2 file or paste its contents before running checks.');
            const analysis = analyzeBaiContent(source);
            const summaryLines = analysis.summary ? [...analysis.summary] : [];
            if (checkFileName) summaryLines.unshift(`File: ${checkFileName}`);
            setCheckSummary(summaryLines);
            setCheckIssues(analysis.issues);
            setCheckRecords(analysis.records);
            const sanitized = sanitizeBaiRecords(analysis.records);
            setSanitizedOutput(sanitized);
            if (sanitized) {
                setCheckMessage(
                    analysis.issues.length
                        ? 'Sanitized output prepared. Review remaining issues before resubmitting.'
                        : 'Sanitized output prepared.'
                );
            } else {
                setCheckMessage('');
            }
        } catch (err) {
            setCheckError((err as Error)?.message || 'Unable to analyse BAI2 content.');
            setCheckSummary([]);
            setCheckIssues([]);
            setCheckRecords([]);
            setSanitizedOutput('');
            setCheckMessage('');
        } finally {
            setIsChecking(false);
        }
    };

    const handleCopySanitized = async () => {
        if (!sanitizedOutput.trim() || !navigator?.clipboard?.writeText) return;
        await navigator.clipboard.writeText(sanitizedOutput.endsWith('\n') ? sanitizedOutput : `${sanitizedOutput}\n`);
        setCheckMessage('Sanitized output copied to clipboard.');
    };

    const handleDownloadSanitized = () => {
        if (!sanitizedOutput.trim()) return;
        const content = sanitizedOutput.endsWith('\n') ? sanitizedOutput : `${sanitizedOutput}\n`;
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const base = checkFileName.replace(/\.(bai|txt)$/i, '') || 'bai2';
        link.href = url;
        link.download = `${base}-sanitized.bai`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleClearCheck = () => {
        setCheckRaw('');
        setCheckInput('');
        setCheckFileName('');
        resetCheckState();
    };

    const resetCheckState = () => {
        setCheckSummary([]);
        setCheckIssues([]);
        setCheckRecords([]);
        setSanitizedOutput('');
        setCheckMessage('');
        setCheckError('');
    };

    const previewRecords = useMemo(() => checkRecords.slice(0, PREVIEW_LIMIT), [checkRecords]);
    const [activeTool, setActiveTool] = useState<typeof TOOL_TABS[number]['id']>('generator');

    const renderGenerator = () => (
        <section className="rounded-2xl bg-white p-6 shadow space-y-6">
            <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold text-gray-900">BAI2 Generator</h2>
                <p className="text-sm text-gray-600">
                    Upload a treasury transaction CSV, confirm the header metadata, and download a compliant BAI2 file ready for the banking portal.
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-gray-700">
                    Sender ID
                    <input
                        type="text"
                        value={metadata.senderId}
                        onChange={handleMetaChange('senderId')}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
                <label className="text-sm font-medium text-gray-700">
                    Receiver ID
                    <input
                        type="text"
                        value={metadata.receiverId}
                        onChange={handleMetaChange('receiverId')}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
                <label className="text-sm font-medium text-gray-700">
                    File ID
                    <input
                        type="number"
                        min={1}
                        value={metadata.fileId}
                        onChange={handleMetaChange('fileId')}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
                <label className="text-sm font-medium text-gray-700">
                    Group status
                    <select
                        value={metadata.groupStatus}
                        onChange={handleMetaChange('groupStatus')}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                        <option value="1">1 – Update</option>
                        <option value="2">2 – Preliminary</option>
                        <option value="3">3 – Final</option>
                    </select>
                </label>
                <label className="text-sm font-medium text-gray-700">
                    Account number
                    <input
                        type="text"
                        value={metadata.accountNumber}
                        onChange={handleMetaChange('accountNumber')}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
                <label className="text-sm font-medium text-gray-700">
                    Currency code
                    <input
                        type="text"
                        maxLength={3}
                        value={metadata.currency}
                        onChange={handleMetaChange('currency')}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm uppercase"
                    />
                </label>
                <label className="text-sm font-medium text-gray-700">
                    Default credit txn code
                    <input
                        type="text"
                        maxLength={3}
                        value={metadata.creditCode}
                        onChange={handleMetaChange('creditCode')}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
                <label className="text-sm font-medium text-gray-700">
                    Default debit txn code
                    <input
                        type="text"
                        maxLength={3}
                        value={metadata.debitCode}
                        onChange={handleMetaChange('debitCode')}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
                <label className="text-sm font-medium text-gray-700">
                    Account summary type code
                    <input
                        type="text"
                        maxLength={3}
                        value={metadata.summaryCode}
                        onChange={handleMetaChange('summaryCode')}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
                <label className="text-sm font-medium text-gray-700">
                    Detail funds type (optional)
                    <input
                        type="text"
                        maxLength={10}
                        value={metadata.detailFundsType}
                        onChange={handleMetaChange('detailFundsType')}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvChange} />
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={handleSelectCsv}
                        className="rounded-md bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
                    >
                        Select CSV
                    </button>
                    <span className="text-xs text-gray-500">{csvFileName || 'No file selected.'}</span>
                </div>
                {generatorError && <p className="mt-2 text-xs text-red-600">{generatorError}</p>}
            </div>

            <textarea
                value={baiOutput}
                readOnly
                rows={12}
                className="w-full rounded-xl border border-gray-200 bg-white font-mono text-xs text-gray-800 shadow-inner"
                placeholder="Generated BAI2 output will appear here"
            />
            {generatorSummary && <p className="text-sm text-gray-600">{generatorSummary}</p>}

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="rounded-full bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-60"
                >
                    {isGenerating ? 'Generating…' : 'Generate BAI2'}
                </button>
                <button
                    type="button"
                    onClick={handleDownloadBai}
                    disabled={!baiOutput}
                    className="rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-60"
                >
                    Download BAI2
                </button>
                <button
                    type="button"
                    onClick={handleCopyBai}
                    disabled={!baiOutput}
                    className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                    Copy output
                </button>
                <button
                    type="button"
                    onClick={handleClearGenerator}
                    className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                    Clear
                </button>
            </div>
        </section>
    );

    const renderValidator = () => (
        <section className="rounded-2xl bg-white p-6 shadow space-y-6">
            <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold text-gray-900">BAI2 Validator</h2>
                <p className="text-sm text-gray-600">
                    Upload or paste BAI2 content to run structural checks, inspect parsed output, and produce a sanitized file before submission.
                </p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 space-y-3">
                <input ref={baiInputRef} type="file" accept=".bai,.txt" className="hidden" onChange={handleBaiFileChange} />
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={handleSelectBai}
                        className="rounded-md bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
                    >
                        Select BAI2 file
                    </button>
                    <span className="text-xs text-gray-500">{checkFileName || 'No file selected.'}</span>
                </div>
                <textarea
                    value={checkInput}
                    onChange={(e) => setCheckInput(e.target.value)}
                    rows={8}
                    className="w-full rounded-lg border border-gray-200 bg-white font-mono text-xs text-gray-800"
                    placeholder="Paste BAI2 content here"
                />
                {checkError && <p className="text-xs text-red-600">{checkError}</p>}
            </div>

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={handleRunCheck}
                    disabled={isChecking}
                    className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                    {isChecking ? 'Checking…' : 'Run checks'}
                </button>
                <button
                    type="button"
                    onClick={handleClearCheck}
                    className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                    Clear
                </button>
                <button
                    type="button"
                    onClick={handleCopySanitized}
                    disabled={!sanitizedOutput}
                    className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                    Copy sanitized
                </button>
                <button
                    type="button"
                    onClick={handleDownloadSanitized}
                    disabled={!sanitizedOutput}
                    className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                    Download sanitized
                </button>
            </div>
            {checkMessage && <p className="text-sm text-emerald-700">{checkMessage}</p>}

            <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                    <h3 className="text-base font-semibold text-gray-900">Summary</h3>
                    {checkSummary.length ? (
                        <ul className="mt-2 space-y-1 text-xs text-gray-600">
                            {checkSummary.map((line) => (
                                <li key={line}>{line}</li>
                            ))}
                        </ul>
                    ) : (
                        <p className="mt-2 text-xs text-gray-500">Run checks to see summary details.</p>
                    )}
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                    <h3 className="text-base font-semibold text-gray-900">Issues</h3>
                    {checkIssues.length ? (
                        <ul className="mt-2 list-disc space-y-2 pl-4 text-xs text-gray-700">
                            {checkIssues.map((issue, index) => (
                                <li key={`${issue.message}-${index}`}>
                                    <span className="font-semibold text-gray-800">{issue.message}</span>
                                    {issue.lines && issue.lines.length > 0 && (
                                        <div className="text-[11px] font-mono text-gray-500">Line{issue.lines.length > 1 ? 's' : ''} {issue.lines.join(', ')}</div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="mt-2 text-xs text-gray-500">No structural issues detected.</p>
                    )}
                </div>
            </div>

            <div className="rounded-xl border border-gray-200">
                <div className="border-b border-gray-200 px-4 py-2 text-sm font-semibold text-gray-800">
                    Preview (showing {previewRecords.length} of {checkRecords.length} lines)
                </div>
                <div className="max-h-80 overflow-y-auto">
                    {previewRecords.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-gray-500">Run checks to see parsed lines here.</p>
                    ) : (
                        previewRecords.map((record) => (
                            <div
                                key={`${record.lineNumber}-${record.raw}`}
                                className={`flex items-start gap-3 border-b border-gray-100 px-4 py-1 text-xs ${
                                    issueLineSet.has(record.lineNumber) ? 'bg-red-50' : ''
                                }`}
                            >
                                <span className="w-16 text-right font-mono text-[11px] text-gray-500">{record.lineNumber}</span>
                                <pre className="flex-1 whitespace-pre-wrap font-mono text-[11px] text-gray-800">{record.raw}</pre>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </section>
    );

    return (
        <div className="space-y-6">
            <section className="rounded-2xl bg-white p-6 shadow space-y-3">
                <h1 className="text-2xl font-bold text-gray-900">Banking Workstation</h1>
                <p className="text-sm text-gray-600">Build treasury files, audit BAI2 exports, and access finance-only tooling.</p>
            </section>

            <div className="rounded-2xl bg-white p-4 shadow">
                <div className="flex flex-wrap gap-2">
                    {TOOL_TABS.map((tab) => {
                        const isActive = activeTool === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTool(tab.id)}
                                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                                    isActive ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {activeTool === 'generator' ? renderGenerator() : renderValidator()}
        </div>
    );
}

function parseStatementCsv(text: string): ParsedStatement {
    const rows = parseCsvText(text);
    if (!rows.length) throw new Error('CSV is empty.');
    const headerCells = rows.shift()!;
    const normalizedHeaders = headerCells.map(normalizeHeaderLabel);
    const findIndex = (label: string) => normalizedHeaders.indexOf(label);
    const idxProcessDate = findIndex('process date');
    const idxDescription = findIndex('description');
    const idxCurrency = findIndex('currency code');
    const idxDebit = findIndex('debit');
    let idxCredit = findIndex('credit');
    if (idxCredit === -1) idxCredit = findIndex('dedit');
    if (idxProcessDate === -1) throw new Error('Column "Process date" not found.');
    if (idxDescription === -1) throw new Error('Column "Description" not found.');
    if (idxDebit === -1 && idxCredit === -1) throw new Error('At least one of "Debit" or "Credit" columns must be present.');

    const entries: StatementEntry[] = [];
    const errors: string[] = [];
    let earliestDate: Date | null = null;
    let latestDate: Date | null = null;
    const currencies = new Set<string>();
    let skippedRows = 0;

    rows.forEach((cells, index) => {
        const rowNumber = index + 2;
        if (!cells || cells.every((cell) => !String(cell || '').trim())) {
            skippedRows++;
            return;
        }
        const rawDate = cells[idxProcessDate] ?? '';
        const date = parseCsvDate(rawDate);
        if (!date) {
            errors.push(`Row ${rowNumber}: invalid Process date "${rawDate}".`);
            return;
        }
        const debitAmount = idxDebit === -1 ? 0 : parseAmountField(cells[idxDebit]);
        const creditAmount = idxCredit === -1 ? 0 : parseAmountField(cells[idxCredit]);
        const debitCents = Math.round(debitAmount * 100);
        const creditCents = Math.round(creditAmount * 100);
        let signedCents = 0;
        if (creditCents && debitCents) signedCents = creditCents - debitCents;
        else if (creditCents) signedCents = creditCents;
        else if (debitCents) signedCents = -debitCents;
        if (!signedCents) {
            skippedRows++;
            return;
        }
        const description = cells[idxDescription] ?? '';
        const currencyValue = idxCurrency === -1 ? '' : String(cells[idxCurrency] || '').trim().toUpperCase();
        if (currencyValue) currencies.add(currencyValue);
        if (!earliestDate || date < earliestDate) earliestDate = date;
        if (!latestDate || date > latestDate) latestDate = date;
        entries.push({
            rowNumber,
            date,
            description,
            currency: currencyValue,
            signedCents,
            amountCents: Math.abs(signedCents),
            isCredit: signedCents >= 0,
        });
    });

    if (errors.length) {
        const preview = errors.slice(0, 5).join(' ');
        const suffix = errors.length > 5 ? ` (and ${errors.length - 5} more issues)` : '';
        throw new Error(preview + suffix);
    }
    if (!entries.length) throw new Error('No transactions with values were found in the CSV.');

    return {
        entries,
        earliestDate,
        latestDate,
        currencies: Array.from(currencies),
        skippedRows,
        rowCount: rows.length + 1,
    };
}

function parseCsvText(text: string): string[][] {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0)
        .map(parseCsvLine);
}

function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            result.push(cell);
            cell = '';
        } else {
            cell += ch;
        }
    }
    result.push(cell);
    return result;
}

function normalizeHeaderLabel(label: unknown): string {
    return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseCsvDate(value: unknown): Date | null {
    const raw = String(value || '').trim();
    if (!raw) return null;
    let year: number | undefined;
    let month: number | undefined;
    let day: number | undefined;
    let match = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (match) {
        year = Number(match[1]);
        month = Number(match[2]);
        day = Number(match[3]);
    } else {
        match = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
        if (match) {
            day = Number(match[1]);
            month = Number(match[2]);
            year = Number(match[3]);
            if (year < 100) year += year >= 70 ? 1900 : 2000;
        } else {
            match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
            if (match) {
                year = Number(match[1]);
                month = Number(match[2]);
                day = Number(match[3]);
            }
        }
    }
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
}

function parseAmountField(value: unknown): number {
    const cleaned = String(value || '').replace(/[^0-9.\-]/g, '');
    if (!cleaned) return 0;
    const num = Number(cleaned);
    return Number.isNaN(num) ? 0 : num;
}

function buildBaiFile(parsed: ParsedStatement, meta: BaiMetadata): BaiBuildResult {
    const now = new Date();
    const creationDate = formatYYMMDD(now);
    const creationTime = formatHHMM(now);
    const asOfDate = meta.asOfDate || now;
    const asOfDateYYMMDD = formatYYMMDD(asOfDate);

    let creditTotalCents = 0;
    let debitTotalCents = 0;
    let netTotalCents = 0;
    let creditCount = 0;
    let debitCount = 0;

    const detailRecords = parsed.entries.map((entry) => {
        if (entry.signedCents >= 0) {
            creditTotalCents += entry.amountCents;
            creditCount += 1;
        } else {
            debitTotalCents += entry.amountCents;
            debitCount += 1;
        }
        netTotalCents += entry.signedCents;
        const txnCode = entry.signedCents >= 0 ? meta.creditCode : meta.debitCode;
        const detailText = sanitizeDetailText(entry.description);
        const reference = detailText ? detailText.slice(0, 16) : '';
        return ['16', txnCode, formatUnsignedCents(entry.amountCents), '', meta.detailFundsType || '', reference, detailText];
    });

    const transactionCount = parsed.entries.length;
    const accountSummaryCode = (meta.summaryCode || '015').slice(0, 3);
    const summarySegments = [
        { code: accountSummaryCode, amountCents: netTotalCents, itemCount: '', signed: true, fundsType: '' },
        { code: '100', amountCents: creditTotalCents, itemCount: creditCount, signed: false, fundsType: '' },
        { code: '400', amountCents: debitTotalCents, itemCount: debitCount, signed: false, fundsType: '' },
    ];
    ['900', '901', '902', '903', '904', '905'].forEach((code) => {
        summarySegments.push({ code, amountCents: 0, itemCount: '', signed: false, fundsType: '' });
    });

    const accountRecord: (string | number)[] = ['03', meta.accountNumber, ''];
    const formatSegmentAmount = (segment: { signed: boolean; amountCents: number }) =>
        segment.signed ? formatSignedCents(segment.amountCents) : formatUnsignedCents(segment.amountCents);
    summarySegments.forEach((segment) => {
        accountRecord.push(
            segment.code,
            formatSegmentAmount(segment),
            segment.itemCount === '' ? '' : String(segment.itemCount || 0),
            segment.fundsType || '',
            ''
        );
    });

    const lines: string[] = [];
    const pushLine = (fields: Array<string | number>) => {
        lines.push(fields.join(',') + '/');
    };

    pushLine(['01', meta.senderId, meta.receiverId, creationDate, creationTime, meta.fileId, '', '', '2']);
    pushLine(['02', '', meta.senderId, meta.groupStatus, asOfDateYYMMDD, '', meta.currency || '', meta.asOfDateModifier || '0']);
    pushLine(accountRecord);
    detailRecords.forEach((rec) => pushLine(rec));
    const groupRecordCount = transactionCount + 2;
    const fileRecordCount = transactionCount + 4;
    pushLine(['49', formatSignedCents(netTotalCents), String(transactionCount)]);
    pushLine(['98', formatSignedCents(netTotalCents), String(groupRecordCount)]);
    pushLine(['99', formatSignedCents(netTotalCents), '1', String(fileRecordCount)]);

    return {
        content: lines.join('\n'),
        creditTotalCents,
        debitTotalCents,
        netTotalCents,
        transactionCount,
        fileRecordCount,
    };
}

function analyzeBaiContent(text: string) {
    const records = parseBaiRecords(text);
    const issueDetails: BaiIssue[] = [];
    const addIssue = (message: string, lineNumbers?: number | number[]) => {
        const lines = Array.isArray(lineNumbers)
            ? lineNumbers.filter((line) => Number.isFinite(line))
            : Number.isFinite(lineNumbers)
            ? [lineNumbers as number]
            : undefined;
        issueDetails.push({ message, lines });
    };

    if (!records.length) {
        addIssue('BAI2 content is empty.');
        return { summary: [], issues: issueDetails, records };
    }

    let fileHeader: BaiRecord | null = null;
    let fileTrailer: BaiRecord | null = null;
    let currentGroup: BaiGroupState | null = null;
    let currentAccount: BaiAccountState | null = null;
    let totalTransactions = 0;

    const getHeaderState = () => fileHeader as BaiRecord | null;
    const getAccountState = () => currentAccount as BaiAccountState | null;
    const getGroupState = () => currentGroup as BaiGroupState | null;
    const getTrailerState = () => fileTrailer as BaiRecord | null;
    let accountCount = 0;
    let fileRecordCount = 0;
    let fileNetFromGroups = 0;
    let groupCount = 0;
    let fileCurrency = '';

    records.forEach((record) => {
        fileRecordCount += 1;
        const { type, fields, lineNumber } = record;
        if (!record.hasTerminator) addIssue('Record missing "/" terminator.', lineNumber);
        if (!type) {
            addIssue('Record type is blank.', lineNumber);
            return;
        }
        switch (type) {
            case '01':
                if (fileHeader) addIssue('Duplicate file header (01) record.', lineNumber);
                fileHeader = record;
                break;
            case '02':
                if (!fileHeader) addIssue('Group header (02) appears before file header.', lineNumber);
                const previousGroup = getGroupState();
                if (previousGroup) {
                    addIssue('Previous group missing group trailer (98).', previousGroup.startLine);
                }
                currentGroup = { startLine: lineNumber, netCents: 0, transactions: 0 };
                currentAccount = null;
                groupCount += 1;
                if (fields[6]) fileCurrency = fileCurrency || fields[6];
                break;
            case '03':
                if (!currentGroup) {
                    addIssue('Account header (03) found outside of a group.', lineNumber);
                    break;
                }
                const previousAccount = getAccountState();
                if (previousAccount) {
                    addIssue('Previous account missing trailer (49).', previousAccount.line);
                }
                currentAccount = { id: fields[1] || '', line: lineNumber, transactions: 0 };
                accountCount += 1;
                break;
            case '16':
                if (!currentAccount) addIssue('Transaction detail (16) without a preceding account (03).', lineNumber);
                else currentAccount.transactions += 1;
                if (currentGroup) currentGroup.transactions += 1;
                totalTransactions += 1;
                break;
            case '49': {
                if (!currentGroup) {
                    addIssue('Account trailer (49) found outside of a group.', lineNumber);
                    break;
                }
                if (!currentAccount) addIssue('Account trailer (49) encountered without an open account.', lineNumber);
                const trailerNet = parseIntSafe(fields[1]);
                if (trailerNet === null) addIssue('Account trailer net total is not numeric.', lineNumber);
                else currentGroup.netCents += trailerNet;
                const trailerCount = parseIntSafe(fields[2]);
                if (trailerCount !== null && currentAccount && trailerCount !== currentAccount.transactions) {
                    addIssue(
                        `Account ${currentAccount.id || '(unknown)'} trailer expects ${trailerCount} transactions but ${currentAccount.transactions} recorded.`,
                        lineNumber
                    );
                }
                currentAccount = null;
                break;
            }
            case '98':
                if (!currentGroup) {
                    addIssue('Group trailer (98) without an open group.', lineNumber);
                    break;
                }
                const openAccount = getAccountState();
                if (openAccount) {
                    addIssue('Account missing trailer (49) before group trailer (98).', openAccount.line);
                    currentAccount = null;
                }
                const groupNet = parseIntSafe(fields[1]);
                if (groupNet !== null && groupNet !== currentGroup.netCents) {
                    addIssue(`Group net ${groupNet} does not match account totals ${currentGroup.netCents || 0}.`, lineNumber);
                }
                const expectedRecords = parseIntSafe(fields[2]);
                if (expectedRecords !== null) {
                    const observedRecords = currentGroup.transactions + 2;
                    if (expectedRecords !== observedRecords) addIssue(`Group record count ${expectedRecords} does not match observed ${observedRecords}.`, lineNumber);
                }
                if (groupNet !== null) fileNetFromGroups += groupNet;
                currentGroup = null;
                currentAccount = null;
                break;
            case '99':
                if (fileTrailer) addIssue('Duplicate file trailer (99) record.', lineNumber);
                fileTrailer = record;
                break;
            default:
                break;
        }

        if (record.sanitizedRaw && record.sanitizedRaw.includes('"')) {
            addIssue('Double quotes detected; replace them with apostrophes or remove them before submission.', lineNumber);
            record.sanitizedRaw = record.sanitizedRaw.replace(/"/g, "'");
        }
    });

    const pendingAccount = getAccountState();
    if (pendingAccount) {
        addIssue('Account missing trailer (49).', pendingAccount.line);
    }
    const pendingGroup = getGroupState();
    if (pendingGroup) {
        addIssue('Group missing group trailer (98).', pendingGroup.startLine);
    }
    if (!fileHeader) addIssue('Missing file header (01) record.');
    if (!fileTrailer) addIssue('Missing file trailer (99) record.');

    const trailerRecord = getTrailerState();
    const trailerNet = parseTrailerValue(trailerRecord, 1);
    const trailerGroupCount = parseTrailerValue(trailerRecord, 2);
    const trailerRecordCount = parseTrailerValue(trailerRecord, 3);
    const trailerLineNumber = trailerRecord?.lineNumber;

    if (trailerGroupCount !== null && trailerGroupCount !== groupCount) {
        addIssue(`File trailer reports ${trailerGroupCount} groups but ${groupCount} observed.`, trailerLineNumber);
    }
    if (trailerRecordCount !== null && trailerRecordCount !== fileRecordCount) {
        addIssue(`File trailer reports ${trailerRecordCount} records but ${fileRecordCount} observed.`, trailerLineNumber);
    }
    if (trailerNet !== null && trailerNet !== fileNetFromGroups) {
        addIssue(`File trailer net ${trailerNet} does not match sum of group nets ${fileNetFromGroups}.`, trailerLineNumber);
    }

    const summary: string[] = [];
    const headerRecord = getHeaderState();
    if (headerRecord?.fields) {
        const [, sender, receiver, creationDate, creationTime] = headerRecord.fields;
        if (sender || receiver) summary.push(`Sender ${sender || 'unknown'} → Receiver ${receiver || 'unknown'}`);
        if (creationDate) summary.push(`File creation: ${creationDate}${creationTime ? ` ${creationTime}` : ''}`);
    }
    summary.push(`Groups: ${groupCount}`);
    summary.push(`Accounts: ${accountCount}`);
    summary.push(`Transactions: ${totalTransactions}`);
    summary.push(`Records: ${fileRecordCount}`);
    if (trailerNet !== null) summary.push(`File net: ${formatCurrencyFromCents(trailerNet, fileCurrency || 'AUD')}`);

    return { summary, issues: issueDetails, records };
}

function parseTrailerValue(record: BaiRecord | null | undefined, index: number) {
    if (!record) return null;
    const fields = record.fields;
    if (!Array.isArray(fields)) return null;
    return parseIntSafe(fields[index]);
}

function parseBaiRecords(text: string): BaiRecord[] {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((raw, idx) => {
            const hasTerminator = raw.endsWith('/');
            const cleaned = hasTerminator ? raw.slice(0, -1) : raw;
            const fields = cleaned.split(',');
            return {
                lineNumber: idx + 1,
                raw,
                fields,
                type: fields[0] || '',
                hasTerminator,
                sanitizedRaw: cleaned,
            };
        });
}

function sanitizeBaiRecords(records: BaiRecord[]): string {
    if (!Array.isArray(records) || !records.length) return '';
    const sanitized = records
        .map((record) => {
            const source = record?.sanitizedRaw ?? record?.raw ?? '';
            const trimmed = String(source).trim();
            if (!trimmed) return '';
            return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
        })
        .filter((line) => line.length > 0);
    return sanitized.join('\n');
}

function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Unable to read file.'));
        reader.readAsText(file);
    });
}

function formatYYMMDD(date: Date) {
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return yy + mm + dd;
}

function formatHHMM(date: Date) {
    return String(date.getHours()).padStart(2, '0') + String(date.getMinutes()).padStart(2, '0');
}

function formatSignedCents(value: number) {
    const sign = value < 0 ? '-' : '';
    return sign + String(Math.abs(Math.trunc(value)));
}

function formatUnsignedCents(value: number) {
    return String(Math.abs(Math.trunc(value)));
}

function sanitizeDetailText(value: string, max = 80) {
    return String(value || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/,+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function formatCurrencyFromCents(cents: number, currency: string) {
    const value = (Number(cents) || 0) / 100;
    try {
        return new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency || 'AUD' }).format(value);
    } catch {
        return `${currency || 'CUR'} ${value.toFixed(2)}`;
    }
}

function parseIntSafe(value: unknown) {
    if (value === undefined || value === null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

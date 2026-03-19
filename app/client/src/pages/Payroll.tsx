import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { apiClient } from '../lib/api';

interface PayrollResponse {
    file_name: string;
    mime_type: string;
    file_data: string;
}

function fileToBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.onerror = () => reject(new Error('Unable to read the selected file.'));
        reader.readAsDataURL(file);
    });
}

function base64ToBlob(base64: string, mimeType: string) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
}

export function Payroll() {
    const { user } = useAuth();
    const { addToast } = useToast();
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<PayrollResponse | null>(null);

    const isAllowed = user?.role === 'payroll' || user?.role === 'admin';
    const acceptedTypes = '.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const nextFile = event.target.files?.[0] || null;
        setError('');
        setResult(null);
        if (!nextFile) {
            setSelectedFile(null);
            return;
        }
        const extension = nextFile.name.split('.').pop()?.toLowerCase();
        if (!extension || !['xlsx', 'xls'].includes(extension)) {
            setSelectedFile(null);
            setError('Please choose an Excel workbook (.xlsx or .xls).');
            return;
        }
        setSelectedFile(nextFile);
    };

    const handleProcess = async () => {
        if (!selectedFile) {
            setError('Choose an Excel workbook to continue.');
            return;
        }

        setProcessing(true);
        setError('');
        setResult(null);

        try {
            const fileData = await fileToBase64(selectedFile);
            const response = await apiClient.post<PayrollResponse>('/payroll/reformat', {
                file_name: selectedFile.name,
                file_data: fileData,
                mime_type: selectedFile.type || 'application/octet-stream',
            });
            setResult(response);
            addToast('NSF file formatted successfully.', 'success');
        } catch (err) {
            const message = (err as Error)?.message || 'Unable to create the NSF file format.';
            setError(message);
            addToast(message, 'error');
        } finally {
            setProcessing(false);
        }
    };

    const handleDownload = () => {
        if (!result) return;
        const blob = base64ToBlob(result.file_data, result.mime_type);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.file_name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    if (!isAllowed) {
        return (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
                <h2 className="text-xl font-semibold">Payroll access required</h2>
                <p className="mt-2 text-sm text-amber-800">
                    Sign in with a payroll account to upload a workbook and generate the NSF file format.
                </p>
            </div>
        );
    }

    return (
        <section className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow">
                <div className="max-w-3xl">
                    <h2 className="text-2xl font-semibold text-gray-900">NSF File Format</h2>
                    <p className="mt-2 text-sm text-gray-600">
                        Upload the TechOne payroll deduction export, run the existing payroll formatting script, and download the NSF-formatted workbook.
                    </p>
                </div>

                <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6">
                        <label className="block text-sm font-medium text-gray-700">
                            Source workbook
                            <input
                                type="file"
                                accept={acceptedTypes}
                                onChange={handleFileChange}
                                className="mt-3 block w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm text-gray-700 file:mr-4 file:rounded-full file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100"
                            />
                        </label>
                        <p className="mt-3 text-xs text-gray-500">
                            Accepted formats: Excel `.xlsx` or `.xls`
                        </p>
                        {selectedFile && (
                            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
                                <div className="font-medium text-gray-900">{selectedFile.name}</div>
                                <div className="mt-1 text-xs text-gray-500">
                                    {(selectedFile.size / 1024).toFixed(1)} KB
                                </div>
                            </div>
                        )}
                        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
                    </div>

                    <div className="rounded-2xl bg-slate-900 p-6 text-white shadow-sm">
                        <h3 className="text-lg font-semibold">Process</h3>
                        <p className="mt-2 text-sm text-slate-200">
                            The backend runs `scripts/reformat_payroll.py` and returns the NSF-formatted workbook for download.
                        </p>
                        <button
                            type="button"
                            onClick={handleProcess}
                            disabled={processing || !selectedFile}
                            className="mt-6 w-full rounded-full bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                        >
                            {processing ? 'Processing…' : 'Create NSF file format'}
                        </button>
                        <button
                            type="button"
                            onClick={handleDownload}
                            disabled={!result}
                            className="mt-3 w-full rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-400"
                        >
                            Download NSF file
                        </button>
                    </div>
                </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow">
                <h3 className="text-lg font-semibold text-gray-900">Result</h3>
                {!result ? (
                    <p className="mt-2 text-sm text-gray-500">No processed file yet.</p>
                ) : (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <p className="text-sm font-medium text-emerald-900">{result.file_name}</p>
                        <p className="mt-1 text-sm text-emerald-800">
                            The workbook is ready. Use the download button above to save the NSF-formatted file.
                        </p>
                    </div>
                )}
            </div>
        </section>
    );
}

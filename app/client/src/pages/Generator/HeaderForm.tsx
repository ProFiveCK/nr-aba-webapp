import React from 'react';
import type { HeaderData } from './types';
import { HEADER_PRESETS, type HeaderPresetKey } from '../../lib/constants';

import { todayDDMMYY } from '../../lib/utils';

interface HeaderFormProps {
    headerData: HeaderData;
    onHeaderChange: (data: HeaderData) => void;
}

export function HeaderForm({ headerData, onHeaderChange }: HeaderFormProps) {
    const [showBalancing, setShowBalancing] = React.useState(false);

    // Pre-fill processing date if empty
    React.useEffect(() => {
        if (!headerData.proc) {
            onHeaderChange({ ...headerData, proc: todayDDMMYY() });
        }
    }, []);

    const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const presetKey = e.target.value as HeaderPresetKey;
        if (presetKey && HEADER_PRESETS[presetKey]) {
            const preset = HEADER_PRESETS[presetKey];
            const resolvedProc = preset.proc || headerData.proc || todayDDMMYY();
            onHeaderChange({
                fi: preset.fi,
                reel: preset.reel,
                user: preset.user,
                apca: preset.apca,
                desc: preset.desc,
                proc: resolvedProc,
                trace_bsb: preset.trace_bsb,
                trace_acct: preset.trace_acct,
                remitter: preset.remitter,
                balance_required: preset.balance_required,
                balance_txn_code: preset.balance_txn_code,
                balance_bsb: preset.balance_bsb,
                balance_acct: preset.balance_acct,
                balance_title: preset.balance_title,
            });
        }
    };

    const handleFieldChange = (field: keyof HeaderData, value: string) => {
        onHeaderChange({ ...headerData, [field]: value });
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="space-y-3">
                    <h2 className="text-lg font-semibold text-gray-900">RON Bank Account Details</h2>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="text-xs font-medium text-gray-700">
                            Pick a Bank Account
                            <select
                                id="header-preset"
                                onChange={handlePresetChange}
                                className="mt-1 w-full rounded-md border border-gray-300 bg-yellow-50 px-2 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            >
                                {Object.keys(HEADER_PRESETS).map((key) => (
                                    <option key={key} value={key}>
                                        {key}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="text-xs font-medium text-gray-700">
                            Financial Institution
                            <input
                                type="text"
                                value={headerData.fi}
                                maxLength={3}
                                className="mt-1 block w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-2 text-sm"
                                readOnly
                            />
                        </label>
                        <label className="text-xs font-medium text-gray-700">
                            APCA User ID
                            <input
                                type="text"
                                value={headerData.apca}
                                maxLength={6}
                                className="mt-1 block w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-2 text-sm"
                                readOnly
                            />
                        </label>
                        <label className="text-xs font-medium text-gray-700">
                            Reel Sequence
                            <input
                                type="text"
                                value={headerData.reel}
                                className="mt-1 block w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-2 text-sm"
                                readOnly
                            />
                        </label>
                        <label className="text-xs font-medium text-gray-700">
                            Trace BSB, NNN-NNN
                            <input
                                type="text"
                                value={headerData.trace_bsb}
                                maxLength={7}
                                className="mt-1 block w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-2 text-sm"
                                readOnly
                            />
                        </label>
                        <label className="text-xs font-medium text-gray-700">
                            Trace Account
                            <input
                                type="text"
                                value={headerData.trace_acct}
                                maxLength={9}
                                className="mt-1 block w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-2 text-sm"
                                readOnly
                            />
                        </label>
                    </div>
                    <p className="text-xs text-gray-500">Switch preset to populate and lock bank fields.</p>
                </div>

                <div className="space-y-3">
                    <h2 className="text-lg font-semibold text-gray-900">Department Specific Fields</h2>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="text-xs font-medium text-gray-700 sm:col-span-2">
                            Name of User, max 26
                            <input
                                type="text"
                                value={headerData.user}
                                maxLength={26}
                                onChange={(e) => handleFieldChange('user', e.target.value)}
                                className="mt-1 block w-full rounded-md border-2 border-yellow-400 bg-yellow-50 px-2 py-2 text-sm focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                            />
                        </label>
                        <label className="text-xs font-medium text-gray-700">
                            Description, max 12
                            <input
                                type="text"
                                value={headerData.desc}
                                maxLength={12}
                                onChange={(e) => handleFieldChange('desc', e.target.value)}
                                className="mt-1 block w-full rounded-md border-2 border-yellow-400 bg-yellow-50 px-2 py-2 text-sm focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                            />
                        </label>
                        <label className="text-xs font-medium text-gray-700">
                            Processing Date, DDMMYY
                            <input
                                type="text"
                                value={headerData.proc}
                                maxLength={6}
                                onChange={(e) => handleFieldChange('proc', e.target.value)}
                                className="mt-1 block w-full rounded-md border-2 border-yellow-400 bg-yellow-50 px-2 py-2 text-sm focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                            />
                        </label>
                        <label className="text-xs font-medium text-gray-700 sm:col-span-2">
                            Remitter Name, max 16
                            <input
                                type="text"
                                value={headerData.remitter}
                                maxLength={16}
                                onChange={(e) => handleFieldChange('remitter', e.target.value)}
                                className="mt-1 block w-full rounded-md border-2 border-yellow-400 bg-yellow-50 px-2 py-2 text-sm focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                            />
                        </label>
                    </div>
                </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center">
                        <input
                            id="balance_required"
                            type="checkbox"
                            checked
                            disabled
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <label htmlFor="balance_required" className="ml-2 text-xs font-medium text-gray-700">
                            Balancing entry always enabled
                        </label>
                    </div>
                    <span className="text-xs text-gray-500">Locked to trace account with Txn code 13.</span>
                </div>
                <details open={showBalancing} onToggle={(e) => setShowBalancing(e.currentTarget.open)} className="mt-2">
                    <summary className="cursor-pointer text-sm text-gray-700">
                        <span className="text-gray-400">{showBalancing ? '▾' : '▸'}</span> Show balancing fields
                    </summary>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <label className="text-xs font-medium text-gray-700">
                            Balance BSB
                            <input
                                type="text"
                                value={headerData.balance_bsb}
                                className="mt-1 block w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-sm"
                                readOnly
                            />
                        </label>
                        <label className="text-xs font-medium text-gray-700">
                            Balance Account
                            <input
                                type="text"
                                value={headerData.balance_acct}
                                className="mt-1 block w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-sm"
                                readOnly
                            />
                        </label>
                        <label className="text-xs font-medium text-gray-700">
                            Balance Account Title
                            <input
                                type="text"
                                value={headerData.balance_title}
                                className="mt-1 block w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-sm"
                                readOnly
                            />
                        </label>
                        <div className="sm:col-span-3 flex items-center gap-3">
                            <label className="text-xs font-medium text-gray-700">
                                Balance Txn Code
                                <input
                                    value="13"
                                    className="mt-1 w-16 rounded-md border border-gray-200 bg-white text-center text-sm"
                                    readOnly
                                />
                            </label>
                            <p className="text-xs text-gray-500">Debit balancing record is generated automatically.</p>
                        </div>
                    </div>
                </details>
            </div>
        </div>
    );

}

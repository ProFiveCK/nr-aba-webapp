import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { LoadingState } from '../../components/Ui';
import { HEADER_PRESETS } from '../../lib/constants';
import type { PublicHealthTier, PublicHealthTierCode } from '../../features/public-health/types';

const LEVELS: PublicHealthTierCode[] = ['LV0', 'LV1', 'LV2', 'LV3'];
const SOURCE = HEADER_PRESETS['CBA-RON'];

export function SettingsPanel() {
  const { addToast } = useToast();
  const [tiers, setTiers] = useState<PublicHealthTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tierRows = await apiClient.get<PublicHealthTier[]>('/public-health/tiers');
      setTiers(tierRows || []);
    } catch (err) {
      addToast((err as Error)?.message || 'Failed to load settings.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    load();
  }, [load]);

  const saveTiers = async () => {
    setSaving(true);
    try {
      for (const t of tiers) {
        if (t.code === 'LV0') continue; // LV0 is always $0
        await apiClient.put(`/public-health/tiers/${t.code}`, { monthly_amount: Number(t.monthly_amount) });
      }
      addToast('Allowance tiers saved.', 'success');
    } catch (err) {
      addToast((err as Error)?.message || 'Failed to save tiers.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const setTier = (code: PublicHealthTierCode, value: string) => {
    setTiers((prev) => prev.map((t) => (t.code === code ? { ...t, monthly_amount: Number(value) || 0 } : t)));
  };

  if (loading) return <div className="app-panel p-6"><LoadingState label="Loading settings…" /></div>;

  return (
    <div className="space-y-6">
      <section className="app-panel p-6">
        <h1 className="text-2xl font-bold text-gray-900">Wellness Program Settings</h1>
        <p className="text-sm text-gray-600">Configure allowance tiers and payment details.</p>
      </section>

      <section className="app-panel p-6">
        <h2 className="text-lg font-semibold text-gray-900">Allowance Tiers</h2>
        <p className="text-sm text-gray-500">Monthly allowance per level. LV0 is a demotion with no payment.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LEVELS.map((code) => {
            const tier = tiers.find((t) => t.code === code);
            const locked = code === 'LV0';
            return (
              <div key={code} className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">{code}</span>
                  {tier?.label && <span className="text-xs text-gray-500">{tier.label}</span>}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-gray-500">$</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    disabled={locked}
                    value={locked ? 0 : tier?.monthly_amount ?? 0}
                    onChange={(e) => setTier(code, e.target.value)}
                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-zinc-100 disabled:text-zinc-400"
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={saveTiers} disabled={saving} className="toolbar-button bg-teal-600 text-white border-teal-600 hover:bg-teal-700 disabled:opacity-60">Save Tiers</button>
        </div>
      </section>

      <section className="app-panel p-6">
        <h2 className="text-lg font-semibold text-gray-900">Payment Details</h2>
        <p className="text-sm text-gray-500">Payments are drawn from the CBA-RON treasury account.</p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3">
            <dt className="text-xs uppercase tracking-wide text-gray-500">Source BSB</dt>
            <dd className="mt-1 font-mono text-sm font-medium text-gray-900">{SOURCE.trace_bsb}</dd>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3">
            <dt className="text-xs uppercase tracking-wide text-gray-500">Source Account</dt>
            <dd className="mt-1 font-mono text-sm font-medium text-gray-900">{SOURCE.trace_acct}</dd>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3">
            <dt className="text-xs uppercase tracking-wide text-gray-500">Description</dt>
            <dd className="mt-1 text-sm font-medium text-gray-900">ALLOWANCE-Health</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

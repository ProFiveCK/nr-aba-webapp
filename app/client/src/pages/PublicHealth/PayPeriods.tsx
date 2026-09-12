import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/useAuth';
import { useToast } from '../../contexts/useToast';
import { EmptyState, LoadingState } from '../../components/Ui';
import { buildAbaFile } from '../../lib/generator-utils';
import { toBase64 } from '../../lib/utils';
import { HEADER_PRESETS } from '../../lib/constants';
import { printReport } from '../../lib/print';
import type { HeaderData } from '../Generator/types';
import type { PublicHealthPayPeriod, PublicHealthPeriodEntry } from '../../features/public-health/types';

function toDDMMYY(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}${m}${y.slice(2)}`;
}

function esc(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LEVELS = ['LV0', 'LV1', 'LV2', 'LV3'];

export function PayPeriods() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [periods, setPeriods] = useState<PublicHealthPayPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<PublicHealthPayPeriod | null>(null);
  const [entries, setEntries] = useState<PublicHealthPeriodEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [paidDate, setPaidDate] = useState('');

  const loadPeriods = async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await apiClient.get<PublicHealthPayPeriod[]>('/public-health/pay-periods');
      setPeriods(rows || []);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load pay periods.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPeriods();
  }, []);

  const openPeriod = async (period: PublicHealthPayPeriod) => {
    setSelected(period);
    setDetailLoading(true);
    setDirty(false);
    try {
      const detail = await apiClient.get<PublicHealthPayPeriod & { entries: PublicHealthPeriodEntry[] }>(`/public-health/pay-periods/${period.id}`);
      setEntries(detail.entries || []);
    } catch (err) {
      addToast((err as Error)?.message || 'Failed to load pay period.', 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleActive = (id: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, active: !e.active } : e)));
    setDirty(true);
  };

  const saveEntries = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const payload = entries.map((e) => ({ participant_id: e.participant_id, active: e.active }));
      await apiClient.put(`/public-health/pay-periods/${selected.id}/entries`, { entries: payload });
      setDirty(false);
      addToast('Pay period updated.', 'success');
      await loadPeriods();
    } catch (err) {
      addToast((err as Error)?.message || 'Failed to save pay period.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const generateAba = async () => {
    if (!selected) return;
    const active = entries.filter((e) => e.active && Number(e.amount) > 0);
    if (!active.length) {
      addToast('No active participants to include in the payment.', 'error');
      return;
    }
    setGenerating(true);
    try {
      const preset = HEADER_PRESETS['CBA-RON'];
      const header: HeaderData = {
        fi: preset.fi,
        reel: preset.reel,
        user: preset.user,
        apca: preset.apca,
        desc: 'ALLOW-HEALTH',
        proc: toDDMMYY(selected.paid_date),
        trace_bsb: preset.trace_bsb,
        trace_acct: preset.trace_acct,
        remitter: preset.remitter,
        balance_required: true,
        balance_txn_code: preset.balance_txn_code || '13',
        balance_bsb: preset.balance_bsb,
        balance_acct: preset.balance_acct,
        balance_title: preset.balance_title,
      };
      const transactions = active.map((e) => ({
        bsb: e.bank_bsb || '',
        account: e.bank_account || '',
        amount: Number(e.amount),
        accountTitle: e.full_name,
        lodgementRef: e.full_name.slice(0, 18),
        txnCode: '53',
      }));
      const abaText = buildAbaFile(header, transactions);
      await apiClient.post('/batches', {
        aba_content: toBase64(abaText),
        pd_number: `PH-${selected.paid_date}`,
        workflow_type: 'public_health',
        metadata: {
          prepared_by: user?.display_name || user?.email,
          period_id: selected.id,
          paid_date: selected.paid_date,
          participant_count: active.length,
        },
      });
      await apiClient.patch(`/public-health/pay-periods/${selected.id}/status`, { status: 'submitted' });
      addToast('ABA generated and submitted for review.', 'success');
      await loadPeriods();
      setSelected(null);
    } catch (err) {
      addToast((err as Error)?.message || 'Failed to generate ABA.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const createPeriod = async () => {
    if (!paidDate) {
      addToast('Paid date is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiClient.post('/public-health/pay-periods', { paid_date: paidDate });
      addToast('Pay period created.', 'success');
      setCreateOpen(false);
      setPaidDate('');
      await loadPeriods();
    } catch (err) {
      addToast((err as Error)?.message || 'Failed to create pay period.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (selected) {
    const activeEntries = entries.filter((e) => e.active && Number(e.amount) > 0);
    const activeCount = activeEntries.length;
    const total = activeEntries.reduce((sum, e) => sum + Number(e.amount), 0);

    const byLevel: Record<string, { count: number; amount: number }> = {};
    for (const lvl of LEVELS) byLevel[lvl] = { count: 0, amount: 0 };
    const byVillage: Record<string, { count: number; amount: number }> = {};
    for (const e of activeEntries) {
      byLevel[e.level] = byLevel[e.level] || { count: 0, amount: 0 };
      byLevel[e.level].count += 1;
      byLevel[e.level].amount += Number(e.amount);
      const v = (e.village || '').trim() || 'Unassigned';
      byVillage[v] = byVillage[v] || { count: 0, amount: 0 };
      byVillage[v].count += 1;
      byVillage[v].amount += Number(e.amount);
    }
    const villageRows = Object.entries(byVillage).sort((a, b) => b[1].amount - a[1].amount);

    const handlePrintSummary = () => {
      const levelRows = LEVELS.map((lvl) => `<tr><td>${lvl}</td><td class="right">${byLevel[lvl].count}</td><td class="right">$${byLevel[lvl].amount.toFixed(2)}</td></tr>`).join('');
      const villageRowsHtml = villageRows.map(([v, d]) => `<tr><td>${esc(v)}</td><td class="right">${d.count}</td><td class="right">$${d.amount.toFixed(2)}</td></tr>`).join('');
      const body = `<h1>Pay Run Summary — ${selected.paid_date}</h1><div class="meta">${activeCount} participants · $${total.toFixed(2)} total</div><div class="totals"><h2>By Level</h2><table><thead><tr><th>Level</th><th class="right">Count</th><th class="right">Amount</th></tr></thead><tbody>${levelRows}</tbody></table><h2>By Village</h2><table><thead><tr><th>Village</th><th class="right">Count</th><th class="right">Amount</th></tr></thead><tbody>${villageRowsHtml}</tbody></table></div>`;
      printReport('Pay Run Summary', body);
    };

    return (
      <div className="space-y-6">
        <section className="app-panel p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Pay Run — {selected.paid_date}</h1>
              <p className="text-sm text-gray-600">
                {activeCount} active · ${total.toFixed(2)} total · {selected.status}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setSelected(null)} className="toolbar-button">Back</button>
              <button onClick={saveEntries} disabled={!dirty || saving} className="toolbar-button">Save changes</button>
              <button onClick={handlePrintSummary} className="toolbar-button">Print Summary</button>
              <button onClick={generateAba} disabled={generating || selected.status !== 'draft'} className="toolbar-button bg-teal-600 text-white border-teal-600 hover:bg-teal-700 disabled:opacity-60">
                {generating ? 'Generating…' : 'Generate ABA'}
              </button>
            </div>
          </div>
        </section>

        <section className="app-panel p-6">
          <h2 className="text-lg font-semibold text-gray-900">Summary</h2>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">By Level</h3>
              <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
                    <tr><th className="px-3 py-2 text-left">Level</th><th className="px-3 py-2 text-right">Count</th><th className="px-3 py-2 text-right">Amount</th></tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {LEVELS.map((lvl) => (
                      <tr key={lvl} className={byLevel[lvl].count === 0 ? 'text-zinc-400' : ''}>
                        <td className="px-3 py-2 font-medium">{lvl}</td>
                        <td className="px-3 py-2 text-right">{byLevel[lvl].count}</td>
                        <td className="px-3 py-2 text-right">${byLevel[lvl].amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700">By Village</h3>
              <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-zinc-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 sticky top-0">
                    <tr><th className="px-3 py-2 text-left">Village</th><th className="px-3 py-2 text-right">Count</th><th className="px-3 py-2 text-right">Amount</th></tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {villageRows.length === 0 ? (
                      <tr><td colSpan={3} className="px-3 py-2 text-center text-zinc-400">No active participants</td></tr>
                    ) : villageRows.map(([v, d]) => (
                      <tr key={v}>
                        <td className="px-3 py-2">{v}</td>
                        <td className="px-3 py-2 text-right">{d.count}</td>
                        <td className="px-3 py-2 text-right">${d.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section className="app-panel p-6">
          <h2 className="text-lg font-semibold text-gray-900">Allowance Schedule</h2>
          <p className="text-sm text-gray-500">Tick a participant to include them this pay run. Level is set on the Participants page.</p>
          {detailLoading ? (
            <LoadingState label="Loading schedule…" />
          ) : (
            <div className="data-table-wrap mt-4">
              <div className="data-table-scroll max-h-[560px]">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="px-3 py-2">Include</th>
                      <th className="px-3 py-2">Participant</th>
                      <th className="px-3 py-2">Village</th>
                      <th className="px-3 py-2">Account</th>
                      <th className="px-3 py-2">Level</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const isLv0 = e.level === 'LV0';
                      return (
                        <tr key={e.id} className={e.active ? '' : 'opacity-50'}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={e.active}
                              onChange={() => toggleActive(e.id)}
                              disabled={isLv0}
                              title={isLv0 ? 'LV0 participants cannot be paid' : undefined}
                              className="h-4 w-4 rounded border-zinc-300 text-teal-600 focus:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-40"
                            />
                          </td>
                          <td className="px-3 py-2 font-medium text-gray-900">{e.full_name}</td>
                          <td className="px-3 py-2 text-gray-700">{e.village || '—'}</td>
                          <td className="px-3 py-2 font-mono">{e.bank_bsb} {e.bank_account}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${levelClass(e.level)}`}>{e.level}</span>
                            {isLv0 && <span className="ml-1 text-xs text-zinc-400">No payment</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">{isLv0 ? '—' : `$${Number(e.amount).toFixed(2)}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="app-panel p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Pay Runs</h1>
            <p className="text-sm text-gray-600">Create a pay run for a paid date and generate the ABA file.</p>
          </div>
          <button onClick={() => setCreateOpen(true)} className="toolbar-button bg-teal-600 text-white border-teal-600 hover:bg-teal-700">New Pay Run</button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="data-table-wrap mt-4">
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="px-3 py-2">Paid Date</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Active</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4}><LoadingState label="Loading pay runs…" /></td></tr>
                ) : periods.length === 0 ? (
                  <tr><td colSpan={4}><EmptyState title="No pay runs yet." detail="Create your first pay run to begin." /></td></tr>
                ) : (
                  periods.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 font-medium text-gray-900">{p.paid_date}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(p.status)}`}>{p.status}</span>
                      </td>
                      <td className="px-3 py-2">{p.active_count ?? 0}/{p.entry_count ?? 0}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => openPeriod(p)} className="px-3 py-1.5 rounded-md bg-teal-600 text-xs font-medium text-white hover:bg-teal-700">Open</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4 py-6" onClick={() => setCreateOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h2 className="text-xl font-semibold text-gray-900">New Pay Run</h2>
              <button onClick={() => setCreateOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-gray-700">Paid date (value date)
                <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" />
              </label>
              <p className="text-xs text-gray-500">Paid from CBA-RON ({HEADER_PRESETS['CBA-RON'].trace_bsb} {HEADER_PRESETS['CBA-RON'].trace_acct}). Description: ALLOWANCE-Health.</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setCreateOpen(false)} className="toolbar-button">Cancel</button>
              <button onClick={createPeriod} disabled={saving} className="toolbar-button bg-teal-600 text-white border-teal-600 hover:bg-teal-700 disabled:opacity-60">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function statusClass(status: string) {
  switch (status) {
    case 'approved': return 'bg-emerald-50 text-emerald-700';
    case 'submitted': return 'bg-amber-50 text-amber-700';
    default: return 'bg-zinc-100 text-zinc-600';
  }
}

function levelClass(level?: string) {
  switch (level) {
    case 'LV0': return 'bg-zinc-100 text-zinc-600';
    case 'LV1': return 'bg-teal-50 text-teal-700';
    case 'LV2': return 'bg-blue-50 text-blue-700';
    case 'LV3': return 'bg-purple-50 text-purple-700';
    default: return 'bg-teal-50 text-teal-700';
  }
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { useConfirm } from '../../contexts/useConfirm';
import { EmptyState, LoadingState } from '../../components/Ui';
import { parseCsvRows, formatBSB } from '../../lib/utils';
import { printReport } from '../../lib/print';
import type { PublicHealthParticipant, PublicHealthTierCode } from '../../features/public-health/types';

interface FormState {
  full_name: string;
  bank_bsb: string;
  bank_account: string;
  bank_account_name: string;
  village: string;
  external_ref: string;
}

const EMPTY_FORM: FormState = {
  full_name: '',
  bank_bsb: '',
  bank_account: '',
  bank_account_name: '',
  village: '',
  external_ref: '',
};

const LEVELS: PublicHealthTierCode[] = ['LV0', 'LV1', 'LV2', 'LV3'];

type SortKey = 'full_name' | 'village' | 'current_level' | 'status' | 'created_at';

function formatBsbInput(value: string): string {
  const digits = value.replace(/[^0-9]/g, '').slice(0, 6);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

function esc(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function Participants() {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [participants, setParticipants] = useState<PublicHealthParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [levelFilter, setLevelFilter] = useState<'all' | PublicHealthTierCode>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'full_name', dir: 'asc' });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PublicHealthParticipant | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [levelOpen, setLevelOpen] = useState(false);
  const [levelParticipant, setLevelParticipant] = useState<PublicHealthParticipant | null>(null);
  const [levelForm, setLevelForm] = useState<{ level: PublicHealthTierCode; reason: string }>({ level: 'LV1', reason: '' });
  const [savingLevel, setSavingLevel] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await apiClient.get<PublicHealthParticipant[]>('/public-health/participants');
      setParticipants(rows || []);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load participants.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let list = participants;
    if (statusFilter !== 'all') list = list.filter((p) => p.status === statusFilter);
    if (levelFilter !== 'all') list = list.filter((p) => (p.current_level || 'LV1') === levelFilter);
    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter((p) =>
        `${p.full_name} ${p.village || ''} ${p.bank_account_name || ''} ${p.external_ref || ''}`.toLowerCase().includes(term)
      );
    }
    return [...list].sort((a, b) => {
      const av = a[sort.key] ?? '';
      const bv = b[sort.key] ?? '';
      const cmp = String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [participants, search, statusFilter, levelFilter, sort]);

  const stats = useMemo(() => {
    const s = { total: participants.length, active: 0, inactive: 0, LV0: 0, LV1: 0, LV2: 0, LV3: 0 };
    for (const p of participants) {
      if (p.status === 'active') s.active += 1;
      else s.inactive += 1;
      const lvl = p.current_level || 'LV1';
      if (lvl === 'LV0') s.LV0 += 1;
      else if (lvl === 'LV1') s.LV1 += 1;
      else if (lvl === 'LV2') s.LV2 += 1;
      else if (lvl === 'LV3') s.LV3 += 1;
    }
    return s;
  }, [participants]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (p: PublicHealthParticipant) => {
    setEditing(p);
    setForm({
      full_name: p.full_name,
      bank_bsb: p.bank_bsb || '',
      bank_account: p.bank_account || '',
      bank_account_name: p.bank_account_name || '',
      village: p.village || '',
      external_ref: p.external_ref || '',
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.full_name.trim()) {
      addToast('Full name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        full_name: form.full_name.trim(),
        bank_bsb: form.bank_bsb || null,
        bank_account: form.bank_account || null,
        bank_account_name: form.bank_account_name || null,
        village: form.village.trim() || null,
        external_ref: form.external_ref || null,
      };
      if (editing) {
        await apiClient.patch(`/public-health/participants/${editing.id}`, payload);
        addToast('Participant updated.', 'success');
      } else {
        await apiClient.post('/public-health/participants', payload);
        addToast('Participant added.', 'success');
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      addToast((err as Error)?.message || 'Failed to save participant.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (p: PublicHealthParticipant) => {
    if (!(await confirm({ message: `Deactivate ${p.full_name}?`, confirmLabel: 'Deactivate', tone: 'danger' }))) return;
    try {
      await apiClient.delete(`/public-health/participants/${p.id}`);
      addToast('Participant deactivated.', 'success');
      await load();
    } catch (err) {
      addToast((err as Error)?.message || 'Failed to deactivate participant.', 'error');
    }
  };

  const openLevel = (p: PublicHealthParticipant) => {
    setLevelParticipant(p);
    setLevelForm({ level: (p.current_level as PublicHealthTierCode) || 'LV1', reason: '' });
    setLevelOpen(true);
  };

  const saveLevel = async () => {
    if (!levelParticipant) return;
    if (!levelForm.reason.trim()) {
      addToast('A reason for the level change is required.', 'error');
      return;
    }
    setSavingLevel(true);
    try {
      await apiClient.patch(`/public-health/participants/${levelParticipant.id}/level`, {
        level: levelForm.level,
        reason: levelForm.reason.trim(),
      });
      addToast('Participant level updated.', 'success');
      setLevelOpen(false);
      await load();
    } catch (err) {
      addToast((err as Error)?.message || 'Failed to change level.', 'error');
    } finally {
      setSavingLevel(false);
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const rows = parseCsvRows(text);
      if (!rows.length) {
        addToast('CSV file is empty.', 'error');
        return;
      }
      const header = rows[0].map((c) => String(c).toLowerCase().trim());
      const idx = (keys: string[]) => header.findIndex((c) => keys.some((k) => c.includes(k)));
      const nameIdx = idx(['name', 'full_name', 'fullname']);
      const bsbIdx = idx(['bsb']);
      const acctIdx = idx(['account', 'account_number', 'account number']);
      const titleIdx = idx(['account_name', 'account title', 'title']);
      const villageIdx = idx(['village', 'district', 'area']);
      const refIdx = idx(['ref', 'external_ref', 'id']);
      const start = nameIdx >= 0 || bsbIdx >= 0 || acctIdx >= 0 ? 1 : 0;
      const participants = rows.slice(start).map((row) => ({
        full_name: String(nameIdx >= 0 ? row[nameIdx] : row[0] || '').trim(),
        bank_bsb: formatBsbInput(String(bsbIdx >= 0 ? row[bsbIdx] : row[1] || '').trim()),
        bank_account: String(acctIdx >= 0 ? row[acctIdx] : row[2] || '').trim(),
        bank_account_name: String(titleIdx >= 0 ? row[titleIdx] : row[3] || '').trim(),
        village: String(villageIdx >= 0 ? row[villageIdx] : '').trim(),
        external_ref: String(refIdx >= 0 ? row[refIdx] : row[4] || '').trim(),
      })).filter((p) => p.full_name);
      if (!participants.length) {
        addToast('No valid participant rows found in CSV.', 'error');
        return;
      }
      const result = await apiClient.post<{ created: number; skipped: number }>('/public-health/participants/import', { participants });
      addToast(`Imported ${result.created} participant(s); ${result.skipped} skipped.`, 'success');
      await load();
    } catch (err) {
      addToast((err as Error)?.message || 'Failed to import CSV.', 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handlePrint = () => {
    const rows = filtered.map((p) => (
      `<tr><td>${esc(p.full_name)}</td><td>${esc(p.village)}</td><td>${p.current_level || 'LV1'}</td><td>${esc(p.bank_bsb)}</td><td>${esc(p.bank_account)}</td><td>${p.status}</td></tr>`
    )).join('');
    const body = `<h1>Wellness Program Participants</h1><div class="meta">${filtered.length} participants · ${new Date().toLocaleString()}</div><table><thead><tr><th>Name</th><th>Village</th><th>Level</th><th>BSB</th><th>Account</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
    printReport('Wellness Program Participants', body);
  };

  return (
    <div className="space-y-6">
      <section className="app-panel p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="wellness-section-title">Participants</h2>
            <p className="wellness-section-subtitle">Manage recipients, bank details and allowance levels.</p>
          </div>
          <button onClick={openCreate} className="toolbar-button wellness-primary self-start">Add participant</button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-7">
          <Stat label="Total" value={stats.total} />
          <Stat label="Active" value={stats.active} tone="emerald" />
          <Stat label="Inactive" value={stats.inactive} tone="zinc" />
          <Stat label="LV0" value={stats.LV0} tone="zinc" />
          <Stat label="LV1" value={stats.LV1} tone="teal" />
          <Stat label="LV2" value={stats.LV2} tone="blue" />
          <Stat label="LV3" value={stats.LV3} tone="purple" />
        </div>

        <div className="wellness-filterbar mt-4 border-t border-slate-200">
            <input
              type="search"
              aria-label="Search participants"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, village, account"
              className="wellness-input min-w-0 flex-1 sm:max-w-xs"
            />
            <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="wellness-input">
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select aria-label="Filter by level" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as typeof levelFilter)} className="wellness-input">
              <option value="all">All levels</option>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <button onClick={handlePrint} className="toolbar-button">Print report</button>
            <button onClick={() => fileRef.current?.click()} className="toolbar-button">Import CSV</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onImportFile(e.target.files[0])} />
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="data-table-wrap mt-2 hidden sm:block">
          <div className="data-table-scroll max-h-[600px]">
            <table className="data-table">
              <thead>
                <tr>
                  <SortTh label="Name" active={sort.key === 'full_name'} dir={sort.dir} onClick={() => toggleSort('full_name')} />
                  <SortTh label="Village" active={sort.key === 'village'} dir={sort.dir} onClick={() => toggleSort('village')} />
                  <SortTh label="Level" active={sort.key === 'current_level'} dir={sort.dir} onClick={() => toggleSort('current_level')} />
                  <th className="px-3 py-2">BSB</th>
                  <th className="px-3 py-2">Account</th>
                  <SortTh label="Status" active={sort.key === 'status'} dir={sort.dir} onClick={() => toggleSort('status')} />
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7}><LoadingState label="Loading participants…" /></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7}><EmptyState title="No participants match your filters." detail="Adjust the search or filters, or add a participant." /></td></tr>
                ) : (
                  filtered.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 font-medium text-gray-900">{p.full_name}</td>
                      <td className="px-3 py-2 text-gray-700">{p.village || '—'}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => openLevel(p)}
                          title={`Change level (currently ${p.current_level || 'LV1'})`}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition ${levelClass(p.current_level)} hover:ring-2 hover:ring-amber-300`}
                        >
                          {p.current_level || 'LV1'}
                          <span aria-hidden className="opacity-60">▾</span>
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono">{p.bank_bsb ? formatBSB(p.bank_bsb) : '—'}</td>
                      <td className="px-3 py-2 font-mono">{p.bank_account || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${p.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>{p.status}</span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => openLevel(p)} className="wellness-row-action">Change level</button>
                        <button onClick={() => openEdit(p)} className="wellness-row-action ml-1">Edit</button>
                        <button onClick={() => deactivate(p)} className="wellness-row-action ml-1 text-rose-700">Deactivate</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-2 space-y-2 sm:hidden">
          {loading ? <LoadingState label="Loading participants…" /> : filtered.length === 0 ? (
            <EmptyState title="No participants match your filters." detail="Adjust the filters or add a participant." />
          ) : filtered.map((p) => (
            <article key={p.id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-slate-900">{p.full_name}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">{p.village || 'Village not set'}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${p.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>{p.status}</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-y border-slate-100 py-2.5 text-sm">
                <span className="text-slate-500">Allowance level</span>
                <button onClick={() => openLevel(p)} className={`rounded-full px-2.5 py-1 text-xs font-bold ${levelClass(p.current_level)}`}>{p.current_level || 'LV1'} ▾</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => openEdit(p)} className="wellness-row-action flex-1">Edit details</button>
                <button onClick={() => deactivate(p)} className="wellness-row-action text-rose-700">Deactivate</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4 py-6" onClick={() => setModalOpen(false)}>
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h2 className="text-xl font-semibold text-gray-900">{editing ? 'Edit Participant' : 'Add Participant'}</h2>
              <button onClick={() => setModalOpen(false)} aria-label="Close participant form" className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="mt-4 space-y-3">
              <Field label="Full name *">
                <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" placeholder="e.g. Jane Doe" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Village">
                  <input value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" placeholder="e.g. Aiwo" />
                </Field>
                <Field label="BSB">
                  <input value={form.bank_bsb} onChange={(e) => setForm({ ...form, bank_bsb: formatBsbInput(e.target.value) })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" placeholder="000-000" maxLength={7} />
                </Field>
              </div>
              <Field label="Account number">
                <input value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" placeholder="12345678" />
              </Field>
              <Field label="Account name">
                <input value={form.bank_account_name} onChange={(e) => setForm({ ...form, bank_account_name: e.target.value })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" placeholder="Account holder" />
              </Field>
              <Field label="External reference">
                <input value={form.external_ref} onChange={(e) => setForm({ ...form, external_ref: e.target.value })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" placeholder="Optional identifier" />
              </Field>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="toolbar-button">Cancel</button>
              <button onClick={save} disabled={saving} className="toolbar-button bg-teal-600 text-white border-teal-600 hover:bg-teal-700 disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {levelOpen && levelParticipant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 px-4 py-6" onClick={() => setLevelOpen(false)}>
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Change Level</h2>
              <button onClick={() => setLevelOpen(false)} aria-label="Close level form" className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <p className="mt-1 text-sm text-gray-500">Current level: <span className="font-medium">{levelParticipant.current_level || 'LV1'}</span></p>
            <div className="mt-4 space-y-3">
              <Field label="New level">
                <select value={levelForm.level} onChange={(e) => setLevelForm({ ...levelForm, level: e.target.value as PublicHealthTierCode })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500">
                  {LEVELS.map((l) => <option key={l} value={l}>{l}{l === 'LV0' ? ' (no payment)' : ''}</option>)}
                </select>
              </Field>
              <Field label="Reason for change *">
                <textarea rows={3} value={levelForm.reason} onChange={(e) => setLevelForm({ ...levelForm, reason: e.target.value })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" placeholder="e.g. Met milestone 2" />
              </Field>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setLevelOpen(false)} className="toolbar-button">Cancel</button>
              <button onClick={saveLevel} disabled={savingLevel} className="toolbar-button bg-teal-600 text-white border-teal-600 hover:bg-teal-700 disabled:opacity-60">{savingLevel ? 'Saving…' : 'Save Level'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  const tones: Record<string, string> = {
    emerald: 'text-emerald-700',
    zinc: 'text-zinc-700',
    teal: 'text-teal-700',
    blue: 'text-blue-700',
    purple: 'text-purple-700',
  };
  return (
    <div className="wellness-stat">
      <div className="wellness-stat-label">{label}</div>
      <div className={`wellness-stat-value ${tones[tone || ''] || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function SortTh({ label, active, dir, onClick }: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void }) {
  return (
    <th className="px-3 py-2">
      <button onClick={onClick} className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-teal-700">
        {label}
        <span className="text-xs text-zinc-400">{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium text-gray-700">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

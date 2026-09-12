import { useState } from 'react';
import { apiClient } from '../../lib/api';
import { formatForexTTAmount, parseForexTTAmount } from './forexTTAmount';
import type { ForexTTAttachment, ForexTTFormData, ForexTTRequest } from './forexTTTypes';

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'CNY', name: 'Chinese Yuan' },
];

const ATTACHMENT_CATEGORIES: { value: string; label: string }[] = [
  { value: 'payment_voucher', label: 'Payment Voucher' },
  { value: 'supporting', label: 'Supporting Documents' },
];

const SENDER_NAME = 'The Republic of Nauru';

const fieldClass =
  'w-full h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:bg-zinc-50 disabled:text-zinc-500';

const selectClass =
  'w-full h-9 appearance-none rounded-md border border-zinc-300 bg-white px-3 pr-8 text-sm text-zinc-900 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:bg-zinc-50 disabled:text-zinc-500 bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2024%2024%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%3E%3Cpath%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20d%3D%22M19%209l-7%207-7-7%22%2F%3E%3C%2Fsvg%3E")] bg-[length:16px] bg-[right_8px_center] bg-no-repeat';

const labelClass = 'block text-xs font-medium text-zinc-600 mb-1';

interface ForexTTFormProps {
  request?: ForexTTRequest;
  onSaved: (r: ForexTTRequest) => void;
}

export function ForexTTForm({ request, onSaved }: ForexTTFormProps) {
  const [form, setForm] = useState<ForexTTFormData>(() => ({
    sender_account_name: SENDER_NAME,
    ...request?.form_data,
  }));
  const [amountInput, setAmountInput] = useState(() => formatForexTTAmount(request?.form_data.amount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filesByCategory, setFilesByCategory] = useState<Record<string, FileList | null>>({});
  const [attachments, setAttachments] = useState<ForexTTAttachment[]>(request?.attachments || []);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const update = (field: keyof ForexTTFormData, value: unknown) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const uploadSelectedFiles = async (requestId: string) => {
    for (const cat of ATTACHMENT_CATEGORIES) {
      const files = filesByCategory[cat.value];
      if (!files || files.length === 0) continue;
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append('files', file));
      formData.append('category', cat.value);
      const result = await apiClient.upload<{ attachments: ForexTTAttachment[] }>(
        `/forex-tt/${requestId}/attachments`,
        formData,
      );
      if (result?.attachments) {
        setAttachments((prev) => {
          const next = prev.filter((a) => !result.attachments!.some((na) => na.category === a.category));
          return [...next, ...result.attachments!];
        });
      }
    }
    setFilesByCategory({});
  };

  const removeAttachment = async (attachmentId: number) => {
    if (!request?.request_id) return;
    setRemovingId(attachmentId);
    setError(null);
    try {
      await apiClient.delete(`/forex-tt/${request.request_id}/attachments/${attachmentId}`);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch (err) {
      setError((err as Error).message || 'Failed to remove attachment.');
    } finally {
      setRemovingId(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseForexTTAmount(amountInput);
    if (amountInput && amount === null) {
      setError('Enter an amount with no more than two decimal places.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        form_data: { ...form, amount: amount ?? undefined, sender_account_name: SENDER_NAME },
        version: request?.version,
      };
      const saved = request?.id
        ? await apiClient.patch<ForexTTRequest>(`/forex-tt/${request.request_id}`, payload)
        : await apiClient.post<ForexTTRequest>('/forex-tt', payload);

      const hasFiles = ATTACHMENT_CATEGORIES.some((c) => filesByCategory[c.value]?.length);
      if (hasFiles && saved.request_id) {
        await uploadSelectedFiles(saved.request_id);
        const refreshed = await apiClient.get<ForexTTRequest>(`/forex-tt/${saved.request_id}`);
        onSaved(refreshed);
      } else {
        onSaved({ ...saved, attachments });
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to save request.');
    } finally {
      setBusy(false);
    }
  };

  const groupedAttachments = attachments.reduce<Record<string, ForexTTAttachment[]>>((acc, a) => {
    const key = a.category || 'supporting';
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Transfer Details */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 border-b border-zinc-100 pb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Transfer Details
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Currency</label>
            <select
              className={selectClass}
              value={form.currency || ''}
              onChange={(e) => update('currency', e.target.value)}
            >
              <option value="">Select currency…</option>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Amount</label>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className={fieldClass}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9.,]/g, ''))}
              onBlur={() => {
                const amount = parseForexTTAmount(amountInput);
                if (amount !== null) setAmountInput(formatForexTTAmount(amount));
              }}
              placeholder="0.00"
            />
          </div>

          <div>
            <label className={labelClass}>Priority</label>
            <select
              className={selectClass}
              value={form.priority || 'standard'}
              onChange={(e) => update('priority', e.target.value)}
            >
              <option value="standard">Standard</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Fee Paid By</label>
            <select
              className={selectClass}
              value={form.fee_paid_by || 'sender'}
              onChange={(e) => update('fee_paid_by', e.target.value)}
            >
              <option value="sender">Sender (OUR)</option>
              <option value="beneficiary">Beneficiary (BEN)</option>
              <option value="shared">Shared (SHA)</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass}>Payment Reason</label>
            <input
              type="text"
              className={fieldClass}
              value={form.payment_reason || ''}
              onChange={(e) => update('payment_reason', e.target.value)}
              placeholder="e.g. invoice payment, supplier settlement"
            />
          </div>
        </div>
      </section>

      {/* Beneficiary */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 border-b border-zinc-100 pb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Beneficiary Details
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>Beneficiary Name</label>
            <input
              type="text"
              className={fieldClass}
              value={form.beneficiary_name || ''}
              onChange={(e) => update('beneficiary_name', e.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass}>Beneficiary Address</label>
            <textarea
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              rows={2}
              value={form.beneficiary_address || ''}
              onChange={(e) => update('beneficiary_address', e.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Beneficiary Bank Name</label>
            <input
              type="text"
              className={fieldClass}
              value={form.beneficiary_bank_name || ''}
              onChange={(e) => update('beneficiary_bank_name', e.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>BIC / SWIFT Code</label>
            <input
              type="text"
              className={fieldClass}
              value={form.beneficiary_bic || ''}
              onChange={(e) => update('beneficiary_bic', e.target.value)}
              placeholder="e.g. ANZBAU2M"
            />
          </div>

          <div>
            <label className={labelClass}>Bank Address</label>
            <input
              type="text"
              className={fieldClass}
              value={form.beneficiary_bank_address || ''}
              onChange={(e) => update('beneficiary_bank_address', e.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>IBAN / Account Number</label>
            <input
              type="text"
              className={fieldClass}
              value={form.beneficiary_iban || form.beneficiary_account_number || ''}
              onChange={(e) => {
                const val = e.target.value;
                update(/^[A-Z]{2}/i.test(val) ? 'beneficiary_iban' : 'beneficiary_account_number', val);
              }}
            />
          </div>
        </div>
      </section>

      {/* Sender Account — fixed, Treasury completes BSB/Account */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 border-b border-zinc-100 pb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Sender Account
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>Account Name</label>
            <div className="flex h-9 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-700">
              {SENDER_NAME}
            </div>
          </div>
          <div>
            <label className={labelClass}>BSB</label>
            <div className="flex h-9 items-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 text-xs text-zinc-400">
              Treasury use only
            </div>
          </div>
          <div>
            <label className={labelClass}>Account Number</label>
            <div className="flex h-9 items-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 text-xs text-zinc-400">
              Treasury use only
            </div>
          </div>
        </div>
      </section>

      {/* Notes */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 border-b border-zinc-100 pb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Notes / Additional Instructions
        </h3>
        <textarea
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          rows={2}
          value={form.notes || ''}
          onChange={(e) => update('notes', e.target.value)}
          placeholder="Any additional instructions or context for the reviewer…"
        />
      </section>

      {/* Attachments */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 border-b border-zinc-100 pb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Supporting Documents (PDF, PNG, JPG)
        </h3>
        <div className="space-y-3">
          {ATTACHMENT_CATEGORIES.map((cat) => {
            const selected = filesByCategory[cat.value];
            const existing = groupedAttachments[cat.value] || [];
            return (
              <div key={cat.value} className="rounded-md border border-zinc-200 p-3">
                <label className="mb-2 block text-sm font-medium text-zinc-700">{cat.label}</label>
                {existing.length > 0 && (
                  <ul className="mb-2 divide-y divide-zinc-100 rounded-md border border-zinc-100">
                    {existing.map((a) => (
                      <li key={a.id} className="flex items-center justify-between px-3 py-2">
                        <a
                          href={`${import.meta.env.VITE_API_BASE_URL || '/api'}/forex-tt/attachments/${a.id}`}
                          download
                          className="text-sm text-amber-600 hover:underline"
                        >
                          {a.file_name}
                        </a>
                        {request?.id && (
                          <button
                            type="button"
                            onClick={() => removeAttachment(a.id)}
                            disabled={removingId === a.id}
                            className="text-sm text-red-600 hover:underline disabled:opacity-50"
                          >
                            {removingId === a.id ? 'Removing…' : 'Remove'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <input
                  id={`forex-tt-form-${cat.value}`}
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="sr-only"
                  onChange={(e) => setFilesByCategory((prev) => ({ ...prev, [cat.value]: e.target.files }))}
                />
                <label
                  htmlFor={`forex-tt-form-${cat.value}`}
                  className="inline-flex h-9 cursor-pointer items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Select files
                </label>
                <p className="mt-2 text-xs text-zinc-500">
                  {selected && selected.length > 0
                    ? `${selected.length} file${selected.length === 1 ? '' : 's'} selected`
                    : 'No files selected'}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="h-9 rounded-md bg-amber-500 px-5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {busy ? 'Saving…' : request?.id ? 'Save Changes' : 'Create Draft'}
        </button>
      </div>
    </form>
  );
}

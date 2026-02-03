/**
 * Reviewer Module
 * Handles batch retrieval, review submission, and reviewer archives
 */

import { appState } from '../../state/app-state.js';
import { apiClient } from '../../api/client.js';
import { getById } from '../../utils/dom.js';
import { setTab } from '../../core/tabs.js';
import { openModal, closeModal } from '../../utils/modals.js';
import {
  formatPdNumber,
  formatAuDateTime,
  formatIsoDateTime,
  escapeHtml,
  normalizeBSBStrict,
  downloadBase64File,
  fromBase64
} from '../../utils/index.js';
import { toBase64 } from '../../utils/encoding.js';
import { buildAbaFromHeader } from '../../utils/aba-generator.js';
import { normalizeBatchCode, ensureBatchCodeFormat } from '../../utils/parsers.js';
import { STAGE_META, STAGE_TRANSITIONS, HEADER_PRESETS } from '../../constants.js';
import { hasRole, ensureAuth, authDisplayName } from '../../core/auth.js';

// Module state
let currentRetrievedBatch = null;
let currentRetrievedCode = null;
let reviewerArchivesCache = [];
let reviewerArchiveSearchTerm = '';
let reviewerArchiveSearchTermRaw = '';

// DOM elements (will be initialized)
let retrieveBatchResult;
let retrieveBatchError;
let retrieveDecisionContainer;
let reviewerArchivesCard;
let reviewerArchiveTbody;
let reviewerArchiveSearchInput;
let reviewerArchiveFeedback;

// Utility functions
const U = {
  digitsOnly: (s) => String(s || '').replace(/[^0-9]/g, ''),
  money: (cents) => {
    const dollars = Math.floor(Math.abs(cents) / 100);
    const centsPart = Math.abs(cents) % 100;
    const sign = cents < 0 ? '-' : '';
    return `${sign}$${dollars.toLocaleString()}.${String(centsPart).padStart(2, '0')}`;
  }
};

// ensureBatchCodeFormat is imported from parsers.js

// normalizeBatchCode is imported from parsers.js

/**
 * Find preset name by balance account
 */
function findPresetNameByBalance(bsb, acct) {
  if (!bsb || !acct) return '';
  const targetBsb = normalizeBSBStrict(bsb) || '';
  const targetAcct = String(acct).trim();
  if (!targetBsb || !targetAcct) return '';
  try {
    const entries = Object.entries(HEADER_PRESETS || {});
    for (const [name, preset] of entries) {
      const presetBsb = normalizeBSBStrict(preset?.balance_bsb || '') || '';
      const presetAcct = String(preset?.balance_acct || '').trim();
      if (presetBsb === targetBsb && presetAcct === targetAcct) return name;
    }
  } catch (_) {
    return '';
  }
  return '';
}

/**
 * Load reviews for a batch
 */
async function loadReviewsForBatch(batchId) {
  try {
    const reviews = await window.apiRequest(`/reviews/${batchId}`);
    return Array.isArray(reviews) ? reviews : [];
  } catch (err) {
    console.warn('Failed to load review history', err);
    return [];
  }
}

/**
 * Render review list
 */
function renderReviewList(reviews) {
  if (!reviews.length) return '<p class="text-xs text-gray-500">No reviewer activity recorded yet.</p>';
  return `
    <ul class="space-y-2 text-xs text-gray-600">
      ${reviews.map(r => `
        <li class="border border-gray-200 rounded-md p-2">
          <div class="flex justify-between"><span class="font-medium">${escapeHtml(r.reviewer || 'Unknown')}</span><span>${formatAuDateTime(r.created_at)}</span></div>
          <div>Status: <strong>${escapeHtml(r.status || 'unknown')}</strong></div>
          ${r.comments ? `<div>Comments: ${escapeHtml(r.comments)}</div>` : ''}
        </li>`).join('')}
    </ul>`;
}

const reviewerDetailsPlaceholder = '';

const reviewerDecisionPlaceholder = '';

function resetReviewerPanels() {
  if (retrieveBatchResult) retrieveBatchResult.innerHTML = reviewerDetailsPlaceholder;
  if (retrieveDecisionContainer) retrieveDecisionContainer.innerHTML = reviewerDecisionPlaceholder;
  if (retrieveBatchError) retrieveBatchError.classList.add('hidden');
}

function setReviewerLoadingState() {
  if (retrieveBatchResult) retrieveBatchResult.innerHTML = '<p class="text-sm text-gray-500">Loading…</p>';
  if (retrieveDecisionContainer) retrieveDecisionContainer.innerHTML = reviewerDecisionPlaceholder;
}

function showReviewerDetailsMessage(message) {
  if (retrieveBatchResult) {
    retrieveBatchResult.innerHTML = `
      <div class="border border-dashed border-gray-300 rounded-md p-3 text-sm text-gray-600 bg-white">
        ${escapeHtml(message)}
      </div>
    `;
  }
  if (retrieveDecisionContainer) retrieveDecisionContainer.innerHTML = reviewerDecisionPlaceholder;
}

function isoForInput(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function ddmmyyToIso(ddmmyy) {
  if (!/^\d{6}$/.test(ddmmyy || '')) return '';
  const day = ddmmyy.slice(0, 2);
  const month = ddmmyy.slice(2, 4);
  const year = ddmmyy.slice(4);
  const iso = `20${year}-${month}-${day}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return iso;
}

function isoToDdmmyy(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  return `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + Number(days || 0));
  return copy;
}

async function loadBatchForReview(rawCode) {
  const code = (rawCode || '').trim();
  if (!code) {
    showReviewerDetailsMessage('Batch code missing.');
    return false;
  }
  if (retrieveBatchError) retrieveBatchError.classList.add('hidden');
  setReviewerLoadingState();
  const digits = code.replace(/\D/g, '');
  const formatted = ensureBatchCodeFormat(code);
  const candidates = [];
  const addCandidate = (val) => { if (val && !candidates.includes(val)) candidates.push(val); };
  addCandidate(formatted);
  addCandidate(digits);
  addCandidate(code);

  let fetchedBatch = null;
  let usedCode = candidates[0] || code;
  let lastError = null;
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeBatchCode(candidate);
    if (!normalizedCandidate) continue;
    try {
      fetchedBatch = await window.apiRequest(`/batches/${normalizedCandidate.encoded}`);
      usedCode = normalizedCandidate.raw;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!fetchedBatch) {
    const feedback = lastError?.message || 'Batch not found.';
    if (retrieveBatchError) {
      retrieveBatchError.textContent = feedback;
      retrieveBatchError.classList.remove('hidden');
    }
    showReviewerDetailsMessage(feedback);
    return false;
  }

  currentRetrievedBatch = fetchedBatch;
  const reviews = fetchedBatch.batch_id ? await loadReviewsForBatch(fetchedBatch.batch_id) : [];
  if (retrieveBatchError) retrieveBatchError.classList.add('hidden');
  const normalizedCode = ensureBatchCodeFormat(fetchedBatch.code || usedCode);
  currentRetrievedCode = normalizedCode;
  renderRetrievedBatch(fetchedBatch, reviews);
  return true;
}

async function refreshRetrievedBatch(code) {
  if (!code) return;
  await loadBatchForReview(code);
}

function openValueDateModal(batch, payload, formattedCode) {
  if (!payload?.header || !Array.isArray(payload.transactions)) {
    alert('Original header or transactions unavailable. Cannot adjust value date.');
    return;
  }
  const header = payload.header || {};
  const today = new Date();
  const minIso = isoForInput(today);
  const maxIso = isoForInput(addDays(today, 2));
  const currentIso = ddmmyyToIso(header.proc) || minIso;
  const descValue = header.desc || '';
  const remitterValue = header.remitter || '';
  const stageInfo = STAGE_META[(batch.stage || '').toLowerCase()] || {};

  openModal(`
    <div class="space-y-4 text-sm text-gray-700">
      <div>
        <h3 class="text-lg font-semibold text-gray-800">Adjust Value Date</h3>
        <p class="text-xs text-gray-500 mt-1">Bank requires value dates to be within 2 business days. Update the processing date, description, or remitter and save a refreshed ABA.</p>
      </div>
      <div class="border border-gray-200 rounded-md p-3 bg-gray-50 space-y-1">
        <p class="font-medium">Batch ${escapeHtml(formattedCode)}</p>
        <p>Current stage: <span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ${stageInfo.classes || 'bg-gray-100 text-gray-700'}">${escapeHtml(stageInfo.label || batch.stage || '-')}</span></p>
        <p>Existing value date: <strong>${escapeHtml(header.proc || '-')}</strong></p>
      </div>
      <form id="value-date-form" class="space-y-3">
        <div>
          <label class="block mb-1 font-medium" for="value-date-input">New value date</label>
          <input id="value-date-input" type="date" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" value="${currentIso}" min="${minIso}" max="${maxIso}" required>
          <p class="text-xs text-gray-500 mt-1">Choose today or a future date within the next 2 business days.</p>
        </div>
        <div>
          <label class="block mb-1 font-medium" for="value-date-desc">Description (Type 0)</label>
          <input id="value-date-desc" type="text" maxlength="12" value="${escapeHtml(descValue)}" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200">
        </div>
        <div>
          <label class="block mb-1 font-medium" for="value-date-remitter">Remitter</label>
          <input id="value-date-remitter" type="text" maxlength="16" value="${escapeHtml(remitterValue)}" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200">
        </div>
        <p id="value-date-error" class="text-xs text-red-600 hidden"></p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="value-date-cancel" class="px-3 py-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="submit" id="value-date-submit" class="px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700">Save update</button>
        </div>
      </form>
    </div>
  `);

  setTimeout(() => {
    const form = getById('value-date-form');
    const errorEl = getById('value-date-error');
    const dateInput = getById('value-date-input');
    const descInput = getById('value-date-desc');
    const remitterInput = getById('value-date-remitter');
    const submitBtn = getById('value-date-submit');
    const cancelBtn = getById('value-date-cancel');

    cancelBtn?.addEventListener('click', () => closeModal());

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (errorEl) errorEl.classList.add('hidden');
      const isoVal = dateInput?.value || '';
      const min = minIso || '';
      const max = maxIso || '';
      if (!isoVal) {
        if (errorEl) {
          errorEl.textContent = 'Select a new value date.';
          errorEl.classList.remove('hidden');
        }
        dateInput?.focus();
        return;
      }
      if (min && isoVal < min) {
        if (errorEl) {
          errorEl.textContent = 'Value date cannot be in the past.';
          errorEl.classList.remove('hidden');
        }
        dateInput?.focus();
        return;
      }
      if (max && isoVal > max) {
        if (errorEl) {
          errorEl.textContent = 'Value date must be within the next 2 business days.';
          errorEl.classList.remove('hidden');
        }
        dateInput?.focus();
        return;
      }
      const newProc = isoToDdmmyy(isoVal);
      if (!/^\d{6}$/.test(newProc)) {
        if (errorEl) {
          errorEl.textContent = 'Unable to parse the selected date.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      const updatedHeader = { ...header, proc: newProc };
      if (descInput) updatedHeader.desc = descInput.value?.trim() || '';
      if (remitterInput) updatedHeader.remitter = remitterInput.value?.trim() || '';

      let abaContent = '';
      try {
        abaContent = buildAbaFromHeader(updatedHeader, payload.transactions);
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message || 'Unable to rebuild ABA file.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      const body = {
        proc: newProc,
        desc: updatedHeader.desc,
        remitter: updatedHeader.remitter,
        aba_content: toBase64(abaContent)
      };

      const restoreBtn = () => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save update';
        }
      };

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving…';
      }

      try {
        const updatedBatch = await window.apiRequest(`/batches/${formattedCode}/value-date`, {
          method: 'PATCH',
          body: JSON.stringify(body)
        });
        closeModal();
        const refreshedReviews = batch.batch_id ? await loadReviewsForBatch(batch.batch_id) : [];
        currentRetrievedBatch = updatedBatch;
        currentRetrievedCode = ensureBatchCodeFormat(updatedBatch.code);
        renderRetrievedBatch(updatedBatch, refreshedReviews);
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message || 'Unable to update value date.';
          errorEl.classList.remove('hidden');
        }
        restoreBtn();
        return;
      }
    });
  }, 50);
}

/**
 * Build archive row markup
 */
function archiveRowMarkup(item, { allowDelete = false } = {}) {
  const meta = item?.transactions || {};
  const prepared = escapeHtml(meta.prepared_by || '-');
  const submittedBy = escapeHtml(item?.submitted_email || '-');
  const created = formatAuDateTime(item?.created_at);
  const formattedCode = ensureBatchCodeFormat(item?.code);
  const stage = (item?.stage || 'submitted').toLowerCase();
  const stageInfo = STAGE_META[stage] || { label: stage, classes: 'bg-gray-100 text-gray-700' };
  const stageBadge = `<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${stageInfo.classes}">${escapeHtml(stageInfo.label)}</span>`;
  const pdRaw = item?.pd_number || meta.pd_number || '';
  const pdDisplay = pdRaw ? escapeHtml(formatPdNumber(pdRaw)) : '-';
  
  const actions = [
    { label: 'View', action: 'view', classes: 'px-2 py-1 bg-indigo-500 text-white rounded hover:bg-indigo-600 text-xs', dataCode: formattedCode }
  ];
  
  if (allowDelete && item?.stage === 'rejected') {
    actions.push({ label: 'Delete', action: 'delete', classes: 'px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs', dataCode: formattedCode });
  }
  
  const actionsHtml = actions.map(({ label, action, classes, dataCode }) => {
    return `<button data-action="${action}" data-code="${escapeHtml(dataCode)}" class="${classes}">${label}</button>`;
  }).join('');
  
  return `
    <tr class="border-b">
      <td class="px-3 py-2 font-mono">${escapeHtml(formattedCode)}</td>
      <td class="px-3 py-2">${stageBadge}</td>
      <td class="px-3 py-2">${pdDisplay}</td>
      <td class="px-3 py-2">${escapeHtml(item?.department_code || '-')}</td>
      <td class="px-3 py-2">${prepared}</td>
      <td class="px-3 py-2 text-xs">${submittedBy}</td>
      <td class="px-3 py-2 text-xs text-gray-500">${created}</td>
      <td class="px-3 py-2">
        <div class="flex justify-end gap-2">${actionsHtml}</div>
      </td>
    </tr>`;
}

/**
 * Build archive search values
 */
function buildArchiveSearchValues(item) {
  const meta = item?.transactions || {};
  return [
    item?.code || '',
    item?.pd_number || meta.pd_number || '',
    item?.department_code || meta.department_code || '',
    meta.prepared_by || '',
    item?.stage || ''
  ].map(v => String(v || '').toLowerCase()).join(' ');
}

/**
 * Match archive search
 */
function matchesArchiveSearch(item, term) {
  if (!term) return true;
  const normalizedTerm = term.toLowerCase();
  const compactTerm = normalizedTerm.replace(/[^a-z0-9]/g, '');
  const values = buildArchiveSearchValues(item);
  const compactValues = values.replace(/[^a-z0-9]/g, '');
  return values.includes(normalizedTerm) || compactValues.includes(compactTerm);
}

/**
 * Filter reviewer archives
 */
function filteredReviewerArchives() {
  if (!reviewerArchivesCache) return [];
  const term = reviewerArchiveSearchTerm.trim();
  if (!term) return [...reviewerArchivesCache];
  return reviewerArchivesCache.filter(item => matchesArchiveSearch(item, term));
}

/**
 * Render reviewer archives
 */
function renderReviewerArchives(archives) {
  if (!reviewerArchiveTbody) return;
  const list = Array.isArray(archives) ? archives : [];
  if (!list.length) {
    const message = reviewerArchiveSearchTerm ? 'No archives match the current search.' : 'No archives available yet.';
    reviewerArchiveTbody.innerHTML = `<tr><td colspan="8" class="px-3 py-3 text-center text-gray-500">${message}</td></tr>`;
    return;
  }
  reviewerArchiveTbody.innerHTML = list.map(item => archiveRowMarkup(item, { allowDelete: false })).join('');
}

/**
 * Load reviewer archives
 */
async function loadReviewerArchives(showFeedback = false) {
  if (!hasRole('reviewer') || !reviewerArchiveTbody) return;
  reviewerArchiveTbody.innerHTML = '<tr><td colspan="8" class="px-3 py-3 text-center text-gray-500">Loading…</td></tr>';
  try {
    const archives = await window.apiRequest('/archives');
    reviewerArchivesCache = Array.isArray(archives) ? archives : [];
    renderReviewerArchives(filteredReviewerArchives());
    if (reviewerArchiveSearchInput) reviewerArchiveSearchInput.value = reviewerArchiveSearchTermRaw;
    if (showFeedback && reviewerArchiveFeedback) {
      reviewerArchiveFeedback.textContent = 'Archive list refreshed.';
      reviewerArchiveFeedback.classList.remove('hidden');
      setTimeout(() => reviewerArchiveFeedback.classList.add('hidden'), 4000);
    }
  } catch (err) {
    reviewerArchiveTbody.innerHTML = `<tr><td colspan="8" class="px-3 py-3 text-center text-red-600">${err.message || 'Failed to load archives.'}</td></tr>`;
    if (reviewerArchiveFeedback) {
      reviewerArchiveFeedback.textContent = err.message || 'Failed to load archives.';
      reviewerArchiveFeedback.classList.remove('hidden');
      setTimeout(() => reviewerArchiveFeedback.classList.add('hidden'), 4000);
    }
  }
}

/**
 * Apply header payload to generator
 */
function applyHeaderPayload(header) {
  if (!header) return;
  ['fi', 'reel', 'user', 'apca', 'desc', 'proc', 'trace_bsb', 'trace_acct', 'remitter'].forEach(key => {
    const el = getById(key);
    if (el && header[key] !== undefined) el.value = header[key];
  });
  ['balance_bsb', 'balance_acct', 'balance_title', 'balance_txn_code'].forEach(key => {
    const el = getById(key);
    if (el && header[key] !== undefined) el.value = header[key];
  });
  if (typeof window.saveToLocalStorage === 'function') {
    window.saveToLocalStorage();
  }
}

/**
 * Render retrieved batch
 */
function renderRetrievedBatch(batch, reviews) {
  const formattedCode = ensureBatchCodeFormat(batch.code);
  const normalizedBatchCode = normalizeBatchCode(batch.code);
  const encodedBatchCode = normalizedBatchCode?.encoded;
  const stage = (batch.stage || 'submitted').toLowerCase();
  const stageInfo = STAGE_META[stage] || { label: stage, classes: 'bg-gray-100 text-gray-700' };
  const transitions = STAGE_TRANSITIONS[stage] || { approve: false, reject: false };
  const meta = batch.transactions || {};
  const metrics = meta.metrics || {};
  const duplicates = meta.duplicates || { sets: 0, rows: 0 };
  const payload = meta.payload;
  const hasPayload = payload && Array.isArray(payload.transactions);
  const payloadAvailable = hasPayload;
  const derivedTxnCount = hasPayload ? payload.transactions.length : null;
  const derivedCreditsCents = hasPayload
    ? payload.transactions.reduce((sum, tx) => sum + Math.round((parseFloat(tx.amount) || 0) * 100), 0)
    : null;
  const txnCount = metrics.transactionCount ?? derivedTxnCount ?? '-';
  const creditsDisplay = metrics.creditsCents !== undefined
    ? U.money(metrics.creditsCents)
    : (derivedCreditsCents !== null ? U.money(derivedCreditsCents) : '-');
  const pdRaw = batch.pd_number || meta.pd_number || '';
  const pdNumber = pdRaw ? formatPdNumber(pdRaw) : '-';
  const submitterEmail = escapeHtml(batch.submitted_email || meta.submitted_by_email || '-');
  const hasFile = stage === 'approved' && !!batch.file_base64;
  const createdAtDisplay = formatAuDateTime(batch.created_at);
  const stageBadge = `<span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${stageInfo.classes}">${escapeHtml(stageInfo.label)}</span>`;
  const canAdjustValueDate = hasRole('reviewer') && stage === 'approved';
  const adjustBtnClass = payloadAvailable
    ? 'px-4 py-2 bg-slate-700 text-white rounded-md hover:bg-slate-800'
    : 'px-4 py-2 bg-slate-500 text-white rounded-md opacity-60 cursor-not-allowed';
  const adjustBtnAttrs = payloadAvailable ? '' : 'disabled aria-disabled="true"';
  
  // Try to compute balancing/preset match from payload header if available
  let balMatch = '';
  let balBsbForSummary = '';
  let balAcctForSummary = '';
  if (payload && payload.header) {
    const h = payload.header;
    balMatch = findPresetNameByBalance(h.balance_bsb || '', h.balance_acct || '');
    balBsbForSummary = normalizeBSBStrict(h.balance_bsb || '') || '';
    balAcctForSummary = U.digitsOnly(h.balance_acct || '') || '';
  }
  
  // Fallback: if no match but approved file is available, decode and parse balancing record from file
  if (!balMatch && hasFile && batch.file_base64) {
    try {
      const text = fromBase64(batch.file_base64).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      let balBsb = '', balAcct = '';
      lines.forEach(raw => {
        const line = (raw + ' '.repeat(120)).slice(0, 120);
        if (line[0] !== '1') return;
        const code2 = line.slice(18, 20).trim();
        if (code2 === '13') {
          balBsb = line.slice(1, 8).trim();
          balAcct = line.slice(8, 17).trim();
        }
      });
      if (balBsb && balAcct) {
        balMatch = findPresetNameByBalance(balBsb, balAcct) || '';
        balBsbForSummary = normalizeBSBStrict(balBsb) || balBsb;
        balAcctForSummary = U.digitsOnly(balAcct) || balAcct;
      }
    } catch (_) { /* ignore */ }
  }

  const summaryList = `
    <ul class="list-disc list-inside space-y-1 text-sm text-gray-700">
      <li>Code: <strong class="font-mono">${escapeHtml(formattedCode)}</strong></li>
      <li>Stage: ${stageBadge}</li>
      <li>PD reference: <strong>${escapeHtml(pdNumber)}</strong></li>
      <li>Department: <strong>${escapeHtml(batch.department_code || meta.department_code || '-')}</strong></li>
      <li>Prepared by: <strong>${escapeHtml(meta.prepared_by || '-')}</strong></li>
      <li>Submitted by: <strong>${submitterEmail}</strong></li>
      <li>Created: <strong>${createdAtDisplay}</strong></li>
      <li>Transactions: <strong>${txnCount}</strong></li>
      <li>Total credits: <strong>${creditsDisplay}</strong></li>
      <li>Duplicate sets: <strong>${duplicates.sets || 0}</strong></li>
      ${balMatch ? `<li>Bank account preset: <strong>${escapeHtml(balMatch)}</strong></li>` : ''}
      ${balMatch && (balBsbForSummary || balAcctForSummary) ? `<li>Account: <span class="font-mono">${escapeHtml(balBsbForSummary)}</span> <span class="font-mono">${escapeHtml(balAcctForSummary)}</span></li>` : ''}
    </ul>`;
  const notesBlock = meta.notes
    ? `<div class="text-xs text-gray-700 bg-amber-50 border border-amber-200 rounded-md p-2">
         <p class="font-semibold text-amber-900">Submitter notes</p>
         <p class="mt-1">${escapeHtml(meta.notes)}</p>
       </div>`
    : '';
  const stageNotice = hasFile ? '' : '<p class="text-xs text-amber-600">ABA download becomes available once the batch is approved.</p>';
  if (!retrieveBatchResult || !retrieveDecisionContainer) return;
  
  retrieveBatchResult.innerHTML = `
    <div class="bg-gray-50 border border-gray-200 rounded-md p-3 space-y-4">
      <div class="space-y-2">
        ${summaryList}
      </div>
      ${notesBlock ? `<div>${notesBlock}</div>` : ''}
      <div class="border-t border-gray-200 pt-3">
        <h3 class="font-medium text-sm text-gray-800 mb-2">Reviewer log</h3>
        <div id="retrieve-review-list">${renderReviewList(reviews)}</div>
      </div>
      ${stageNotice ? `<p class="text-xs text-amber-600">${stageNotice.replace(/<\/?p[^>]*>/g, '')}</p>` : ''}
      <div class="flex flex-wrap items-center gap-2 pt-1">
        <button id="retrieve-download" class="px-4 py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600 ${hasFile ? '' : 'opacity-50 cursor-not-allowed'}" ${hasFile ? '' : 'disabled'}>Download ABA</button>
        <button id="retrieve-open-reader" class="px-4 py-2 bg-amber-500 text-white rounded-md hover:bg-amber-600">Open in Reader</button>
        ${canAdjustValueDate ? `<button id="retrieve-adjust-value" class="${adjustBtnClass}" ${adjustBtnAttrs}>Adjust Value Date</button>` : ''}
      </div>
      ${canAdjustValueDate && !payloadAvailable ? '<p class="text-xs text-gray-500">Original payload is unavailable for this batch. Load it in Generator to regenerate the ABA if you need to adjust the value date.</p>' : ''}
    </div>
  `;
  retrieveDecisionContainer.innerHTML = `
    <form id="retrieve-review-form" class="space-y-3 text-sm text-gray-700 border-2 border-red-500 rounded-md p-3 bg-red-50 h-full">
      <h3 class="font-medium text-gray-800 text-red-900">Record reviewer decision</h3>
      <div>
        <label class="block mb-1 font-medium" for="retrieve-reviewer">Reviewer name</label>
        <input id="retrieve-reviewer" type="text" required class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200">
      </div>
      <input type="hidden" id="retrieve-decision" value="note">
      <div>
        <label class="block mb-1 font-medium" for="retrieve-comments">Comments</label>
        <textarea id="retrieve-comments" rows="3" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" placeholder="Add any notes"></textarea>
      </div>
      <p id="retrieve-review-error" class="text-xs text-red-600 hidden"></p>
      <div class="flex flex-wrap gap-2">
        <button type="button" data-decision="note" class="px-3 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-100">Record note</button>
        ${transitions.approve ? '<button type="button" data-decision="approved" class="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-semibold shadow-md">Approve</button>' : ''}
        ${transitions.reject ? '<button type="button" data-decision="rejected" class="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-semibold shadow-md">Reject</button>' : ''}
      </div>
    </form>
  `;

  const downloadBtn = getById('retrieve-download');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      if (!hasFile) {
        alert('The ABA file is only available after approval.');
        return;
      }
      downloadBase64File(batch.file_base64, batch.file_name || `${formattedCode}.aba`);
    });
  }
  
  getById('retrieve-open-reader')?.addEventListener('click', () => {
    if (typeof window.openBatchInReader === 'function') {
      window.openBatchInReader(batch);
    }
  });
  
  if (canAdjustValueDate) {
    const adjustBtn = getById('retrieve-adjust-value');
    adjustBtn?.addEventListener('click', () => {
      if (!payloadAvailable) {
        alert('Original batch payload is unavailable. Load the batch into Generator to regenerate the ABA before adjusting the value date.');
        return;
      }
      openValueDateModal(batch, payload, formattedCode);
    });
  }

  const reviewForm = getById('retrieve-review-form');
  const reviewError = getById('retrieve-review-error');
  const reviewerInput = getById('retrieve-reviewer');
  const decisionSelect = getById('retrieve-decision');
  const commentsInput = getById('retrieve-comments');
  const reviewerName = hasRole('reviewer') ? authDisplayName() : '';
  
  if (reviewerInput) {
    if (reviewerName) {
      reviewerInput.value = reviewerName;
      reviewerInput.defaultValue = reviewerName;
      reviewerInput.readOnly = true;
      reviewerInput.classList.add('locked');
      reviewerInput.setAttribute('aria-readonly', 'true');
    } else {
      reviewerInput.readOnly = false;
      reviewerInput.classList.remove('locked');
      reviewerInput.removeAttribute('aria-readonly');
    }
  }

  reviewForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!hasRole('reviewer')) {
      ensureAuth('reviewer', () => renderRetrievedBatch(batch, reviews));
      return;
    }
    reviewError?.classList.add('hidden');
    const reviewer = reviewerInput?.value.trim();
    if (!reviewer) {
      if (reviewError) {
        reviewError.textContent = 'Reviewer name is required.';
        reviewError.classList.remove('hidden');
      }
      return;
    }
    const decision = decisionSelect?.value || 'note';
    const comments = commentsInput?.value.trim() || '';
    if (decision === 'rejected' && !comments) {
      if (reviewError) {
        reviewError.textContent = 'Provide a reason when rejecting a batch.';
        reviewError.classList.remove('hidden');
      }
      return;
    }
    if (decision === 'approved' && !transitions.approve) {
      if (reviewError) {
        reviewError.textContent = 'Batch cannot transition to approved from its current stage.';
        reviewError.classList.remove('hidden');
      }
      return;
    }
    if (decision === 'rejected' && !transitions.reject) {
      if (reviewError) {
        reviewError.textContent = 'Batch cannot be rejected from its current stage.';
        reviewError.classList.remove('hidden');
      }
      return;
    }
    try {
      if (decision !== 'note' && decision !== stage) {
        if (!encodedBatchCode) {
          throw new Error('Batch code unavailable for stage change.');
        }
        await window.apiRequest(`/batches/${encodedBatchCode}/stage`, {
          method: 'PATCH',
          body: JSON.stringify({ stage: decision, comments: comments || undefined })
        });
      } else {
        await window.apiRequest('/reviews', {
          method: 'POST',
          body: JSON.stringify({
            batch_id: batch.batch_id,
            reviewer,
            status: 'submitted',
            comments: comments || null,
            metadata: { previous_stage: stage, decision_source: 'reviewer_panel' }
          })
        });
      }
      if (!encodedBatchCode) {
        throw new Error('Batch code unavailable for refresh.');
      }
      const refreshedBatch = await window.apiRequest(`/batches/${encodedBatchCode}`);
      currentRetrievedBatch = refreshedBatch;
      currentRetrievedCode = ensureBatchCodeFormat(refreshedBatch.code);
      const updatedReviews = refreshedBatch.batch_id ? await loadReviewsForBatch(refreshedBatch.batch_id) : [];
      renderRetrievedBatch(refreshedBatch, updatedReviews);
      if (decision !== 'note') {
        await loadReviewerArchives(true);
        if (hasRole('admin') && typeof window.loadAdminArchives === 'function') {
          await window.loadAdminArchives(true);
        }
      } else {
        await loadReviewerArchives();
      }
    } catch (err) {
      if (reviewError) {
        reviewError.textContent = err.message || 'Unable to save decision.';
        reviewError.classList.remove('hidden');
      }
    }
  });

  if (reviewForm) {
    reviewForm.querySelectorAll('button[data-decision]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (decisionSelect) decisionSelect.value = btn.getAttribute('data-decision') || 'note';
        reviewForm.requestSubmit();
      });
    });
  }
}

/**
 * Initialize Reviewer module
 */
export function initReviewer() {
  // Initialize DOM elements
  retrieveBatchResult = getById('retrieve-batch-result');
  retrieveBatchError = getById('retrieve-batch-error');
  retrieveDecisionContainer = getById('retrieve-decision-container');
  reviewerArchivesCard = getById('reviewer-archives-card');
  reviewerArchiveTbody = getById('reviewer-archive-tbody');
  reviewerArchiveSearchInput = getById('reviewer-archive-search');
  reviewerArchiveFeedback = getById('reviewer-archive-feedback');
  resetReviewerPanels();

  // Reviewer archives search
  if (reviewerArchiveSearchInput) {
    reviewerArchiveSearchInput.addEventListener('input', (e) => {
      reviewerArchiveSearchTermRaw = e.target.value || '';
      reviewerArchiveSearchTerm = reviewerArchiveSearchTermRaw.trim().toLowerCase();
      renderReviewerArchives(filteredReviewerArchives());
    });
  }

  // Reviewer archives table click handler
  attachArchiveTableHandler(reviewerArchiveTbody, 'reviewer');

  // Load archives when reviewer tab is opened
  const tabReviewer = getById('tab-reviewer');
  if (tabReviewer) {
    tabReviewer.addEventListener('click', () => {
      if (!hasRole('reviewer')) {
        ensureAuth('reviewer', () => {
          if (reviewerArchivesCard) reviewerArchivesCard.classList.remove('hidden');
          if (!reviewerArchivesCache.length) loadReviewerArchives();
        });
        return;
      }
      if (reviewerArchivesCard) reviewerArchivesCard.classList.remove('hidden');
      if (!reviewerArchivesCache.length) loadReviewerArchives();
    });
  }
}

/**
 * Process archive action (approve, reject, delete, open, download, copy)
 * Shared between admin and reviewer modules
 */
export async function processArchiveAction(action, code, tableRole = 'admin') {
  const normalized = normalizeBatchCode(code);
  if (!normalized) return;
  const { raw, formatted, encoded } = normalized;
  
  if (action === 'copy') {
    try { 
      await navigator.clipboard?.writeText?.(formatted); 
    } catch (err) { 
      console.warn('Copy failed', err); 
    }
    return;
  }

  if (action === 'approve' || action === 'reject') {
    if (!hasRole('admin')) {
      if (typeof window.showAdminSection === 'function') {
        ensureAuth('admin', () => window.showAdminSection('archives', true));
      }
      return;
    }
    try {
      let comments;
      let notify = true;
      if (action === 'reject') {
        const input = prompt('Provide a reason for rejection (emailed to the submitter):', '');
        if (input === null) return; // cancelled
        comments = (input || '').trim();
        const notifyChoice = confirm('Notify the original submitter by email? Click OK to notify, Cancel for silent revert.');
        notify = notifyChoice;
      }
      const payload = { stage: action === 'approve' ? 'approved' : 'rejected' };
      if (comments) payload.comments = comments;
      if (action === 'reject') payload.notify = notify;
      const updated = await apiClient.patch(`/batches/${encoded}/stage`, payload);
      
      // Update caches and UI - use window functions if available
      if (typeof window.renderAdminArchives === 'function' && typeof window.filteredAdminArchives === 'function') {
        if (typeof window.adminArchivesCache !== 'undefined') {
          window.adminArchivesCache = window.adminArchivesCache.map((item) => item.code === raw ? { ...item, ...updated } : item);
          window.renderAdminArchives(window.filteredAdminArchives());
        }
      }
      reviewerArchivesCache = reviewerArchivesCache.map((item) => item.code === raw ? { ...item, ...updated } : item);
      renderReviewerArchives(filteredReviewerArchives());
      
      if (typeof window.adminSectionLoaded !== 'undefined') {
        window.adminSectionLoaded.add('archives');
      }
      
      if (tableRole === 'admin' && typeof window.adminArchiveFeedback !== 'undefined') {
        const verb = action === 'approve' ? 'approved' : 'rejected';
        window.adminArchiveFeedback.textContent = `Batch ${formatted} ${verb}.`;
        window.adminArchiveFeedback.classList.remove('hidden');
        setTimeout(() => window.adminArchiveFeedback.classList.add('hidden'), 4000);
      }
      
      if (currentRetrievedCode === formatted) {
        await refreshRetrievedBatch(formatted);
      }
    } catch (err) {
      if (tableRole === 'admin' && typeof window.adminArchiveFeedback !== 'undefined') {
        window.adminArchiveFeedback.textContent = err.message || 'Unable to change stage.';
        window.adminArchiveFeedback.classList.remove('hidden');
        setTimeout(() => window.adminArchiveFeedback.classList.add('hidden'), 4000);
      }
    }
    return;
  }

  if (action === 'delete') {
    if (!hasRole('admin')) {
      if (typeof window.showAdminSection === 'function') {
        ensureAuth('admin', () => window.showAdminSection('archives', true));
      }
      return;
    }
    if (!confirm(`Delete batch ${formatted}? This cannot be undone.`)) return;
    try {
      await apiClient.delete(`/batches/${encoded}`);
      if (tableRole === 'admin' && typeof window.adminArchiveFeedback !== 'undefined') {
        window.adminArchiveFeedback.textContent = `Batch ${formatted} deleted.`;
        window.adminArchiveFeedback.classList.remove('hidden');
        setTimeout(() => window.adminArchiveFeedback.classList.add('hidden'), 4000);
      }
      
      if (typeof window.adminArchivesCache !== 'undefined') {
        window.adminArchivesCache = window.adminArchivesCache.filter(item => item.code !== raw);
        if (typeof window.renderAdminArchives === 'function' && typeof window.filteredAdminArchives === 'function') {
          window.renderAdminArchives(window.filteredAdminArchives());
        }
      }
      reviewerArchivesCache = reviewerArchivesCache.filter(item => item.code !== raw);
      renderReviewerArchives(filteredReviewerArchives());
      
      if (typeof window.adminSectionLoaded !== 'undefined') {
        window.adminSectionLoaded.add('archives');
      }
      
      if (currentRetrievedCode === formatted) {
        showReviewerDetailsMessage('Batch has been deleted.');
      }
    } catch (err) {
      if (tableRole === 'admin' && typeof window.adminArchiveFeedback !== 'undefined') {
        window.adminArchiveFeedback.textContent = err.message || 'Unable to delete batch.';
        window.adminArchiveFeedback.classList.remove('hidden');
        setTimeout(() => window.adminArchiveFeedback.classList.add('hidden'), 4000);
      }
    }
    return;
  }

  if (action === 'open' || action === 'view') {
    const openBatch = () => {
      setTab('reviewer');
      loadBatchForReview(formatted);
    };
    ensureAuth('reviewer', openBatch);
    return;
  }

  if (action === 'download') {
    if (!hasRole('reviewer')) {
      ensureAuth('reviewer', () => {});
      return;
    }
    try {
      const batch = await apiClient.get(`/batches/${encoded}`);
      if (batch?.file_base64) {
        downloadBase64File(batch.file_base64, batch.file_name || `${formatted}.aba`);
      } else {
        throw new Error('File available once approved.');
      }
    } catch (err) {
      const feedbackEl = tableRole === 'admin' 
        ? (typeof window.adminArchiveFeedback !== 'undefined' ? window.adminArchiveFeedback : null)
        : reviewerArchiveFeedback;
      if (feedbackEl) {
        feedbackEl.textContent = err.message || 'Unable to download batch.';
        feedbackEl.classList.remove('hidden');
        setTimeout(() => feedbackEl.classList.add('hidden'), 4000);
      }
    }
  }
}

/**
 * Attach archive table click handler
 */
export function attachArchiveTableHandler(tbody, role) {
  tbody?.addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const code = btn.dataset.code;
    if (!code) return;
    await processArchiveAction(btn.dataset.action, code, role);
  });
}

// Export for global access during migration
window.loadReviewerArchives = loadReviewerArchives;
window.renderRetrievedBatch = renderRetrievedBatch;
window.loadReviewsForBatch = loadReviewsForBatch;
window.loadBatchForReview = loadBatchForReview;
window.refreshRetrievedBatch = refreshRetrievedBatch;
window.processArchiveAction = processArchiveAction;
window.attachArchiveTableHandler = attachArchiveTableHandler;

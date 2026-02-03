/**
 * My Batches Module
 * Handles viewing and managing user's submitted batches
 */

import { appState } from '../../state/app-state.js';
import { getById } from '../../utils/dom.js';
import { setTab } from '../../core/tabs.js';
import { openModal, closeModal } from '../../utils/modals.js';
import {
  formatPdNumber,
  formatIsoDateTime,
  escapeHtml,
  normalizeBSBStrict
} from '../../utils/index.js';
import { STAGE_META, HEADER_PRESETS, HEADER_FIELDS, BALANCE_FIELDS } from '../../constants.js';
import { isAuthActive, ensureAuth } from '../../core/auth.js';

// Module state
let myBatchesCache = [];
let myBatchesSearchTerm = '';
let myBatchesLoading = false;

// DOM elements (will be initialized)
let myBatchesSearchInput;
let myBatchesRefreshBtn;
let myBatchesTbody;
let myBatchesFeedback;

/**
 * Clear feedback message
 */
function clearMyBatchesFeedback() {
  if (!myBatchesFeedback) return;
  myBatchesFeedback.textContent = '';
  myBatchesFeedback.classList.add('hidden');
  myBatchesFeedback.classList.remove('text-red-600', 'text-green-600');
  if (!myBatchesFeedback.classList.contains('text-gray-500')) {
    myBatchesFeedback.classList.add('text-gray-500');
  }
}

/**
 * Set feedback message
 */
function setMyBatchesFeedback(message, tone = 'info') {
  if (!myBatchesFeedback) return;
  myBatchesFeedback.classList.remove('hidden');
  myBatchesFeedback.textContent = message;
  myBatchesFeedback.classList.remove('text-gray-500', 'text-red-600', 'text-green-600');
  const toneClass = tone === 'error' ? 'text-red-600' : tone === 'success' ? 'text-green-600' : 'text-gray-500';
  myBatchesFeedback.classList.add(toneClass);
}

/**
 * Render stage badge
 */
function renderStageBadge(stage, isDraft) {
  if (isDraft) {
    return '<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800">Draft</span>';
  }
  const key = stage && STAGE_META[stage] ? stage : null;
  const meta = key ? STAGE_META[key] : { label: stage ? stage.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown', classes: 'bg-gray-100 text-gray-700' };
  return `<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ${meta.classes}">${escapeHtml(meta.label)}</span>`;
}

/**
 * Render batches table
 */
function renderMyBatches() {
  console.log('renderMyBatches called, tbody:', myBatchesTbody, 'cache length:', myBatchesCache.length);
  if (!myBatchesTbody) {
    console.error('renderMyBatches: tbody element not found!');
    return;
  }
  const term = (myBatchesSearchTerm || '').toLowerCase();
  const filtered = term
    ? myBatchesCache.filter((item) => {
        const code = String(item.code || '').toLowerCase();
        const pd = String(item.pd_number || '').toLowerCase();
        const dept = String(item.department_code || '').toLowerCase();
        const stage = String(item.stage || '').toLowerCase();
        return code.includes(term) || pd.includes(term) || dept.includes(term) || stage.includes(term);
      })
    : myBatchesCache.slice();

  if (!filtered.length) {
    myBatchesTbody.innerHTML = '<tr><td colspan="7" class="px-3 py-3 text-center text-gray-500">No matching batches.</td></tr>';
    return;
  }

  const rows = filtered.map((item) => {
    const code = escapeHtml(item.code || '');
    const pd = item.pd_number ? escapeHtml(formatPdNumber(item.pd_number)) : 'N/A';
    const dept = item.department_code ? escapeHtml(item.department_code) : 'N/A';
    const created = formatIsoDateTime(item.created_at);
    const updated = formatIsoDateTime(item.stage_updated_at || item.created_at);
    const badge = renderStageBadge(item.stage, item.is_draft);
    return `
      <tr class="bg-white border-b hover:bg-gray-50">
        <td class="px-3 py-2 font-mono text-sm">${code || 'N/A'}</td>
        <td class="px-3 py-2">${badge}</td>
        <td class="px-3 py-2">${pd}</td>
        <td class="px-3 py-2">${dept}</td>
        <td class="px-3 py-2">${created}</td>
        <td class="px-3 py-2">${updated}</td>
        <td class="px-3 py-2 text-right">
          <button type="button" data-code="${code}" class="px-3 py-1.5 bg-indigo-500 text-white rounded-md hover:bg-indigo-600 text-xs">View</button>
        </td>
      </tr>`;
  }).join('');

  console.log('renderMyBatches: Setting innerHTML, rows length:', rows.length);
  myBatchesTbody.innerHTML = rows;
  console.log('renderMyBatches: innerHTML set, tbody children:', myBatchesTbody.children.length);
}

/**
 * Load batches from API
 */
async function loadMyBatches(force = false) {
  console.log('loadMyBatches called, force:', force, 'isAuthActive:', isAuthActive());
  if (!isAuthActive()) {
    console.warn('loadMyBatches: User not authenticated, skipping');
    return;
  }
  if (myBatchesLoading) {
    console.log('loadMyBatches: Already loading, skipping. Loading flag will be reset after current request completes.');
    // Reset loading flag after a timeout to prevent permanent lock
    setTimeout(() => {
      if (myBatchesLoading) {
        console.warn('loadMyBatches: Loading flag stuck, resetting...');
        myBatchesLoading = false;
      }
    }, 10000); // 10 second timeout
    return;
  }
  if (!force && myBatchesCache.length) {
    renderMyBatches();
    return;
  }
  myBatchesLoading = true;
  setMyBatchesFeedback('Loading your batches…');
  try {
    console.log('loadMyBatches: Making API request to /my/batches');
    const data = await window.apiRequest('/my/batches');
    console.log('loadMyBatches: API response:', data);
    myBatchesCache = Array.isArray(data) ? data : [];
    console.log('loadMyBatches: Cache updated, rendering...', myBatchesCache.length, 'batches');
    renderMyBatches();
    if (myBatchesCache.length) {
      setMyBatchesFeedback(`Loaded ${myBatchesCache.length} batch${myBatchesCache.length === 1 ? '' : 'es'}.`);
      setTimeout(() => clearMyBatchesFeedback(), 4000);
    } else {
      setMyBatchesFeedback('No batches on record yet.');
    }
  } catch (err) {
    console.error('loadMyBatches: Error loading batches:', err);
    setMyBatchesFeedback(err?.message || 'Failed to load your batches.', 'error');
    myBatchesCache = [];
    renderMyBatches();
  } finally {
    myBatchesLoading = false;
    console.log('loadMyBatches: Loading complete');
  }
}

/**
 * Build batch history HTML
 */
function buildMyBatchHistory(history) {
  if (!Array.isArray(history) || !history.length) {
    return '<p class="text-xs text-gray-500">No activity recorded yet.</p>';
  }
  return `<ol class="space-y-3 text-sm text-gray-700">${history.map((event) => {
    const when = formatIsoDateTime(event.created_at);
    const actor = escapeHtml(event.reviewer || 'System');
    const statusRaw = String(event.status || 'update');
    const statusLabel = statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1);
    const status = escapeHtml(statusLabel);
    const comment = event.comments ? `<p class="text-xs text-gray-600 border-l-2 border-gray-200 pl-3">${escapeHtml(event.comments)}</p>` : '';
    return `<li><p class="font-medium">${when} • ${status} by ${actor}</p>${comment}</li>`;
  }).join('')}</ol>`;
}

/**
 * Infer preset name from header
 */
function inferPresetFromHeader(header) {
  if (!header) return null;
  const targetBsb = normalizeBSBStrict(header.balance_bsb || '') || '';
  const targetAcct = String(header.balance_acct || '').trim();
  if (!targetBsb || !targetAcct) return null;
  try {
    const entries = Object.entries(HEADER_PRESETS || {});
    for (const [name, preset] of entries) {
      const presetBsb = normalizeBSBStrict(preset?.balance_bsb || '') || '';
      const presetAcct = String(preset?.balance_acct || '').trim();
      if (presetBsb === targetBsb && presetAcct === targetAcct) return name;
    }
  } catch (_) {
    return null;
  }
  return null;
}

/**
 * Apply header to generator form
 */
function applyHeaderToGenerator(header) {
  if (!header) return;
  HEADER_FIELDS.forEach((id) => {
    const el = getById(id);
    if (!el || header[id] === undefined) return;
    el.value = header[id] ?? '';
  });
  BALANCE_FIELDS.forEach((id) => {
    const el = getById(id);
    if (!el || header[id] === undefined) return;
    if (el.type === 'checkbox') {
      el.checked = !!header[id];
    } else {
      el.value = header[id] ?? '';
    }
  });
}

/**
 * Load generator from batch payload
 */
function loadGeneratorFromPayload(payload, rootBatchId) {
  if (!payload || !payload.header || !Array.isArray(payload.transactions)) {
    throw new Error('Batch payload is incomplete.');
  }
  const header = payload.header;
  const preset = inferPresetFromHeader(header);
  const headerPresetSel = getById('header-preset');
  if (preset && headerPresetSel) {
    headerPresetSel.value = preset;
    if (typeof window.fillHeaderFromPreset === 'function') {
      window.fillHeaderFromPreset(preset);
    }
  }
  applyHeaderToGenerator(header);
  
  // Import generator module dynamically
  import('../generator/index.js').then((generatorModule) => {
    const newTransactions = payload.transactions.map((tx) => ({
      bsb: tx.bsb || '',
      account: tx.account || '',
      amount: Number.isFinite(tx.amount) ? Number(tx.amount) : parseFloat(tx.amount) || 0,
      accountTitle: tx.accountTitle || '',
      lodgementRef: tx.lodgementRef || '',
      txnCode: '53',
      withholdingCents: null
    }));
    
    if (typeof generatorModule.setTransactions === 'function') {
      generatorModule.setTransactions(newTransactions);
    }
    if (typeof generatorModule.renderTransactions === 'function') {
      generatorModule.renderTransactions();
    }
    if (typeof window.saveToLocalStorage === 'function') {
      window.saveToLocalStorage();
    }
    if (typeof generatorModule.updateTotals === 'function') {
      generatorModule.updateTotals();
    }
    if (typeof generatorModule.checkValidationIssues === 'function') {
      generatorModule.checkValidationIssues();
    }
    if (typeof generatorModule.setCurrentSubmissionRootId === 'function') {
      generatorModule.setCurrentSubmissionRootId(rootBatchId || null);
    }
    setTab('gen');
  }).catch((err) => {
    console.error('Failed to load generator module:', err);
    throw err;
  });
}

/**
 * Show batch detail modal
 */
function showMyBatchDetail(batch) {
  if (!batch) return;
  const code = escapeHtml(batch.code || '');
  const stage = renderStageBadge(batch.stage, batch.is_draft);
  const pd = batch.pd_number ? escapeHtml(formatPdNumber(batch.pd_number)) : 'N/A';
  const dept = batch.department_code ? escapeHtml(batch.department_code) : 'N/A';
  const created = formatIsoDateTime(batch.created_at);
  const updated = formatIsoDateTime(batch.stage_updated_at || batch.created_at);
  const rootId = escapeHtml(batch.root_batch_id || '');
  const historyHtml = buildMyBatchHistory(batch.history || []);
  const payload = batch.transactions?.payload;
  const readerBtnId = 'my-batch-open-reader';
  const loadBtnId = 'my-batch-load-generator';
  const canLoadToGenerator = !!(batch.is_draft || ['rejected', 'submitted'].includes(batch.stage));
  const hasPayload = payload && Array.isArray(payload.transactions) && payload.header;
  const loadDisabled = !canLoadToGenerator || !hasPayload;
  openModal(`
    <div class="space-y-4">
      <div class="space-y-2 text-sm text-gray-700">
        <h3 class="text-lg font-semibold text-gray-800">Batch ${code || '-'}</h3>
        <div class="flex items-center gap-2">${stage}</div>
        <div><span class="font-medium text-gray-900">PD#:</span> ${pd}</div>
        <div><span class="font-medium text-gray-900">Department:</span> ${dept}</div>
        <div><span class="font-medium text-gray-900">Created:</span> ${created}</div>
        <div><span class="font-medium text-gray-900">Last updated:</span> ${updated}</div>
        <div><span class="font-medium text-gray-900">Batch family:</span> ${rootId || 'N/A'}</div>
      </div>
      <div>
        <h4 class="text-sm font-semibold text-gray-800 mb-2">Activity</h4>
        ${historyHtml}
      </div>
      <div class="flex flex-wrap justify-end gap-2 pt-4 border-t border-gray-200">
        <button type="button" id="${readerBtnId}" class="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm">Open in Reader</button>
        ${canLoadToGenerator ? `<button type="button" id="${loadBtnId}" class="px-3 py-2 ${loadDisabled ? 'bg-indigo-200 text-white cursor-not-allowed' : 'bg-indigo-500 text-white hover:bg-indigo-600'} rounded-md text-sm" ${loadDisabled ? 'disabled' : ''}>Load into Generator</button>` : ''}
      </div>
      ${canLoadToGenerator && loadDisabled ? '<p class="text-xs text-red-600">Unable to load into Generator because the payload is missing.</p>' : ''}
    </div>
  `);

  getById(readerBtnId)?.addEventListener('click', () => {
    closeModal();
    if (typeof window.openBatchInReader === 'function') {
      window.openBatchInReader(batch);
    }
    setMyBatchesFeedback(`Opened ${batch.code} in Reader.`);
    setTimeout(() => clearMyBatchesFeedback(), 4000);
  });

  if (!loadDisabled) {
    getById(loadBtnId)?.addEventListener('click', () => {
      try {
        loadGeneratorFromPayload(payload, batch.root_batch_id);
        closeModal();
        setMyBatchesFeedback('Loaded into Generator. Apply fixes and submit when ready.', 'success');
        setTimeout(() => clearMyBatchesFeedback(), 5000);
      } catch (err) {
        setMyBatchesFeedback(err?.message || 'Unable to load into Generator.', 'error');
      }
    });
  }
}

/**
 * Open batch detail by code
 */
async function openMyBatchDetail(code) {
  if (!code) return;
  if (!isAuthActive()) {
    ensureAuth('user', () => openMyBatchDetail(code));
    return;
  }
  try {
    setMyBatchesFeedback(`Loading ${code}…`);
    const data = await window.apiRequest(`/my/batches/${encodeURIComponent(code)}`);
    clearMyBatchesFeedback();
    showMyBatchDetail(data);
  } catch (err) {
    setMyBatchesFeedback(err?.message || 'Unable to load batch details.', 'error');
  }
}

/**
 * Initialize My Batches module
 */
export function initMyBatches() {
  // Initialize DOM elements
  myBatchesSearchInput = getById('my-batches-search');
  myBatchesRefreshBtn = getById('my-batches-refresh');
  myBatchesTbody = getById('my-batches-tbody');
  myBatchesFeedback = getById('my-batches-feedback');

  // Event listeners
  if (myBatchesSearchInput) {
    myBatchesSearchInput.addEventListener('input', (e) => {
      myBatchesSearchTerm = e.target.value || '';
      renderMyBatches();
    });
  }

  if (myBatchesRefreshBtn) {
    myBatchesRefreshBtn.addEventListener('click', () => {
      if (!isAuthActive()) {
        ensureAuth('user', () => loadMyBatches(true));
        return;
      }
      loadMyBatches(true);
    });
  }

  if (myBatchesTbody) {
    myBatchesTbody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-code]');
      if (!btn) return;
      const code = btn.getAttribute('data-code');
      if (code) openMyBatchDetail(code);
    });
  }

  // Load batches on tab open
  const tabMy = getById('tab-my');
  if (tabMy) {
    tabMy.addEventListener('click', () => {
      if (!isAuthActive()) {
        ensureAuth('user', () => {
          if (!myBatchesCache.length) loadMyBatches();
        });
        return;
      }
      if (!myBatchesCache.length) loadMyBatches();
    });
  }

  // Clear on logout
  if (typeof window.clearAuthState === 'function') {
    const originalClearAuth = window.clearAuthState;
    window.clearAuthState = function() {
      originalClearAuth();
      myBatchesCache = [];
      myBatchesSearchTerm = '';
      myBatchesLoading = false;
      if (myBatchesSearchInput) myBatchesSearchInput.value = '';
      clearMyBatchesFeedback();
      if (myBatchesTbody) {
        myBatchesTbody.innerHTML = '<tr><td colspan="7" class="px-3 py-3 text-center text-gray-500">No batches loaded yet.</td></tr>';
      }
    };
  }
}

// Export for global access during migration
window.loadMyBatches = loadMyBatches;
window.openMyBatchDetail = openMyBatchDetail;


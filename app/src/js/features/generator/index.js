/**
 * Generator Module
 * Handles transaction management, CSV import/export, ABA generation
 * 
 * NOTE: This is a partial extraction. The full module will be completed
 * by extracting remaining functions from index.html inline scripts.
 */

import { appState } from '../../state/app-state.js';
import { getById } from '../../utils/dom.js';
import { 
  normalizeBSBStrict, 
  formatMoney, 
  todayDDMMYY,
  parseCsvLine,
  parseCsvRows,
  buildAbaFromHeader,
  downloadBase64File,
  toBase64
} from '../../utils/index.js';
import { sha256Hex } from '../../utils/encoding.js';
import { openModal, closeModal } from '../../utils/modals.js';
import { ensureBatchCodeFormat } from '../../utils/parsers.js';
import { normalizeAccountStrict } from '../../utils/formatters.js';
import { apiClient } from '../../api/client.js';
import { hasRole } from '../../core/auth.js';
import { 
  CREDIT_CODE_SET, 
  HEADER_PRESETS, 
  HEADER_FIELDS, 
  BALANCE_FIELDS 
} from '../../constants.js';
import { isBlacklistedCombo, getBlacklistDetails } from '../admin/index.js';

// Module state
let transactions = [];
let transactionSearchTerm = '';
let transactionSort = { key: null, direction: 'asc' };
let duplicateGroups = [];
let duplicateIndexSet = new Set();
let duplicateIndexToGroup = new Map();

// DOM elements (will be initialized)
let transactionTableBody;
let summaryElement;
let errorsElement;
let importSummaryElement;
let duplicateSummaryElement;
let transactionSearchInput;
let sortButtons;
let addRowBtn;
let clearAllBtn;
let importCsvBtn;
let exportCsvBtn;
let csvFileInput;
let bulkLodgementBtn;
let bulkLodgementInput;
let headerPresetSel;
let generateAbaBtn;

// Utility functions
const U = {
  digitsOnly: (s) => String(s || '').replace(/[^0-9]/g, ''),
  trunc: (s, n) => String(s || '').slice(0, n),
  padL: (s, w, ch = '0') => String(s || '').padStart(w, ch).slice(-w),
  padR: (s, w, ch = ' ') => String(s || '').padEnd(w, ch).slice(0, w),
  money: formatMoney
};

// normalizeAccountStrict is imported from parsers.js

/**
 * Initialize generator module with DOM elements
 */
export function initGenerator(elements = {}) {
  transactionTableBody = elements.transactionTableBody || getById('transaction-tbody');
  summaryElement = elements.summaryElement || getById('summary');
  errorsElement = elements.errorsElement || getById('errors');
  importSummaryElement = elements.importSummaryElement || getById('import-summary');
  duplicateSummaryElement = elements.duplicateSummaryElement || getById('duplicate-summary');
  transactionSearchInput = elements.transactionSearchInput || getById('transaction-search');
  sortButtons = elements.sortButtons || Array.from(document.querySelectorAll('[data-sort-key]'));
  addRowBtn = elements.addRowBtn || getById('add-row');
  clearAllBtn = elements.clearAllBtn || getById('clear-all');
  importCsvBtn = elements.importCsvBtn || getById('import-csv');
  exportCsvBtn = elements.exportCsvBtn || getById('export-csv');
  csvFileInput = elements.csvFileInput || getById('csv-file-input');
  bulkLodgementBtn = elements.bulkLodgementBtn || getById('bulk-lodgement-btn');
  bulkLodgementInput = elements.bulkLodgementInput || getById('bulk-lodgement-input');
  headerPresetSel = elements.headerPresetSel || getById('header-preset');
  generateAbaBtn = elements.generateAbaBtn || getById('generate-aba');

  // Event Listeners
  generateAbaBtn?.addEventListener('click', handleGenerateAba);
  headerPresetSel?.addEventListener('change', () => {
    if (headerPresetSel.value && HEADER_PRESETS[headerPresetSel.value]) {
      fillHeaderFromPreset(headerPresetSel.value);
    }
  });
  addRowBtn?.addEventListener('click', handleAddRow);
  clearAllBtn?.addEventListener('click', handleClearAll);
  importCsvBtn?.addEventListener('click', () => csvFileInput?.click());
  csvFileInput?.addEventListener('change', handleCsvFileInput);
  exportCsvBtn?.addEventListener('click', handleExportCsv);
  bulkLodgementBtn?.addEventListener('click', handleBulkLodgementApply);
  transactionSearchInput?.addEventListener('input', handleTransactionSearchInput);
  transactionSearchInput?.addEventListener('search', handleTransactionSearchInput);
  sortButtons.forEach(btn => {
    btn.addEventListener('click', handleSortButtonClick);
  });

  // Lock header fields
  ["fi", "apca", "reel", "trace_bsb", "trace_acct", "balance_bsb", "balance_acct", "balance_title", "balance_txn_code"]
    .forEach(id => {
      const el = getById(id);
      if (el) {
        el.readOnly = true;
        el.classList.add('locked');
        el.disabled = (id === 'balance_txn_code');
      }
    });

  // Load from localStorage
  loadFromLocalStorage();
  
  // Render initial transactions (only if tbody exists)
  if (transactionTableBody) {
    renderTransactions();
  }
}

/**
 * Build duplicate key for transaction
 */
function buildDuplicateKey(tx) {
  if (!tx) return null;
  const bsb = normalizeBSBStrict(tx.bsb);
  const account = U.digitsOnly(tx.account);
  const amount = parseFloat(tx.amount);
  const lodgement = String(tx.lodgementRef || '').trim();
  if (!bsb || !account || !lodgement || isNaN(amount) || amount <= 0) return null;
  return `${bsb}|${account}|${amount.toFixed(2)}|${lodgement.toLowerCase()}`;
}

/**
 * Recompute duplicate groups
 */
function recomputeDuplicates() {
  duplicateGroups = [];
  duplicateIndexSet = new Set();
  duplicateIndexToGroup = new Map();
  const map = new Map();
  transactions.forEach((tx, index) => {
    const key = buildDuplicateKey(tx);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(index);
  });
  map.forEach(indexes => {
    if (indexes.length > 1) {
      duplicateGroups.push(indexes);
      indexes.forEach(idx => {
        duplicateIndexSet.add(idx);
        duplicateIndexToGroup.set(idx, indexes);
      });
    }
  });
}

/**
 * Get batch metrics
 */
export function getBatchMetrics() {
  let creditsCents = 0, debitsCents = 0, transactionCount = 0;
  transactions.forEach(tx => {
    const amount = parseFloat(tx.amount);
    if (isNaN(amount) || amount <= 0) return;
    const cents = Math.round(amount * 100);
    if (tx.txnCode === '13') debitsCents += cents;
    else if (CREDIT_CODE_SET.has(tx.txnCode)) creditsCents += cents;
    transactionCount++;
  });
  return { creditsCents, debitsCents, transactionCount };
}

/**
 * Update totals display
 */
export function updateTotals() {
  const { creditsCents, debitsCents, transactionCount } = getBatchMetrics();
  const txt = `Transactions: ${transactionCount} | Credits: ${U.money(creditsCents)} | Debits: ${U.money(debitsCents)}`;
  if (summaryElement) summaryElement.textContent = txt;
}

/**
 * Get filtered and sorted matches
 */
function getFilteredMatches() {
  if (!transactions.length) return [];
  const term = transactionSearchTerm.trim().toLowerCase();
  let matches = term
    ? transactions
        .map((tx, index) => ({ tx, index }))
        .filter(({ tx }) => {
          const haystack = [tx.accountTitle, tx.lodgementRef, tx.account, tx.bsb]
            .map(part => String(part || '').toLowerCase());
          return haystack.some(part => part.includes(term));
        })
    : transactions.map((tx, index) => ({ tx, index }));

  if (transactionSort.key) {
    const dir = transactionSort.direction === 'asc' ? 1 : -1;
    matches.sort((a, b) => {
      const aVal = getSortValue(a.tx, transactionSort.key);
      const bVal = getSortValue(b.tx, transactionSort.key);
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        if (aVal === bVal) return a.index - b.index;
        return (aVal > bVal ? 1 : -1) * dir;
      }
      const cmp = String(aVal).localeCompare(String(bVal));
      if (cmp === 0) return a.index - b.index;
      return cmp * dir;
    });
  }
  return matches;
}

function getSortValue(tx, key) {
  const lower = (val) => String(val || '').toLowerCase();
  switch(key) {
    case 'amount':
      return parseFloat(tx.amount) || 0;
    case 'account':
      return lower(tx.account);
    case 'accountTitle':
      return lower(tx.accountTitle);
    case 'lodgementRef':
      return lower(tx.lodgementRef);
    case 'bsb':
    default:
      return lower(tx.bsb);
  }
}

/**
 * Check blocked accounts
 */
function checkBlockedAccounts() {
  const blockedWarning = getById('blocked-accounts-warning');
  const blockedList = getById('blocked-accounts-list');
  
  if (!blockedWarning || !blockedList) return;
  
  const blockedTransactions = transactions.filter(tx => 
    tx.bsb && tx.account && isBlacklistedCombo(tx.bsb, tx.account)
  );
  
  if (blockedTransactions.length === 0) {
    blockedWarning.classList.add('hidden');
    return;
  }
  
  const blockedDetails = blockedTransactions.map(tx => {
    const bsb = normalizeBSBStrict(tx.bsb) || tx.bsb;
    const account = normalizeAccountStrict(tx.account) || tx.account;
    const details = getBlacklistDetails(tx.bsb, tx.account);
    const label = details?.label ? ` (${details.label})` : '';
    return `• ${bsb} / ${account}${label}`;
  });
  
  blockedList.innerHTML = blockedDetails.join('<br>');
  blockedWarning.classList.remove('hidden');
}

/**
 * Check missing lodgement refs
 */
function checkMissingLodgementRefs() {
  const lodgementWarning = getById('missing-lodgement-warning');
  const lodgementList = getById('missing-lodgement-list');
  
  if (!lodgementWarning || !lodgementList) return;
  
  const missingLodgementTxs = transactions.filter((tx, index) => 
    !tx.lodgementRef || tx.lodgementRef.trim() === ''
  );
  
  if (missingLodgementTxs.length === 0) {
    lodgementWarning.classList.add('hidden');
    return;
  }
  
  const missingDetails = missingLodgementTxs.map((tx, index) => {
    const rowNum = transactions.indexOf(tx) + 1;
    const bsb = tx.bsb || 'No BSB';
    const account = tx.account || 'No Account';
    const title = tx.accountTitle || 'No Title';
    return `• Row ${rowNum}: ${bsb} / ${account} - ${title}`;
  });
  
  lodgementList.innerHTML = missingDetails.join('<br>');
  lodgementWarning.classList.remove('hidden');
}

/**
 * Check validation issues
 */
export function checkValidationIssues() {
  checkBlockedAccounts();
  checkMissingLodgementRefs();
}

/**
 * Update duplicate summary
 */
function updateDuplicateSummary() {
  if (!duplicateSummaryElement) return;
  if (!transactions.length || duplicateGroups.length === 0) {
    duplicateSummaryElement.innerHTML = '';
    duplicateSummaryElement.classList.add('hidden');
    return;
  }
  duplicateSummaryElement.classList.remove('hidden');
  const MAX_PREVIEW = 10;
  const previewGroups = duplicateGroups.slice(0, MAX_PREVIEW);
  const previewItems = previewGroups.map(indexes => {
    const sample = transactions[indexes[0]] || {};
    const rowNums = indexes.map(i => `Row ${i + 1}`).join(', ');
    const amountStr = Number(sample.amount || 0).toFixed(2);
    const title = sample.accountTitle || sample.account || 'No title';
    const lodgement = sample.lodgementRef || 'No lodgement ref';
    return `<li>${rowNums} - ${sample.bsb || 'BSB?'} / ${sample.account || 'Acct?'} / $${amountStr} / ${lodgement} (${title})</li>`;
  }).join('');
  const excessGroups = Math.max(duplicateGroups.length - MAX_PREVIEW, 0);
  const downloadButton = duplicateGroups.length > 0
    ? `<button type="button" id="download-duplicate-report" class="mt-2 inline-flex items-center gap-1 px-3 py-1.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-md text-xs font-semibold hover:bg-amber-200">Download full duplicate report${excessGroups > 0 ? ` (${duplicateGroups.length} sets)` : ''}</button>`
    : '';

  duplicateSummaryElement.innerHTML = `
    <div class="bg-amber-50 border border-amber-200 rounded-md p-3 text-amber-800 space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="font-semibold">Duplicate rows detected: ${duplicateIndexSet.size} rows across ${duplicateGroups.length} set${duplicateGroups.length === 1 ? '' : 's'}</p>
        ${downloadButton}
      </div>
      <ul class="space-y-1 list-disc list-inside text-sm">
        ${previewItems || '<li>Resolve duplicates to ensure each payment is unique.</li>'}
      </ul>
      ${excessGroups > 0 ? `<p class="text-xs text-amber-700">Showing first ${MAX_PREVIEW} sets. Use the download button to review all duplicates.</p>` : ''}
    </div>
  `;
  const downloadBtn = duplicateSummaryElement.querySelector('#download-duplicate-report');
  if (downloadBtn && typeof window.exportDuplicateReport === 'function') {
    downloadBtn.addEventListener('click', window.exportDuplicateReport);
  }
}

/**
 * Update sort indicators
 */
function updateSortIndicators() {
  sortButtons.forEach(btn => {
    const key = btn.dataset.sortKey;
    const isActive = transactionSort.key === key;
    btn.classList.toggle('sort-active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    const icon = btn.querySelector('.sort-indicator');
    if (!icon) return;
    if (!isActive) {
      icon.textContent = '';
    } else {
      icon.textContent = transactionSort.direction === 'asc' ? '▲' : '▼';
    }
  });
}

/**
 * Render transactions table
 */
export function renderTransactions() {
  if (!transactionTableBody) return;
  transactionTableBody.innerHTML = '';
  updateSortIndicators();
  recomputeDuplicates();

  if (transactions.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.innerHTML = `<td colspan="8" class="text-center py-3 text-gray-500 border-r border-gray-300">No transactions added yet.</td>`;
    transactionTableBody.appendChild(emptyRow);
    updateDuplicateSummary();
    return;
  }
  
  const matches = getFilteredMatches();
  if (matches.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.innerHTML = `<td colspan="8" class="text-center py-3 text-gray-500 border-r border-gray-300">No transactions match the current search.</td>`;
    transactionTableBody.appendChild(emptyRow);
    updateDuplicateSummary();
    return;
  }

  matches.forEach(({ tx, index }, displayIndex) => {
    const normalized = normalizeBSBStrict(tx.bsb);
    if (normalized && normalized !== tx.bsb) transactions[index].bsb = normalized;
    tx.txnCode = '53';
    tx.withholdingCents = null;
    const duplicateGroup = duplicateIndexToGroup.get(index);
    const duplicateBadge = duplicateGroup
      ? `<span class="duplicate-badge" title="Matches ${duplicateGroup.filter(i => i !== index).map(i => `row ${i + 1}`).join(', ') || 'another row'}">dup</span>`
      : '';
    const blocked = isBlacklistedCombo(tx.bsb, tx.account);
    const blacklistBadge = blocked
      ? '<span class="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-red-100 text-red-700" title="Blocked combination">blocked</span>'
      : '';
    const badgeHtml = duplicateBadge || blacklistBadge
      ? `<span class="ml-2 inline-flex items-center gap-1">${duplicateBadge}${blacklistBadge}</span>`
      : '';

    const row = document.createElement('tr');
    row.className = 'border-b hover:bg-gray-50';
    if (blocked) {
      row.classList.add('bg-red-50', 'border-red-200');
    } else {
      row.classList.add('bg-white');
    }
    
    const escapeHtml = (text) => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };
    
    row.innerHTML = `
      <td class="p-2 whitespace-nowrap border-r border-gray-300 text-center text-gray-500">${displayIndex + 1}${badgeHtml}</td>
      <td class="p-2 whitespace-nowrap border-r border-gray-300 w-24"><input type="text" value="${escapeHtml(tx.bsb||'')}" class="w-full max-w-[6rem] bg-transparent border-none focus:outline-none" data-field="bsb" data-index="${index}"></td>
      <td class="p-2 whitespace-nowrap border-r border-gray-300 w-32"><input type="text" value="${escapeHtml(tx.account||'')}" class="w-full max-w-[8rem] bg-transparent border-none focus:outline-none" data-field="account" data-index="${index}"></td>
      <td class="p-2 whitespace-nowrap border-r border-gray-300 w-28"><input type="number" step="0.01" value="${Number(tx.amount||0).toFixed(2)}" class="w-full bg-transparent border-none focus:outline-none text-right" data-field="amount" data-index="${index}"></td>
      <td class="p-2 whitespace-nowrap border-r border-gray-300"><input type="text" value="${escapeHtml(tx.accountTitle||'')}" class="w-full min-w-[16rem] bg-transparent border-none focus:outline-none" data-field="accountTitle" data-index="${index}"></td>
      <td class="p-2 whitespace-nowrap border-r border-gray-300 min-w-[14rem]"><input type="text" required maxlength="18" value="${escapeHtml(tx.lodgementRef||'')}" class="w-full min-w-[14rem] bg-transparent border border-transparent focus:border-gray-300 focus:outline-none" data-field="lodgementRef" data-index="${index}" placeholder="Required" title="Max 18 characters"></td>
      <td class="p-2 whitespace-nowrap border-r border-gray-300 text-center">
        <input type="text" value="53" class="w-16 text-center border-none text-gray-500 cursor-not-allowed select-none bg-gray-100" data-field="txnCode" data-index="${index}" readonly tabindex="-1">
      </td>
      <td class="p-2 text-center whitespace-nowrap border-r border-gray-300">
        <button class="delete-row-btn px-2 py-1 text-sm text-red-600 hover:text-red-800 transition-colors duration-200 rounded-md" data-index="${index}">Delete</button>
      </td>
    `;
    if (duplicateGroup) row.classList.add('duplicate-row');
    transactionTableBody.appendChild(row);
  });

  transactionTableBody.querySelectorAll('input:not([readonly])').forEach(input => { 
    input.addEventListener('change', handleTransactionUpdate); 
  });
  transactionTableBody.querySelectorAll('.delete-row-btn').forEach(button => { 
    button.addEventListener('click', handleDeleteRow); 
  });
  updateDuplicateSummary();
}

/**
 * Handle transaction update
 */
function handleTransactionUpdate(e) {
  const input = e.target;
  const index = parseInt(input.dataset.index, 10);
  const field = input.dataset.field;
  const value = input.value;
  if (isNaN(index) || !transactions[index]) return;

  if (field === 'txnCode'){ transactions[index].txnCode = '53'; input.value = '53'; return; }
  if (field === 'withholdingCents'){ transactions[index].withholdingCents = null; input.value = ''; return; }
  
  let needsRerender = false;
  
  if (field === 'bsb') {
    const oldBsb = transactions[index][field];
    const normalized = normalizeBSBStrict(value);
    const newBsb = normalized ?? value;
    transactions[index][field] = newBsb;
    
    if (normalized && normalized !== value) {
      input.value = normalized;
    }
    
    const oldAccount = transactions[index].account;
    if (oldAccount) {
      const wasBlocked = oldBsb && isBlacklistedCombo(oldBsb, oldAccount);
      const isNowBlocked = newBsb && isBlacklistedCombo(newBsb, oldAccount);
      needsRerender = (wasBlocked !== isNowBlocked);
    }
  } else if (field === 'account') {
    const oldAccount = transactions[index][field];
    transactions[index][field] = value;
    
    const currentBsb = transactions[index].bsb;
    if (currentBsb) {
      const wasBlocked = oldAccount && isBlacklistedCombo(currentBsb, oldAccount);
      const isNowBlocked = value && isBlacklistedCombo(currentBsb, value);
      needsRerender = (wasBlocked !== isNowBlocked);
    }
  } else if (field === 'amount') {
    transactions[index][field] = parseFloat(value) || 0;
  } else {
    transactions[index][field] = value;
    if (field === 'lodgementRef') {
      const hadLodgement = transactions[index].lodgementRef && transactions[index].lodgementRef.trim() !== '';
      const hasLodgement = value && value.trim() !== '';
      needsRerender = (hadLodgement !== hasLodgement);
    }
  }

  if (typeof window.saveToLocalStorage === 'function') {
    window.saveToLocalStorage();
  }
  updateTotals(); 
  
  if (needsRerender) {
    checkValidationIssues(); 
    renderTransactions();
  } else {
    checkValidationIssues();
  }
}

/**
 * Handle delete row
 */
function handleDeleteRow(e) {
  const index = parseInt(e.target.dataset.index, 10);
  if (!isNaN(index)) {
    transactions.splice(index, 1);
    renderTransactions(); 
    if (typeof window.saveToLocalStorage === 'function') {
      window.saveToLocalStorage();
    }
    updateTotals(); 
    checkValidationIssues();
  }
}

// Functions are already exported individually above, no need for export block

// Export setter functions for other modules
export function setTransactions(newTransactions) {
  transactions = newTransactions;
}

export function setCurrentSubmissionRootId(rootId) {
  // This will be handled by appState
  if (typeof window.setCurrentSubmissionRootId === 'function') {
    window.setCurrentSubmissionRootId(rootId);
  }
}

/**
 * Open submission modal and collect batch metadata
 */
export function openSubmissionModal({ batchId, metrics, duplicates }) {
  const account = appState.getReviewer() || {};
  const deptCode = account.department_code || '';
  const hasDept = !!deptCode;
  const isAdmin = account.role === 'admin' || hasRole('admin');
  const duplicateInfo = duplicates.sets > 0
    ? `<li>Duplicate sets: <strong>${duplicates.sets}</strong> (rows affected: ${duplicates.rows})</li>`
    : '<li>No duplicate transactions detected.</li>';
  const totalCredits = formatMoney(metrics.creditsCents);
  const totalDebits = formatMoney(metrics.debitsCents);
  const deptBlock = hasDept
    ? `<p class="text-xs text-gray-600">Department Head: <strong>${deptCode}</strong>. This will be recorded with the submission.</p>`
    : `<div>
        <label class="block mb-1 font-medium" for="submission-dept">Department Head FMIS code (first 2 digits)</label>
        <input id="submission-dept" type="text" required pattern="\\d{2}" maxlength="2" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" placeholder="e.g. 12">
      </div>`;
  const preparedDefault = account.display_name || account.email || '';
  const emailNote = account.email
    ? `<p class="text-xs text-gray-500">Notifications about this batch will be sent to <strong>${account.email}</strong>.</p>`
    : '';
  const pdLabel = isAdmin ? 'Payment reference' : 'FMIS PD reference';
  const manualToggleBlock = isAdmin
    ? `
        <div class="flex items-center gap-2 mt-2">
          <input id="submission-manual-ref" type="checkbox" class="h-4 w-4 text-amber-600 border-gray-300 rounded focus:ring-amber-500">
          <label for="submission-manual-ref" class="text-xs text-gray-600">Use manual reference (admin only)</label>
        </div>
        <p id="submission-manual-help" class="text-xs text-gray-500">
          Use this for urgent payments not yet in FMIS. Manual references accept 4–16 characters (A–Z, numbers, hyphen) and must include at least one digit.
        </p>
      `
    : '';

  return new Promise((resolve) => {
    openModal(`
      <h3 class="text-lg font-semibold text-gray-800 mb-3">Commit Batch for Review</h3>
      <p class="text-xs text-gray-500 mb-3">Local batch ID: <span class="font-mono">${batchId}</span></p>
      <div class="bg-gray-50 border border-gray-200 rounded-md p-3 text-sm text-gray-700 space-y-1 mb-4">
        <p class="font-medium">Batch summary</p>
        <ul class="list-disc list-inside space-y-1">
          <li>Transactions: <strong>${metrics.transactionCount}</strong></li>
          <li>Total credits: <strong>${totalCredits}</strong></li>
          <li>Total debits: <strong>${totalDebits}</strong></li>
          ${duplicateInfo}
        </ul>
      </div>
      <form id="submission-form" class="space-y-3 text-sm text-gray-700">
        ${deptBlock}
        <div>
          <label class="block mb-1 font-medium" for="submission-pd">${pdLabel}</label>
          <input id="submission-pd" type="text" required maxlength="16" inputmode="numeric" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" placeholder="123456" autocomplete="off">
          <p id="submission-pd-help" class="text-xs text-gray-500 mt-1">Enter the six-digit FMIS PD number. <strong>Do not</strong> enter the PD prefix.</p>
          ${manualToggleBlock}
        </div>
        <div>
          <label class="block mb-1 font-medium" for="submission-name">Prepared by</label>
          <input id="submission-name" type="text" required value="${preparedDefault}" class="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100 text-gray-700" placeholder="Your name" disabled>
          <p class="text-xs text-gray-500 mt-1">Auto-filled from your login and recorded with the batch.</p>
        </div>
        <div>
          <label class="block mb-1 font-medium" for="submission-notes">Notes (optional)</label>
          <textarea id="submission-notes" rows="3" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" placeholder="Reference or comments"></textarea>
        </div>
        ${emailNote}
        <p id="submission-error" class="text-xs text-red-600 hidden"></p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="submission-cancel" class="px-3 py-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">Commit Batch</button>
        </div>
      </form>
    `);
    
    // Set up form functionality with proper error handling
    setTimeout(() => {
      const form = getById('submission-form');
      const errorEl = getById('submission-error');
      const pdInput = getById('submission-pd');
      const pdHelp = getById('submission-pd-help');
      const manualToggle = isAdmin ? getById('submission-manual-ref') : null;
      const cancelBtn = getById('submission-cancel');
      const applyPdMode = () => {
        if (!pdInput) return;
        const manualMode = !!(manualToggle?.checked);
        if (manualMode) {
          pdInput.maxLength = 16;
          pdInput.placeholder = 'e.g. MAN-2024-01';
          pdInput.setAttribute('inputmode', 'text');
          if (pdHelp) {
            pdHelp.textContent = 'Enter 4–16 characters (A–Z, numbers, hyphen). Include at least one digit.';
          }
        } else {
          pdInput.maxLength = 6;
          pdInput.placeholder = '123456';
          pdInput.setAttribute('inputmode', 'numeric');
          if (pdHelp) {
            pdHelp.textContent = 'Enter the six-digit FMIS PD number. Do not enter the PD prefix.';
          }
        }
      };
      
      if (pdInput) {
        pdInput.focus();
        pdInput.addEventListener('input', () => {
          const manualMode = !!(manualToggle?.checked);
          if (manualMode) {
            let value = (pdInput.value || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
            pdInput.value = value.slice(0, 16);
          } else {
            const digits = (pdInput.value || '').replace(/[^0-9]/g, '').slice(0, 6);
            pdInput.value = digits;
          }
        });
      }
      
      if (manualToggle) {
        manualToggle.addEventListener('change', () => {
          if (pdInput) {
            pdInput.value = '';
            pdInput.focus();
          }
          applyPdMode();
        });
      }
      applyPdMode();
      
      cancelBtn?.addEventListener('click', () => { 
        const modal = getById('dynamic-modal');
        if (modal) modal.remove();
        resolve(null); 
      });
      
      form?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (errorEl) errorEl.classList.add('hidden');
        let deptOverride = null;
        if (!hasDept) {
          const deptVal = (getById('submission-dept')?.value || '').trim();
          if (!/^\d{2}$/.test(deptVal)) {
            if (errorEl) {
              errorEl.textContent = 'Enter the first two digits of the department FMIS code.';
              errorEl.classList.remove('hidden');
            }
            return;
          }
          deptOverride = deptVal;
        }
        const manualMode = !!(manualToggle?.checked);
        const rawPd = (pdInput?.value || '').trim();
        let pdNumber;
        if (manualMode) {
          const normalizedManual = rawPd.toUpperCase().replace(/[^A-Z0-9-]/g, '');
          if (!/^(?=.*\d)[A-Z0-9-]{4,16}$/.test(normalizedManual)) {
            if (errorEl) {
              errorEl.textContent = 'Manual references must be 4–16 characters (A–Z, numbers, hyphen) and include at least one digit.';
              errorEl.classList.remove('hidden');
            }
            pdInput?.focus();
            return;
          }
          pdNumber = normalizedManual;
        } else {
          const normalizedPd = rawPd.replace(/[^0-9]/g, '');
          if (!/^\d{6}$/.test(normalizedPd)) {
            if (errorEl) {
              errorEl.textContent = 'Enter the six-digit FMIS PD reference (e.g. 123456).';
              errorEl.classList.remove('hidden');
            }
            pdInput?.focus();
            return;
          }
          pdNumber = normalizedPd;
        }
        const preparer = preparedDefault.trim();
        if (!preparer) {
          if (errorEl) {
            errorEl.textContent = 'Prepared by could not be resolved from your account.';
            errorEl.classList.remove('hidden');
          }
          return;
        }
        const notes = getById('submission-notes')?.value.trim();
        const modal = getById('dynamic-modal');
        if (modal) modal.remove();
        resolve({ pdNumber, preparer, notes, deptOverride, manualPd: manualMode });
      });
    }, 100);
  });
}

/**
 * Generate a unique batch ID
 */
export const generateBatchId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/**
 * Show batch stored modal with batch details
 */
export function showBatchStoredModal({ code, fileName, base64, metadata, batchId }) {
  const formattedCode = ensureBatchCodeFormat(code);
  const totalCredits = metadata?.metrics ? formatMoney(metadata.metrics.creditsCents || 0) : '-';
  const duplicates = metadata?.duplicates || { sets: 0, rows: 0 };
  const infoList = `
    <ul class="list-disc list-inside space-y-1 text-sm text-gray-700">
      <li>Reference code: <strong class="font-mono">${formattedCode}</strong></li>
      <li>Department: <strong>${metadata?.department_code || '-'}</strong></li>
      <li>Prepared by: <strong>${metadata?.prepared_by || '-'}</strong></li>
      <li>Transactions: <strong>${metadata?.metrics?.transactionCount ?? transactions.length}</strong></li>
      <li>Total credits: <strong>${totalCredits}</strong></li>
      <li>Duplicate sets: <strong>${duplicates.sets || 0}</strong></li>
      <li>Duplicate rows: <strong>${duplicates.rows || 0}</strong></li>
    </ul>`;
  const notesBlock = metadata?.notes
    ? `<div class="text-xs text-gray-500">Notes: ${metadata.notes}</div>`
    : '';
  openModal(`
    <h3 class="text-lg font-semibold text-gray-800 mb-3">Batch Stored</h3>
    <p class="text-sm text-gray-700 mb-3">Provide this code on the FMIS payment request so reviewers can retrieve the ABA file. A copy of the batch has also been emailed to Treasury reviewers ahead of the FMIS process.</p>
    <div class="bg-gray-50 border border-gray-200 rounded-md p-3 space-y-2 mb-3">
      ${infoList}
    </div>
    ${notesBlock}
    <div class="flex flex-wrap items-center gap-2 mt-4">
      <button id="stored-copy-code" class="px-3 py-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-100">Copy Code</button>
      <button id="stored-download" class="px-4 py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600">Download Copy</button>
      <button id="stored-close" class="px-3 py-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-100">Close</button>
    </div>
    <p class="text-xs text-gray-500 mt-2">Stored as ${fileName}. Batch ID: <span class="font-mono">${batchId}</span></p>
  `);
  getById('stored-close')?.addEventListener('click', closeModal);
  getById('stored-download')?.addEventListener('click', () => {
    downloadBase64File(base64, fileName);
  });
  getById('stored-copy-code')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard?.writeText?.(formattedCode);
    } catch (_) {
      // ignore clipboard errors
    }
  });
}

// Export for global access during migration
window.getBatchMetrics = getBatchMetrics;
window.updateTotals = updateTotals;
window.renderTransactions = renderTransactions;
window.checkValidationIssues = checkValidationIssues;
window.showBatchStoredModal = showBatchStoredModal;
window.generateBatchId = generateBatchId;
window.openSubmissionModal = openSubmissionModal;

/**
 * Get header data from form inputs
 */
function getHeaderData() {
  const headerData = {};
  ['fi', 'reel', 'user', 'apca', 'desc', 'proc', 'trace_bsb', 'trace_acct', 'remitter'].forEach(id => {
    const el = getById(id);
    if (el) headerData[id] = el.value;
  });
  headerData.balance_required = true;
  headerData.balance_txn_code = '13';
  const balanceBsb = getById('balance_bsb');
  const balanceAcct = getById('balance_acct');
  const balanceTitle = getById('balance_title');
  if (balanceBsb) headerData.balance_bsb = balanceBsb.value;
  if (balanceAcct) headerData.balance_acct = balanceAcct.value;
  if (balanceTitle) headerData.balance_title = balanceTitle.value;
  return headerData;
}

/**
 * Build ABA file content from header and transactions
 */
function buildAba(h, rows) {
  if (!h.user || !h.remitter) throw new Error("User Name and Remitter Name are required.");
  const apca = String(h.apca || '').replace(/[^0-9]/g, '');
  if (apca.length !== 6) throw new Error("APCA/User ID must be exactly 6 digits.");

  const proc = /^\d{6}$/.test(h.proc) ? h.proc : todayDDMMYY();

  // Utility functions
  const U = {
    digitsOnly: (s) => String(s || '').replace(/[^0-9]/g, ''),
    padL: (s, w, ch = '0') => String(s || '').padStart(w, ch).slice(-w),
    padR: (s, w, ch = ' ') => String(s || '').padEnd(w, ch).slice(0, w)
  };

  // Type 0
  const t0 = "0"
    + U.padR('', 17)
    + U.padL(String(h.reel || '1'), 2)
    + U.padR((h.fi || '').slice(0, 3), 3)
    + U.padR('', 7)
    + U.padR((h.user || '').slice(0, 26), 26)
    + U.padL(apca, 6)
    + U.padR((h.desc || '').slice(0, 12), 12)
    + U.padR(proc, 6)
    + U.padR('', 40);
  const lines = [(t0 + ' '.repeat(120)).slice(0, 120)];

  let credits = 0, count = 0;

  // Type 1 credits
  rows.forEach((r, i) => {
    const n = i + 1;

    if (!r.lodgementRef || r.lodgementRef.trim() === '') {
      throw new Error(`Row ${n}: Lodgement Ref is required.`);
    }

    const bsbDigits = U.digitsOnly(r.bsb || '');
    if (bsbDigits.length !== 6) throw new Error(`Row ${n}: BSB must be 6 digits, format NNN-NNN.`);
    const normalizedBsb = normalizeBSBStrict(r.bsb);
    if (!normalizedBsb) throw new Error(`Row ${n}: BSB must be 6 digits, format NNN-NNN.`);
    if (rows[i].bsb !== normalizedBsb) rows[i].bsb = normalizedBsb;
    const acctDigits = U.digitsOnly(r.account || '');
    if (acctDigits.length < 5 || acctDigits.length > 9) throw new Error(`Row ${n}: Account must be 5–9 digits.`);

    const amount = parseFloat(r.amount);
    if (isNaN(amount) || amount <= 0) throw new Error(`Row ${n}: Amount must be a positive number.`);
    const cents = Math.round(amount * 100);
    if (cents > 9999999999) throw new Error(`Row ${n}: Amount exceeds maximum allowed.`);

    const bsb7 = normalizedBsb.padEnd(7, ' ').slice(0, 7);
    const acct9 = U.padL(acctDigits, 9, ' ');
    const ind1 = ' ';
    const code2 = '53';
    const amt10 = U.padL(String(cents), 10);
    const name32 = U.padR((r.accountTitle || '').slice(0, 32), 32);
    const lodg18 = U.padR((r.lodgementRef || '').slice(0, 18), 18);
    const trbsb7 = (h.trace_bsb || '').padEnd(7, ' ').slice(0, 7);
    const tracct9 = U.padL(U.digitsOnly(h.trace_acct || ''), 9, ' ');
    const remit16 = U.padR((h.remitter || '').slice(0, 16), 16);
    const wtax8 = U.padL('0', 8);

    const t1 = "1" + bsb7 + acct9 + ind1 + code2 + amt10 + name32 + lodg18 + trbsb7 + tracct9 + remit16 + wtax8;
    lines.push((t1 + ' '.repeat(120)).slice(0, 120));
    count++;
    credits += cents;
  });

  // Balancing debit (code 13), equals total credits
  const balAcctEl = getById('balance_acct');
  const balBsbEl = getById('balance_bsb');
  const balTitleEl = getById('balance_title');
  const descEl = getById('desc');
  const traceBsbEl = getById('trace_bsb');
  const traceAcctEl = getById('trace_acct');
  const remitterEl = getById('remitter');

  const balAcctDigits = U.digitsOnly(balAcctEl?.value || '');
  const balBsbDigits = U.digitsOnly(balBsbEl?.value || '');
  if (balBsbDigits.length !== 6) throw new Error("Balance BSB must be 6 digits.");
  const normalizedBalanceBsb = normalizeBSBStrict(balBsbEl?.value || '');
  if (!normalizedBalanceBsb) throw new Error("Balance BSB must be 6 digits.");
  if (balAcctDigits.length < 5 || balAcctDigits.length > 9) throw new Error("Balance Account must be 5–9 digits.");

  const balCents = credits;
  const b_bsb7 = normalizedBalanceBsb.padEnd(7, ' ').slice(0, 7);
  const b_acct9 = U.padL(balAcctDigits, 9, ' ');
  const b_ind1 = ' ';
  const b_code2 = '13';
  const b_amt10 = U.padL(String(balCents), 10);
  const b_name32 = U.padR((balTitleEl?.value || '').slice(0, 32), 32);
  const b_lodg18 = U.padR(`${(descEl?.value || '').slice(0, 12)}-${proc}`.slice(0, 18), 18);
  const b_trbsb7 = (traceBsbEl?.value || '').padEnd(7, ' ').slice(0, 7);
  const b_tracct9 = U.padL(U.digitsOnly(traceAcctEl?.value || ''), 9, ' ');
  const b_remit16 = U.padR((remitterEl?.value || '').slice(0, 16), 16);
  const b_wtax8 = U.padL('0', 8);

  const balT1 = "1" + b_bsb7 + b_acct9 + b_ind1 + b_code2 + b_amt10 + b_name32 + b_lodg18 + b_trbsb7 + b_tracct9 + b_remit16 + b_wtax8;
  lines.push((balT1 + ' '.repeat(120)).slice(0, 120));
  count++;

  // Type 7
  const netTotal = credits - balCents; // 0
  const t7 = "7"
    + "999-999"
    + U.padR('', 12)
    + U.padL(String(netTotal), 10)
    + U.padL(String(credits), 10)
    + U.padL(String(balCents), 10)
    + U.padR('', 24)
    + U.padL(String(count), 6)
    + U.padR('', 40);
  lines.push((t7 + ' '.repeat(120)).slice(0, 120));
  return lines.join('\r\n') + '\r\n';
}

/**
 * Handle batch submission (generate ABA and submit)
 */
async function handleGenerateAba() {
  try {
    if (!transactions.length) {
      if (errorsElement) errorsElement.textContent = 'Add at least one transaction before generating.';
      return;
    }
    updateTotals();

    // Check for blocked accounts BEFORE opening the modal
    const blacklistedTx = transactions.find((tx) => isBlacklistedCombo(tx.bsb, tx.account));
    if (blacklistedTx) {
      const blockedBsb = normalizeBSBStrict(blacklistedTx.bsb) || (blacklistedTx.bsb || 'unknown BSB');
      const blockedAccount = normalizeAccountStrict(blacklistedTx.account) || (blacklistedTx.account || 'unknown account');
      const details = getBlacklistDetails(blacklistedTx.bsb, blacklistedTx.account);
      const labelHint = details?.label ? ` (${details.label})` : '';

      openModal(`
        <h3 class="text-lg font-semibold text-red-600 mb-3">❌ Blocked Account Detected</h3>
        <div class="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
          <p class="text-sm text-red-800 mb-2">
            <strong>Account:</strong> ${blockedBsb} / ${blockedAccount}${labelHint}
          </p>
          <p class="text-sm text-red-700">
            This account combination is blocked and cannot be used in batch files.
          </p>
        </div>
        <div class="bg-amber-50 border border-amber-200 rounded-md p-3 mb-4">
          <p class="text-sm text-amber-800">
            <strong>Action required:</strong> Please remove or correct the blocked account before generating the file.
          </p>
        </div>
        <div class="flex justify-end">
          <button type="button" id="blocked-account-ok" class="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700">OK</button>
        </div>
      `);

      setTimeout(() => {
        getById('blocked-account-ok')?.addEventListener('click', () => {
          const modal = getById('dynamic-modal');
          if (modal) modal.remove();
        });
      }, 100);
      return;
    }

    // Check for missing lodgement refs BEFORE opening the modal
    const missingLodgementTx = transactions.find((tx) => !tx.lodgementRef || tx.lodgementRef.trim() === '');
    if (missingLodgementTx) {
      const missingTxs = transactions.filter((tx) => !tx.lodgementRef || tx.lodgementRef.trim() === '');
      const missingList = missingTxs.map((tx, index) => {
        const rowNum = transactions.indexOf(tx) + 1;
        const bsb = tx.bsb || 'No BSB';
        const account = tx.account || 'No Account';
        const title = tx.accountTitle || 'No Title';
        return `• Row ${rowNum}: ${bsb} / ${account} - ${title}`;
      }).join('<br>');

      openModal(`
        <h3 class="text-lg font-semibold text-orange-600 mb-3">⚠️ Missing Lodgement References</h3>
        <div class="bg-orange-50 border border-orange-200 rounded-md p-3 mb-4">
          <p class="text-sm text-orange-800 mb-2">
            <strong>The following transactions are missing Lodgement References:</strong>
          </p>
          <div class="text-xs text-orange-700 max-h-32 overflow-y-auto">
            ${missingList}
          </div>
        </div>
        <div class="bg-amber-50 border border-amber-200 rounded-md p-3 mb-4">
          <p class="text-sm text-amber-800">
            <strong>Action required:</strong> Please add Lodgement References to all transactions before generating the file.
          </p>
        </div>
        <div class="flex justify-end">
          <button type="button" id="missing-lodgement-ok" class="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700">OK</button>
        </div>
      `);

      setTimeout(() => {
        getById('missing-lodgement-ok')?.addEventListener('click', () => {
          const modal = getById('dynamic-modal');
          if (modal) modal.remove();
        });
      }, 100);
      return;
    }

    const metrics = getBatchMetrics();
    const duplicatesSummary = { sets: duplicateGroups.length, rows: duplicateIndexSet.size };
    const batchId = generateBatchId();

    const submission = await openSubmissionModal({ batchId, metrics, duplicates: duplicatesSummary });
    if (!submission) return; // cancelled by user

    const account = appState.getReviewer() || {};
    const accountDept = account.department_code || '';
    const deptCode = accountDept || submission.deptOverride || '';
    if (!/^\d{2}$/.test(deptCode)) {
      if (errorsElement) errorsElement.textContent = 'Department Head is required before submitting.';
      return;
    }

    const header = getHeaderData();
    header.proc = (/^\d{6}$/.test(header.proc) ? header.proc : todayDDMMYY());
    header.balance_required = true;
    header.balance_txn_code = '13';

    const payload = {
      header,
      transactions: transactions.map(tx => ({
        bsb: tx.bsb || '',
        account: tx.account || '',
        amount: Number(tx.amount || 0),
        accountTitle: tx.accountTitle || '',
        lodgementRef: tx.lodgementRef || '',
        txnCode: '53'
      }))
    };

    const abaContent = buildAba(header, transactions);
    const checksum = await sha256Hex(abaContent);
    const submittedIso = new Date().toISOString();
    const metadata = {
      metrics,
      duplicates: duplicatesSummary,
      generated_at: submittedIso,
      prepared_by: submission.preparer,
      notes: submission.notes || null,
      department_code: deptCode,
      pd_number: submission.pdNumber,
      client_batch_id: batchId,
      payload
    };
    metadata.manual_pd = !!submission.manualPd;
    metadata.submitted_by_email = account.email || null;
    metadata.submitted_by_role = account.role || null;
    if (account.display_name) metadata.submitted_by_name = account.display_name;
    metadata.submitted_at = submittedIso;

    const abaBase64 = toBase64(abaContent);
    const pdFileSegment = submission.pdNumber.replace(/[^A-Za-z0-9-]/g, '') || 'PDREF';
    const requestBody = {
      aba_content: abaBase64,
      pd_number: submission.pdNumber,
      metadata,
      checksum,
      suggested_file_name: `ABA_${deptCode}-${pdFileSegment}.aba`
    };
    const currentSubmissionRootId = appState.getCurrentSubmissionRootId();
    if (currentSubmissionRootId) {
      requestBody.root_batch_id = currentSubmissionRootId;
    }
    if (!accountDept && submission.deptOverride) {
      requestBody.dept_code = submission.deptOverride;
    }
    const response = await apiClient.post('/batches', requestBody);

    if (errorsElement) errorsElement.textContent = '';
    showBatchStoredModal({
      code: response.code,
      fileName: response.file_name || `ABA_${response.code}.aba`,
      base64: abaBase64,
      metadata,
      batchId: response.batch_id
    });
    appState.setCurrentSubmissionRootId(null);
    appState.setReaderContext({ rootBatchId: null, code: null });
    if (account.role === 'user') {
      if (typeof window.loadMyBatches === 'function') {
        window.loadMyBatches(true);
      }
    }
  } catch (error) {
    if (errorsElement) errorsElement.textContent = `Error: ${error.message}`;
  }
}

/**
 * Fill header from preset
 */
function fillHeaderFromPreset(presetKey) {
  const p = HEADER_PRESETS[presetKey];
  if (!p) return;
  Object.entries(p).forEach(([k, v]) => {
    const el = getById(k);
    if (el) {
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
    }
  });
  const reelEl = getById('reel');
  if (reelEl) reelEl.value = '1';
  const balanceRequiredEl = getById('balance_required');
  if (balanceRequiredEl) {
    balanceRequiredEl.checked = true;
    balanceRequiredEl.disabled = true;
  }
  const balanceTxnCodeEl = getById('balance_txn_code');
  if (balanceTxnCodeEl) balanceTxnCodeEl.value = '13';

  ["fi", "apca", "reel", "trace_bsb", "trace_acct", "balance_bsb", "balance_acct", "balance_title", "balance_txn_code"]
    .forEach(id => {
      const el = getById(id);
      if (el) {
        el.readOnly = true;
        el.classList.add('locked');
        el.disabled = (el.id === 'balance_txn_code');
      }
    });

  ensureProcToday();
  saveToLocalStorage();
}

/**
 * Ensure proc date is set to today if invalid
 */
function ensureProcToday() {
  const procEl = getById('proc');
  if (!procEl) return;
  if (!/^\d{6}$/.test(procEl.value)) procEl.value = todayDDMMYY();
}

/**
 * Load from localStorage
 * Supports both legacy format (aba-header, aba-transactions) and new format (aba-generator-state)
 */
function loadFromLocalStorage() {
  try {
    // Try legacy format first for compatibility
    const storedHeader = localStorage.getItem('aba-header');
    const storedTransactions = localStorage.getItem('aba-transactions');
    
    if (storedHeader) {
      const headerData = JSON.parse(storedHeader);
      const preset = headerData.__preset || 'CBA-RON';
      if (headerPresetSel) headerPresetSel.value = preset;
      fillHeaderFromPreset(preset);
      ['user', 'desc', 'proc', 'remitter'].forEach(id => {
        if (headerData[id] !== undefined) {
          const el = getById(id);
          if (el) el.value = headerData[id];
        }
      });
    } else {
      // Default to CBA-RON preset if no stored header
      if (headerPresetSel) headerPresetSel.value = 'CBA-RON';
      fillHeaderFromPreset('CBA-RON');
    }
    
    ensureProcToday();
    
    if (storedTransactions) {
      transactions = JSON.parse(storedTransactions);
    } else {
      // Try new format as fallback
      const stored = localStorage.getItem('aba-generator-state');
      if (stored) {
        const data = JSON.parse(stored);
        if (data.transactions && Array.isArray(data.transactions)) {
          transactions = data.transactions;
        }
        if (data.header) {
          Object.entries(data.header).forEach(([key, value]) => {
            const el = getById(key);
            if (el) {
              if (el.type === 'checkbox') el.checked = !!value;
              else el.value = value ?? '';
            }
          });
        }
      } else {
        // Default sample transactions
        transactions = [
          { bsb: "062-000", account: "12345678", amount: 10.00, accountTitle: "John Smith", lodgementRef: "WAGE-WEEKLY-01", txnCode: "53", withholdingCents: null },
          { bsb: "062-000", account: "98765432", amount: 60.00, accountTitle: "Jane Doe", lodgementRef: "WAGE-WEEKLY-02", txnCode: "53", withholdingCents: null }
        ];
      }
    }
    
    // Ensure all transactions have correct txnCode
    transactions = transactions.map(t => ({ ...t, txnCode: '53', withholdingCents: null }));
    renderTransactions();
    updateTotals();
    checkValidationIssues();
  } catch (err) {
    console.warn('Failed to load from localStorage', err);
  }
}

/**
 * Save to localStorage
 * Uses legacy format (aba-header, aba-transactions) for compatibility
 */
function saveToLocalStorage() {
  try {
    const headerData = {};
    const headerFields = ['fi', 'reel', 'user', 'apca', 'desc', 'proc', 'trace_bsb', 'trace_acct', 'remitter'];
    const balanceFields = ['balance_bsb', 'balance_acct', 'balance_title', 'balance_txn_code'];
    
    headerFields.forEach(id => {
      const el = getById(id);
      if (el) headerData[id] = el.value;
    });
    
    const balanceRequiredEl = getById('balance_required');
    if (balanceRequiredEl) {
      balanceRequiredEl.checked = true;
    }
    const balanceTxnCodeEl = getById('balance_txn_code');
    if (balanceTxnCodeEl) balanceTxnCodeEl.value = '13';
    
    balanceFields.forEach(id => {
      const el = getById(id);
      if (el) {
        headerData[id] = (el.type === 'checkbox') ? el.checked : el.value;
      }
    });
    
    if (headerPresetSel) {
      headerData.__preset = headerPresetSel.value;
    }
    
    localStorage.setItem('aba-header', JSON.stringify(headerData));
    localStorage.setItem('aba-transactions', JSON.stringify(transactions));
  } catch (err) {
    console.warn('Failed to save to localStorage', err);
  }
}

/**
 * Handle add row
 */
function handleAddRow() {
  transactions.push({ bsb: "", account: "", amount: 0, accountTitle: "", lodgementRef: "", txnCode: "53", withholdingCents: null });
  renderTransactions();
  saveToLocalStorage();
  updateTotals();
  checkValidationIssues();
}

/**
 * Handle clear all
 */
function handleClearAll() {
  if (confirm("Are you sure you want to clear all transactions?")) {
    transactions = [];
    renderTransactions();
    saveToLocalStorage();
    updateTotals();
    if (importSummaryElement) importSummaryElement.innerHTML = '';
    appState.setCurrentSubmissionRootId(null);
    appState.setReaderContext({ rootBatchId: null, code: null });
  }
}

/**
 * Handle CSV file input
 */
function handleCsvFileInput(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const rawText = e.target.result || '';
      const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        .split('\n')
        .filter(line => line.trim().length > 0);
      if (lines.length <= 1) {
        throw new Error('CSV must include a header row and at least one data row.');
      }

      const accepted = [];
      const errors = [];
      const seenKeys = new Map();
      const duplicateDetailMap = new Map();

      for (let i = 1; i < lines.length; i++) {
        const rowNumber = i + 1;
        const rawLine = lines[i];
        if (!rawLine || rawLine.trim() === '') continue;
        const cols = parseCsvLine(rawLine);
        if (cols.length < 5) {
          errors.push({ row: rowNumber, reason: 'Expected at least 5 columns.' });
          continue;
        }

        const rawBsb = cols[0] ?? '';
        const rawAccount = cols[1] ?? '';
        const rawAmount = cols[2] ?? '';
        const rawAccountTitle = cols[3] ?? '';
        const rawLodgementRef = cols[4] ?? '';

        const normalizedBsb = normalizeBSBStrict(rawBsb);
        if (!normalizedBsb) {
          errors.push({ row: rowNumber, reason: 'Invalid BSB (requires 6 digits).' });
          continue;
        }

        const accountDigits = U.digitsOnly(rawAccount);
        if (accountDigits.length < 5 || accountDigits.length > 9) {
          errors.push({ row: rowNumber, reason: 'Account must be 5–9 digits.' });
          continue;
        }

        const parsedAmount = parseFloat(String(rawAmount).replace(/[^0-9.\-]/g, ''));
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
          errors.push({ row: rowNumber, reason: 'Amount must be a positive number.' });
          continue;
        }
        const normalizedAmount = Number(parsedAmount.toFixed(2));

        const lodgementRef = String(rawLodgementRef || '').trim().slice(0, 18);
        if (!lodgementRef) {
          errors.push({ row: rowNumber, reason: 'Lodgement Ref is required.' });
          continue;
        }

        const sanitizedTx = {
          bsb: normalizedBsb,
          account: accountDigits,
          amount: normalizedAmount,
          accountTitle: String(rawAccountTitle || '').trim(),
          lodgementRef,
          txnCode: '53',
          withholdingCents: null
        };

        const sortKey = buildDuplicateKey(sanitizedTx);
        const tableRow = accepted.length + 1;
        const existing = sortKey ? seenKeys.get(sortKey) : null;
        if (existing && sortKey) {
          const group = duplicateDetailMap.get(sortKey) || [];
          if (!group.length) {
            group.push(existing);
          }
          group.push({ csvRow: rowNumber, tableRow, tx: sanitizedTx });
          duplicateDetailMap.set(sortKey, group);
        } else if (sortKey) {
          seenKeys.set(sortKey, { csvRow: rowNumber, tableRow, tx: sanitizedTx });
        }

        accepted.push(sanitizedTx);
      }

      const duplicateGroupsList = Array.from(duplicateDetailMap.values());
      const duplicateSetCount = duplicateGroupsList.length;
      const duplicateRowTotal = duplicateGroupsList.reduce((sum, group) => sum + group.length, 0);

      if (importSummaryElement) {
        const duplicatePreviewHtml = duplicateSetCount
          ? `<ul class="list-disc list-inside text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
              ${duplicateGroupsList.slice(0, 5).map(group => {
                const sample = group[0]?.tx || {};
                const rows = group.map(item => `Row ${Math.max(item.tableRow, 1)}${item.csvRow ? ` (CSV ${item.csvRow})` : ''}`).join(', ');
                const amountStr = Number(sample.amount || 0).toFixed(2);
                return `<li>${rows} - ${sample.bsb || 'BSB?'} / ${sample.account || 'Acct?'} / $${amountStr} / ${sample.lodgementRef || 'No lodgement ref'}</li>`;
              }).join('')}
              ${duplicateSetCount > 5 ? `<li class="text-xs">… plus ${duplicateSetCount - 5} more duplicate set${duplicateSetCount - 5 === 1 ? '' : 's'}.</li>` : ''}
            </ul>`
          : '';
        const duplicateDetailsHtml = duplicateSetCount
          ? `<details class="mt-2">
              <summary class="cursor-pointer text-sm font-medium text-amber-700">View duplicate groups</summary>
              <ol class="mt-2 list-decimal list-inside space-y-1 text-amber-700">
                ${duplicateGroupsList.slice(0, 50).map(group => {
                  const sample = group[0]?.tx || {};
                  const rows = group.map(item => `Row ${Math.max(item.tableRow, 1)}${item.csvRow ? ` (CSV ${item.csvRow})` : ''}`).join(', ');
                  const amountStr = Number(sample.amount || 0).toFixed(2);
                  const title = sample.accountTitle || sample.account || 'No title';
                  return `<li>${rows} - ${sample.bsb || 'BSB?'} / ${sample.account || 'Acct?'} / $${amountStr} / ${sample.lodgementRef || 'No lodgement ref'} (${title})</li>`;
                }).join('')}
                ${duplicateSetCount > 50 ? `<li class="text-xs">… plus ${duplicateSetCount - 50} more duplicate set${duplicateSetCount - 50 === 1 ? '' : 's'}.</li>` : ''}
              </ol>
            </details>`
          : '';
        const errorDetailsHtml = errors.length
          ? `<details class="mt-2">
              <summary class="cursor-pointer text-sm font-medium text-red-700">View skipped rows</summary>
              <ul class="mt-2 list-disc list-inside space-y-1 text-red-700">
                ${errors.slice(0, 100).map(err => `<li>Row ${err.row}: ${err.reason}</li>`).join('')}
                ${errors.length > 100 ? `<li class="text-xs">… plus ${errors.length - 100} more skipped row${errors.length - 100 === 1 ? '' : 's'}.</li>` : ''}
              </ul>
            </details>`
          : '';

        importSummaryElement.innerHTML = `
          <div class="bg-gray-50 border border-gray-200 rounded-md p-3 space-y-2">
            <p class="font-medium text-gray-700">CSV import summary</p>
            <ul class="list-disc list-inside space-y-1 text-sm text-gray-700">
              <li>Accepted rows: ${accepted.length}</li>
              <li>Duplicate rows detected: ${duplicateRowTotal} (across ${duplicateSetCount} group${duplicateSetCount === 1 ? '' : 's'})</li>
              <li>Rows skipped due to validation: ${errors.length}</li>
            </ul>
            ${duplicatePreviewHtml}
            ${duplicateDetailsHtml}
            ${errorDetailsHtml}
            <p class="mt-1 text-xs text-gray-500">Duplicates are identified by matching BSB, account, amount, and lodgement reference. They are imported so you can resolve them inside the grid.</p>
          </div>`;
      }

      if (!accepted.length) {
        if (errorsElement) errorsElement.textContent = 'No valid rows found in CSV. Resolve the noted issues and try again.';
        return;
      }

      if (errorsElement) errorsElement.textContent = '';
      const summaryLines = [
        `Accepted rows: ${accepted.length}`,
        `Duplicate rows detected: ${duplicateRowTotal}`,
        `Duplicate groups: ${duplicateDetailMap.size}`,
        `Rows skipped: ${errors.length}`
      ].join('\n');
      const confirmMsg = `CSV import summary\n\n${summaryLines}\n\nImporting will replace the current transaction list. Continue?`;
      if (!confirm(confirmMsg)) return;

      transactions = accepted;
      appState.setCurrentSubmissionRootId(null);
      appState.setReaderContext({ rootBatchId: null, code: null });
      transactionSearchTerm = '';
      transactionSort = { key: null, direction: 'asc' };
      if (transactionSearchInput) transactionSearchInput.value = '';
      renderTransactions();
      saveToLocalStorage();
      updateTotals();
      checkValidationIssues();
    } catch (err) {
      if (errorsElement) errorsElement.textContent = `Error importing CSV: ${err.message}`;
    }
    if (event.target) event.target.value = '';
  };
  reader.readAsText(file);
}

/**
 * Handle export CSV
 */
function handleExportCsv() {
  if (!transactions.length) {
    if (errorsElement) errorsElement.textContent = 'No transactions available to export.';
    return;
  }
  const matches = getFilteredMatches();
  if (!matches.length) {
    if (errorsElement) errorsElement.textContent = 'Nothing to export with the current search or sort filters applied.';
    return;
  }
  const rows = matches.map(({ tx }) => [
    `"${tx.bsb || ''}"`,
    `"${tx.account || ''}"`,
    Number(tx.amount || 0).toFixed(2),
    `"${tx.accountTitle || ''}"`,
    `"${tx.lodgementRef || ''}"`,
    `"53"`,
    ''
  ].join(','));
  const csv = [
    'BSB,Account,Amount,Account Title,Lodgement Ref,Txn Code,Withholding (c)',
    ...rows
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'transactions-filtered.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  if (errorsElement) errorsElement.textContent = '';
}

/**
 * Apply lodgement to all transactions
 */
function applyLodgementToAll(val) {
  transactions = transactions.map(t => ({ ...t, lodgementRef: val }));
  renderTransactions();
  saveToLocalStorage();
  updateTotals();
  checkValidationIssues();
}

/**
 * Confirm bulk apply
 */
function confirmBulkApply(val) {
  const count = transactions.length;
  const limited = (val || '').slice(0, 18);
  const shown = limited.length > 30 ? (limited.slice(0, 30) + '…') : limited;
  return confirm(`Apply this Lodgement Ref (max 18 chars) to all ${count} transactions?\n\n"${shown}"`);
}

/**
 * Handle bulk lodgement apply
 */
function handleBulkLodgementApply() {
  let val = (bulkLodgementInput?.value || '').trim();
  if (val === '') return;
  val = val.slice(0, 18);
  if (bulkLodgementInput) bulkLodgementInput.value = val;
  if (!confirmBulkApply(val)) return;
  applyLodgementToAll(val);
}

/**
 * Handle transaction search input
 */
function handleTransactionSearchInput() {
  transactionSearchTerm = transactionSearchInput?.value || '';
  renderTransactions();
}

/**
 * Handle sort button click
 */
function handleSortButtonClick(e) {
  const key = e.currentTarget.dataset.sortKey;
  if (!key) return;
  if (transactionSort.key !== key) {
    transactionSort = { key, direction: 'asc' };
  } else if (transactionSort.direction === 'asc') {
    transactionSort.direction = 'desc';
  } else {
    transactionSort = { key: null, direction: 'asc' };
  }
  renderTransactions();
}

// Export localStorage functions for global access
window.saveToLocalStorage = saveToLocalStorage;
window.loadFromLocalStorage = loadFromLocalStorage;

window.__generatorModule = {
  setTransactions,
  setCurrentSubmissionRootId,
  renderTransactions,
  updateTotals,
  checkValidationIssues
};

/**
 * Admin Module
 * Handles all admin functionality: signups, accounts, blacklist, archives, testing
 */

import { appState } from '../../state/app-state.js';
import { apiClient } from '../../api/client.js';
import { getById } from '../../utils/dom.js';
import {
  formatAuDateTime,
  formatIsoDateTime,
  formatPdNumber,
  normalizeBSBStrict,
  normalizeAccountStrict
} from '../../utils/formatters.js';
import { escapeHtml } from '../../utils/dom.js';
import { parseBlacklistCsv, normalizeBatchCode, ensureBatchCodeFormat } from '../../utils/parsers.js';
import { downloadBase64File } from '../../utils/encoding.js';
import { openModal, closeModal } from '../../utils/modals.js';
import { setTab } from '../../core/tabs.js';
import { hasRole, ensureAuth, isAuthActive } from '../../core/auth.js';
import { ADMIN_SECTIONS, STAGE_META, BLACKLIST_IMPORT_LIMIT } from '../../constants.js';
import { processArchiveAction, attachArchiveTableHandler } from '../reviewer/index.js';

// DOM elements - will be initialized
let adminPendingSignupTbody;
let adminPendingSignupCount;
let adminSignupHistoryTbody;
let adminSignupFeedback;
let adminRefreshSignupsBtn;
let adminReviewerList;
let adminArchiveTbody;
let adminRefreshReviewersBtn;
let adminRefreshArchivesBtn;
let adminToggleArchiveScopeBtn;
let adminArchiveStatsContainer;
let adminArchiveScopeHint;
const adminArchiveStatElements = {
  total: null,
  submitted: null,
  approved: null,
  rejected: null
};
let adminCreateReviewerForm;
let adminCreateReviewerError;
let adminCreateReviewerSuccess;
let adminCreateReviewerSubmitBtn;
let adminCreateReviewerCancelBtn;
let adminReviewerFeedback;
let adminArchiveFeedback;
let adminBlacklistTbody;
let adminBlacklistFeedback;
let adminRefreshBlacklistBtn;
let adminBlacklistForm;
let adminBlacklistError;
let adminBlacklistBsbInput;
let adminBlacklistAccountInput;
let adminBlacklistLabelInput;
let adminBlacklistNotesInput;
let adminBlacklistActiveSelect;
let adminBlacklistSubmitBtn;
let adminBlacklistCancelEditBtn;
let adminBlacklistImportBtn;
let adminBlacklistImportInput;
let adminReviewerSearchInput;
let adminReviewerRoleSelect;
let adminBlacklistSearchInput;
let adminReviewerCountBadge;
let adminBlacklistCountBadge;
let adminNewEmailInput;
let adminNewNameInput;
let adminTestingStatus;
let adminTestingMeta;
let adminTestingToggle;
let adminTestingFeedback;
let adminTestingBanner;
let adminPanelContainer;
let adminPanels;
let adminNavButtons;
let adminArchiveSearchInput;
let adminNewRoleSelect;
let adminNewDeptInput;
let adminNewNotifySelect;
let adminNewSendEmailSelect;
let retrieveBatchCodeInput;
let retrieveBatchForm;
let retrieveBatchResult;
let reviewerArchiveTbody;
let reviewerArchiveFeedback;
let reviewerArchiveSearchInput;
let reviewerRefreshArchivesBtn;

// Module state
let currentAdminSection = 'signups';
let adminSectionLoaded = new Set();
let adminArchivesCache = [];
let adminArchivesFetched = false;
let adminArchiveSearchTerm = '';
let adminArchiveSearchTermRaw = '';
let adminArchiveScope = 'recent';
let adminReviewersCache = [];
let adminReviewerSearchTerm = '';
let adminReviewerSearchTermRaw = '';
let adminReviewerRoleFilterValue = 'all';
let adminBlacklistCache = [];
let adminBlacklistSearchTerm = '';
let adminBlacklistSearchTermRaw = '';
let adminReviewerEditingId = null;
let adminBlacklistEditingId = null;
let adminTestingMode = null;
let adminTestingLoading = false;
let activeBlacklistEntries = [];
let activeBlacklistSet = new Set();

// Export blacklist functions for use by generator
export function isBlacklistedCombo(bsb, account) {
  const key = (() => {
    const normalizedBsb = normalizeBSBStrict(bsb);
    const normalizedAccount = normalizeAccountStrict(account);
    if (!normalizedBsb || !normalizedAccount) return null;
    return `${normalizedBsb}|${normalizedAccount}`;
  })();
  return key ? activeBlacklistSet.has(key) : false;
}

export function getBlacklistDetails(bsb, account) {
  const normalizedBsb = normalizeBSBStrict(bsb);
  const normalizedAccount = normalizeAccountStrict(account);
  if (!normalizedBsb || !normalizedAccount) return null;
  return activeBlacklistEntries.find((entry) => {
    const entryBsb = normalizeBSBStrict(entry.bsb);
    const entryAccount = normalizeAccountStrict(entry.account);
    return entryBsb === normalizedBsb && entryAccount === normalizedAccount;
  }) || null;
}

export async function refreshActiveBlacklist(showWarning = false) {
  if (!isAuthActive()) {
    activeBlacklistEntries = [];
    activeBlacklistSet = new Set();
    return;
  }
  try {
    const entries = await apiClient.get('/blacklist/active');
    activeBlacklistEntries = Array.isArray(entries) ? entries : [];
    activeBlacklistSet = new Set(
      activeBlacklistEntries
        .map((entry) => {
          const bsb = normalizeBSBStrict(entry.bsb);
          const account = normalizeAccountStrict(entry.account);
          if (!bsb || !account) return null;
          return `${bsb}|${account}`;
        })
        .filter(Boolean)
    );
    // Notify generator to re-render if needed
    if (typeof window.renderTransactions === 'function') {
      window.renderTransactions();
    }
  } catch (err) {
    if (showWarning) console.warn('Unable to refresh blacklist', err);
  }
}

// ========== SIGNUP REQUESTS ==========

async function loadSignupRequests() {
  if (!adminPendingSignupTbody || !adminSignupHistoryTbody) {
    console.warn('Missing signup request DOM elements');
    return;
  }
  
  if (adminPendingSignupCount) adminPendingSignupCount.textContent = 'Loading…';
  adminPendingSignupTbody.innerHTML = `<tr><td colspan="5" class="px-3 py-3 text-center text-gray-500">Loading…</td></tr>`;
  adminSignupHistoryTbody.innerHTML = `<tr><td colspan="6" class="px-3 py-3 text-center text-gray-500">Loading…</td></tr>`;
  
  try {
    const data = await apiClient.get('/admin/signup-requests');
    const requests = Array.isArray(data) ? data : [];
    
    const pending = requests
      .filter((req) => req.status === 'pending')
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const history = requests
      .filter((req) => req.status !== 'pending')
      .sort((a, b) => new Date(b.reviewed_at || b.created_at || 0) - new Date(a.reviewed_at || a.created_at || 0))
      .slice(0, 25);

    if (adminPendingSignupCount) {
      adminPendingSignupCount.textContent = pending.length ? `${pending.length} waiting` : 'All clear';
    }

    const pendingHtml = pending.length
      ? pending.map((req) => {
          const requested = formatAuDateTime(req.created_at);
          return `<tr>
            <td class="px-3 py-2">${escapeHtml(req.name)}</td>
            <td class="px-3 py-2 font-mono">${escapeHtml(req.email)}</td>
            <td class="px-3 py-2">${escapeHtml(req.department_code || '-')}</td>
            <td class="px-3 py-2">${requested}</td>
            <td class="px-3 py-2 text-right">
              <button class="px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-xs" data-action="approve" data-id="${req.id}">Approve</button>
              <button class="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs ml-2" data-action="reject" data-id="${req.id}">Reject</button>
            </td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="5" class="px-3 py-3 text-center text-gray-500">No pending requests.</td></tr>`;

    const historyHtml = history.length
      ? history.map((req) => {
          const reviewed = formatAuDateTime(req.reviewed_at);
          const status = req.status.charAt(0).toUpperCase() + req.status.slice(1);
          const reviewerDisplay = (req.reviewer_name && req.reviewer_name.trim())
            ? req.reviewer_name.trim()
            : (req.reviewer_email || '-');
          const reviewer = escapeHtml(reviewerDisplay);
          const tooltip = req.review_comment ? ` title="${escapeHtml(req.review_comment)}"` : '';
          return `<tr${tooltip}>
            <td class="px-3 py-2">${escapeHtml(req.name)}</td>
            <td class="px-3 py-2 font-mono">${escapeHtml(req.email)}</td>
            <td class="px-3 py-2">${escapeHtml(req.department_code || '-')}</td>
            <td class="px-3 py-2">${reviewed}</td>
            <td class="px-3 py-2">${status}</td>
            <td class="px-3 py-2">${reviewer}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="6" class="px-3 py-3 text-center text-gray-500">No recent decisions.</td></tr>`;

    adminPendingSignupTbody.innerHTML = pendingHtml;
    adminSignupHistoryTbody.innerHTML = historyHtml;
    
    adminSectionLoaded.add('signups');
  } catch (err) {
    console.error('Error loading signup requests:', err);
    adminPendingSignupTbody.innerHTML = `<tr><td colspan="5" class="px-3 py-3 text-center text-red-600">Failed to load requests.</td></tr>`;
    adminSignupHistoryTbody.innerHTML = `<tr><td colspan="6" class="px-3 py-3 text-center text-red-600">Failed to load history.</td></tr>`;
    if (adminPendingSignupCount) adminPendingSignupCount.textContent = 'Unavailable';
  }
}

// ========== ACCOUNTS/REVIEWERS ==========

function renderAdminReviewers(reviewers) {
  if (!adminReviewerList) return;
  adminReviewersCache = Array.isArray(reviewers) ? [...reviewers] : [];
  renderFilteredAdminReviewers();
}

function renderFilteredAdminReviewers() {
  if (!adminReviewerList) return;
  if (adminReviewerSearchInput && adminReviewerSearchInput.value !== adminReviewerSearchTermRaw) {
    adminReviewerSearchInput.value = adminReviewerSearchTermRaw;
  }
  if (adminReviewerRoleSelect && adminReviewerRoleSelect.value !== adminReviewerRoleFilterValue) {
    adminReviewerRoleSelect.value = adminReviewerRoleFilterValue;
  }
  const sortKey = (reviewer) => {
    const name = reviewer?.display_name?.trim();
    if (name) return name.toLowerCase();
    return (reviewer?.email || '').toLowerCase();
  };
  const term = adminReviewerSearchTerm.trim().toLowerCase();
  const roleFilter = adminReviewerRoleFilterValue;
  const filtered = adminReviewersCache.filter((reviewer) => {
    const matchesRole = roleFilter === 'all' || reviewer.role === roleFilter;
    if (!matchesRole) return false;
    if (!term) return true;
    const haystack = [reviewer.display_name, reviewer.email]
      .map((part) => String(part || '').toLowerCase())
      .join(' ');
    return haystack.includes(term);
  });
  const totalCount = adminReviewersCache.length;
  const filteredCount = filtered.length;
  if (adminReviewerCountBadge) {
    const badgeText = (term || roleFilter !== 'all')
      ? `${filteredCount}/${totalCount}`
      : `${totalCount}`;
    adminReviewerCountBadge.textContent = badgeText;
    adminReviewerCountBadge.setAttribute('aria-label', `Showing ${filteredCount} of ${totalCount} user accounts`);
  }
  if (!filtered.length) {
    const hasFilters = adminReviewersCache.length > 0 && (term || roleFilter !== 'all');
    const emptyMessage = hasFilters
      ? 'No accounts match the current filters.'
      : 'No accounts found.';
    adminReviewerList.innerHTML = `<tr><td colspan="8" class="px-3 py-3 text-center text-gray-500">${emptyMessage}</td></tr>`;
    return;
  }
  const sorted = [...filtered].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  adminReviewerList.innerHTML = sorted.map((r) => {
    const role = r.role ?? 'reviewer';
    const displayName = escapeHtml(r.display_name || '-');
    const email = escapeHtml(r.email || '-');
    const lastLogin = escapeHtml(formatAuDateTime(r.last_login_at, { fallback: 'Never' }));
    const statusBadge = r.status === 'active'
      ? '<span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700">Active</span>'
      : '<span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-700">Inactive</span>';
    const nextStatus = r.status === 'active' ? 'inactive' : 'active';
    const toggleLabel = r.status === 'active' ? 'Deactivate' : 'Activate';
    const toggleClasses = r.status === 'active' ? 'text-amber-600 hover:text-amber-800' : 'text-green-600 hover:text-green-800';
    const mustChangeTag = r.must_change_password ? '<span class="ml-1 text-xs font-semibold text-red-600">(Must change)</span>' : '';
    const deptRaw = r.department_code || '';
    const deptDisplay = deptRaw ? escapeHtml(deptRaw) : '-';
    const deptMarkup = role === 'user'
      ? `<span class="inline-flex items-center gap-1"><span class="font-mono">${deptDisplay}</span><button data-action="edit-dept" data-id="${r.id}" data-dept="${deptRaw}" class="text-xs text-indigo-600 hover:text-indigo-800">Edit</button></span>`
      : `<span class="font-mono">${deptDisplay}</span>`;
    const supportsNotify = role === 'reviewer' || role === 'admin';
    let notifyMarkup;
    if (supportsNotify) {
      const notifyEnabled = r.notify_on_submission === true;
      const notifyBadge = notifyEnabled
        ? '<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-green-50 text-green-700">On</span>'
        : '<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-gray-100 text-gray-600">Off</span>';
      const notifyButton = `<button data-action="toggle-notify" data-id="${r.id}" data-next="${notifyEnabled ? 'off' : 'on'}" class="text-xs text-indigo-600 hover:text-indigo-800">${notifyEnabled ? 'Disable' : 'Enable'}</button>`;
      notifyMarkup = `<span class="inline-flex items-center gap-1">${notifyBadge}${notifyButton}</span>`;
    } else {
      notifyMarkup = '<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-gray-100 text-gray-600">N/A</span>';
    }
    const roleSelect = `<select data-action="set-role" data-id="${r.id}" data-current-role="${role}" data-dept="${deptRaw}" data-notify="${r.notify_on_submission === true}" class="border border-gray-300 rounded-md px-2 py-1 text-xs bg-white">
      <option value="user"${role === 'user' ? ' selected' : ''}>User</option>
      <option value="banking"${role === 'banking' ? ' selected' : ''}>Banking</option>
      <option value="reviewer"${role === 'reviewer' ? ' selected' : ''}>Reviewer</option>
      <option value="admin"${role === 'admin' ? ' selected' : ''}>Admin</option>
    </select>`;
    return `<tr data-reviewer-id="${r.id}">
      <td class="px-3 py-2">
        <span class="font-semibold text-gray-800">${displayName}</span>${mustChangeTag}
      </td>
      <td class="px-3 py-2 font-mono text-gray-600">${email}</td>
      <td class="px-3 py-2">${roleSelect}</td>
      <td class="px-3 py-2">${deptMarkup}</td>
      <td class="px-3 py-2">${statusBadge}</td>
      <td class="px-3 py-2">${notifyMarkup}</td>
      <td class="px-3 py-2 text-xs text-gray-500">${lastLogin}</td>
      <td class="px-3 py-2 text-right space-x-2">
        <button data-action="edit-account" data-id="${r.id}" class="text-xs text-indigo-600 hover:text-indigo-800">Edit</button>
        <button data-action="reset" data-id="${r.id}" class="text-xs text-indigo-600 hover:text-indigo-800">Reset</button>
        <button data-action="toggle" data-id="${r.id}" data-next="${nextStatus}" class="text-xs ${toggleClasses}">${toggleLabel}</button>
        <button data-action="delete" data-id="${r.id}" class="text-xs text-red-600 hover:text-red-800">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function setAdminReviewerForm(account = null) {
  if (!adminCreateReviewerForm) return;
  adminReviewerEditingId = account?.id ?? null;
  adminCreateReviewerForm.reset();
  adminCreateReviewerError?.classList.add('hidden');
  adminCreateReviewerSuccess?.classList.add('hidden');
  const isEdit = !!adminReviewerEditingId;
  if (adminCreateReviewerSubmitBtn) {
    adminCreateReviewerSubmitBtn.textContent = isEdit ? 'Save changes' : 'Create account';
    adminCreateReviewerSubmitBtn.dataset.mode = isEdit ? 'edit' : 'create';
  }
  if (adminCreateReviewerCancelBtn) {
    adminCreateReviewerCancelBtn.classList.toggle('hidden', !isEdit);
  }
  if (adminNewEmailInput) {
    adminNewEmailInput.value = account?.email || '';
    adminNewEmailInput.readOnly = isEdit;
    adminNewEmailInput.classList.toggle('bg-gray-100', isEdit);
  }
  if (adminNewNameInput) {
    adminNewNameInput.value = account?.display_name || '';
  }
  const roleValue = account?.role || (adminNewRoleSelect?.value || 'reviewer');
  if (adminNewRoleSelect) {
    adminNewRoleSelect.value = roleValue;
  }
  syncAdminCreateFormRole();
  if (adminNewDeptInput) {
    adminNewDeptInput.value = roleValue === 'user' ? (account?.department_code || '') : '';
  }
  if (adminNewNotifySelect) {
    if (roleValue === 'reviewer' || roleValue === 'admin') {
      adminNewNotifySelect.value = account?.notify_on_submission === false ? 'no' : 'yes';
    } else {
      adminNewNotifySelect.value = 'no';
    }
  }
  if (adminNewSendEmailSelect) {
    adminNewSendEmailSelect.value = 'no';
    adminNewSendEmailSelect.disabled = isEdit;
    adminNewSendEmailSelect.closest('label')?.classList.toggle('opacity-50', isEdit);
  }
  if (!isEdit) {
    adminReviewerEditingId = null;
  } else if (adminNewNameInput) {
    adminNewNameInput.focus();
  }
}

function syncAdminCreateFormRole() {
  const role = adminNewRoleSelect?.value || 'reviewer';
  const deptWrapper = adminNewDeptInput?.closest('label');
  const notifyWrapper = adminNewNotifySelect?.closest('label');
  const emailWrapper = adminNewSendEmailSelect?.closest('label');
  const isEditingAccount = !!adminReviewerEditingId;

  if (adminNewDeptInput) {
    adminNewDeptInput.disabled = role !== 'user';
    if (role !== 'user') adminNewDeptInput.value = '';
    deptWrapper?.classList.toggle('opacity-50', role !== 'user');
  }
  if (adminNewNotifySelect) {
    const canSetNotify = role === 'reviewer' || role === 'admin';
    adminNewNotifySelect.disabled = !canSetNotify;
    if (!canSetNotify) adminNewNotifySelect.value = 'no';
    notifyWrapper?.classList.toggle('opacity-50', !canSetNotify);
  }
  if (adminNewSendEmailSelect) {
    const disableSendEmail = isEditingAccount;
    adminNewSendEmailSelect.disabled = disableSendEmail;
    if (disableSendEmail) adminNewSendEmailSelect.value = 'no';
    emailWrapper?.classList.toggle('opacity-50', disableSendEmail);
  }
}

async function loadAdminReviewers(showFeedback = false) {
  if (!hasRole('admin') || !adminReviewerList) return;
  adminReviewerList.innerHTML = '<tr><td colspan="8" class="px-3 py-3 text-center text-gray-500">Loading…</td></tr>';
  try {
    const reviewers = await apiClient.get('/reviewers');
    renderAdminReviewers(reviewers);
    adminSectionLoaded.add('accounts');
    if (showFeedback && adminReviewerFeedback) {
      adminReviewerFeedback.textContent = 'Account list refreshed.';
      adminReviewerFeedback.classList.remove('hidden');
      setTimeout(() => adminReviewerFeedback.classList.add('hidden'), 4000);
    }
  } catch (err) {
    adminReviewerList.innerHTML = `<tr><td colspan="8" class="px-3 py-3 text-center text-red-600">${err.message || 'Failed to load accounts.'}</td></tr>`;
    if (adminReviewerFeedback) {
      adminReviewerFeedback.textContent = err.message || 'Failed to load accounts.';
      adminReviewerFeedback.classList.remove('hidden');
      setTimeout(() => adminReviewerFeedback.classList.add('hidden'), 4000);
    }
    adminReviewersCache = [];
    adminSectionLoaded.delete('accounts');
  }
}

// ========== BLACKLIST ==========

function renderAdminBlacklist(rows) {
  if (!adminBlacklistTbody) return;
  if (adminBlacklistSearchInput && adminBlacklistSearchInput.value !== adminBlacklistSearchTermRaw) {
    adminBlacklistSearchInput.value = adminBlacklistSearchTermRaw;
  }
  const list = Array.isArray(rows) ? rows : [];
  const term = adminBlacklistSearchTerm.trim().toLowerCase();
  const filtered = term
    ? list.filter((entry) => {
        const haystack = [entry.bsb, entry.account, entry.label, entry.notes]
          .map((part) => String(part || '').toLowerCase())
          .join(' ');
        return haystack.includes(term);
      })
    : list;
  const totalCount = list.length;
  const filteredCount = filtered.length;
  if (adminBlacklistCountBadge) {
    const badgeText = term ? `${filteredCount}/${totalCount}` : `${totalCount}`;
    adminBlacklistCountBadge.textContent = badgeText;
    adminBlacklistCountBadge.setAttribute('aria-label', `Showing ${filteredCount} of ${totalCount} blocked bank accounts`);
  }
  if (!filtered.length) {
    const emptyMessage = term
      ? 'No blacklist entries match the current search.'
      : 'No blocked entries.';
    adminBlacklistTbody.innerHTML = `<tr><td colspan="6" class="px-3 py-3 text-center text-gray-500">${emptyMessage}</td></tr>`;
    return;
  }
  const sorted = [...filtered].sort((a, b) => {
    const bsbCompare = String(a.bsb || '').localeCompare(String(b.bsb || ''));
    if (bsbCompare !== 0) return bsbCompare;
    return String(a.account || '').localeCompare(String(b.account || ''));
  });
  adminBlacklistTbody.innerHTML = sorted.map((entry) => {
    const active = entry.active !== false;
    const statusBadge = active
      ? '<span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-700">Active</span>'
      : '<span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600">Disabled</span>';
    const label = entry.label ? escapeHtml(entry.label) : '-';
    const notes = entry.notes ? escapeHtml(entry.notes) : '-';
    const toggleLabel = active ? 'Disable' : 'Enable';
    const toggleIntent = active ? 'deactivate' : 'activate';
    return `<tr data-id="${entry.id}">
      <td class="px-3 py-2 font-mono">${escapeHtml(entry.bsb)}</td>
      <td class="px-3 py-2 font-mono">${escapeHtml(entry.account)}</td>
      <td class="px-3 py-2">${label}</td>
      <td class="px-3 py-2 text-sm text-gray-600">${notes}</td>
      <td class="px-3 py-2">${statusBadge}</td>
      <td class="px-3 py-2 text-right space-x-2">
        <button class="text-xs text-indigo-600 hover:text-indigo-800" data-action="edit" data-id="${entry.id}">Edit</button>
        <button class="text-xs text-amber-600 hover:text-amber-800" data-action="toggle" data-id="${entry.id}" data-next="${toggleIntent}">${toggleLabel}</button>
        <button class="text-xs text-red-600 hover:text-red-800" data-action="delete" data-id="${entry.id}">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function setAdminBlacklistForm(entry = null) {
  if (!adminBlacklistForm) return;
  adminBlacklistEditingId = entry?.id !== undefined ? Number(entry.id) : null;
  adminBlacklistForm.reset();
  if (!entry) {
    if (adminBlacklistActiveSelect) adminBlacklistActiveSelect.value = 'yes';
    if (adminBlacklistSubmitBtn) {
      adminBlacklistSubmitBtn.textContent = 'Add entry';
      adminBlacklistSubmitBtn.dataset.mode = 'create';
    }
    adminBlacklistCancelEditBtn?.classList.add('hidden');
    return;
  }
  const normalizedBsb = normalizeBSBStrict(entry.bsb) || (entry.bsb || '');
  const normalizedAccount = normalizeAccountStrict(entry.account || '');
  if (adminBlacklistBsbInput) adminBlacklistBsbInput.value = normalizedBsb;
  if (adminBlacklistAccountInput) adminBlacklistAccountInput.value = normalizedAccount;
  if (adminBlacklistLabelInput) adminBlacklistLabelInput.value = entry.label || '';
  if (adminBlacklistNotesInput) adminBlacklistNotesInput.value = entry.notes || '';
  if (adminBlacklistActiveSelect) adminBlacklistActiveSelect.value = entry.active === false ? 'no' : 'yes';
  if (adminBlacklistSubmitBtn) {
    adminBlacklistSubmitBtn.textContent = 'Save changes';
    adminBlacklistSubmitBtn.dataset.mode = 'edit';
  }
  adminBlacklistCancelEditBtn?.classList.remove('hidden');
}

async function loadAdminBlacklist(showFeedback = false) {
  if (!hasRole('admin') || !adminBlacklistTbody) return;
  adminBlacklistFeedback?.classList.add('hidden');
  adminBlacklistTbody.innerHTML = '<tr><td colspan="6" class="px-3 py-3 text-center text-gray-500">Loading…</td></tr>';
  try {
    const rows = await apiClient.get('/blacklist');
    adminBlacklistCache = Array.isArray(rows) ? rows : [];
    renderAdminBlacklist(adminBlacklistCache);
    await refreshActiveBlacklist();
    adminSectionLoaded.add('blacklist');
    if (showFeedback && adminBlacklistFeedback) {
      adminBlacklistFeedback.textContent = 'Blacklist refreshed.';
      adminBlacklistFeedback.classList.remove('hidden');
      setTimeout(() => adminBlacklistFeedback.classList.add('hidden'), 4000);
    }
  } catch (err) {
    adminBlacklistTbody.innerHTML = `<tr><td colspan="6" class="px-3 py-3 text-center text-red-600">${err.message || 'Failed to load blacklist.'}</td></tr>`;
    if (adminBlacklistFeedback) {
      adminBlacklistFeedback.textContent = err.message || 'Failed to load blacklist.';
      adminBlacklistFeedback.classList.remove('hidden');
      setTimeout(() => adminBlacklistFeedback.classList.add('hidden'), 4000);
    }
    adminBlacklistCache = [];
    adminSectionLoaded.delete('blacklist');
  }
}

// ========== ARCHIVES ==========

function buildArchiveActionButtons(item, { allowDelete = false } = {}) {
  const code = item?.code || '';
  const stage = (item?.stage || 'submitted').toLowerCase();
  const canDownload = stage === 'approved';
  const actions = [
    { label: 'Open', action: 'open', classes: 'text-indigo-600 hover:text-indigo-800' },
    { label: 'Copy', action: 'copy', classes: 'text-gray-600 hover:text-gray-800' }
  ];
  actions.push({
    label: 'Download',
    action: 'download',
    classes: canDownload ? 'text-green-600 hover:text-green-800' : 'text-gray-400 cursor-not-allowed',
    disabled: !canDownload,
    title: canDownload ? 'Download ABA' : 'Available once approved'
  });
  if (allowDelete) {
    if (stage !== 'approved') {
      actions.push({ label: 'Approve', action: 'approve', classes: 'text-green-700 hover:text-green-800' });
    }
    if (stage !== 'rejected') {
      const rejectLabel = stage === 'approved' ? 'Revert to Rejected' : 'Reject';
      actions.push({ label: rejectLabel, action: 'reject', classes: 'text-amber-700 hover:text-amber-800' });
    }
    actions.push({ label: 'Delete', action: 'delete', classes: 'text-red-600 hover:text-red-800' });
  }
  return actions.map(({ label, action, classes, disabled, title }) => {
    const attrs = [`data-action="${action}"`, `data-code="${code}"`, `data-stage="${stage}"`, `class="text-xs ${classes}"`];
    if (disabled) attrs.push('disabled');
    if (title) attrs.push(`title="${title}"`);
    return `<button ${attrs.join(' ')}>${label}</button>`;
  }).join('');
}

function archiveRowMarkup(item, { allowDelete = false } = {}) {
  const meta = item?.transactions || {};
  const prepared = meta.prepared_by || '-';
  const created = formatAuDateTime(item?.created_at);
  const formattedCode = ensureBatchCodeFormat(item?.code);
  const actions = buildArchiveActionButtons(item, { allowDelete });
  const stage = (item?.stage || 'submitted').toLowerCase();
  const stageInfo = STAGE_META[stage] || { label: stage, classes: 'bg-gray-100 text-gray-700' };
  const stageBadge = `<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${stageInfo.classes}">${stageInfo.label}</span>`;
  const pdRaw = item?.pd_number || meta.pd_number || '';
  const pdDisplay = pdRaw ? formatPdNumber(pdRaw) : '-';
  return `
    <tr class="border-b">
      <td class="px-3 py-2 font-mono">${formattedCode}</td>
      <td class="px-3 py-2">${stageBadge}</td>
      <td class="px-3 py-2">${pdDisplay}</td>
      <td class="px-3 py-2">${item?.department_code || '-'}</td>
      <td class="px-3 py-2">${prepared}</td>
      <td class="px-3 py-2 text-xs text-gray-500">${created}</td>
      <td class="px-3 py-2">
        <div class="flex justify-end gap-2">${actions}</div>
      </td>
    </tr>`;
}

function renderAdminArchives(archives) {
  if (!adminArchiveTbody) return;
  const list = Array.isArray(archives) ? archives : [];
  if (!list.length) {
    const message = adminArchiveSearchTerm ? 'No archives match the current search.' : 'No archives found.';
    adminArchiveTbody.innerHTML = `<tr><td colspan="8" class="px-3 py-3 text-center text-gray-500">${message}</td></tr>`;
    return;
  }
  adminArchiveTbody.innerHTML = list.map(item => archiveRowMarkup(item, { allowDelete: true })).join('');
}

function buildArchiveSearchValues(item) {
  const txMeta = item?.transactions || {};
  const pdSource = item?.pd_number ?? txMeta.pd_number ?? '';
  const pdFormatted = formatPdNumber(pdSource);
  const rawValues = [
    item?.code,
    item?.stage,
    item?.department_code,
    txMeta.prepared_by,
    txMeta.prepared_by_name,
    pdSource,
    pdFormatted
  ].map((value) => String(value || '').toLowerCase()).filter(Boolean);
  const compactValues = [
    item?.code,
    pdSource,
    pdFormatted
  ].map((value) => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase()).filter(Boolean);
  return { rawValues, compactValues };
}

function matchesArchiveSearch(item, term) {
  if (!term) return true;
  const normalizedTerm = term.toLowerCase();
  const compactTerm = normalizedTerm.replace(/[^a-z0-9]/g, '');
  const { rawValues, compactValues } = buildArchiveSearchValues(item);
  if (rawValues.some((value) => value.includes(normalizedTerm))) return true;
  if (compactTerm && compactValues.some((value) => value.includes(compactTerm))) return true;
  return false;
}

function filteredAdminArchives() {
  const term = adminArchiveSearchTerm.trim().toLowerCase();
  if (!term) return adminArchivesCache;
  return adminArchivesCache.filter((item) => matchesArchiveSearch(item, term));
}

function summarizeAdminArchiveStats(list) {
  const entries = Array.isArray(list) ? list : [];
  const stats = {
    total: entries.length,
    submitted: 0,
    approved: 0,
    rejected: 0
  };
  entries.forEach((item) => {
    const stage = String(item?.stage || 'submitted').toLowerCase();
    if (stage in stats) {
      stats[stage] += 1;
    }
  });
  return stats;
}

function updateAdminArchiveStats(list = null) {
  if (!adminArchiveStatsContainer) return;
  if (!adminArchivesFetched) {
    adminArchiveStatsContainer.classList.add('hidden');
    Object.values(adminArchiveStatElements).forEach((el) => {
      if (el) el.textContent = '-';
    });
    if (adminArchiveScopeHint) adminArchiveScopeHint.textContent = 'Scope: pending load';
    return;
  }
  const source = Array.isArray(list) ? list : filteredAdminArchives();
  const stats = summarizeAdminArchiveStats(source);
  Object.entries(adminArchiveStatElements).forEach(([key, el]) => {
    if (!el) return;
    const value = stats[key] ?? 0;
    el.textContent = Number.isFinite(value) ? value.toLocaleString() : '-';
  });
  if (adminArchiveScopeHint) {
    const scopeLabel = adminArchiveScope === 'all' ? 'Scope: full archive' : 'Scope: recent';
    const filterSuffix = adminArchiveSearchTerm ? ' • filters applied' : '';
    adminArchiveScopeHint.textContent = `${scopeLabel}${filterSuffix}`;
  }
  adminArchiveStatsContainer.classList.remove('hidden');
}

function updateAdminArchiveScopeButton() {
  if (!adminToggleArchiveScopeBtn) return;
  const showingAll = adminArchiveScope === 'all';
  adminToggleArchiveScopeBtn.textContent = showingAll ? 'Show recent only' : 'Show full archive';
  adminToggleArchiveScopeBtn.setAttribute('aria-pressed', showingAll ? 'true' : 'false');
}

async function loadAdminArchives(showFeedback = false) {
  if (!hasRole('admin') || !adminArchiveTbody) return;
  adminArchiveTbody.innerHTML = '<tr><td colspan="8" class="px-3 py-3 text-center text-gray-500">Loading…</td></tr>';
  try {
    updateAdminArchiveScopeButton();
    const path = adminArchiveScope === 'all' ? '/archives?scope=all' : '/archives';
    const archives = await apiClient.get(path);
    adminArchivesCache = Array.isArray(archives) ? archives : [];
    adminArchivesFetched = true;
    const filtered = filteredAdminArchives();
    renderAdminArchives(filtered);
    updateAdminArchiveStats(filtered);
    if (adminArchiveSearchInput) adminArchiveSearchInput.value = adminArchiveSearchTermRaw;
    if (adminArchiveFeedback) {
      if (showFeedback) {
        const message = adminArchiveScope === 'all'
          ? `Loaded full archive (${adminArchivesCache.length} batches).`
          : 'Showing most recent archives.';
        adminArchiveFeedback.textContent = message;
        adminArchiveFeedback.classList.remove('hidden');
        setTimeout(() => adminArchiveFeedback.classList.add('hidden'), 4000);
      } else {
        adminArchiveFeedback.classList.add('hidden');
      }
    }
  } catch (err) {
    adminArchiveTbody.innerHTML = `<tr><td colspan="8" class="px-3 py-3 text-center text-red-600">${err.message || 'Failed to load archives.'}</td></tr>`;
    if (adminArchiveFeedback) {
      adminArchiveFeedback.textContent = err.message || 'Failed to load archives.';
      adminArchiveFeedback.classList.remove('hidden');
      setTimeout(() => adminArchiveFeedback.classList.add('hidden'), 4000);
    }
  }
}

// ========== TESTING ==========

function clearAdminTestingFeedback() {
  if (!adminTestingFeedback) return;
  adminTestingFeedback.textContent = '';
  adminTestingFeedback.classList.add('hidden');
  adminTestingFeedback.classList.remove('text-red-600', 'text-green-600', 'text-gray-600');
}

function setAdminTestingFeedback(message, tone = 'info') {
  if (!adminTestingFeedback) return;
  adminTestingFeedback.textContent = message;
  adminTestingFeedback.classList.remove('hidden', 'text-red-600', 'text-green-600', 'text-gray-600');
  const toneClass = tone === 'error' ? 'text-red-600' : tone === 'success' ? 'text-green-600' : 'text-gray-600';
  adminTestingFeedback.classList.add(toneClass);
}

function renderAdminTestingMode() {
  if (!adminTestingStatus) return;
  const enabled = !!adminTestingMode?.enabled;
  adminTestingStatus.classList.remove('text-gray-700', 'text-amber-700', 'text-red-600');
  if (adminTestingLoading && !adminTestingMode) {
    adminTestingStatus.textContent = 'Loading testing status…';
    adminTestingStatus.classList.add('text-gray-700');
  } else if (enabled) {
    adminTestingStatus.textContent = 'Testing mode is active. Emails are currently muted.';
    adminTestingStatus.classList.add('text-amber-700');
  } else {
    adminTestingStatus.textContent = 'Testing mode is off. Emails will send normally.';
    adminTestingStatus.classList.add('text-gray-700');
  }
  if (adminTestingBanner) {
    adminTestingBanner.classList.toggle('hidden', !enabled);
  }
  if (adminTestingToggle) {
    adminTestingToggle.disabled = adminTestingLoading;
    adminTestingToggle.textContent = adminTestingLoading
      ? (enabled ? 'Saving…' : 'Saving…')
      : enabled ? 'Disable testing mode' : 'Enable testing mode';
    adminTestingToggle.classList.toggle('bg-indigo-500', !enabled);
    adminTestingToggle.classList.toggle('hover:bg-indigo-600', !enabled);
    adminTestingToggle.classList.toggle('bg-red-600', enabled);
    adminTestingToggle.classList.toggle('hover:bg-red-700', enabled);
  }
  if (adminTestingMeta) {
    if (adminTestingMode?.updated_at) {
      const when = formatIsoDateTime(adminTestingMode.updated_at);
      const who = adminTestingMode.set_by_name || adminTestingMode.set_by_email || 'an admin';
      adminTestingMeta.textContent = `Last changed ${when ? `on ${when}` : 'recently'} by ${who}.`;
    } else {
      adminTestingMeta.textContent = 'No prior testing toggles recorded yet.';
    }
  }
}

async function loadAdminTestingMode(force = false) {
  if (!adminTestingStatus) return;
  if (adminTestingLoading) return;
  if (!force && adminTestingMode) {
    renderAdminTestingMode();
    return;
  }
  adminTestingLoading = true;
  clearAdminTestingFeedback();
  renderAdminTestingMode();
  try {
    const data = await apiClient.get('/admin/testing-mode');
    adminTestingMode = data || { enabled: false };
    renderAdminTestingMode();
  } catch (err) {
    console.error('Failed to load testing mode status', err);
    if (adminTestingStatus) {
      adminTestingStatus.textContent = 'Unable to load testing status.';
      adminTestingStatus.classList.remove('text-gray-700', 'text-amber-700');
      adminTestingStatus.classList.add('text-red-600');
    }
    setAdminTestingFeedback(err?.message || 'Failed to load testing status.', 'error');
  } finally {
    adminTestingLoading = false;
    renderAdminTestingMode();
  }
}

// ========== ADMIN NAVIGATION ==========

function setAdminNavState(section) {
  adminNavButtons.forEach((btn) => {
    const target = btn.dataset.adminSection;
    const isActive = target === section;
    btn.classList.toggle('bg-amber-100', isActive);
    btn.classList.toggle('text-amber-900', isActive);
    btn.classList.toggle('shadow-sm', isActive);
    btn.classList.toggle('text-gray-700', !isActive);
    btn.classList.toggle('hover:bg-amber-50', !isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
}

export async function showAdminSection(section, force = false) {
  if (!ADMIN_SECTIONS.includes(section)) section = 'signups';
  currentAdminSection = section;
  setAdminNavState(section);
  
  adminPanels.forEach((panel) => {
    const target = panel.dataset.adminSection;
    const shouldShow = target === section;
    panel.classList.toggle('hidden', !shouldShow);
    
    // Ensure all panels use absolute positioning for consistent top alignment
    if (!panel.classList.contains('absolute')) {
      panel.classList.add('absolute', 'top-0', 'left-0', 'right-0');
    }
  });
  
  if (!hasRole('admin')) return;
  
  const shouldReload = force || !adminSectionLoaded.has(section);
  if (!shouldReload) return;
  
  try {
    if (section === 'signups') {
      await loadSignupRequests();
    } else if (section === 'accounts') {
      await loadAdminReviewers(force);
    } else if (section === 'blacklist') {
      await loadAdminBlacklist(force);
    } else if (section === 'archives') {
      await loadAdminArchives();
    } else if (section === 'testing') {
      await loadAdminTestingMode(force);
    }
    adminSectionLoaded.add(section);
  } catch (err) {
    console.error(`Failed to load admin section: ${section}`, err);
  }
}

// ========== INITIALIZATION ==========

export function initAdmin() {
  // Initialize DOM elements
  adminPendingSignupTbody = getById('admin-pending-signup-tbody');
  adminPendingSignupCount = getById('admin-pending-signup-count');
  adminSignupHistoryTbody = getById('admin-signup-history-tbody');
  adminSignupFeedback = getById('admin-signup-feedback');
  adminRefreshSignupsBtn = getById('admin-refresh-signups');
  adminReviewerList = getById('admin-reviewer-list');
  adminArchiveTbody = getById('admin-archive-tbody');
  adminRefreshReviewersBtn = getById('admin-refresh-reviewers');
  adminRefreshArchivesBtn = getById('admin-refresh-archives');
  adminToggleArchiveScopeBtn = getById('admin-toggle-archive-scope');
  adminCreateReviewerForm = getById('admin-create-reviewer-form');
  adminCreateReviewerError = getById('admin-create-reviewer-error');
  adminCreateReviewerSuccess = getById('admin-create-reviewer-success');
  adminCreateReviewerSubmitBtn = getById('admin-create-reviewer-submit');
  adminCreateReviewerCancelBtn = getById('admin-create-reviewer-cancel');
  adminReviewerFeedback = getById('admin-reviewer-feedback');
  adminArchiveFeedback = getById('admin-archive-feedback');
  adminArchiveStatsContainer = getById('admin-archive-stats');
  adminArchiveScopeHint = getById('admin-archive-scope-hint');
  adminArchiveStatElements.total = getById('admin-archive-stat-total');
  adminArchiveStatElements.submitted = getById('admin-archive-stat-submitted');
  adminArchiveStatElements.approved = getById('admin-archive-stat-approved');
  adminArchiveStatElements.rejected = getById('admin-archive-stat-rejected');
  adminBlacklistTbody = getById('admin-blacklist-tbody');
  adminBlacklistFeedback = getById('admin-blacklist-feedback');
  adminRefreshBlacklistBtn = getById('admin-refresh-blacklist');
  adminBlacklistForm = getById('admin-blacklist-form');
  adminBlacklistError = getById('admin-blacklist-error');
  adminBlacklistBsbInput = getById('admin-blacklist-bsb');
  adminBlacklistAccountInput = getById('admin-blacklist-account');
  adminBlacklistLabelInput = getById('admin-blacklist-label');
  adminBlacklistNotesInput = getById('admin-blacklist-notes');
  adminBlacklistActiveSelect = getById('admin-blacklist-active');
  adminBlacklistSubmitBtn = getById('admin-blacklist-submit');
  adminBlacklistCancelEditBtn = getById('admin-blacklist-cancel-edit');
  adminBlacklistImportBtn = getById('admin-blacklist-import');
  adminBlacklistImportInput = getById('admin-blacklist-import-file');
  adminReviewerSearchInput = getById('admin-reviewer-search');
  adminReviewerRoleSelect = getById('admin-reviewer-role');
  adminBlacklistSearchInput = getById('admin-blacklist-search');
  adminReviewerCountBadge = getById('admin-reviewer-count');
  adminBlacklistCountBadge = getById('admin-blacklist-count');
  adminNewEmailInput = getById('admin-new-email');
  adminNewNameInput = getById('admin-new-name');
  adminTestingStatus = getById('admin-testing-status');
  adminTestingMeta = getById('admin-testing-meta');
  adminTestingToggle = getById('admin-testing-toggle');
  adminTestingFeedback = getById('admin-testing-feedback');
  adminTestingBanner = getById('admin-testing-banner');
  adminPanelContainer = getById('admin-panel-container');
  adminPanels = adminPanelContainer ? Array.from(adminPanelContainer.querySelectorAll('.admin-panel')) : [];
  adminNavButtons = Array.from(document.querySelectorAll('button[data-admin-section]'));
  adminArchiveSearchInput = getById('admin-archive-search');
  adminNewRoleSelect = getById('admin-new-role');
  adminNewDeptInput = getById('admin-new-dept');
  adminNewNotifySelect = getById('admin-new-notify');
  adminNewSendEmailSelect = getById('admin-new-send-email');

  // Sync state from appState
  adminArchiveSearchTerm = appState.getAdminArchiveSearchTerm();
  adminArchiveSearchTermRaw = appState.getAdminArchiveSearchTermRaw();
  adminArchiveScope = appState.getAdminArchiveScope();
  adminReviewerSearchTerm = appState.getAdminReviewerSearchTerm();
  adminReviewerSearchTermRaw = appState.getAdminReviewerSearchTermRaw();
  adminReviewerRoleFilterValue = appState.getAdminReviewerRoleFilterValue();
  adminBlacklistSearchTerm = appState.getAdminBlacklistSearchTerm();
  adminBlacklistSearchTermRaw = appState.getAdminBlacklistSearchTermRaw();
  adminReviewerEditingId = appState.getAdminReviewerEditingId();
  adminBlacklistEditingId = appState.getAdminBlacklistEditingId();
  adminTestingMode = appState.getAdminTestingMode();
  adminTestingLoading = appState.getAdminTestingLoading();
  currentAdminSection = appState.getCurrentAdminSection();
  // adminSectionLoaded is managed locally, but we can sync with appState if needed
  adminSectionLoaded = new Set();

  // Event Listeners - Signups
  adminRefreshSignupsBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => showAdminSection('signups', true));
      return;
    }
    await loadSignupRequests();
  });

  adminPendingSignupTbody?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');
    let comment = '';
    if (action === 'reject') {
      comment = prompt('Optional rejection reason (shown to user):', '');
    }
    btn.disabled = true;
    try {
      const response = await apiClient.post(`/admin/signup-requests/${id}/${action}`, { review_comment: comment });
      if (adminSignupFeedback) {
        adminSignupFeedback.textContent = response?.message || (action === 'approve' ? 'Signup approved.' : 'Signup rejected.');
        adminSignupFeedback.classList.remove('hidden');
        setTimeout(() => adminSignupFeedback.classList.add('hidden'), 4000);
      }
      await loadSignupRequests();
    } catch (err) {
      if (adminSignupFeedback) {
        adminSignupFeedback.textContent = err.message || 'Action failed.';
        adminSignupFeedback.classList.remove('hidden');
        setTimeout(() => adminSignupFeedback.classList.add('hidden'), 4000);
      }
    } finally {
      btn.disabled = false;
    }
  });

  // Event Listeners - Reviewers/Accounts
  adminRefreshReviewersBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => showAdminSection('accounts', true));
      return;
    }
    await loadAdminReviewers(true);
  });

  adminReviewerSearchInput?.addEventListener('input', () => {
    adminReviewerSearchTermRaw = (adminReviewerSearchInput.value || '').trim();
    adminReviewerSearchTerm = adminReviewerSearchTermRaw.toLowerCase();
    appState.setAdminReviewerSearchTermRaw(adminReviewerSearchTermRaw);
    appState.setAdminReviewerSearchTerm(adminReviewerSearchTerm);
    renderFilteredAdminReviewers();
  });

  adminReviewerSearchInput?.addEventListener('search', () => {
    adminReviewerSearchTermRaw = (adminReviewerSearchInput.value || '').trim();
    adminReviewerSearchTerm = adminReviewerSearchTermRaw.toLowerCase();
    appState.setAdminReviewerSearchTermRaw(adminReviewerSearchTermRaw);
    appState.setAdminReviewerSearchTerm(adminReviewerSearchTerm);
    renderFilteredAdminReviewers();
  });

  adminReviewerRoleSelect?.addEventListener('change', () => {
    adminReviewerRoleFilterValue = adminReviewerRoleSelect.value || 'all';
    appState.setAdminReviewerRoleFilterValue(adminReviewerRoleFilterValue);
    renderFilteredAdminReviewers();
  });

  // Event Listeners - Blacklist
  adminRefreshBlacklistBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => showAdminSection('blacklist', true));
      return;
    }
    await loadAdminBlacklist(true);
  });

  adminBlacklistSearchInput?.addEventListener('input', () => {
    adminBlacklistSearchTermRaw = (adminBlacklistSearchInput.value || '').trim();
    adminBlacklistSearchTerm = adminBlacklistSearchTermRaw.toLowerCase();
    appState.setAdminBlacklistSearchTermRaw(adminBlacklistSearchTermRaw);
    appState.setAdminBlacklistSearchTerm(adminBlacklistSearchTerm);
    renderAdminBlacklist(adminBlacklistCache);
  });

  adminBlacklistSearchInput?.addEventListener('search', () => {
    adminBlacklistSearchTermRaw = (adminBlacklistSearchInput.value || '').trim();
    adminBlacklistSearchTerm = adminBlacklistSearchTermRaw.toLowerCase();
    appState.setAdminBlacklistSearchTermRaw(adminBlacklistSearchTermRaw);
    appState.setAdminBlacklistSearchTerm(adminBlacklistSearchTerm);
    renderAdminBlacklist(adminBlacklistCache);
  });

  // Event Listeners - Archives
  adminRefreshArchivesBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => showAdminSection('archives', true));
      return;
    }
    await loadAdminArchives(true);
    adminSectionLoaded.add('archives');
  });

  adminToggleArchiveScopeBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => showAdminSection('archives', true));
      return;
    }
    adminArchiveScope = adminArchiveScope === 'all' ? 'recent' : 'all';
    appState.setAdminArchiveScope(adminArchiveScope);
    updateAdminArchiveScopeButton();
    await loadAdminArchives(true);
    adminSectionLoaded.add('archives');
  });

  adminArchiveSearchInput?.addEventListener('input', () => {
    adminArchiveSearchTermRaw = adminArchiveSearchInput.value || '';
    adminArchiveSearchTerm = adminArchiveSearchTermRaw.trim().toLowerCase();
    appState.setAdminArchiveSearchTermRaw(adminArchiveSearchTermRaw);
    appState.setAdminArchiveSearchTerm(adminArchiveSearchTerm);
    const filtered = filteredAdminArchives();
    renderAdminArchives(filtered);
    updateAdminArchiveStats(filtered);
    if (adminArchiveFeedback) adminArchiveFeedback.classList.add('hidden');
  });

  // Event Listeners - Testing
  adminTestingToggle?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => showAdminSection('testing', true));
      return;
    }
    if (adminTestingLoading) return;
    const nextEnabled = !adminTestingMode?.enabled;
    adminTestingLoading = true;
    appState.setAdminTestingLoading(true);
    clearAdminTestingFeedback();
    renderAdminTestingMode();
    try {
      const data = await apiClient.post('/admin/testing-mode', { enabled: nextEnabled });
      adminTestingMode = data || { enabled: nextEnabled };
      appState.setAdminTestingMode(adminTestingMode);
      renderAdminTestingMode();
      setAdminTestingFeedback(
        nextEnabled
          ? 'Testing mode enabled. Emails are now muted.'
          : 'Testing mode disabled. Emails will be delivered normally.',
        'success'
      );
      adminSectionLoaded.add('testing');
    } catch (err) {
      setAdminTestingFeedback(err?.message || 'Failed to update testing mode.', 'error');
    } finally {
      adminTestingLoading = false;
      appState.setAdminTestingLoading(false);
      renderAdminTestingMode();
    }
  });

  // Event Listeners - Admin Navigation
  adminNavButtons.forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const section = btn.dataset.adminSection;
      if (!section) return;
      if (!hasRole('admin')) {
        ensureAuth('admin', () => showAdminSection(section, true));
        return;
      }
      showAdminSection(section);
    });
  });

  // Load signups on admin tab open
  const adminTabLink = getById('tab-admin');
  if (adminTabLink) {
    adminTabLink.addEventListener('click', () => {
      setTimeout(loadSignupRequests, 300);
    });
  }

  // Event Listeners - Reviewer Form
  adminNewRoleSelect?.addEventListener('change', () => {
    syncAdminCreateFormRole();
    if (adminReviewerEditingId && adminNewRoleSelect?.value !== 'user' && adminNewDeptInput) {
      adminNewDeptInput.value = '';
    }
  });

  adminCreateReviewerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => adminCreateReviewerForm.requestSubmit());
      return;
    }
    if (adminCreateReviewerError) adminCreateReviewerError.classList.add('hidden');
    if (adminCreateReviewerSuccess) adminCreateReviewerSuccess.classList.add('hidden');
    const email = (adminNewEmailInput?.value || '').trim();
    if (!email) {
      if (adminCreateReviewerError) {
        adminCreateReviewerError.textContent = 'Email is required.';
        adminCreateReviewerError.classList.remove('hidden');
      }
      return;
    }
    const nameValue = (adminNewNameInput?.value || '').trim();
    const name = nameValue ? nameValue : null;
    const role = adminNewRoleSelect?.value || 'reviewer';
    const deptValue = (adminNewDeptInput?.value || '').trim();
    const notifyPref = adminNewNotifySelect?.value || 'yes';
    const sendEmailPref = adminNewSendEmailSelect?.value === 'yes';
    if (role === 'user' && !/^\d{2}$/.test(deptValue)) {
      if (adminCreateReviewerError) {
        adminCreateReviewerError.textContent = 'Users must have a two-digit Department Head.';
        adminCreateReviewerError.classList.remove('hidden');
      }
      return;
    }
    const isEdit = !!adminReviewerEditingId;
    const requestBody = {
      display_name: name,
      role
    };
    if (role === 'user') {
      requestBody.department_code = deptValue;
    } else if (isEdit) {
      requestBody.department_code = null;
    }
    if (role === 'reviewer' || role === 'admin') {
      requestBody.notify_on_submission = notifyPref === 'yes';
    } else if (isEdit) {
      requestBody.notify_on_submission = false;
    }
    let endpoint = '/reviewers';
    let method = 'POST';
    if (isEdit) {
      endpoint = `/reviewers/${adminReviewerEditingId}`;
      method = 'PUT';
    } else {
      requestBody.email = email;
      requestBody.send_email = sendEmailPref;
    }
    try {
      if (isEdit) {
        await apiClient.put(endpoint, requestBody);
        setAdminReviewerForm(null);
        await loadAdminReviewers();
        adminSectionLoaded.add('accounts');
        if (adminCreateReviewerSuccess) {
          adminCreateReviewerSuccess.textContent = 'Account updated.';
          adminCreateReviewerSuccess.classList.remove('hidden');
          setTimeout(() => adminCreateReviewerSuccess.classList.add('hidden'), 4000);
        }
      } else {
        const payload = await apiClient.post(endpoint, requestBody);
        setAdminReviewerForm(null);
        if (adminCreateReviewerSuccess) {
          adminCreateReviewerSuccess.textContent = payload?.temporary_password
            ? `Account created. Temporary password: ${payload.temporary_password} (change required on first login).`
            : 'Account created. User must change their password on first login.';
          adminCreateReviewerSuccess.classList.remove('hidden');
          setTimeout(() => adminCreateReviewerSuccess.classList.add('hidden'), 6000);
        }
        await loadAdminReviewers();
        adminSectionLoaded.add('accounts');
      }
    } catch (err) {
      if (adminCreateReviewerError) {
        adminCreateReviewerError.textContent = err.message || (isEdit ? 'Unable to update account.' : 'Unable to create account.');
        adminCreateReviewerError.classList.remove('hidden');
      }
    }
  });

  adminCreateReviewerCancelBtn?.addEventListener('click', () => {
    setAdminReviewerForm(null);
    if (adminCreateReviewerError) adminCreateReviewerError.classList.add('hidden');
  });

  // Event Listeners - Reviewer List Actions
  adminReviewerList?.addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    if (!hasRole('admin')) {
      ensureAuth('admin', () => showAdminSection('accounts', true));
      return;
    }
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (!id || !action) return;
    const entry = adminReviewersCache.find((item) => item.id === id);
    try {
      if (action === 'reset') {
        const result = await apiClient.post(`/reviewers/${id}/reset-password`, { send_email: false });
        if (result?.temporary_password) {
          openModal(`
            <div class="p-6">
              <h3 class="text-lg font-semibold text-gray-900 mb-4">Password Reset Complete</h3>
              <div class="bg-gray-50 border border-gray-200 rounded-md p-4 mb-4">
                <div class="flex items-center justify-between">
                  <span class="text-sm text-gray-600">Temporary Password:</span>
                  <button id="copy-temp-password" class="text-xs text-indigo-600 hover:text-indigo-800">Copy</button>
                </div>
                <div class="font-mono text-lg font-semibold text-gray-900 mt-2 select-all" id="temp-password-display">${result.temporary_password}</div>
              </div>
              <p class="text-sm text-gray-600 mb-4">The user must change this password on their first login.</p>
              <div class="flex justify-end">
                <button id="close-password-modal" class="px-4 py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600">Close</button>
              </div>
            </div>
          `);
          const copyBtn = getById('copy-temp-password');
          const closeBtn = getById('close-password-modal');
          copyBtn?.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(result.temporary_password);
              copyBtn.textContent = 'Copied!';
              copyBtn.classList.add('text-green-600');
              copyBtn.classList.remove('text-indigo-600');
              setTimeout(() => {
                copyBtn.textContent = 'Copy';
                copyBtn.classList.remove('text-green-600');
                copyBtn.classList.add('text-indigo-600');
              }, 2000);
            } catch (err) {
              console.warn('Copy failed', err);
            }
          });
          closeBtn?.addEventListener('click', closeModal);
        } else {
          if (adminReviewerFeedback) {
            adminReviewerFeedback.textContent = 'Password reset.';
            adminReviewerFeedback.classList.remove('hidden');
            setTimeout(() => adminReviewerFeedback.classList.add('hidden'), 6000);
          }
        }
        await loadAdminReviewers();
        adminSectionLoaded.add('accounts');
      } else if (action === 'toggle') {
        const next = btn.dataset.next || 'inactive';
        await apiClient.put(`/reviewers/${id}`, { status: next });
        await loadAdminReviewers();
        adminSectionLoaded.add('accounts');
      } else if (action === 'toggle-notify') {
        const next = btn.dataset.next === 'on';
        await apiClient.put(`/reviewers/${id}`, { notify_on_submission: next });
        await loadAdminReviewers(true);
        adminSectionLoaded.add('accounts');
      } else if (action === 'delete') {
        const confirmed = confirm('Delete this account? This cannot be undone.');
        if (!confirmed) return;
        await apiClient.delete(`/reviewers/${id}`);
        await loadAdminReviewers();
        adminSectionLoaded.add('accounts');
        if (adminReviewerFeedback) {
          adminReviewerFeedback.textContent = 'Account deleted.';
          adminReviewerFeedback.classList.remove('hidden');
          setTimeout(() => adminReviewerFeedback.classList.add('hidden'), 6000);
        }
        if (adminReviewerEditingId === id) setAdminReviewerForm(null);
      } else if (action === 'edit-account') {
        if (!entry) {
          await loadAdminReviewers(true);
          return;
        }
        setAdminReviewerForm(entry);
        if (adminCreateReviewerError) adminCreateReviewerError.classList.add('hidden');
        if (adminCreateReviewerSuccess) adminCreateReviewerSuccess.classList.add('hidden');
        adminCreateReviewerForm?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => adminNewNameInput?.focus({ preventScroll: true }), 150);
        return;
      } else if (action === 'edit-dept') {
        let current = (btn.dataset.dept || '').trim();
        let nextValue = current;
        let resolved = false;
        while (!resolved) {
          const input = prompt('Enter the two-digit Department Head code:', nextValue || '');
          if (input === null) return;
          const trimmed = input.trim();
          if (/^\d{2}$/.test(trimmed)) {
            nextValue = trimmed;
            resolved = true;
          } else {
            alert('Department Head must be exactly two digits.');
          }
        }
        await apiClient.put(`/reviewers/${id}`, { department_code: nextValue });
        await loadAdminReviewers();
        adminSectionLoaded.add('accounts');
        if (adminReviewerFeedback) {
          adminReviewerFeedback.textContent = `Department updated to ${nextValue}.`;
          adminReviewerFeedback.classList.remove('hidden');
          setTimeout(() => adminReviewerFeedback.classList.add('hidden'), 6000);
        }
      }
    } catch (err) {
      if (adminReviewerFeedback) {
        adminReviewerFeedback.textContent = err.message || 'Operation failed.';
        adminReviewerFeedback.classList.remove('hidden');
        setTimeout(() => adminReviewerFeedback.classList.add('hidden'), 6000);
      }
    }
  });

  adminReviewerList?.addEventListener('change', async (event) => {
    const select = event.target.closest('select[data-action="set-role"]');
    if (!select) return;
    if (!hasRole('admin')) {
      ensureAuth('admin', () => showAdminSection('accounts', true));
      select.value = select.dataset.currentRole || select.value;
      return;
    }
    const id = select.dataset.id;
    const previousRole = select.dataset.currentRole || 'reviewer';
    let deptValue = select.dataset.dept || '';
    const newRole = select.value;
    if (!id) return;

    if (newRole === 'user') {
      let inputValue = deptValue;
      let valid = false;
      while (!valid) {
        inputValue = prompt('Enter the two-digit Department Head for this user:', inputValue || '');
        if (inputValue === null) {
          select.value = previousRole;
          return;
        }
        inputValue = inputValue.trim();
        if (/^\d{2}$/.test(inputValue)) {
          valid = true;
        } else {
          alert('Department Head must be exactly two digits.');
        }
      }
      deptValue = inputValue;
    }

    const payload = { role: newRole };
    if (newRole === 'user') payload.department_code = deptValue;
    else if (deptValue) payload.department_code = null;
    if (newRole === 'user') payload.notify_on_submission = false;

    try {
      const response = await apiClient.put(`/reviewers/${id}`, payload);
      const updated = response?.reviewer || {};
      select.dataset.currentRole = updated.role || newRole;
      select.dataset.dept = updated.department_code || '';
      select.dataset.notify = updated.notify_on_submission ? 'true' : 'false';
      await loadAdminReviewers(true);
      adminSectionLoaded.add('accounts');
    } catch (err) {
      select.value = previousRole;
      if (adminReviewerFeedback) {
        adminReviewerFeedback.textContent = err.message || 'Unable to update role.';
        adminReviewerFeedback.classList.remove('hidden');
        setTimeout(() => adminReviewerFeedback.classList.add('hidden'), 6000);
      }
    }
  });

  // Event Listeners - Blacklist Form
  adminBlacklistForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => adminBlacklistForm.requestSubmit());
      return;
    }
    if (adminBlacklistError) adminBlacklistError.classList.add('hidden');
    const bsb = normalizeBSBStrict(adminBlacklistBsbInput?.value || '');
    const account = normalizeAccountStrict(adminBlacklistAccountInput?.value || '');
    const label = adminBlacklistLabelInput?.value.trim() || null;
    const notes = adminBlacklistNotesInput?.value.trim() || null;
    const activeValue = adminBlacklistActiveSelect?.value === 'yes';
    if (!bsb) {
      if (adminBlacklistError) {
        adminBlacklistError.textContent = 'Enter a valid BSB in NNN-NNN format.';
        adminBlacklistError.classList.remove('hidden');
      }
      return;
    }
    if (!account || account.length < 5 || account.length > 16) {
      if (adminBlacklistError) {
        adminBlacklistError.textContent = 'Account number must be 5-16 digits.';
        adminBlacklistError.classList.remove('hidden');
      }
      return;
    }
    const payload = {
      bsb,
      account,
      label,
      notes,
      active: activeValue
    };
    const isEdit = !!adminBlacklistEditingId;
    try {
      if (isEdit) {
        await apiClient.put(`/blacklist/${adminBlacklistEditingId}`, payload);
      } else {
        await apiClient.post('/blacklist', payload);
      }
      const successMessage = isEdit ? 'Blacklist entry updated.' : 'Blacklist entry added.';
      setAdminBlacklistForm(null);
      if (adminBlacklistError) adminBlacklistError.classList.add('hidden');
      await loadAdminBlacklist();
      adminSectionLoaded.add('blacklist');
      if (adminBlacklistFeedback) {
        adminBlacklistFeedback.textContent = successMessage;
        adminBlacklistFeedback.classList.remove('hidden');
        setTimeout(() => adminBlacklistFeedback.classList.add('hidden'), 4000);
      }
    } catch (err) {
      if (adminBlacklistError) {
        adminBlacklistError.textContent = err.message || 'Unable to save entry.';
        adminBlacklistError.classList.remove('hidden');
      }
    }
  });

  adminBlacklistCancelEditBtn?.addEventListener('click', () => {
    setAdminBlacklistForm(null);
    if (adminBlacklistError) adminBlacklistError.classList.add('hidden');
  });

  adminBlacklistImportBtn?.addEventListener('click', () => {
    if (!hasRole('admin')) {
      ensureAuth('admin', () => adminBlacklistImportBtn?.click());
      return;
    }
    adminBlacklistImportInput?.click();
  });

  adminBlacklistImportInput?.addEventListener('change', async (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;
    if (adminBlacklistError) adminBlacklistError.classList.add('hidden');
    if (adminBlacklistFeedback) adminBlacklistFeedback.classList.add('hidden');
    try {
      const text = await file.text();
      const parsed = parseBlacklistCsv(text);
      const entries = parsed.entries;
      const localIssues = parsed.issues || [];
      if (!entries.length) {
        const message = localIssues.length ? localIssues.join(' ') : 'File did not contain any blacklist entries.';
        if (adminBlacklistError) {
          adminBlacklistError.textContent = message;
          adminBlacklistError.classList.remove('hidden');
        }
        return;
      }
      if (entries.length > BLACKLIST_IMPORT_LIMIT) {
        if (adminBlacklistError) {
          adminBlacklistError.textContent = `Import is limited to ${BLACKLIST_IMPORT_LIMIT} rows per file.`;
          adminBlacklistError.classList.remove('hidden');
        }
        return;
      }
      const response = await apiClient.post('/blacklist/import', { entries });
      await loadAdminBlacklist();
      adminSectionLoaded.add('blacklist');
      const serverErrors = Array.isArray(response?.errors) ? response.errors : [];
      const summaryParts = [`Imported ${response.inserted || 0} new`, `updated ${response.updated || 0}`];
      if (localIssues.length) summaryParts.push(`${localIssues.length} rows skipped locally`);
      if (serverErrors.length) summaryParts.push(`${serverErrors.length} rows rejected by server`);
      if (adminBlacklistFeedback) {
        adminBlacklistFeedback.textContent = summaryParts.join('; ');
        adminBlacklistFeedback.classList.remove('hidden');
        setTimeout(() => adminBlacklistFeedback.classList.add('hidden'), 6000);
      }
      if (serverErrors.length && adminBlacklistError) {
        const details = serverErrors.slice(0, 5).map((err) => {
          const index = err?.index ? `Row ${err.index}` : 'Row ?';
          return `${index}: ${err?.message || 'Import failed.'}`;
        });
        adminBlacklistError.textContent = details.join(' ');
        adminBlacklistError.classList.remove('hidden');
      } else if (localIssues.length && adminBlacklistError) {
        adminBlacklistError.textContent = localIssues.slice(0, 5).join(' ');
        adminBlacklistError.classList.remove('hidden');
      }
    } catch (err) {
      if (adminBlacklistError) {
        const tail = err.details?.errors?.length ? ` (${err.details.errors.length} rows failed)` : '';
        adminBlacklistError.textContent = `${err.message}${tail}`;
        adminBlacklistError.classList.remove('hidden');
      }
    } finally {
      if (event.target) event.target.value = '';
    }
  });

  adminBlacklistAccountInput?.addEventListener('input', () => {
    const normalized = normalizeAccountStrict(adminBlacklistAccountInput.value).slice(0, 16);
    adminBlacklistAccountInput.value = normalized;
  });

  // Event Listeners - Blacklist Table Actions
  adminBlacklistTbody?.addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    if (!hasRole('admin')) {
      ensureAuth('admin', () => showAdminSection('blacklist', true));
      return;
    }
    const id = Number(btn.dataset.id);
    if (!id) return;
    const entry = adminBlacklistCache.find((item) => Number(item.id) === id);
    if (!entry) return;
    const action = btn.dataset.action;
    try {
      if (action === 'toggle') {
        const nextActive = btn.dataset.next === 'activate';
        await apiClient.put(`/blacklist/${id}`, { active: nextActive });
        await loadAdminBlacklist(true);
        adminSectionLoaded.add('blacklist');
      } else if (action === 'delete') {
        if (!confirm(`Remove ${entry.bsb} / ${entry.account} from the blacklist?`)) return;
        await apiClient.delete(`/blacklist/${id}`);
        await loadAdminBlacklist(true);
        adminSectionLoaded.add('blacklist');
        if (adminBlacklistFeedback) {
          adminBlacklistFeedback.textContent = 'Blacklist entry deleted.';
          adminBlacklistFeedback.classList.remove('hidden');
          setTimeout(() => adminBlacklistFeedback.classList.add('hidden'), 4000);
        }
        if (adminBlacklistEditingId === id) setAdminBlacklistForm(null);
      } else if (action === 'edit') {
        setAdminBlacklistForm(entry);
        if (adminBlacklistError) adminBlacklistError.classList.add('hidden');
        adminBlacklistForm?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => adminBlacklistBsbInput?.focus({ preventScroll: true }), 150);
      }
    } catch (err) {
      if (adminBlacklistFeedback) {
        adminBlacklistFeedback.textContent = err.message || 'Operation failed.';
        adminBlacklistFeedback.classList.remove('hidden');
        setTimeout(() => adminBlacklistFeedback.classList.add('hidden'), 4000);
      }
    }
  });

  // Event Listeners - Archive Table Actions
  attachArchiveTableHandler(adminArchiveTbody, 'admin');

  // Initial setup
  updateAdminArchiveScopeButton();
  setAdminReviewerForm(null);
  setAdminBlacklistForm(null);
  showAdminSection(currentAdminSection);
}

// Expose functions for global access during migration
window.showAdminSection = showAdminSection;
window.loadAdminDashboard = async function(force = false) {
  const currentSection = appState.getCurrentAdminSection();
  await showAdminSection(currentSection, force);
};
window.loadSignupRequests = loadSignupRequests;
window.loadAdminReviewers = loadAdminReviewers;
window.loadAdminBlacklist = loadAdminBlacklist;
window.loadAdminArchives = loadAdminArchives;
window.loadAdminTestingMode = loadAdminTestingMode;
window.setAdminReviewerForm = setAdminReviewerForm;
window.setAdminBlacklistForm = setAdminBlacklistForm;
window.renderFilteredAdminReviewers = renderFilteredAdminReviewers;
window.refreshActiveBlacklist = refreshActiveBlacklist;
window.isBlacklistedCombo = isBlacklistedCombo;
window.getBlacklistDetails = getBlacklistDetails;

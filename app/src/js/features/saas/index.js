/**
 * SaaS Sync Module
 * Handles manual sync triggers and sync history display
 */

import { appState } from '../../state/app-state.js';
import { getById } from '../../utils/dom.js';
import { formatAuDateTime, escapeHtml } from '../../utils/index.js';
import { isAuthActive, ensureAuth } from '../../core/auth.js';

// Module state
let saasSyncHistory = [];
let saasSyncLoading = false;
let saasSyncConfig = null;

/**
 * Load SaaS sync configuration and history
 * Called when SaaS tab is activated
 */
async function loadSaasSync() {
  // Check auth before loading
  if (!isAuthActive()) {
    console.warn('SaaS sync: User not authenticated');
    const historyEl = getById('sync-history');
    if (historyEl) {
      historyEl.innerHTML = '<div class="text-center py-2 text-red-600">Please sign in to access SaaS sync.</div>';
    }
    return;
  }
  
  await Promise.all([
    loadSaasSyncConfig(),
    loadSaasSyncHistory()
  ]);
  initSaasSyncHandlers();
}

/**
 * Load sync configuration
 */
async function loadSaasSyncConfig() {
  try {
    saasSyncConfig = await window.apiRequest('/saas/config');
    console.log('SaaS sync config loaded:', saasSyncConfig);
    updateSaasSyncUI();
  } catch (err) {
    console.error('Failed to load sync config:', err);
    // Show error in UI if config element exists
    const warningEl = document.querySelector('#panel-saas .bg-amber-50');
    if (warningEl) {
      const p = warningEl.querySelector('p');
      if (p) {
        p.textContent = `Failed to load sync configuration: ${err.message || 'Unknown error'}`;
        p.classList.add('text-red-600');
      }
    }
  }
}

/**
 * Update UI based on sync config
 */
function updateSaasSyncUI() {
  if (!saasSyncConfig) return;
  
  const warningEl = document.querySelector('#panel-saas .bg-amber-50');
  if (!warningEl) return;
  
  if (saasSyncConfig.method === 'database') {
    // Show warning about delay
    const h3 = warningEl.querySelector('h3');
    const p = warningEl.querySelector('p');
    if (h3) h3.textContent = 'Manual Sync (Scheduled)';
    if (p) p.textContent = 'Manual sync requests are queued and processed during the next scheduled sync cycle (up to 15 minute delay).';
    warningEl.classList.remove('bg-amber-50', 'border-amber-200');
    warningEl.classList.add('bg-orange-50', 'border-orange-200');
    if (h3) {
      h3.classList.remove('text-amber-900');
      h3.classList.add('text-orange-900');
    }
    if (p) {
      p.classList.remove('text-amber-800');
      p.classList.add('text-orange-800');
    }
  } else if (saasSyncConfig.method === 'direct') {
    // Show immediate sync info with Windows service URL
    const h3 = warningEl.querySelector('h3');
    const p = warningEl.querySelector('p');
    if (h3) h3.textContent = 'Manual Sync (Immediate)';
    if (p) {
      const urlInfo = saasSyncConfig.windowsSyncUrl ? `\nWindows service: ${saasSyncConfig.windowsSyncUrl}` : '';
      p.textContent = `Manual sync requests are processed immediately via Windows web service.${urlInfo}`;
    }
  } else {
    // Show immediate sync info
    const h3 = warningEl.querySelector('h3');
    const p = warningEl.querySelector('p');
    if (h3) h3.textContent = 'Manual Sync (Immediate)';
    if (p) p.textContent = `Manual sync requests are processed immediately. ${saasSyncConfig.description || ''}`;
  }
}

/**
 * Load sync history
 */
async function loadSaasSyncHistory() {
  if (saasSyncLoading) return;
  saasSyncLoading = true;
  
  const historyEl = getById('sync-history');
  if (historyEl) {
    historyEl.innerHTML = '<div class="text-center py-2 text-gray-500">Loading recent requests...</div>';
  }
  
  try {
    const history = await window.apiRequest('/saas/sync-history?limit=10');
    console.log('SaaS sync history loaded:', history);
    saasSyncHistory = Array.isArray(history) ? history : [];
    renderSaasSyncHistory();
  } catch (err) {
    console.error('Failed to load sync history:', err);
    if (historyEl) {
      const errorMsg = err.message || 'Failed to load sync history.';
      historyEl.innerHTML = `<div class="text-center py-2 text-red-600">${escapeHtml(errorMsg)}</div>`;
    }
  } finally {
    saasSyncLoading = false;
  }
}

/**
 * Render sync history
 */
function renderSaasSyncHistory() {
  const historyEl = getById('sync-history');
  if (!historyEl) return;
  
  if (!saasSyncHistory.length) {
    historyEl.innerHTML = '<div class="text-center py-2 text-gray-500">No sync requests yet.</div>';
    return;
  }
  
  const historyHtml = saasSyncHistory.map(request => {
    const date = formatAuDateTime(request.requested_at);
    const status = request.status;
    const statusClass = {
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800'
    }[status] || 'bg-gray-100 text-gray-800';
    
    const fileCount = request.files_synced ? ` (${request.files_synced} files)` : '';
    const error = request.error_message ? `<div class="text-xs text-red-600 mt-1">${escapeHtml(request.error_message)}</div>` : '';
    const requester = escapeHtml(request.requester_name || request.requester_email || 'Unknown');
    
    return `
      <div class="flex justify-between items-start py-2 border-b border-gray-200 last:border-b-0">
        <div class="flex-1">
          <div class="text-xs text-gray-600">${date}</div>
          <div class="text-xs text-gray-500">${requester}</div>
          ${error}
        </div>
        <span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${statusClass}">
          ${status}${fileCount}
        </span>
      </div>
    `;
  }).join('');
  
  historyEl.innerHTML = historyHtml;
}

/**
 * Initialize sync button handlers
 */
function initSaasSyncHandlers() {
  const syncBtn = getById('sync-now-btn');
  const statusEl = getById('sync-status');
  const feedbackEl = getById('sync-feedback');
  
  if (!syncBtn) return;
  
  // Remove existing listeners to prevent duplicates
  syncBtn.replaceWith(syncBtn.cloneNode(true));
  const newSyncBtn = getById('sync-now-btn');
  
  newSyncBtn?.addEventListener('click', async () => {
    if (!isAuthActive()) {
      ensureAuth('user', () => initSaasSyncHandlers());
      return;
    }
    
    newSyncBtn.disabled = true;
    newSyncBtn.textContent = 'Requesting...';
    
    if (statusEl) statusEl.textContent = 'Submitting sync request...';
    if (feedbackEl) {
      feedbackEl.textContent = '';
      feedbackEl.classList.add('hidden');
    }
    
    try {
      console.log('Triggering SaaS sync...');
      const response = await window.apiRequest('/saas/sync-trigger', {
        method: 'POST',
        body: JSON.stringify({ notes: 'Manual sync triggered from web interface' })
      });
      console.log('Sync trigger response:', response);
      
      if (feedbackEl) {
        feedbackEl.textContent = response.message || 'Sync request submitted successfully.';
        feedbackEl.className = 'mt-3 text-sm text-green-600';
        feedbackEl.classList.remove('hidden');
      }
      
      if (statusEl) statusEl.textContent = 'Request submitted successfully.';
      
      // Refresh history to show the new request
      setTimeout(() => loadSaasSyncHistory(), 1000);
      
    } catch (err) {
      console.error('Sync trigger failed:', err);
      const errorMsg = err.message || 'Failed to submit sync request.';
      if (feedbackEl) {
        feedbackEl.textContent = errorMsg;
        feedbackEl.className = 'mt-3 text-sm text-red-600';
        feedbackEl.classList.remove('hidden');
      }
      
      if (statusEl) statusEl.textContent = 'Request failed.';
    } finally {
      newSyncBtn.disabled = false;
      newSyncBtn.textContent = 'Sync Now';
      
      // Clear status after a delay
      setTimeout(() => {
        if (statusEl) statusEl.textContent = '';
      }, 5000);
    }
  });
}

/**
 * Initialize SaaS module
 */
export function initSaas() {
  // Note: Tab switching is handled by tabs.js module
  // When the SaaS tab is activated, tabs.js will call window.loadSaasSync()
  // We just need to ensure loadSaasSync is available globally
  // The actual loading will happen when the tab is switched via tabs.js
}

// Export for global access during migration
window.loadSaasSync = loadSaasSync;


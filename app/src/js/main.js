/**
 * Main Application Entry Point
 * This file initializes the application and loads all modules
 */

// Import utilities
import * as Utils from './utils/index.js';
import { apiClient } from './api/client.js';
import { appState } from './state/app-state.js';
import * as Constants from './constants.js';

// Import core modules
import { initAuth } from './core/auth.js';
import { initTabs } from './core/tabs.js';
import { initApp } from './core/app-init.js';

// Import feature modules
import { initGenerator } from './features/generator/index.js';
import { initReader } from './features/reader/index.js';
import { initMyBatches } from './features/my-batches/index.js';
import { initReviewer } from './features/reviewer/index.js';
import { initSaas } from './features/saas/index.js';
import { initBanking } from './features/banking/index.js';
import { initAdmin } from './features/admin/index.js';
import { initAiHelper } from './features/ai-helper/widget.js';
import { initInputBinding } from './utils/input-binding.js';

// Make utilities available globally for backward compatibility during migration
window.U = {
  digitsOnly: Utils.digitsOnly,
  trunc: (s, n) => String(s || '').slice(0, n),
  padL: (s, w, ch = '0') => String(s || '').padStart(w, ch).slice(-w),
  padR: (s, w, ch = ' ') => String(s || '').padEnd(w, ch).slice(0, w),
  money: Utils.formatMoney
};

// Make common functions available globally
window.getById = Utils.getById;
window.escapeHtml = Utils.escapeHtml;
window.formatBSB = Utils.formatBSB;
window.normalizeBSBStrict = Utils.normalizeBSBStrict;
window.formatCurrency = Utils.formatCurrency;
window.formatMoney = Utils.formatMoney;
window.formatPdNumber = Utils.formatPdNumber;
window.formatAuDateTime = Utils.formatAuDateTime;
window.formatIsoDateTime = Utils.formatIsoDateTime;
window.todayDDMMYY = Utils.todayDDMMYY;
window.toBase64 = Utils.toBase64;
window.fromBase64 = Utils.fromBase64;
window.downloadBase64File = Utils.downloadBase64File;
window.buildAbaFromHeader = Utils.buildAbaFromHeader;
window.parseCsvRows = Utils.parseCsvRows;
window.parseCsvLine = Utils.parseCsvLine;
window.parseBlacklistCsv = Utils.parseBlacklistCsv;
window.openModal = Utils.openModal;
window.closeModal = Utils.closeModal;

// Make constants available globally
window.API_BASE = Constants.API_BASE;
window.AUTH_STORAGE_KEY = Constants.AUTH_STORAGE_KEY;
window.CREDIT_TXN_CODES = Constants.CREDIT_TXN_CODES;
window.CREDIT_CODE_SET = Constants.CREDIT_CODE_SET;
window.BATCH_STAGES = Constants.BATCH_STAGES;
window.STAGE_META = Constants.STAGE_META;
window.STAGE_TRANSITIONS = Constants.STAGE_TRANSITIONS;
window.HEADER_PRESETS = Constants.HEADER_PRESETS;
window.COMMON_HEADER = Constants.COMMON_HEADER;
window.HEADER_FIELDS = Constants.HEADER_FIELDS;
window.BALANCE_FIELDS = Constants.BALANCE_FIELDS;
window.ADMIN_SECTIONS = Constants.ADMIN_SECTIONS;
window.BANKING_SECTIONS = Constants.BANKING_SECTIONS;

// Make API client available
window.apiClient = apiClient;

// Make app state available
window.appState = appState;

// Helper to create apiRequest function for backward compatibility
window.apiRequest = async function(path, options = {}) {
  const token = appState.getAuthToken();
  if (token) {
    apiClient.setAuthToken(token);
  }
  
  try {
    const method = options.method || 'GET';
    if (method === 'GET') {
      return await apiClient.get(path, options);
    } else if (method === 'POST') {
      return await apiClient.post(path, options.body ? JSON.parse(options.body) : null, options);
    } else if (method === 'PUT') {
      return await apiClient.put(path, options.body ? JSON.parse(options.body) : null, options);
    } else if (method === 'PATCH') {
      return await apiClient.patch(path, options.body ? JSON.parse(options.body) : null, options);
    } else if (method === 'DELETE') {
      return await apiClient.delete(path, options);
    }
  } catch (error) {
    // Handle 401 errors
    if (error.status === 401) {
      appState.clearAuthState();
      if (typeof window.clearAuthState === 'function') {
        window.clearAuthState();
      }
      // Redirect to landing page after clearing auth
      if (typeof window.updateAuthUI === 'function') {
        window.updateAuthUI();
      }
    }
    throw error;
  }
};

console.log('✅ Main application modules loaded');
console.log('📦 Utilities, constants, API client, and state management ready');

// Initialize application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initApp();
    initGenerator();
    initReader();
    initMyBatches();
    initReviewer();
    initSaas();
    initBanking();
    initAdmin();
    initAiHelper();
    initInputBinding();
  });
} else {
      initApp();
      initGenerator();
      initReader();
      initMyBatches();
      initReviewer();
      initSaas();
      initBanking();
      initAdmin();
      initAiHelper();
      initInputBinding();
    }


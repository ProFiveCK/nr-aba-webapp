/**
 * Application State Management
 * Centralized state for the application
 */

import { AUTH_STORAGE_KEY } from '../constants.js';

class AppState {
  constructor() {
    // Authentication state
    this.authState = {
      token: null,
      reviewer: null,
      expires_at: null
    };

    // UI State
    this.currentTab = 'gen';
    this.currentBankingSection = 'converter';
    this.currentAdminSection = 'signups';
    this.modalLocked = false;

    // Generator state
    this.transactions = [];
    this.currentSubmissionRootId = null;
    this.activeBlacklistEntries = [];
    this.activeBlacklistSet = new Set();

    // Reader state
    this.readerContext = { rootBatchId: null, code: null };
    this.parsedTransactions = [];
    this.parsedHeader = null;
    this.parsedControl = null;

    // Admin state
    this.adminArchivesCache = [];
    this.adminArchiveSearchTerm = '';
    this.adminArchiveSearchTermRaw = '';
    this.adminArchiveScope = 'recent';
    this.adminReviewersCache = [];
    this.adminReviewerSearchTerm = '';
    this.adminReviewerSearchTermRaw = '';
    this.adminReviewerRoleFilterValue = 'all';
    this.adminReviewerEditingId = null;
    this.adminBlacklistCache = [];
    this.adminBlacklistSearchTerm = '';
    this.adminBlacklistSearchTermRaw = '';
    this.adminBlacklistEditingId = null;
    this.adminTestingMode = null;
    this.adminTestingLoading = false;
    this.adminSectionLoaded = new Set();

    // Reviewer state
    this.reviewerArchivesCache = [];
    this.reviewerArchiveSearchTerm = '';
    this.reviewerArchiveSearchTermRaw = '';

    // My Batches state
    this.myBatchesCache = [];
    this.myBatchesSearchTerm = '';
    this.myBatchesSearchTermRaw = '';
    this.myBatchesLoading = false;

    // SaaS Sync state
    this.saasSyncHistory = [];
    this.saasSyncLoading = false;
    this.saasSyncConfig = null;

    // Load from localStorage
    this.loadAuthState();
  }

  /**
   * Load authentication state from localStorage
   */
  loadAuthState() {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.authState = {
          token: parsed.token || null,
          reviewer: parsed.reviewer || null,
          expires_at: parsed.expires_at || null
        };
      }
    } catch (err) {
      console.warn('Failed to load auth state from localStorage', err);
    }
  }

  /**
   * Save authentication state to localStorage
   */
  saveAuthState() {
    try {
      if (this.authState.token) {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(this.authState));
      } else {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch (err) {
      console.warn('Failed to save auth state to localStorage', err);
    }
  }

  /**
   * Clear authentication state
   */
  clearAuthState() {
    this.authState = { token: null, reviewer: null, expires_at: null };
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }

  /**
   * Set authentication state
   */
  setAuthState(token, reviewer, expires_at) {
    this.authState = { token, reviewer, expires_at };
    this.saveAuthState();
  }

  /**
   * Get authentication token
   */
  getAuthToken() {
    return this.authState.token;
  }

  /**
   * Get current reviewer
   */
  getReviewer() {
    return this.authState.reviewer;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.authState.token && !!this.authState.reviewer;
  }

  /**
   * Check if user has role
   */
  hasRole(role) {
    const reviewer = this.getReviewer();
    if (!reviewer) return false;
    if (Array.isArray(role)) {
      return role.includes(reviewer.role);
    }
    return reviewer.role === role;
  }

  /**
   * Set current tab
   */
  setCurrentTab(tab) {
    this.currentTab = tab;
  }

  /**
   * Get current tab
   */
  getCurrentTab() {
    return this.currentTab;
  }

  // Admin state getters and setters
  getAdminArchiveSearchTerm() { return this.adminArchiveSearchTerm; }
  setAdminArchiveSearchTerm(value) { this.adminArchiveSearchTerm = value; }
  getAdminArchiveSearchTermRaw() { return this.adminArchiveSearchTermRaw; }
  setAdminArchiveSearchTermRaw(value) { this.adminArchiveSearchTermRaw = value; }
  getAdminArchiveScope() { return this.adminArchiveScope; }
  setAdminArchiveScope(value) { this.adminArchiveScope = value; }
  getAdminReviewerSearchTerm() { return this.adminReviewerSearchTerm; }
  setAdminReviewerSearchTerm(value) { this.adminReviewerSearchTerm = value; }
  getAdminReviewerSearchTermRaw() { return this.adminReviewerSearchTermRaw; }
  setAdminReviewerSearchTermRaw(value) { this.adminReviewerSearchTermRaw = value; }
  getAdminReviewerRoleFilterValue() { return this.adminReviewerRoleFilterValue; }
  setAdminReviewerRoleFilterValue(value) { this.adminReviewerRoleFilterValue = value; }
  getAdminBlacklistSearchTerm() { return this.adminBlacklistSearchTerm; }
  setAdminBlacklistSearchTerm(value) { this.adminBlacklistSearchTerm = value; }
  getAdminBlacklistSearchTermRaw() { return this.adminBlacklistSearchTermRaw; }
  setAdminBlacklistSearchTermRaw(value) { this.adminBlacklistSearchTermRaw = value; }
  getAdminReviewerEditingId() { return this.adminReviewerEditingId; }
  setAdminReviewerEditingId(value) { this.adminReviewerEditingId = value; }
  getAdminBlacklistEditingId() { return this.adminBlacklistEditingId; }
  setAdminBlacklistEditingId(value) { this.adminBlacklistEditingId = value; }
  getAdminTestingMode() { return this.adminTestingMode; }
  setAdminTestingMode(value) { this.adminTestingMode = value; }
  getAdminTestingLoading() { return this.adminTestingLoading; }
  setAdminTestingLoading(value) { this.adminTestingLoading = value; }
  getCurrentAdminSection() { return this.currentAdminSection; }
  setCurrentAdminSection(value) { this.currentAdminSection = value; }
  getAdminArchivesCache() { return this.adminArchivesCache; }
  setAdminArchivesCache(value) { this.adminArchivesCache = value; }
  getAdminReviewersCache() { return this.adminReviewersCache; }
  setAdminReviewersCache(value) { this.adminReviewersCache = value; }
  getAdminBlacklistCache() { return this.adminBlacklistCache; }
  setAdminBlacklistCache(value) { this.adminBlacklistCache = value; }
  getAdminSectionLoaded() { return this.adminSectionLoaded; }
  setAdminSectionLoaded(value) { this.adminSectionLoaded = value; }

  // Reviewer state getters and setters
  getReviewerArchivesCache() { return this.reviewerArchivesCache; }
  setReviewerArchivesCache(value) { this.reviewerArchivesCache = value; }
  getReviewerArchiveSearchTerm() { return this.reviewerArchiveSearchTerm; }
  setReviewerArchiveSearchTerm(value) { this.reviewerArchiveSearchTerm = value; }
  getReviewerArchiveSearchTermRaw() { return this.reviewerArchiveSearchTermRaw; }
  setReviewerArchiveSearchTermRaw(value) { this.reviewerArchiveSearchTermRaw = value; }

  // My Batches state getters and setters
  getMyBatchesCache() { return this.myBatchesCache; }
  setMyBatchesCache(value) { this.myBatchesCache = value; }
  getMyBatchesSearchTerm() { return this.myBatchesSearchTerm; }
  setMyBatchesSearchTerm(value) { this.myBatchesSearchTerm = value; }
  getMyBatchesSearchTermRaw() { return this.myBatchesSearchTermRaw; }
  setMyBatchesSearchTermRaw(value) { this.myBatchesSearchTermRaw = value; }
  getMyBatchesLoading() { return this.myBatchesLoading; }
  setMyBatchesLoading(value) { this.myBatchesLoading = value; }

  // Generator state getters and setters
  getTransactions() { return this.transactions; }
  setTransactions(value) { this.transactions = value; }
  getCurrentSubmissionRootId() { return this.currentSubmissionRootId; }
  setCurrentSubmissionRootId(value) { this.currentSubmissionRootId = value; }
  getActiveBlacklistEntries() { return this.activeBlacklistEntries; }
  setActiveBlacklistEntries(value) { 
    this.activeBlacklistEntries = value;
    this.activeBlacklistSet = new Set(value.map(e => `${e.bsb}-${e.account}`));
  }
  getActiveBlacklistSet() { return this.activeBlacklistSet; }

  // Reader state getters and setters
  getReaderContext() { return this.readerContext; }
  setReaderContext(value) { this.readerContext = value; }
  getParsedTransactions() { return this.parsedTransactions; }
  setParsedTransactions(value) { this.parsedTransactions = value; }
  getParsedHeader() { return this.parsedHeader; }
  setParsedHeader(value) { this.parsedHeader = value; }
  getParsedControl() { return this.parsedControl; }
  setParsedControl(value) { this.parsedControl = value; }

  // Banking state getters and setters
  getCurrentBankingSection() { return this.currentBankingSection; }
  setCurrentBankingSection(value) { this.currentBankingSection = value; }

  // Modal state getters and setters
  getModalLocked() { return this.modalLocked; }
  setModalLocked(value) { this.modalLocked = value; }
}

// Create singleton instance
export const appState = new AppState();

// Export class for testing/custom instances
export default AppState;


/**
 * Authentication Module
 * Handles login, logout, session management, and role checking
 */

import { appState } from '../state/app-state.js';
import { apiClient } from '../api/client.js';
import { AUTH_STORAGE_KEY, ROLE_ORDER, ROLE_LABELS, REVIEW_ACCESS_ROLES } from '../constants.js';
import { getById } from '../utils/dom.js';

// DOM elements (will be initialized)
let landingView, appShell, changePasswordBtn, logoutBtn, accountContext;
let landingLoginError, landingPasswordInput, landingEmailInput;
let panelMy, tabMy, reviewerArchivesCard, adminContent, adminLocked;

/**
 * Initialize auth module with DOM elements
 */
export function initAuth(elements = {}) {
  landingView = elements.landingView || getById('landing-view');
  appShell = elements.appShell || getById('app-shell');
  changePasswordBtn = elements.changePasswordBtn || getById('change-password-btn');
  logoutBtn = elements.logoutBtn || getById('logout-btn');
  accountContext = elements.accountContext || getById('account-context');
  landingLoginError = elements.landingLoginError || getById('landing-login-error');
  landingPasswordInput = elements.landingPasswordInput || getById('landing-password');
  landingEmailInput = elements.landingEmailInput || getById('landing-email');
  panelMy = elements.panelMy || getById('panel-my');
  tabMy = elements.tabMy || getById('tab-my');
  reviewerArchivesCard = elements.reviewerArchivesCard || getById('reviewer-archives-card');
  adminContent = elements.adminContent || getById('admin-content');
  adminLocked = elements.adminLocked || getById('admin-locked');

  // Wire Change Password action
  changePasswordBtn?.addEventListener('click', () => {
    openChangePasswordModal(false);
  });
}

/**
 * Check if authentication is active
 */
export function isAuthActive() {
  const token = appState.getAuthToken();
  const reviewer = appState.getReviewer();
  const expiresAt = appState.authState?.expires_at;
  
  if (!token || !expiresAt || !reviewer) return false;
  return new Date(expiresAt) > new Date();
}

/**
 * Check if user has required role
 */
export function hasRole(requiredRole) {
  if (!isAuthActive()) return false;
  if (!requiredRole) return true;
  const reviewer = appState.getReviewer();
  if (!reviewer) return false;
  const role = reviewer.role;
  if (!role) return false;
  
  // Handle array of roles
  if (Array.isArray(requiredRole)) {
    return requiredRole.includes(role);
  }
  
  // Handle role hierarchy
  const actorRank = ROLE_ORDER[role] ?? 0;
  const requiredRank = ROLE_ORDER[requiredRole] ?? 0;
  return actorRank >= requiredRank;
}

/**
 * Get display name for authenticated user
 */
export function authDisplayName() {
  const reviewer = appState.getReviewer();
  return reviewer?.display_name || reviewer?.email || 'Reviewer';
}

/**
 * Load authentication from localStorage
 */
export function loadAuthFromStorage() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.token && parsed?.reviewer && parsed?.expires_at && new Date(parsed.expires_at) > new Date()) {
      appState.setAuthState(parsed.token, parsed.reviewer, parsed.expires_at);
      apiClient.setAuthToken(parsed.token);
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('Failed to load stored auth', err);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

/**
 * Save authentication state
 */
export function saveAuthState(state) {
  if (state?.token) {
    appState.setAuthState(state.token, state.reviewer, state.expires_at);
    apiClient.setAuthToken(state.token);
  } else {
    appState.clearAuthState();
    apiClient.clearAuthToken();
  }
  updateAuthUI();
}

/**
 * Clear authentication state
 */
export function clearAuthState() {
  appState.clearAuthState();
  apiClient.clearAuthToken();
  updateAuthUI();
  
  // Clear dependent state (will be handled by feature modules)
  if (typeof window.clearAuthState === 'function') {
    window.clearAuthState();
  }
}

/**
 * Update authentication UI
 */
export function updateAuthUI() {
  const active = isAuthActive();
  const reviewer = active ? appState.getReviewer() : null;
  const role = reviewer?.role || null;
  const mustChange = !!reviewer?.must_change_password;

  if (active) {
    landingView?.classList.add('hidden');
    appShell?.classList.remove('hidden');
    changePasswordBtn?.classList.remove('hidden');
    logoutBtn?.classList.remove('hidden');
    if (mustChange) {
      changePasswordBtn?.classList.add('bg-red-500', 'hover:bg-red-600');
    } else {
      changePasswordBtn?.classList.remove('bg-red-500', 'hover:bg-red-600');
    }

    const name = authDisplayName();
    const roleText = ROLE_LABELS[role] || 'Signed in';
    const deptCode = reviewer?.department_code 
      ? `Dept ${reviewer.department_code}` 
      : (role === 'user' ? 'Dept not assigned' : '');
    const parts = [name, roleText];
    if (deptCode) parts.push(deptCode);
    if (accountContext) accountContext.textContent = parts.join(' · ');
  } else {
    appShell?.classList.add('hidden');
    landingView?.classList.remove('hidden');
    changePasswordBtn?.classList.add('hidden');
    logoutBtn?.classList.add('hidden');
    changePasswordBtn?.classList.remove('bg-red-500', 'hover:bg-red-600');
    if (accountContext) accountContext.textContent = 'Sign in to continue.';
    landingLoginError?.classList.add('hidden');
    if (landingPasswordInput) landingPasswordInput.value = '';
    landingEmailInput?.focus();
  }

  // Re-initialize tabs after login (in case they weren't found initially)
  if (active && typeof window.initTabs === 'function') {
    window.initTabs();
  }

  // Update role-based tabs (will be handled by tab manager)
  if (typeof window.updateRoleTabs === 'function') {
    window.updateRoleTabs(role, active);
  }

  // Show/hide admin content based on role
  const adminContent = document.getElementById('admin-content');
  const adminLocked = document.getElementById('admin-locked');
  if (adminContent && adminLocked) {
    const hasAdminRole = active && role === 'admin';
    if (hasAdminRole) {
      adminContent.classList.remove('hidden');
      adminLocked.classList.add('hidden');
    } else {
      adminContent.classList.add('hidden');
      adminLocked.classList.remove('hidden');
    }
  }

  // Trigger feature-specific updates
  if (active) {
    if (typeof window.onAuthActive === 'function') {
      window.onAuthActive();
    }
  } else {
    if (typeof window.onAuthInactive === 'function') {
      window.onAuthInactive();
    }
  }
}

/**
 * Verify session with server
 */
export async function verifySession() {
  const token = appState.getAuthToken();
  if (!token) return;
  
  try {
    apiClient.setAuthToken(token);
    const data = await apiClient.get('/auth/me');
    if (data?.reviewer) {
      appState.setAuthState(token, data.reviewer, appState.authState.expires_at);
      updateAuthUI();
    }
  } catch (err) {
    console.warn('Session verification failed', err);
    clearAuthState();
  }
}

/**
 * Ensure user has required role, show login if not
 */
export function ensureAuth(requiredRole = 'reviewer', onSuccess) {
  if (!hasRole(requiredRole)) {
    if (typeof window.openLoginModal === 'function') {
      window.openLoginModal(requiredRole, onSuccess);
    }
    return false;
  }
  if (onSuccess && typeof onSuccess === 'function') {
    onSuccess();
  }
  return true;
}

/**
 * Login reviewer account
 */
export async function loginReviewerAccount(email, password) {
  try {
    // Use apiClient.request directly to pass skipAuth flag
    const response = await apiClient.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' }
    }, true); // skipAuth = true
    
    console.log('Login response:', response);
    
    if (!response?.token || !response?.reviewer) {
      console.error('Invalid login response:', response);
      throw new Error('Login response invalid');
    }
    
    saveAuthState({
      token: response.token,
      reviewer: response.reviewer,
      expires_at: response.expires_at || response.reviewer.session_expires_at
    });
    
    return response;
  } catch (err) {
    console.error('Login error:', err);
    throw err;
  }
}

/**
 * Logout reviewer account
 */
export async function logoutReviewerAccount() {
  try {
    const token = appState.getAuthToken();
    if (token) {
      await apiClient.post('/auth/logout');
    }
  } catch (err) {
    console.warn('Logout warning', err);
  }
  clearAuthState();
  if (typeof window.setTab === 'function') {
    window.setTab('gen');
  }
}

/**
 * Open login modal
 */
export function openLoginModal(requiredRole = 'reviewer', onSuccess) {
  const title = requiredRole === 'admin' ? 'Admin Login' : 'Login';
  const hint = requiredRole === 'admin'
    ? 'Admin access is required. Sign in with an admin account.'
    : 'Enter your credentials to continue.';
  
  if (typeof window.openModal === 'function') {
    window.openModal(`
      <h3 class="text-lg font-semibold text-gray-800 mb-3">${title}</h3>
      <form id="auth-login-form" class="space-y-3 text-sm text-gray-700">
        <p class="text-xs text-gray-500">${hint}</p>
        <div>
          <label class="block mb-1 font-medium" for="auth-login-email">Email</label>
          <input id="auth-login-email" type="email" required class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" autocomplete="email">
        </div>
        <div>
          <label class="block mb-1 font-medium" for="auth-login-password">Password</label>
          <input id="auth-login-password" type="password" required minlength="6" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" autocomplete="current-password">
        </div>
        <div class="text-right">
          <button type="button" id="auth-forgot-password" class="text-xs text-indigo-600 hover:text-indigo-800">Forgot password?</button>
        </div>
        <p id="auth-login-error" class="text-xs text-red-600 hidden"></p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="auth-login-cancel" class="px-3 py-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-amber-500 text-white rounded-md hover:bg-amber-600">Sign In</button>
        </div>
      </form>
    `);
    
    setTimeout(() => {
      getById('auth-login-cancel')?.addEventListener('click', () => {
        if (typeof window.closeModal === 'function') window.closeModal();
      });
      
      getById('auth-forgot-password')?.addEventListener('click', () => {
        if (typeof window.openForgotPasswordModal === 'function') {
          window.openForgotPasswordModal();
        }
      });
      
      const form = getById('auth-login-form');
      const errorEl = getById('auth-login-error');
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl?.classList.add('hidden');
        const email = getById('auth-login-email')?.value.trim();
        const password = getById('auth-login-password')?.value || '';
        try {
          await loginReviewerAccount(email, password);
          if (typeof window.closeModal === 'function') window.closeModal();
          const continuation = () => {
            if (requiredRole === 'admin' && typeof window.loadAdminDashboard === 'function') {
              window.loadAdminDashboard();
            }
            if (typeof onSuccess === 'function') onSuccess();
          };
          handlePostLogin(continuation);
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message || 'Login failed.';
            errorEl.classList.remove('hidden');
          }
        }
      });
    }, 100);
  }
}

/**
 * Handle post-login actions
 */
export function handlePostLogin(onSuccess) {
  // Refresh blacklist if function exists
  if (typeof window.refreshActiveBlacklist === 'function') {
    window.refreshActiveBlacklist(true);
  }
  const reviewer = appState.getReviewer();
  if (reviewer?.must_change_password) {
    openChangePasswordModal(true, onSuccess);
  } else if (typeof onSuccess === 'function') {
    onSuccess();
  }
}

/**
 * Open change password modal
 */
export function openChangePasswordModal(force = false, onSuccess) {
  if (!isAuthActive()) {
    ensureAuth('reviewer', () => openChangePasswordModal(force, onSuccess));
    return;
  }
  const title = force ? 'Set a New Password' : 'Change Password';
  const helpText = force
    ? 'For security you must set a new password before continuing.'
    : 'Enter your current password and a new password (minimum 6 characters).';
  const cancelButton = force
    ? '<button type="button" id="change-password-logout" class="px-3 py-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-100">Log out</button>'
    : '<button type="button" id="change-password-cancel" class="px-3 py-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-100">Cancel</button>';
  
  if (typeof window.openModal === 'function') {
    window.openModal(`
      <h3 class="text-lg font-semibold text-gray-800 mb-3">${title}</h3>
      <form id="change-password-form" class="space-y-3 text-sm text-gray-700">
        <p class="text-xs text-gray-500">${helpText}</p>
        <div>
          <label class="block mb-1 font-medium" for="change-password-current">Current password</label>
          <input id="change-password-current" type="password" required minlength="1" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" autocomplete="current-password">
        </div>
        <div>
          <label class="block mb-1 font-medium" for="change-password-new">New password</label>
          <input id="change-password-new" type="password" required minlength="6" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" autocomplete="new-password">
        </div>
        <div>
          <label class="block mb-1 font-medium" for="change-password-confirm">Confirm new password</label>
          <input id="change-password-confirm" type="password" required minlength="6" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" autocomplete="new-password">
        </div>
        <p id="change-password-error" class="text-xs text-red-600 hidden"></p>
        <div class="flex justify-end gap-2 pt-2">
          ${cancelButton}
          <button type="submit" class="px-4 py-2 bg-amber-500 text-white rounded-md hover:bg-amber-600">Update Password</button>
        </div>
      </form>
    `);
    
    setTimeout(() => {
      if (force && typeof window.modalLocked !== 'undefined') {
        window.modalLocked = true;
      }
      const modalClose = getById('modal-close');
      if (force) modalClose?.classList.add('hidden');
      else modalClose?.classList.remove('hidden');
      
      const form = getById('change-password-form');
      const errorEl = getById('change-password-error');
      const cancelBtn = getById('change-password-cancel');
      const logoutForceBtn = getById('change-password-logout');
      
      cancelBtn?.addEventListener('click', () => {
        if (typeof window.closeModal === 'function') window.closeModal();
      });
      
      logoutForceBtn?.addEventListener('click', () => {
        if (typeof window.modalLocked !== 'undefined') window.modalLocked = false;
        logoutReviewerAccount();
        if (typeof window.closeModal === 'function') window.closeModal();
      });

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl?.classList.add('hidden');
        const current = getById('change-password-current')?.value || '';
        const next = getById('change-password-new')?.value || '';
        const confirm = getById('change-password-confirm')?.value || '';
        if (next.length < 6) {
          if (errorEl) {
            errorEl.textContent = 'Password must be at least 6 characters.';
            errorEl.classList.remove('hidden');
          }
          return;
        }
        if (next !== confirm) {
          if (errorEl) {
            errorEl.textContent = 'Passwords do not match.';
            errorEl.classList.remove('hidden');
          }
          return;
        }
        try {
          const data = await apiClient.post('/auth/change-password', {
            current_password: current,
            new_password: next
          });
          saveAuthState({
            token: data.token,
            reviewer: data.reviewer,
            expires_at: data.expires_at
          });
          if (typeof window.modalLocked !== 'undefined') window.modalLocked = false;
          if (typeof window.closeModal === 'function') window.closeModal();
          if (typeof onSuccess === 'function') onSuccess();
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message || 'Unable to update password.';
            errorEl.classList.remove('hidden');
          }
        }
      });
    }, 100);
  }
}

/**
 * Open forgot password modal (unauthenticated)
 */
export function openForgotPasswordModal() {
  if (typeof window.openModal !== 'function') return;
  window.openModal(`
      <h3 class="text-lg font-semibold text-gray-800 mb-3">Reset Password</h3>
      <form id="forgot-password-form" class="space-y-3 text-sm text-gray-700">
        <p class="text-xs text-gray-500">Enter your email address and we'll send you password reset instructions.</p>
        <div>
          <label class="block mb-1 font-medium" for="forgot-email">Email</label>
          <input id="forgot-email" type="email" required class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" autocomplete="email">
        </div>
        <p id="forgot-password-error" class="text-xs text-red-600 hidden"></p>
        <p id="forgot-password-success" class="text-xs text-green-600 hidden"></p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="forgot-cancel" class="px-3 py-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="submit" id="forgot-submit" class="px-4 py-2 bg-amber-500 text-white rounded-md hover:bg-amber-600">Send Reset Link</button>
        </div>
      </form>
    `);

  setTimeout(() => {
    const form = getById('forgot-password-form');
    const errorEl = getById('forgot-password-error');
    const successEl = getById('forgot-password-success');
    const submitBtn = getById('forgot-submit');
    const cancelBtn = getById('forgot-cancel');

    cancelBtn?.addEventListener('click', () => {
      if (typeof window.closeModal === 'function') window.closeModal();
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl?.classList.add('hidden');
      successEl?.classList.add('hidden');

      const email = getById('forgot-email')?.value.trim();
      if (!email) return;

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';
      }

      try {
        const data = await apiClient.request('/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        }, true);

        if (successEl) {
          successEl.textContent = (data && data.message) || 'Reset instructions sent to your email.';
          successEl.classList.remove('hidden');
        }
        form?.reset();
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message || 'Failed to send reset email';
          errorEl.classList.remove('hidden');
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send Reset Link';
        }
      }
    });
  }, 100);
}

/**
 * Open reset password modal with token (from link)
 */
export function openResetPasswordModal(token) {
  if (!token || typeof window.openModal !== 'function') return;
  window.openModal(`
      <h3 class="text-lg font-semibold text-gray-800 mb-3">Set New Password</h3>
      <form id="reset-password-form" class="space-y-3 text-sm text-gray-700">
        <p class="text-xs text-gray-500">Enter your new password below.</p>
        <div>
          <label class="block mb-1 font-medium" for="new-password">New Password</label>
          <input id="new-password" type="password" required minlength="6" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" autocomplete="new-password">
        </div>
        <p id="reset-password-error" class="text-xs text-red-600 hidden"></p>
        <p id="reset-password-success" class="text-xs text-green-600 hidden"></p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="reset-cancel" class="px-3 py-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="submit" id="reset-submit" class="px-4 py-2 bg-amber-500 text-white rounded-md hover:bg-amber-600">Update Password</button>
        </div>
      </form>
    `);

  setTimeout(() => {
    const form = getById('reset-password-form');
    const errorEl = getById('reset-password-error');
    const successEl = getById('reset-password-success');
    const submitBtn = getById('reset-submit');
    const cancelBtn = getById('reset-cancel');

    cancelBtn?.addEventListener('click', () => {
      if (typeof window.closeModal === 'function') window.closeModal();
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl?.classList.add('hidden');
      successEl?.classList.add('hidden');

      const password = getById('new-password')?.value || '';
      if (!password || password.length < 6) {
        if (errorEl) {
          errorEl.textContent = 'Password must be at least 6 characters';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Updating...';
      }

      try {
        const data = await apiClient.request('/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, new_password: password })
        }, true);

        if (successEl) {
          successEl.textContent = (data && data.message) || 'Password updated successfully';
          successEl.classList.remove('hidden');
        }
        form?.reset();
        setTimeout(() => {
          if (typeof window.closeModal === 'function') window.closeModal();
          window.location.hash = '';
        }, 2000);
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message || 'Failed to reset password';
          errorEl.classList.remove('hidden');
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Update Password';
        }
      }
    });
  }, 100);
}

// Export for global access during migration
window.isAuthActive = isAuthActive;
window.hasRole = hasRole;
window.authDisplayName = authDisplayName;
window.loadAuthFromStorage = loadAuthFromStorage;
window.saveAuthState = saveAuthState;
window.clearAuthState = clearAuthState;
window.updateAuthUI = updateAuthUI;
window.verifySession = verifySession;
window.ensureAuth = ensureAuth;
window.loginReviewerAccount = loginReviewerAccount;
window.logoutReviewerAccount = logoutReviewerAccount;
window.openLoginModal = openLoginModal;
window.handlePostLogin = handlePostLogin;
window.openChangePasswordModal = openChangePasswordModal;
window.openForgotPasswordModal = openForgotPasswordModal;
window.openResetPasswordModal = openResetPasswordModal;


/**
 * Application Initialization Module
 * Sets up all DOM references, event listeners, and initializes modules
 */

import { initAuth, loadAuthFromStorage, updateAuthUI, verifySession } from './auth.js';
import { initTabs, setTab } from './tabs.js';
import { getById } from '../utils/dom.js';

/**
 * Initialize the entire application
 */
export function initApp() {
  // Initialize core modules
  initAuth();
  initTabs();
  
  // Load auth state and update UI
  loadAuthFromStorage();
  updateAuthUI();
  
  // Verify session if authenticated
  if (typeof window.authState !== 'undefined' && window.authState?.token) {
    verifySession().finally(() => {
      handleBatchFromQuery();
      if (window.authState?.reviewer?.must_change_password && typeof window.openChangePasswordModal === 'function') {
        window.openChangePasswordModal(true);
      }
    });
  } else {
    handleBatchFromQuery();
  }
  
  // Set up modal handlers
  setupModalHandlers();
  
  // Set up landing page handlers
  setupLandingPageHandlers();
  
  // Set up password reset from URL hash
  handlePasswordResetFromHash();
  window.addEventListener('hashchange', handlePasswordResetFromHash);
}

/**
 * Handle batch code from URL query parameter
 */
function handleBatchFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const batchParam = params.get('batch');
  if (!batchParam) return;
  
  // Use ensureBatchCodeFormat from utils if available, otherwise define locally
  const ensureBatchCodeFormat = window.ensureBatchCodeFormat || ((value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  });
  
  const formatted = ensureBatchCodeFormat(batchParam);
  const launch = () => {
    setTab('reviewer');
    setTimeout(() => {
      if (typeof window.loadBatchForReview === 'function') {
        window.loadBatchForReview(formatted);
      }
    }, 120);
  };
  
  if (typeof window.hasRole === 'function' && !window.hasRole('reviewer')) {
    if (typeof window.ensureAuth === 'function') {
      window.ensureAuth('reviewer', launch);
    }
  } else {
    launch();
  }
}

/**
 * Set up modal handlers
 */
function setupModalHandlers() {
  const modalBackdrop = getById('modal-backdrop');
  const modalClose = getById('modal-close');
  
  modalBackdrop?.addEventListener('click', (e) => {
    if (typeof window.modalLocked !== 'undefined' && window.modalLocked) return;
    if (e.target === modalBackdrop && typeof window.closeModal === 'function') {
      window.closeModal();
    }
  });
  
  modalClose?.addEventListener('click', () => {
    if (typeof window.closeModal === 'function') {
      window.closeModal();
    }
  });
}

/**
 * Set up landing page handlers
 */
function setupLandingPageHandlers() {
  const landingForgotPassword = getById('landing-forgot-password');
  landingForgotPassword?.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof window.openForgotPasswordModal === 'function') {
      window.openForgotPasswordModal();
    }
  });

  // Login form handler
  const landingLoginForm = getById('landing-login-form');
  const landingLoginError = getById('landing-login-error');
  const landingEmailInput = getById('landing-email');
  const landingPasswordInput = getById('landing-password');
  
  console.log('Setting up login form handler:', {
    form: landingLoginForm,
    error: landingLoginError,
    emailInput: landingEmailInput,
    passwordInput: landingPasswordInput,
    loginFunctionAvailable: typeof window.loginReviewerAccount === 'function'
  });
  
  if (landingLoginForm) {
    landingLoginForm.addEventListener('submit', async (e) => {
      console.log('Login form submitted - event fired');
      e.preventDefault();
      e.stopPropagation();
      
      // Get fresh references to inputs in case DOM changed
      const emailInput = getById('landing-email');
      const passwordInput = getById('landing-password');
      const errorEl = getById('landing-login-error');
      
      if (errorEl) errorEl.classList.add('hidden');
      const email = emailInput?.value.trim();
      const password = passwordInput?.value || '';
      
      console.log('Login attempt:', { email, hasPassword: !!password });
      
      if (!email || !password) {
        if (errorEl) {
          errorEl.textContent = 'Enter email and password to continue.';
          errorEl.classList.remove('hidden');
        }
        return;
      }
      
      // Disable submit button to prevent double submission
      const submitBtn = landingLoginForm.querySelector('button[type="submit"]');
      let originalText = 'Sign In';
      if (submitBtn) {
        originalText = submitBtn.textContent || 'Sign In';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';
      }
      
      try {
        console.log('Calling loginReviewerAccount...');
        if (typeof window.loginReviewerAccount === 'function') {
          await window.loginReviewerAccount(email, password);
          console.log('Login successful');
          if (passwordInput) passwordInput.value = '';
          if (typeof window.handlePostLogin === 'function') {
            window.handlePostLogin(() => {
              if (typeof window.setTab === 'function') {
                window.setTab('gen');
              }
            });
          }
        } else {
          console.error('loginReviewerAccount function not available');
          throw new Error('Login function not available');
        }
      } catch (err) {
        console.error('Login error:', err);
        if (errorEl) {
          errorEl.textContent = err.message || 'Login failed.';
          errorEl.classList.remove('hidden');
        }
      } finally {
        // Re-enable submit button
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }
      }
    });
    console.log('Login form handler attached successfully');
  } else {
    console.error('Landing login form not found!');
  }

  // Logout button handler
  const logoutBtn = getById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await logoutReviewerAccount();
    });
  }

  // Signup form handler
  const signupForm = getById('landing-signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = getById('signup-name')?.value.trim();
      const email = getById('signup-email')?.value.trim();
      const password = getById('signup-password')?.value;
      const department_code = getById('signup-dept')?.value.trim();
      const errorEl = getById('signup-error');
      if (errorEl) {
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
      }
      try {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, department_code })
        });
        const data = await res.json();
        if (res.ok) {
          signupForm.reset();
          signupForm.innerHTML = `<div class="text-green-700 text-center text-sm font-semibold py-4">${data.message || 'Signup request submitted. Await admin approval.'}</div>`;
        } else {
          if (errorEl) {
            errorEl.textContent = data.message || 'Unable to submit signup request.';
            errorEl.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = 'Network error. Please try again.';
          errorEl.classList.remove('hidden');
        }
      }
    });
  }
}

/**
 * Handle password reset from URL hash
 */
function handlePasswordResetFromHash() {
  const hash = window.location.hash;
  if (hash.startsWith('#reset-password=')) {
    const token = hash.substring('#reset-password='.length);
    if (token && typeof window.openResetPasswordModal === 'function') {
      window.location.hash = '';
      window.openResetPasswordModal(token);
    }
  }
}

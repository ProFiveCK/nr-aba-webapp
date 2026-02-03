const getById = (id) => document.getElementById(id);

// Test function to manually trigger click
window.debugClick = function() {
  const btn = getById('landing-forgot-password');
  console.log('Button found:', btn);
  console.log('Button style display:', window.getComputedStyle(btn).display);
  console.log('Button style visibility:', window.getComputedStyle(btn).visibility);
  console.log('Button style pointer-events:', window.getComputedStyle(btn).pointerEvents);
  console.log('Button offset parent:', btn.offsetParent);
  
  // Try to click it programmatically
  btn.click();
};

function openModal(content) {
  console.log('openModal called');
  
  // Remove any existing modal
  const existingModal = document.getElementById('dynamic-modal');
  if (existingModal) existingModal.remove();
  
  // Create a completely fresh modal element
  const modal = document.createElement('div');
  modal.id = 'dynamic-modal';
  modal.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="
        background: white;
        border-radius: 8px;
        padding: 20px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        position: relative;
      ">
        <button onclick="document.getElementById('dynamic-modal').remove()" style="
          position: absolute;
          top: 10px;
          right: 15px;
          background: none;
          border: none;
          font-size: 20px;
          cursor: pointer;
          color: #666;
        ">×</button>
        ${content}
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  console.log('Dynamic modal created and added');
}

function closeModal() {
  const dynamicModal = getById('dynamic-modal');
  if (dynamicModal) {
    dynamicModal.remove();
    return;
  }
  const backdrop = getById('modal-backdrop');
  if (backdrop) backdrop.remove();
}

function openForgotPasswordModal() {
  console.log('openForgotPasswordModal called');
  openModal(`
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
  
  // Set up form functionality
  setTimeout(() => {
    const form = document.getElementById('forgot-password-form');
    const errorEl = document.getElementById('forgot-password-error');
    const successEl = document.getElementById('forgot-password-success');
    const submitBtn = document.getElementById('forgot-submit');
    const cancelBtn = document.getElementById('forgot-cancel');
    
    cancelBtn?.addEventListener('click', () => {
      document.getElementById('dynamic-modal')?.remove();
    });
    
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl?.classList.add('hidden');
      successEl?.classList.add('hidden');
      
      const email = document.getElementById('forgot-email')?.value.trim();
      if (!email) return;
      
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';
      
      try {
        const response = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          successEl.textContent = data.message || 'Reset instructions sent to your email';
          successEl.classList.remove('hidden');
          form.reset();
        } else {
          throw new Error(data.message || 'Failed to send reset email');
        }
      } catch (err) {
        errorEl.textContent = err.message || 'Failed to send reset email';
        errorEl.classList.remove('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Reset Link';
      }
    });
  }, 100);
  
  console.log('Modal HTML set');
}

function openResetPasswordModal(token) {
  openModal(`
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
  
  // Set up form functionality
  setTimeout(() => {
    const form = document.getElementById('reset-password-form');
    const errorEl = document.getElementById('reset-password-error');
    const successEl = document.getElementById('reset-password-success');
    const submitBtn = document.getElementById('reset-submit');
    const cancelBtn = document.getElementById('reset-cancel');
    
    cancelBtn?.addEventListener('click', () => {
      document.getElementById('dynamic-modal')?.remove();
    });
    
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl?.classList.add('hidden');
      successEl?.classList.add('hidden');
      
      const password = document.getElementById('new-password')?.value;
      if (!password) return;
      
      if (password.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters';
        errorEl.classList.remove('hidden');
        return;
      }
      
      submitBtn.disabled = true;
      submitBtn.textContent = 'Updating...';
      
      try {
        const response = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, new_password: password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          successEl.textContent = data.message || 'Password updated successfully';
          successEl.classList.remove('hidden');
          form.reset();
          setTimeout(() => {
            document.getElementById('dynamic-modal')?.remove();
            // Clear the hash
            window.location.hash = '';
          }, 2000);
        } else {
          throw new Error(data.message || 'Failed to reset password');
        }
      } catch (err) {
        errorEl.textContent = err.message || 'Failed to reset password';
        errorEl.classList.remove('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update Password';
      }
    });
  }, 100);
}

// Global event listeners for forgot password functionality
document.addEventListener('DOMContentLoaded', () => {
  // Small delay to ensure everything is ready
  setTimeout(() => {
    // Set up global modal close functionality
    getById('modal-close')?.addEventListener('click', closeModal);
    getById('modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    // Set up forgot password links (both landing and auth modal)
    getById('landing-forgot-password')?.addEventListener('click', (e) => {
      console.log('CLICK DETECTED!');
      e.preventDefault();
      try {
        openForgotPasswordModal();
        console.log('Modal function called');
      } catch (err) {
        console.error('Error opening modal:', err);
      }
    });
    
    const authBtn = getById('auth-forgot-password');
    if (authBtn) {
      authBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openForgotPasswordModal();
      });
    }
  }, 100); // End of setTimeout

  // Handle password reset from URL hash
  function handlePasswordResetFromHash() {
    const hash = window.location.hash;
    if (hash.startsWith('#reset-password=')) {
      const token = hash.substring('#reset-password='.length);
      if (token) {
        window.location.hash = ''; // Clear the hash
        openResetPasswordModal(token);
      }
    }
  }

  // Check for password reset token on load
  handlePasswordResetFromHash();
  
  // Listen for hash changes (in case user navigates with back button)
  window.addEventListener('hashchange', handlePasswordResetFromHash);
});

// Main application code within DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  // DOM, Tabs (move up so tabAdmin is initialized before use)
  // tabAdmin is already declared later, so do not redeclare here
  // Admin Signup Requests Review Logic
  const adminPendingSignupTbody = document.getElementById('admin-pending-signup-tbody');
  const adminPendingSignupCount = document.getElementById('admin-pending-signup-count');
  const adminSignupHistoryTbody = document.getElementById('admin-signup-history-tbody');
  const adminSignupFeedback = document.getElementById('admin-signup-feedback');
  const adminRefreshSignupsBtn = document.getElementById('admin-refresh-signups');
  async function loadSignupRequests() {
    if (!adminPendingSignupTbody || !adminSignupHistoryTbody) return;
    if (adminPendingSignupCount) adminPendingSignupCount.textContent = 'Loading…';
    adminPendingSignupTbody.innerHTML = `<tr><td colspan="5" class="px-3 py-3 text-center text-gray-500">Loading…</td></tr>`;
    adminSignupHistoryTbody.innerHTML = `<tr><td colspan="6" class="px-3 py-3 text-center text-gray-500">Loading…</td></tr>`;
    try {
      const data = await apiRequest('/admin/signup-requests');
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

      adminPendingSignupTbody.innerHTML = pending.length
        ? pending.map((req) => {
            const requested = formatAuDateTime(req.created_at);
            return `<tr>
              <td class="px-3 py-2">${req.name}</td>
              <td class="px-3 py-2 font-mono">${req.email}</td>
              <td class="px-3 py-2">${req.department_code || '-'}</td>
              <td class="px-3 py-2">${requested}</td>
              <td class="px-3 py-2 text-right">
                <button class="px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-xs" data-action="approve" data-id="${req.id}">Approve</button>
                <button class="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs ml-2" data-action="reject" data-id="${req.id}">Reject</button>
              </td>
            </tr>`;
          }).join('')
        : `<tr><td colspan="5" class="px-3 py-3 text-center text-gray-500">No pending requests.</td></tr>`;

      adminSignupHistoryTbody.innerHTML = history.length
        ? history.map((req) => {
            const reviewed = formatAuDateTime(req.reviewed_at);
            const status = req.status.charAt(0).toUpperCase() + req.status.slice(1);
            const reviewerDisplay = (req.reviewer_name && req.reviewer_name.trim())
              ? req.reviewer_name.trim()
              : (req.reviewer_email || '-');
            const reviewer = escapeHtml(reviewerDisplay);
            const tooltip = req.review_comment ? ` title="${escapeHtml(req.review_comment)}"` : '';
            return `<tr${tooltip}>
              <td class="px-3 py-2">${req.name}</td>
              <td class="px-3 py-2 font-mono">${req.email}</td>
              <td class="px-3 py-2">${req.department_code || '-'}</td>
              <td class="px-3 py-2">${reviewed}</td>
              <td class="px-3 py-2">${status}</td>
              <td class="px-3 py-2">${reviewer}</td>
            </tr>`;
          }).join('')
        : `<tr><td colspan="6" class="px-3 py-3 text-center text-gray-500">No recent decisions.</td></tr>`;
      adminSectionLoaded.add('signups');
    } catch (err) {
      adminPendingSignupTbody.innerHTML = `<tr><td colspan="5" class="px-3 py-3 text-center text-red-600">Failed to load requests.</td></tr>`;
      adminSignupHistoryTbody.innerHTML = `<tr><td colspan="6" class="px-3 py-3 text-center text-red-600">Failed to load history.</td></tr>`;
      if (adminPendingSignupCount) adminPendingSignupCount.textContent = 'Unavailable';
    }
  }

  adminRefreshSignupsBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => showAdminSection('signups', true));
      return;
    }
    await loadSignupRequests();
  });
  if (adminPendingSignupTbody) {
    adminPendingSignupTbody.addEventListener('click', async (e) => {
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
        const response = await apiRequest(`/admin/signup-requests/${id}/${action}`, {
          method: 'POST',
          body: JSON.stringify({ review_comment: comment })
        });
        adminSignupFeedback.textContent = response?.message || (action === 'approve' ? 'Signup approved.' : 'Signup rejected.');
        adminSignupFeedback.classList.remove('hidden');
        setTimeout(() => adminSignupFeedback.classList.add('hidden'), 4000);
        loadSignupRequests();
      } catch (err) {
        adminSignupFeedback.textContent = err.message || 'Action failed.';
        adminSignupFeedback.classList.remove('hidden');
        setTimeout(() => adminSignupFeedback.classList.add('hidden'), 4000);
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Load signups on admin tab open
  const adminTabLink = document.getElementById('tab-admin');
  if (adminTabLink) {
    adminTabLink.addEventListener('click', () => {
      setTimeout(loadSignupRequests, 300);
    });
  }
  // Signup form logic
  const signupForm = document.getElementById('landing-signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('signup-name').value.trim();
      const email = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      const department_code = document.getElementById('signup-dept').value.trim();
      const errorEl = document.getElementById('signup-error');
      errorEl.classList.add('hidden');
      errorEl.textContent = '';
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
          errorEl.textContent = data.message || 'Unable to submit signup request.';
          errorEl.classList.remove('hidden');
        }
      } catch (err) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.classList.remove('hidden');
      }
    });
  }
  // ---- Presets, embedded ----
  const COMMON = { fi:"CBA", reel:"1", user:"Nauru Government", apca:"301500", desc:"WAGES", proc:"", remitter:"RON Government" };

  const API_BASE = '/api';

  const CREDIT_TXN_CODES = ['50','51','52','53','54','55','56','57'];
  const CREDIT_CODE_SET = new Set(CREDIT_TXN_CODES);

  const generateBatchId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  async function sha256Hex(text){
    if (!window.crypto?.subtle) return null;
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function showBatchStoredModal({ code, fileName, base64, metadata, batchId }){
    const formattedCode = ensureBatchCodeFormat(code);
  const totalCredits = metadata?.metrics ? U.money(metadata.metrics.creditsCents || 0) : '-';
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

  async function loadReviewsForBatch(batchId){
    try {
      const reviews = await apiRequest(`/reviews/${batchId}`);
      return Array.isArray(reviews) ? reviews : [];
    } catch (err) {
      console.warn('Failed to load review history', err);
      return [];
    }
  }

  function renderReviewList(reviews){
    if (!reviews.length) return '<p class="text-xs text-gray-500">No reviewer activity recorded yet.</p>';
    return `
      <ul class="space-y-2 text-xs text-gray-600">
        ${reviews.map(r => `
          <li class="border border-gray-200 rounded-md p-2">
            <div class="flex justify-between"><span class="font-medium">${r.reviewer}</span><span>${formatAuDateTime(r.created_at)}</span></div>
            <div>Status: <strong>${r.status}</strong></div>
            ${r.comments ? `<div>Comments: ${r.comments}</div>` : ''}
          </li>`).join('')}
      </ul>`;
  }

  function renderAdminReviewers(reviewers){
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
      adminReviewerList.innerHTML = `<div class="px-3 py-3 text-center text-gray-500 border border-dashed border-gray-300 rounded-md">${emptyMessage}</div>`;
      return;
    }
    const sorted = [...filtered].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    adminReviewerList.innerHTML = sorted.map((r) => {
      const role = r.role ?? 'reviewer';
      const displayName = escapeHtml(r.display_name || '-');
      const email = escapeHtml(r.email || '-');
      const createdAt = escapeHtml(formatAuDateTime(r.created_at, { fallback: '-' }));
      const lastLogin = escapeHtml(formatAuDateTime(r.last_login_at, { fallback: 'Never' }));
      const statusBadge = r.status === 'active'
        ? '<span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700">Active</span>'
        : '<span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-700">Inactive</span>';
      const nextStatus = r.status === 'active' ? 'inactive' : 'active';
      const toggleLabel = r.status === 'active' ? 'Deactivate' : 'Activate';
      const toggleClasses = r.status === 'active' ? 'text-amber-600 hover:text-amber-800' : 'text-green-600 hover:text-green-800';
      const mustChangeTag = r.must_change_password ? '<span class="ml-2 text-xs font-semibold text-red-600">Must change</span>' : '';
      const deptRaw = r.department_code || '';
      const deptDisplay = deptRaw ? escapeHtml(deptRaw) : '-';
      const deptMarkup = role === 'user'
        ? `<span class="inline-flex items-center gap-2"><span class="font-mono">${deptDisplay}</span><button data-action="edit-dept" data-id="${r.id}" data-dept="${deptRaw}" class="text-xs text-indigo-600 hover:text-indigo-800">Edit</button></span>`
        : `<span class="font-mono">${deptDisplay}</span>`;
      const supportsNotify = role === 'reviewer' || role === 'admin';
      let notifyMarkup;
      if (supportsNotify) {
        const notifyEnabled = r.notify_on_submission === true;
        const notifyBadge = notifyEnabled
          ? '<span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-green-50 text-green-700">Enabled</span>'
          : '<span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600">Off</span>';
        const notifyButton = `<button data-action="toggle-notify" data-id="${r.id}" data-next="${notifyEnabled ? 'off' : 'on'}" class="text-xs text-indigo-600 hover:text-indigo-800">${notifyEnabled ? 'Disable' : 'Enable'}</button>`;
        notifyMarkup = `<span class="inline-flex items-center gap-2">${notifyBadge}${notifyButton}</span>`;
      } else {
        notifyMarkup = '<span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600">Off</span>';
      }
      const roleSelect = `<select data-action="set-role" data-id="${r.id}" data-current-role="${role}" data-dept="${deptRaw}" data-notify="${r.notify_on_submission === true}" class="border border-gray-300 rounded-md px-2 py-1 text-xs bg-white">
        <option value="user"${role === 'user' ? ' selected' : ''}>User</option>
        <option value="banking"${role === 'banking' ? ' selected' : ''}>Banking</option>
        <option value="reviewer"${role === 'reviewer' ? ' selected' : ''}>Reviewer</option>
        <option value="admin"${role === 'admin' ? ' selected' : ''}>Admin</option>
      </select>`;
      return `
        <div class="border border-gray-200 rounded-lg bg-white shadow-sm p-4" data-reviewer-id="${r.id}">
          <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <p class="text-base font-semibold text-gray-800 flex items-center gap-2">${displayName}${mustChangeTag}</p>
              <p class="text-sm text-gray-600 font-mono">${email}</p>
            </div>
            <div class="flex flex-col items-start md:items-end gap-2 text-sm">
              ${statusBadge}
              <span class="text-xs text-gray-500">Last login: ${lastLogin}</span>
            </div>
          </div>
          <div class="mt-4 grid gap-3 md:grid-cols-2 text-sm text-gray-700">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-gray-600">Role:</span>
              ${roleSelect}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-gray-600">Notifications:</span>
              ${notifyMarkup}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-gray-600">Department:</span>
              ${deptMarkup}
            </div>
            <div class="flex items-center gap-2 text-xs text-gray-500">
              <span>Created:</span>
              <span>${createdAt}</span>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap justify-end gap-2 text-sm">
            <button data-action="edit-account" data-id="${r.id}" class="text-xs text-indigo-600 hover:text-indigo-800">Edit</button>
            <button data-action="reset" data-id="${r.id}" class="text-xs text-indigo-600 hover:text-indigo-800">Reset password</button>
            <button data-action="toggle" data-id="${r.id}" data-next="${nextStatus}" class="text-xs ${toggleClasses}">${toggleLabel}</button>
            <button data-action="delete" data-id="${r.id}" class="text-xs text-red-600 hover:text-red-800">Delete</button>
          </div>
        </div>`;
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
      // Admin tools: approve/reject controls
      if (stage !== 'approved') {
        actions.push({ label: 'Approve', action: 'approve', classes: 'text-green-700 hover:text-green-800' });
      }
      if (stage !== 'rejected') {
        const rejectLabel = stage === 'approved' ? 'Revert to Rejected' : 'Reject';
        actions.push({ label: rejectLabel, action: 'reject', classes: 'text-amber-700 hover:text-amber-800' });
      }
      // Dangerous: delete
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

  function renderAdminArchives(archives){
    if (!adminArchiveTbody) return;
    const list = Array.isArray(archives) ? archives : [];
    if (!list.length) {
      const message = adminArchiveSearchTerm ? 'No archives match the current search.' : 'No archives found.';
      adminArchiveTbody.innerHTML = `<tr><td colspan="7" class="px-3 py-3 text-center text-gray-500">${message}</td></tr>`;
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

  function filteredAdminArchives(){
    if (!adminArchivesCache) return [];
    const term = adminArchiveSearchTerm.trim();
    if (!term) return [...adminArchivesCache];
    return adminArchivesCache.filter(item => matchesArchiveSearch(item, term));
  }

  function renderReviewerArchives(archives){
    if (!reviewerArchiveTbody) return;
    const list = Array.isArray(archives) ? archives : [];
    if (!list.length) {
      const message = reviewerArchiveSearchTerm ? 'No archives match the current search.' : 'No archives available yet.';
      reviewerArchiveTbody.innerHTML = `<tr><td colspan="7" class="px-3 py-3 text-center text-gray-500">${message}</td></tr>`;
      return;
    }
    reviewerArchiveTbody.innerHTML = list.map(item => archiveRowMarkup(item, { allowDelete: false })).join('');
  }

  function filteredReviewerArchives(){
    if (!reviewerArchivesCache) return [];
    const term = reviewerArchiveSearchTerm.trim();
    if (!term) return [...reviewerArchivesCache];
    return reviewerArchivesCache.filter(item => matchesArchiveSearch(item, term));
  }

  async function loadAdminReviewers(showFeedback = false) {
    if (!hasRole('admin') || !adminReviewerList) return;
    adminReviewerList.innerHTML = '<div class="px-3 py-3 text-center text-gray-500 border border-dashed border-gray-300 rounded-md">Loading…</div>';
    try {
      const reviewers = await apiRequest('/reviewers');
      renderAdminReviewers(reviewers);
      adminSectionLoaded.add('accounts');
      if (showFeedback && adminReviewerFeedback) {
        adminReviewerFeedback.textContent = 'Account list refreshed.';
        adminReviewerFeedback.classList.remove('hidden');
        setTimeout(() => adminReviewerFeedback.classList.add('hidden'), 4000);
      }
    } catch (err) {
      adminReviewerList.innerHTML = `<div class="px-3 py-3 text-center text-red-600 border border-dashed border-red-200 rounded-md">${err.message || 'Failed to load accounts.'}</div>`;
      if (adminReviewerFeedback) {
        adminReviewerFeedback.textContent = err.message || 'Failed to load accounts.';
        adminReviewerFeedback.classList.remove('hidden');
        setTimeout(() => adminReviewerFeedback.classList.add('hidden'), 4000);
      }
      adminReviewersCache = [];
      adminSectionLoaded.delete('accounts');
    }
  }

  function updateAdminArchiveScopeButton() {
    if (!adminToggleArchiveScopeBtn) return;
    const showingAll = adminArchiveScope === 'all';
    adminToggleArchiveScopeBtn.textContent = showingAll ? 'Show recent only' : 'Show full archive';
    adminToggleArchiveScopeBtn.setAttribute('aria-pressed', showingAll ? 'true' : 'false');
  }

  async function loadAdminArchives(showFeedback = false) {
    if (!hasRole('admin') || !adminArchiveTbody) return;
    adminArchiveTbody.innerHTML = '<tr><td colspan="7" class="px-3 py-3 text-center text-gray-500">Loading…</td></tr>';
    try {
      updateAdminArchiveScopeButton();
      const path = adminArchiveScope === 'all' ? '/archives?scope=all' : '/archives';
      const archives = await apiRequest(path);
      adminArchivesCache = Array.isArray(archives) ? archives : [];
      renderAdminArchives(filteredAdminArchives());
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
      adminArchiveTbody.innerHTML = `<tr><td colspan="7" class="px-3 py-3 text-center text-red-600">${err.message || 'Failed to load archives.'}</td></tr>`;
      if (adminArchiveFeedback) {
        adminArchiveFeedback.textContent = err.message || 'Failed to load archives.';
        adminArchiveFeedback.classList.remove('hidden');
        setTimeout(() => adminArchiveFeedback.classList.add('hidden'), 4000);
      }
    }
  }

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
      const rows = await apiRequest('/blacklist');
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

  async function refreshActiveBlacklist(showWarning = false) {
    if (!isAuthActive()) {
      activeBlacklistEntries = [];
      activeBlacklistSet = new Set();
      return;
    }
    try {
      const entries = await apiRequest('/blacklist/active');
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
      renderTransactions();
    } catch (err) {
      if (showWarning) console.warn('Unable to refresh blacklist', err);
    }
  }

  function isBlacklistedCombo(bsb, account) {
    const key = (() => {
      const normalizedBsb = normalizeBSBStrict(bsb);
      const normalizedAccount = normalizeAccountStrict(account);
      if (!normalizedBsb || !normalizedAccount) return null;
      return `${normalizedBsb}|${normalizedAccount}`;
    })();
    return key ? activeBlacklistSet.has(key) : false;
  }

  function getBlacklistDetails(bsb, account) {
    const normalizedBsb = normalizeBSBStrict(bsb);
    const normalizedAccount = normalizeAccountStrict(account);
    if (!normalizedBsb || !normalizedAccount) return null;
    return activeBlacklistEntries.find((entry) => {
      const entryBsb = normalizeBSBStrict(entry.bsb);
      const entryAccount = normalizeAccountStrict(entry.account);
      return entryBsb === normalizedBsb && entryAccount === normalizedAccount;
    }) || null;
  }

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
      const data = await apiRequest('/admin/testing-mode');
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

  async function showAdminSection(section, force = false) {
    if (!ADMIN_SECTIONS.includes(section)) section = 'signups';
    currentAdminSection = section;
    setAdminNavState(section);
    adminPanels.forEach((panel) => {
      const target = panel.dataset.adminSection;
      panel.classList.toggle('hidden', target !== section);
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
      console.warn(`Failed to load admin section: ${section}`, err);
    }
  }

  async function loadReviewerArchives(showFeedback = false) {
    if (!hasRole('reviewer') || !reviewerArchiveTbody) return;
    reviewerArchiveTbody.innerHTML = '<tr><td colspan="7" class="px-3 py-3 text-center text-gray-500">Loading…</td></tr>';
    try {
      // Use the same endpoint as admin to get all archives, not just recent ones
      const archives = await apiRequest('/archives');
      reviewerArchivesCache = Array.isArray(archives) ? archives : [];
      renderReviewerArchives(filteredReviewerArchives());
      if (reviewerArchiveSearchInput) reviewerArchiveSearchInput.value = reviewerArchiveSearchTermRaw;
      if (showFeedback && reviewerArchiveFeedback) {
        reviewerArchiveFeedback.textContent = 'Archive list refreshed.';
        reviewerArchiveFeedback.classList.remove('hidden');
        setTimeout(() => reviewerArchiveFeedback.classList.add('hidden'), 4000);
      }
    } catch (err) {
      reviewerArchiveTbody.innerHTML = `<tr><td colspan="7" class="px-3 py-3 text-center text-red-600">${err.message || 'Failed to load archives.'}</td></tr>`;
      if (reviewerArchiveFeedback) {
        reviewerArchiveFeedback.textContent = err.message || 'Failed to load archives.';
        reviewerArchiveFeedback.classList.remove('hidden');
        setTimeout(() => reviewerArchiveFeedback.classList.add('hidden'), 4000);
      }
    }
  }

  async function loadAdminDashboard(force = false) {
    if (!hasRole('admin')) return;
    await showAdminSection(currentAdminSection || 'signups', force);
  }

  // ========== SAAS SYNC FUNCTIONS ==========
  
  let saasSyncHistory = [];
  let saasSyncLoading = false;
  let saasSyncConfig = null;

  async function loadSaasSync() {
    await Promise.all([
      loadSaasSyncConfig(),
      loadSaasSyncHistory()
    ]);
    initSaasSyncHandlers();
  }

  async function loadSaasSyncConfig() {
    try {
      saasSyncConfig = await apiRequest('/saas/config');
      updateSaasSyncUI();
    } catch (err) {
      console.error('Failed to load sync config:', err);
    }
  }

  function updateSaasSyncUI() {
    if (!saasSyncConfig) return;
    
    const warningEl = document.querySelector('#panel-saas .bg-amber-50');
    if (!warningEl) return;
    
    if (saasSyncConfig.method === 'database') {
      // Show warning about delay
      warningEl.querySelector('h3').textContent = 'Manual Sync (Scheduled)';
      warningEl.querySelector('p').textContent = 'Manual sync requests are queued and processed during the next scheduled sync cycle (up to 15 minute delay).';
      warningEl.classList.remove('bg-amber-50', 'border-amber-200');
      warningEl.classList.add('bg-orange-50', 'border-orange-200');
      warningEl.querySelector('h3').classList.remove('text-amber-900');
      warningEl.querySelector('h3').classList.add('text-orange-900');
      warningEl.querySelector('p').classList.remove('text-amber-800');
      warningEl.querySelector('p').classList.add('text-orange-800');
    } else {
      // Show immediate sync info
      warningEl.querySelector('h3').textContent = 'Manual Sync (Immediate)';
      warningEl.querySelector('p').textContent = `Manual sync requests are processed immediately. ${saasSyncConfig.description || ''}`;
    }
  }

  async function loadSaasSyncHistory() {
    if (saasSyncLoading) return;
    saasSyncLoading = true;
    
    const historyEl = getById('sync-history');
    if (historyEl) {
      historyEl.innerHTML = '<div class="text-center py-2 text-gray-500">Loading recent requests...</div>';
    }
    
    try {
      const history = await apiRequest('/saas/sync-history?limit=10');
      saasSyncHistory = Array.isArray(history) ? history : [];
      renderSaasSyncHistory();
    } catch (err) {
      console.error('Failed to load sync history:', err);
      if (historyEl) {
        historyEl.innerHTML = '<div class="text-center py-2 text-red-600">Failed to load sync history.</div>';
      }
    } finally {
      saasSyncLoading = false;
    }
  }

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
        const response = await apiRequest('/saas/sync-trigger', {
          method: 'POST',
          body: JSON.stringify({ notes: 'Manual sync triggered from web interface' })
        });
        
        if (feedbackEl) {
          feedbackEl.textContent = response.message || 'Sync request submitted successfully.';
          feedbackEl.className = 'mt-3 text-sm text-green-600';
          feedbackEl.classList.remove('hidden');
        }
        
        if (statusEl) statusEl.textContent = 'Request submitted successfully.';
        
        // Refresh history to show the new request
        setTimeout(() => loadSaasSyncHistory(), 1000);
        
      } catch (err) {
        if (feedbackEl) {
          feedbackEl.textContent = err.message || 'Failed to submit sync request.';
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

  function applyHeaderPayload(header){
    if (!header) return;
    ['fi','reel','user','apca','desc','proc','trace_bsb','trace_acct','remitter'].forEach(key => {
      const el = getById(key);
      if (el && header[key] !== undefined) el.value = header[key];
    });
    ['balance_bsb','balance_acct','balance_title','balance_txn_code'].forEach(key => {
      const el = getById(key);
      if (el && header[key] !== undefined) el.value = header[key];
    });
    saveToLocalStorage();
  }

  function loadBatchIntoGenerator(payload){
    if (!payload || !Array.isArray(payload.transactions)) return;
    transactions = payload.transactions.map(tx => ({
      bsb: tx.bsb || '',
      account: tx.account || '',
      amount: Number(tx.amount || 0),
      accountTitle: tx.accountTitle || '',
      lodgementRef: tx.lodgementRef || '',
      txnCode: '53',
      withholdingCents: null
    }));
    transactionSearchTerm = '';
    transactionSort = { key: null, direction: 'asc' };
    renderTransactions();
    updateTotals();
    if (payload.header) applyHeaderPayload(payload.header);
    setTab('gen');
    saveToLocalStorage();
  }

  function renderRetrievedBatch(batch, reviews){
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
  const submitterEmail = batch.submitted_email || meta.submitted_by_email || '-';
  const hasFile = stage === 'approved' && !!batch.file_base64;
    const createdAtDisplay = formatAuDateTime(batch.created_at);
    const stageBadge = `<span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${stageInfo.classes}">${stageInfo.label}</span>`;
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
          const line = (raw + ' '.repeat(120)).slice(0,120);
          if (line[0] !== '1') return;
          const code2 = line.slice(18,20).trim();
          if (code2 === '13') {
            balBsb = line.slice(1,8).trim();
            balAcct = line.slice(8,17).trim();
            // don't break; prefer last occurrence
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
        <li>Code: <strong class="font-mono">${formattedCode}</strong></li>
        <li>Stage: ${stageBadge}</li>
        <li>PD reference: <strong>${pdNumber}</strong></li>
  <li>Department: <strong>${batch.department_code || meta.department_code || '-'}</strong></li>
  <li>Prepared by: <strong>${meta.prepared_by || '-'}</strong></li>
        <li>Submitted by: <strong>${submitterEmail}</strong></li>
        <li>Created: <strong>${createdAtDisplay}</strong></li>
        <li>Transactions: <strong>${txnCount}</strong></li>
        <li>Total credits: <strong>${creditsDisplay}</strong></li>
        <li>Duplicate sets: <strong>${duplicates.sets || 0}</strong></li>
        ${balMatch ? `<li>Bank account preset: <strong>${escapeHtml(balMatch)}</strong></li>` : ''}
        ${balMatch && (balBsbForSummary || balAcctForSummary) ? `<li>Account: <span class="font-mono">${escapeHtml(balBsbForSummary)}</span> <span class="font-mono">${escapeHtml(balAcctForSummary)}</span></li>` : ''}
      </ul>`;
    const notesBlock = meta.notes ? `<div class="text-xs text-gray-500">Notes: ${meta.notes}</div>` : '';
  const stageNotice = hasFile ? '' : '<p class="text-xs text-amber-600">ABA download becomes available once the batch is approved.</p>';
    const decisionOptions = ['<option value="note">Record note only (no stage change)</option>'];
    if (transitions.approve) decisionOptions.push('<option value="approved">Mark as approved</option>');
    if (transitions.reject) decisionOptions.push('<option value="rejected">Reject and send back</option>');

    retrieveBatchResult.innerHTML = `
      <div class="bg-gray-50 border border-gray-200 rounded-md p-3 space-y-2 mb-3">
        ${summaryList}
        ${stageNotice}
      </div>
      <p class="text-xs text-gray-500 mb-3">Open this batch in Reader to inspect the actual ABA, with validations and duplicate highlighting. From Reader you can optionally Load into Generator if you need to recreate/edit.</p>
      ${notesBlock}
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <button id="retrieve-download" class="px-4 py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600 ${hasFile ? '' : 'opacity-50 cursor-not-allowed'}" ${hasFile ? '' : 'disabled'}>Download ABA</button>
        <button id="retrieve-open-reader" class="px-4 py-2 bg-amber-500 text-white rounded-md hover:bg-amber-600">Open in Reader</button>
        <button id="retrieve-copy" class="px-3 py-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-100">Copy Code</button>
      </div>
      <div class="border border-gray-200 rounded-md p-3 mb-3">
        <h3 class="font-medium text-sm text-gray-800 mb-2">Reviewer log</h3>
        <div id="retrieve-review-list">${renderReviewList(reviews)}</div>
      </div>
      <form id="retrieve-review-form" class="space-y-3 text-sm text-gray-700 border border-gray-200 rounded-md p-3">
        <h3 class="font-medium text-gray-800">Record reviewer decision</h3>
        <div>
          <label class="block mb-1 font-medium" for="retrieve-reviewer">Reviewer name</label>
          <input id="retrieve-reviewer" type="text" required class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200">
        </div>
        <div>
          <label class="block mb-1 font-medium" for="retrieve-decision">Decision</label>
          <select id="retrieve-decision" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200">
            ${decisionOptions.join('')}
          </select>
        </div>
        <div>
          <label class="block mb-1 font-medium" for="retrieve-comments">Comments</label>
          <textarea id="retrieve-comments" rows="3" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" placeholder="Add any notes"></textarea>
        </div>
        <p id="retrieve-review-error" class="text-xs text-red-600 hidden"></p>
        <div class="flex justify-end">
          <button type="submit" class="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">Save decision</button>
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
      openBatchInReader(batch);
    });
    getById('retrieve-copy')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard?.writeText?.(formattedCode);
      } catch (_) {
        // ignore
      }
    });

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
        reviewError.textContent = 'Reviewer name is required.';
        reviewError.classList.remove('hidden');
        return;
      }
      const decision = decisionSelect?.value || 'note';
      const comments = commentsInput?.value.trim() || '';
      if (decision === 'rejected' && !comments) {
        reviewError.textContent = 'Provide a reason when rejecting a batch.';
        reviewError.classList.remove('hidden');
        return;
      }
      if (decision === 'approved' && !transitions.approve) {
        reviewError.textContent = 'Batch cannot transition to approved from its current stage.';
        reviewError.classList.remove('hidden');
        return;
      }
      if (decision === 'rejected' && !transitions.reject) {
        reviewError.textContent = 'Batch cannot be rejected from its current stage.';
        reviewError.classList.remove('hidden');
        return;
      }
      try {
        if (decision !== 'note' && decision !== stage) {
          if (!encodedBatchCode) {
            throw new Error('Batch code unavailable for stage change.');
          }
          await apiRequest(`/batches/${encodedBatchCode}/stage`, {
            method: 'PATCH',
            body: JSON.stringify({ stage: decision, comments: comments || undefined })
          });
        } else {
          await apiRequest('/reviews', {
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
        const refreshedBatch = await apiRequest(`/batches/${encodedBatchCode}`);
        currentRetrievedBatch = refreshedBatch;
        currentRetrievedCode = ensureBatchCodeFormat(refreshedBatch.code);
        const updatedReviews = refreshedBatch.batch_id ? await loadReviewsForBatch(refreshedBatch.batch_id) : [];
        renderRetrievedBatch(refreshedBatch, updatedReviews);
        if (decision !== 'note') {
          await loadReviewerArchives(true);
          if (hasRole('admin')) await loadAdminArchives(true);
        } else {
          await loadReviewerArchives();
        }
      } catch (err) {
        reviewError.textContent = err.message || 'Unable to save decision.';
        reviewError.classList.remove('hidden');
      }
    });
  }

  function toBase64(str){
    return window.btoa(unescape(encodeURIComponent(str)));
  }

  function fromBase64(base64){
    return decodeURIComponent(escape(window.atob(base64)));
  }

  function downloadBase64File(base64, fileName, mime = 'application/octet-stream'){
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Build an ABA string purely from provided header + rows (preserves original balancing details)
  function buildAbaFromHeader(h, rows){
    if (!h || !rows) throw new Error('Header and rows are required.');
    if (!h.user || !h.remitter) throw new Error('User Name and Remitter Name are required.');
    const apca = U.digitsOnly(h.apca || '');
    if (apca.length !== 6) throw new Error('APCA/User ID must be exactly 6 digits.');

    const proc = /^\d{6}$/.test(h.proc) ? h.proc : todayDDMMYY();

    // Type 0
    const t0 = '0'
      + U.padR('', 17)
      + U.padL(String(h.reel || '1'), 2)
      + U.padR((h.fi || '').slice(0,3), 3)
      + U.padR('', 7)
      + U.padR((h.user || '').slice(0,26), 26)
      + U.padL(apca, 6)
      + U.padR((h.desc || '').slice(0,12), 12)
      + U.padR(proc, 6)
      + U.padR('', 40);
    const lines = [ (t0 + ' '.repeat(120)).slice(0,120) ];

    let credits = 0, count = 0;

    // Type 1 credits from rows
    rows.forEach((r, i) => {
      const n = i + 1;
      if (!r.lodgementRef || String(r.lodgementRef).trim() === '') {
        throw new Error(`Row ${n}: Lodgement Ref is required.`);
      }
      const bsbDigits  = U.digitsOnly(r.bsb || '');
      if (bsbDigits.length !== 6) throw new Error(`Row ${n}: BSB must be 6 digits, format NNN-NNN.`);
      const normalizedBsb = normalizeBSBStrict(r.bsb);
      if (!normalizedBsb) throw new Error(`Row ${n}: BSB must be 6 digits, format NNN-NNN.`);
      const acctDigits = U.digitsOnly(r.account || '');
      if (acctDigits.length < 5 || acctDigits.length > 9) throw new Error(`Row ${n}: Account must be 5–9 digits.`);

      const amount = parseFloat(r.amount);
      if (isNaN(amount) || amount <= 0) throw new Error(`Row ${n}: Amount must be a positive number.`);
      const cents = Math.round(amount * 100);
      if (cents > 9999999999) throw new Error(`Row ${n}: Amount exceeds maximum allowed.`);

      const bsb7    = normalizedBsb.padEnd(7, ' ').slice(0,7);
      const acct9   = U.padL(acctDigits, 9, ' ');
      const ind1    = ' ';
      const code2   = '53';
      const amt10   = U.padL(String(cents), 10);
      const name32  = U.padR((r.accountTitle || '').slice(0,32), 32);
      const lodg18  = U.padR((r.lodgementRef || '').slice(0,18), 18);
      const trbsb7  = (h.trace_bsb || '').padEnd(7, ' ').slice(0,7);
      const tracct9 = U.padL(U.digitsOnly(h.trace_acct || ''), 9, ' ');
      const remit16 = U.padR((h.remitter || '').slice(0,16), 16);
      const wtax8   = U.padL('0', 8);

      const t1 = '1'+bsb7+acct9+ind1+code2+amt10+name32+lodg18+trbsb7+tracct9+remit16+wtax8;
      lines.push((t1 + ' '.repeat(120)).slice(0,120));
      count++;
      credits += cents;
    });

    // Balancing debit (code 13) from header fields
    const balAcctDigits = U.digitsOnly(h.balance_acct || '');
    const balBsbDigits  = U.digitsOnly(h.balance_bsb  || '');
    if (balBsbDigits.length !== 6) throw new Error('Balance BSB must be 6 digits.');
    const normalizedBalanceBsb = normalizeBSBStrict(h.balance_bsb || '');
    if (!normalizedBalanceBsb) throw new Error('Balance BSB must be 6 digits.');
    if (balAcctDigits.length < 5 || balAcctDigits.length > 9) throw new Error('Balance Account must be 5–9 digits.');

    const balCents = credits;
    const b_bsb7    = normalizedBalanceBsb.padEnd(7, ' ').slice(0,7);
    const b_acct9   = U.padL(balAcctDigits, 9, ' ');
    const b_ind1    = ' ';
    const b_code2   = '13';
    const b_amt10   = U.padL(String(balCents), 10);
    const b_name32  = U.padR((h.balance_title || '').slice(0,32), 32);
    const b_lodg18  = U.padR(`${(h.desc || '').slice(0,12)}-${proc}`.slice(0,18), 18);
    const b_trbsb7  = (h.trace_bsb || '').padEnd(7, ' ').slice(0,7);
    const b_tracct9 = U.padL(U.digitsOnly(h.trace_acct || ''), 9, ' ');
    const b_remit16 = U.padR((h.remitter || '').slice(0,16), 16);
    const b_wtax8   = U.padL('0', 8);

    const balT1 = '1'+b_bsb7+b_acct9+b_ind1+b_code2+b_amt10+b_name32+b_lodg18+b_trbsb7+b_tracct9+b_remit16+b_wtax8;
    lines.push((balT1 + ' '.repeat(120)).slice(0,120));
    count++;

    // Type 7
    const netTotal = credits - balCents; // 0
    const t7 = '7'
      + '999-999'
      + U.padR('', 12)
      + U.padL(String(netTotal), 10)
      + U.padL(String(credits), 10)
      + U.padL(String(balCents), 10)
      + U.padR('', 24)
      + U.padL(String(count), 6)
      + U.padR('', 40);
    lines.push((t7 + ' '.repeat(120)).slice(0,120));
    return lines.join('\r\n') + '\r\n';
  }

  async function apiRequest(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }
    if (authState?.token && !options.skipAuth) {
      headers.Authorization = `Bearer ${authState.token}`;
    }
    let resp;
    try {
      resp = await fetch(`${API_BASE}${path}`, { ...options, headers });
    } catch (err) {
      throw new Error(err?.message || 'Network request failed');
    }
    if (resp.status === 204) return null;
    const text = await resp.text();
    let parsed;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        parsed = null;
      }
    }
    if (resp.status === 401) {
      clearAuthState();
      throw new Error(parsed?.message || parsed?.error || text || 'Session expired. Please sign in again.');
    }
    if (!resp.ok) {
      const apiError = new Error(parsed?.message || parsed?.error || text || resp.statusText || 'API request failed');
      apiError.status = resp.status;
      if (parsed && typeof parsed === 'object') apiError.details = parsed;
      throw apiError;
    }
    return parsed ?? null;
  }

  const HEADER_PRESETS = {
    "CBA-RON": {
      ...COMMON,
      "trace_bsb":"064-000","trace_acct":"16744795",
      "balance_required":true,"balance_txn_code":"13","balance_bsb":"064-000","balance_acct":"16744795","balance_title":"Treasury OPA - CBA"
    },
    "CBA-Agent": {
      ...COMMON,
      "trace_bsb":"064-036","trace_acct":"10192093",
      "balance_required":true,"balance_txn_code":"13","balance_bsb":"064-036","balance_acct":"10192093","balance_title":"Agent Operating Account"
    },
    "CBA-DFAT": {
      ...COMMON,
      "trace_bsb":"064-000","trace_acct":"16745106",
      "balance_required":true,"balance_txn_code":"13","balance_bsb":"064-000","balance_acct":"16745106","balance_title":"RON DFAT Account"
    },
    "CBA-NSUDP": {
      ...COMMON,
      "trace_bsb":"064-000","trace_acct":"16745165",
      "balance_required":true,"balance_txn_code":"13","balance_bsb":"064-000","balance_acct":"16745165","balance_title":"RON NSUDP Account"
    },
    "CBA-NZAID": {
      ...COMMON,
      "trace_bsb":"064-000","trace_acct":"16745149",
      "balance_required":true,"balance_txn_code":"13","balance_bsb":"064-000","balance_acct":"16745149","balance_title":"RON NZAid Account"
    },
    "CBA-DEV.FUND": {
      ...COMMON,
      "trace_bsb":"064-000","trace_acct":"16745157",
      "balance_required":true,"balance_txn_code":"13","balance_bsb":"064-000","balance_acct":"16745157","balance_title":"RON DEV.Fund Account"
    },
    "CBA-Seabed.Account": {
      ...COMMON,
      "trace_bsb":"064-000","trace_acct":"16746109",
      "balance_required":true,"balance_txn_code":"13","balance_bsb":"064-000","balance_acct":"16746109","balance_title":"RON SMADG Account"
    },
    "CBA-Tank Farm": {
      ...COMMON,
      "trace_bsb":"064-000","trace_acct":"16746088",
      "balance_required":true,
      "balance_txn_code":"13",
      "balance_bsb":"064-000",
      "balance_acct":"16746088",
      "balance_title":"RON Tank Farm A/C"
    }
  };

  // --- Utils ---
  const headerFields  = ['fi','reel','user','apca','desc','proc','trace_bsb','trace_acct','remitter'];
  const balanceFields = ['balance_required','balance_txn_code','balance_bsb','balance_acct','balance_title'];

  const U = {
    digitsOnly: (s) => String(s||'').replace(/[^0-9]/g, ''),
    trunc: (s, n) => String(s||'').slice(0, n),
    padL: (s, w, ch = '0') => String(s||'').padStart(w, ch).slice(-w),
    padR: (s, w, ch = ' ') => String(s||'').padEnd(w, ch).slice(0, w),
    money: (cents)=> (new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'})).format((cents||0)/100),
  };
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const normalizeBSBStrict = (value) => {
    const digits = U.digitsOnly(value).slice(0, 6);
    if (digits.length !== 6) return null;
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  };
  window.normalizeBSBStrict = normalizeBSBStrict;
  const normalizeAccountStrict = (value) => U.digitsOnly(value);

  function findPresetNameByBalance(bsb, account){
    const nBsb = normalizeBSBStrict(bsb || '') || '';
    const nAcct = U.digitsOnly(account || '');
    if (!nBsb || !nAcct) return '';
    try {
      const entries = Object.entries(HEADER_PRESETS || {});
      for (const [name, preset] of entries) {
        const pBsb = normalizeBSBStrict(preset?.balance_bsb || '') || '';
        const pAcct = U.digitsOnly(preset?.balance_acct || '');
        if (pBsb && pAcct && pBsb === nBsb && pAcct === nAcct) return name;
      }
    } catch (_) { /* ignore */ }
    return '';
  }

  function buildDuplicateKey(tx){
    if (!tx) return null;
    const bsb = normalizeBSBStrict(tx.bsb);
    const account = U.digitsOnly(tx.account);
    const amount = parseFloat(tx.amount);
    const lodgement = String(tx.lodgementRef || '').trim();
    if (!bsb || !account || !lodgement || isNaN(amount) || amount <= 0) return null;
    return `${bsb}|${account}|${amount.toFixed(2)}|${lodgement.toLowerCase()}`;
  }

  function recomputeDuplicates(){
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

  function updateDuplicateSummary(){
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
    if (downloadBtn) {
      downloadBtn.addEventListener('click', exportDuplicateReport);
    }
  }

  function exportDuplicateReport(){
    if (!duplicateGroups.length) {
      if (errorsElement) errorsElement.textContent = 'No duplicate rows to export.';
      return;
    }
    if (typeof XLSX === 'undefined' || !XLSX?.utils) {
      if (errorsElement) errorsElement.textContent = 'Unable to export duplicate report: XLSX library is unavailable.';
      return;
    }
    const rows = [];
    duplicateGroups.forEach((indexes, groupIdx) => {
      indexes.forEach((txIndex, memberIdx) => {
        const tx = transactions[txIndex] || {};
        rows.push({
          Group: groupIdx + 1,
          'Group Size': indexes.length,
          'Member #': memberIdx + 1,
          'Generator Row': txIndex + 1,
          BSB: tx.bsb || '',
          Account: tx.account || '',
          Amount: Number(tx.amount || 0),
          'Lodgement Ref': tx.lodgementRef || '',
          'Account Title': tx.accountTitle || ''
        });
      });
    });

    if (!rows.length) {
      if (errorsElement) errorsElement.textContent = 'No duplicate data available for export.';
      return;
    }

    try {
      const worksheet = XLSX.utils.json_to_sheet(rows, { header: ['Group','Group Size','Member #','Generator Row','BSB','Account','Amount','Lodgement Ref','Account Title'] });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Duplicates');
      XLSX.writeFile(workbook, 'duplicate-report.xlsx', { bookType: 'xlsx' });
      if (errorsElement) errorsElement.textContent = '';
    } catch (err) {
      if (errorsElement) errorsElement.textContent = `Failed to export duplicate report: ${err.message}`;
    }
  }

  function parseCsvLine(line){
    const cols = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"') {
          if (line[i + 1] === '"') { current += '"'; i++; }
          else { inQuotes = false; }
        } else {
          current += char;
        }
      } else {
        if (char === '"') { inQuotes = true; }
        else if (char === ',') {
          cols.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
    }
    cols.push(current.trim());
    if (cols.length && cols[0].charCodeAt(0) === 0xFEFF) {
      cols[0] = cols[0].slice(1);
    }
    return cols;
  }

  function todayDDMMYY() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return dd + mm + yy;
  }
  function ensureProcToday() {
    const procEl = getById('proc');
    if (!procEl) return;
    if (!/^\d{6}$/.test(procEl.value)) procEl.value = todayDDMMYY();
  }

  // DOM, Tabs
  const tabGen = getById('tab-generator');
  const tabMy = getById('tab-my');
  const tabReader = getById('tab-reader');
  const tabBanking = getById('tab-banking');
  const tabSaas = getById('tab-saas');
  const tabReviewer = getById('tab-reviewer');
  const panelGen = getById('panel-generator');
  const panelMy = getById('panel-my');
  const panelReader = getById('panel-reader');
  const panelBanking = getById('panel-banking');
  const panelSaas = getById('panel-saas');
  const panelReviewer = getById('panel-reviewer');
  const tabAdmin = getById('tab-admin');
  const bankingNavButtons = Array.from(document.querySelectorAll('.banking-nav-btn'));
  const bankingPanels = Array.from(document.querySelectorAll('.banking-panel'));

  // DOM, Generator
  const transactionTableBody = getById('transaction-table-body');
  const summaryElement = getById('summary');
  const duplicateSummaryElement = getById('duplicate-summary');
  const errorsElement = getById('errors');
  const importSummaryElement = getById('import-summary');
  const headerPresetSel = getById('header-preset');
  const addRowBtn = getById('add-row');
  const exportCsvBtn = getById('export-csv');
  const importCsvBtn = getById('import-csv');
  const clearAllBtn = getById('clear-all');
  const bulkLodgementInput = getById('bulk-lodgement-ref');
  const bulkLodgementBtn = getById('apply-bulk-lodgement');
  const csvFileInput = getById('csv-file-input');
  const transactionSearchInput = getById('transaction-search');
  const sortButtons = Array.from(document.querySelectorAll('[data-sort-key]'));
  const modalBackdrop = getById('modal-backdrop');
  const modalContent = getById('modal-body');
  const modalClose = getById('modal-close');
  const retrieveBatchForm = getById('retrieve-batch-form');
  const retrieveBatchCodeInput = getById('retrieve-batch-code');
  const retrieveBatchResult = getById('retrieve-batch-result');
  const retrieveBatchError = getById('retrieve-batch-error');
  const myBatchesSearchInput = getById('my-batches-search');
  const myBatchesRefreshBtn = getById('my-batches-refresh');
  const myBatchesTbody = getById('my-batches-tbody');
  const myBatchesFeedback = getById('my-batches-feedback');
  // ...existing code...
  const panelAdmin = getById('panel-admin');
  const adminContent = getById('admin-content');
  const adminLocked = getById('admin-locked');
  const adminReviewerList = getById('admin-reviewer-list');
  const adminArchiveTbody = getById('admin-archive-tbody');
  const adminRefreshReviewersBtn = getById('admin-refresh-reviewers');
  const adminRefreshArchivesBtn = getById('admin-refresh-archives');
  const adminToggleArchiveScopeBtn = getById('admin-toggle-archive-scope');
  const adminCreateReviewerForm = getById('admin-create-reviewer-form');
  const adminCreateReviewerError = getById('admin-create-reviewer-error');
  const adminCreateReviewerSuccess = getById('admin-create-reviewer-success');
  const adminCreateReviewerSubmitBtn = getById('admin-create-reviewer-submit');
  const adminCreateReviewerCancelBtn = getById('admin-create-reviewer-cancel');
  const adminReviewerFeedback = getById('admin-reviewer-feedback');
  const adminArchiveFeedback = getById('admin-archive-feedback');
  const adminBlacklistTbody = getById('admin-blacklist-tbody');
  const adminBlacklistFeedback = getById('admin-blacklist-feedback');
  const adminRefreshBlacklistBtn = getById('admin-refresh-blacklist');
  const adminBlacklistForm = getById('admin-blacklist-form');
  const adminBlacklistError = getById('admin-blacklist-error');
  const adminBlacklistBsbInput = getById('admin-blacklist-bsb');
  const adminBlacklistAccountInput = getById('admin-blacklist-account');
  const adminBlacklistLabelInput = getById('admin-blacklist-label');
  const adminBlacklistNotesInput = getById('admin-blacklist-notes');
  const adminBlacklistActiveSelect = getById('admin-blacklist-active');
  const adminBlacklistSubmitBtn = getById('admin-blacklist-submit');
  const adminBlacklistCancelEditBtn = getById('admin-blacklist-cancel-edit');
  const adminBlacklistImportBtn = getById('admin-blacklist-import');
  const adminBlacklistImportInput = getById('admin-blacklist-import-file');
  const adminReviewerSearchInput = getById('admin-reviewer-search');
  const adminReviewerRoleSelect = getById('admin-reviewer-role');
  const adminBlacklistSearchInput = getById('admin-blacklist-search');
  const adminReviewerCountBadge = getById('admin-reviewer-count');
  const adminBlacklistCountBadge = getById('admin-blacklist-count');
  const adminNewEmailInput = getById('admin-new-email');
  const adminNewNameInput = getById('admin-new-name');
  const adminTestingStatus = getById('admin-testing-status');
  const adminTestingMeta = getById('admin-testing-meta');
  const adminTestingToggle = getById('admin-testing-toggle');
  const adminTestingFeedback = getById('admin-testing-feedback');
  const adminTestingBanner = getById('admin-testing-banner');
  const adminPanelContainer = getById('admin-panel-container');
  const adminPanels = adminPanelContainer ? Array.from(adminPanelContainer.querySelectorAll('.admin-panel')) : [];
  const adminNavButtons = Array.from(document.querySelectorAll('button[data-admin-section]'));
  const ADMIN_SECTIONS = ['signups', 'accounts', 'blacklist', 'archives', 'testing', 'bai'];
  let currentAdminSection = 'signups';
  const adminSectionLoaded = new Set();
  const adminArchiveSearchInput = getById('admin-archive-search');
  const adminNewRoleSelect = getById('admin-new-role');
  const adminNewDeptInput = getById('admin-new-dept');
  const adminNewNotifySelect = getById('admin-new-notify');
  const adminNewSendEmailSelect = getById('admin-new-send-email');
  const reviewerArchivesCard = getById('reviewer-archives-card');
  const reviewerArchiveTbody = getById('reviewer-archive-tbody');
  const reviewerArchiveFeedback = getById('reviewer-archive-feedback');
  const reviewerArchiveSearchInput = getById('reviewer-archive-search');
  const reviewerRefreshArchivesBtn = getById('reviewer-refresh-archives');
  const landingView = getById('landing-view');
  const appShell = getById('app-shell');
  const accountContext = getById('account-context');
  const changePasswordBtn = getById('change-password-btn');
  const logoutBtn = getById('logout-btn');
  const landingLoginForm = getById('landing-login-form');
  const landingLoginError = getById('landing-login-error');
  const landingEmailInput = getById('landing-email');
  const landingPasswordInput = getById('landing-password');
  
  const AUTH_STORAGE_KEY = 'aba-reviewer-auth-v1';
  let authState = { token: null, reviewer: null, expires_at: null };
  let modalLocked = false;
  let adminArchivesCache = [];
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
  let reviewerArchivesCache = [];
  let reviewerArchiveSearchTerm = '';
  let reviewerArchiveSearchTermRaw = '';
  let myBatchesCache = [];
  let myBatchesSearchTerm = '';
  let myBatchesSearchTermRaw = '';
  let myBatchesLoading = false;
  let currentSubmissionRootId = null;
  let readerContext = { rootBatchId: null, code: null };
  let activeBlacklistEntries = [];
  let activeBlacklistSet = new Set();
  const ROLE_ORDER = { user: 1, banking: 2, reviewer: 3, admin: 4 };
  const ROLE_LABELS = {
    user: 'Level 1 User',
    banking: 'Level 2 Banking',
    reviewer: 'Level 3 Reviewer',
    admin: 'Level 4 Administrator'
  };
  const STAGE_META = {
    submitted: { label: 'Submitted', classes: 'bg-amber-100 text-amber-800' },
    approved: { label: 'Approved', classes: 'bg-green-100 text-green-800' },
    rejected: { label: 'Rejected', classes: 'bg-red-100 text-red-800' }
  };
  const STAGE_TRANSITIONS = {
    submitted: { approve: true, reject: true },
    rejected: { approve: true, reject: false },
    approved: { approve: false, reject: false }
  };
  const BLACKLIST_IMPORT_LIMIT = 1000;
  let currentTab = 'gen';
  let currentBankingSection = 'converter';

  function ensureBatchCodeFormat(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  }

  function formatPdNumber(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length === 6) return `PD${digits}`;
    if (/^PD\d{6}$/i.test(raw)) return `PD${raw.slice(-6)}`;
    return raw.toUpperCase();
  }

  const AU_DATE_TIME_OPTIONS = { dateStyle: 'medium', timeStyle: 'short' };

  function formatAuDateTime(value, { fallback = '-', options = AU_DATE_TIME_OPTIONS } = {}) {
    if (!value) return fallback;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return date.toLocaleString('en-AU', options);
  }

  function formatIsoDateTime(value) {
    return formatAuDateTime(value, { fallback: 'N/A' });
  }

  function normalizeHeaderName(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function parseCsvRows(text) {
    const rows = [];
    let current = [];
    let value = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (inQuotes) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          value += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        current.push(value);
        value = '';
      } else if (char === '\n') {
        current.push(value);
        rows.push(current);
        current = [];
        value = '';
      } else if (char === '\r') {
        continue;
      } else {
        value += char;
      }
    }
    current.push(value);
    rows.push(current);
    return rows;
  }

  function parseBlacklistCsv(text) {
    const content = text.includes(',') ? text : text.replace(/\t/g, ',');
    const rawRows = parseCsvRows(content);
    const trimmed = rawRows
      .map((row) => row.map((cell) => String(cell ?? '').trim()))
      .filter((row) => row.some((cell) => cell.length));
    if (!trimmed.length) return { entries: [], issues: ['File is empty.'] };
    const headerCandidate = trimmed[0].map((cell) => normalizeHeaderName(cell));
    const headerHasKeywords = headerCandidate.some((cell) => ['bsb', 'account', 'accountnumber', 'accountno', 'accountnum'].includes(cell));
    let rows = trimmed;
    let headerIndex = null;
    if (headerHasKeywords) {
      rows = trimmed.slice(1);
      headerIndex = new Map(headerCandidate.map((name, index) => [name, index]));
    }
    const entries = [];
    const issues = [];
    const aliases = {
      bsb: ['bsb'],
      account: ['account', 'accountnumber', 'accountno', 'acct', 'accountnum'],
      label: ['label', 'name', 'description', 'accname', 'accountname'],
      notes: ['notes', 'note', 'comment', 'comments'],
      active: ['active', 'status', 'enabled']
    };
    const getValue = (row, names, fallbackIndex) => {
      if (headerIndex) {
        for (const name of names) {
          const resolved = headerIndex.get(normalizeHeaderName(name));
          if (resolved !== undefined) return row[resolved] ?? '';
        }
      }
      if (fallbackIndex !== undefined && fallbackIndex < row.length) return row[fallbackIndex] ?? '';
      return '';
    };
    rows.forEach((row, idx) => {
      const rowNumber = headerIndex ? idx + 2 : idx + 1;
      const bsb = getValue(row, aliases.bsb, 0);
      const account = getValue(row, aliases.account, 1);
      const label = getValue(row, aliases.label, 2);
      const notes = getValue(row, aliases.notes, 3);
      const active = getValue(row, aliases.active, 4);
      if (!bsb && !account) {
        issues.push(`Row ${rowNumber} skipped: missing BSB and account.`);
        return;
      }
      entries.push({ rowNumber, bsb, account, label, notes, active });
    });
    return { entries, issues };
  }

  function normalizeBatchCode(code) {
    if (code === undefined || code === null) return null;
    const raw = String(code).trim();
    if (!raw) return null;
    return {
      raw,
      formatted: ensureBatchCodeFormat(raw),
      encoded: encodeURIComponent(raw)
    };
  }

  function isAuthActive() {
    if (!authState || !authState.token || !authState.expires_at || !authState.reviewer) return false;
    return new Date(authState.expires_at) > new Date();
  }

  function hasRole(requiredRole) {
    if (!isAuthActive()) return false;
    if (!requiredRole) return true;
    const role = authState?.reviewer?.role;
    if (!role) return false;
    const actorRank = ROLE_ORDER[role] ?? 0;
    const requiredRank = ROLE_ORDER[requiredRole] ?? 0;
    return actorRank >= requiredRank;
  }

  function authDisplayName() {
    return authState?.reviewer?.display_name || authState?.reviewer?.email || 'Reviewer';
  }

  function loadAuthFromStorage() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.token && parsed?.reviewer && parsed?.expires_at && new Date(parsed.expires_at) > new Date()) {
        authState = parsed;
      } else {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch (err) {
      console.warn('Failed to load stored auth', err);
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }

  function saveAuthState(state) {
    authState = state || { token: null, reviewer: null, expires_at: null };
    if (authState?.token) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authState));
    else localStorage.removeItem(AUTH_STORAGE_KEY);
    updateAuthUI();
  }

  function clearAuthState() {
    authState = { token: null, reviewer: null, expires_at: null };
    localStorage.removeItem(AUTH_STORAGE_KEY);
    updateAuthUI();
    activeBlacklistEntries = [];
    activeBlacklistSet = new Set();
    renderTransactions();
    adminSectionLoaded.clear();
    currentAdminSection = 'signups';
    setAdminNavState(currentAdminSection);
    adminPanels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.adminSection !== currentAdminSection);
    });
    if (adminReviewerList) {
      adminReviewerList.innerHTML = '<div class="px-3 py-3 text-center text-gray-500 border border-dashed border-gray-300 rounded-md">No accounts loaded.</div>';
    }
    if (adminReviewerFeedback) {
      adminReviewerFeedback.textContent = '';
      adminReviewerFeedback.classList.add('hidden');
    }
    adminReviewersCache = [];
    adminReviewerSearchTerm = '';
    adminReviewerSearchTermRaw = '';
    adminReviewerRoleFilterValue = 'all';
    if (adminReviewerSearchInput) adminReviewerSearchInput.value = '';
    if (adminReviewerRoleSelect) adminReviewerRoleSelect.value = 'all';
    adminBlacklistCache = [];
    adminBlacklistSearchTerm = '';
    adminBlacklistSearchTermRaw = '';
    if (adminBlacklistSearchInput) adminBlacklistSearchInput.value = '';
    if (adminBlacklistTbody) {
      adminBlacklistTbody.innerHTML = '<tr><td colspan="6" class="px-3 py-3 text-center text-gray-500">No blocked entries.</td></tr>';
    }
    if (adminBlacklistFeedback) {
      adminBlacklistFeedback.textContent = '';
      adminBlacklistFeedback.classList.add('hidden');
    }
    adminArchivesCache = [];
    adminArchiveSearchTerm = '';
    adminArchiveSearchTermRaw = '';
    adminArchiveScope = 'recent';
    if (adminArchiveSearchInput) adminArchiveSearchInput.value = '';
    if (adminArchiveTbody) {
      adminArchiveTbody.innerHTML = '<tr><td colspan="7" class="px-3 py-3 text-center text-gray-500">No archives loaded.</td></tr>';
    }
    if (adminArchiveFeedback) {
      adminArchiveFeedback.textContent = '';
      adminArchiveFeedback.classList.add('hidden');
    }
    updateAdminArchiveScopeButton();
    myBatchesCache = [];
    myBatchesSearchTerm = '';
    myBatchesSearchTermRaw = '';
    myBatchesLoading = false;
    currentSubmissionRootId = null;
    readerContext = { rootBatchId: null, code: null };
    if (myBatchesSearchInput) myBatchesSearchInput.value = '';
    clearMyBatchesFeedback();
    if (myBatchesTbody) {
      myBatchesTbody.innerHTML = '<tr><td colspan="7" class="px-3 py-3 text-center text-gray-500">No batches loaded yet.</td></tr>';
    }
  }

  function updateAuthUI() {
    const active = isAuthActive();
    const account = active ? authState?.reviewer : null;
    const role = account?.role || null;
    const mustChange = !!account?.must_change_password;

    if (active) {
      landingView?.classList.add('hidden');
      appShell?.classList.remove('hidden');
      changePasswordBtn?.classList.remove('hidden');
      logoutBtn?.classList.remove('hidden');
      if (mustChange) changePasswordBtn?.classList.add('bg-red-500', 'hover:bg-red-600');
      else changePasswordBtn?.classList.remove('bg-red-500', 'hover:bg-red-600');

      const name = authDisplayName();
      const roleText = ROLE_LABELS[role] || 'Signed in';
      const deptCode = account?.department_code ? `Dept ${account.department_code}` : (role === 'user' ? 'Dept not assigned' : '');
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

    updateRoleTabs(role, active);

    if (active) {
      if (!myBatchesCache.length) loadMyBatches();
    } else {
      if (panelMy) panelMy.classList.add('hidden');
      if (tabMy) tabMy.classList.remove('tab-active');
    }

    if (reviewerArchivesCard) {
      if (active && hasRole('reviewer')) {
        reviewerArchivesCard.classList.remove('hidden');
        if (!reviewerArchivesCache.length) loadReviewerArchives();
      } else {
        reviewerArchivesCard.classList.add('hidden');
        reviewerArchivesCache = [];
        reviewerArchiveSearchTerm = '';
        reviewerArchiveSearchTermRaw = '';
        if (reviewerArchiveSearchInput) reviewerArchiveSearchInput.value = '';
        if (reviewerArchiveTbody) {
        reviewerArchiveTbody.innerHTML = '<tr><td colspan="7" class="px-3 py-3 text-center text-gray-500">Sign in to view recent archives.</td></tr>';
        }
      }
    }

    if (adminContent && adminLocked) {
      if (active && hasRole('admin')) {
        adminContent.classList.remove('hidden');
        adminLocked.classList.add('hidden');
      } else {
        adminContent.classList.add('hidden');
        adminLocked.classList.remove('hidden');
      }
    }
  }

  function updateRoleTabs(role, active) {
    const rank = ROLE_ORDER[role] ?? 0;
    const showGen = active;
    const showMy = active;
    const showReader = active;
    const showBankingTab = active && rank >= ROLE_ORDER.banking;
    const showSaasTab = active && rank >= ROLE_ORDER.reviewer;
    const showReviewerTab = active && rank >= ROLE_ORDER.reviewer;
    const showAdminTab = active && rank >= ROLE_ORDER.admin;

    toggleTabAndPanel(tabGen, panelGen, showGen);
    toggleTabAndPanel(tabMy, panelMy, showMy);
    toggleTabAndPanel(tabReader, panelReader, showReader);
    toggleTabAndPanel(tabBanking, panelBanking, showBankingTab);
    toggleTabAndPanel(tabSaas, panelSaas, showSaasTab);
    toggleTabAndPanel(tabReviewer, panelReviewer, showReviewerTab);
    toggleTabAndPanel(tabAdmin, panelAdmin, showAdminTab);

    const allowedTabs = [];
    if (showGen) allowedTabs.push('gen');
    if (showMy) allowedTabs.push('my');
    if (showReader) allowedTabs.push('reader');
    if (showBankingTab) allowedTabs.push('banking');
    if (showSaasTab) allowedTabs.push('saas');
    if (showReviewerTab) allowedTabs.push('reviewer');
    if (showAdminTab) allowedTabs.push('admin');
    if (!allowedTabs.includes(currentTab)) {
      const fallback = allowedTabs.includes('gen') ? 'gen' : (allowedTabs[0] || 'gen');
      setTab(fallback);
    }
  }

  function setBankingSection(section = 'converter') {
    currentBankingSection = section;
    bankingNavButtons.forEach((btn) => {
      if (!btn?.dataset) return;
      const active = btn.dataset.bankingSection === section;
      btn.classList.toggle('bg-amber-100', active);
      btn.classList.toggle('text-amber-900', active);
      btn.classList.toggle('shadow-sm', active);
      btn.classList.toggle('text-gray-700', !active);
    });
    bankingPanels.forEach((panel) => {
      if (!panel?.dataset) return;
      panel.classList.toggle('hidden', panel.dataset.bankingSection !== section);
    });
  }

  function toggleTabAndPanel(tabEl, panelEl, show) {
    if (!tabEl || !panelEl) return;
    if (show) {
      tabEl.classList.remove('hidden');
    } else {
      tabEl.classList.add('hidden');
      panelEl.classList.add('hidden');
    }
  }

  function clearMyBatchesFeedback() {
    if (!myBatchesFeedback) return;
    myBatchesFeedback.textContent = '';
    myBatchesFeedback.classList.add('hidden');
    myBatchesFeedback.classList.remove('text-red-600', 'text-green-600');
    if (!myBatchesFeedback.classList.contains('text-gray-500')) {
      myBatchesFeedback.classList.add('text-gray-500');
    }
  }

  function setMyBatchesFeedback(message, tone = 'info') {
    if (!myBatchesFeedback) return;
    myBatchesFeedback.classList.remove('hidden');
    myBatchesFeedback.textContent = message;
    myBatchesFeedback.classList.remove('text-gray-500', 'text-red-600', 'text-green-600');
    const toneClass = tone === 'error' ? 'text-red-600' : tone === 'success' ? 'text-green-600' : 'text-gray-500';
    myBatchesFeedback.classList.add(toneClass);
  }

  function renderStageBadge(stage, isDraft) {
    if (isDraft) {
      return '<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800">Draft</span>';
    }
    const key = stage && STAGE_META[stage] ? stage : null;
    const meta = key ? STAGE_META[key] : { label: stage ? stage.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown', classes: 'bg-gray-100 text-gray-700' };
    return `<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ${meta.classes}">${escapeHtml(meta.label)}</span>`;
  }

  function renderMyBatches() {
    if (!myBatchesTbody) return;
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

    myBatchesTbody.innerHTML = rows;
  }

  async function loadMyBatches(force = false) {
    if (!isAuthActive()) return;
    if (myBatchesLoading) return;
    if (!force && myBatchesCache.length) {
      renderMyBatches();
      return;
    }
    myBatchesLoading = true;
    setMyBatchesFeedback('Loading your batches…');
    try {
      const data = await apiRequest('/my/batches');
      myBatchesCache = Array.isArray(data) ? data : [];
      renderMyBatches();
      if (myBatchesCache.length) {
        setMyBatchesFeedback(`Loaded ${myBatchesCache.length} batch${myBatchesCache.length === 1 ? '' : 'es'}.`);
        setTimeout(() => clearMyBatchesFeedback(), 4000);
      } else {
        setMyBatchesFeedback('No batches on record yet.');
      }
    } catch (err) {
      setMyBatchesFeedback(err?.message || 'Failed to load your batches.', 'error');
      myBatchesCache = [];
      renderMyBatches();
    } finally {
      myBatchesLoading = false;
    }
  }

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

  function applyHeaderToGenerator(header) {
    if (!header) return;
    headerFields.forEach((id) => {
      const el = getById(id);
      if (!el || header[id] === undefined) return;
      el.value = header[id] ?? '';
    });
    balanceFields.forEach((id) => {
      const el = getById(id);
      if (!el || header[id] === undefined) return;
      if (el.type === 'checkbox') {
        el.checked = !!header[id];
      } else {
        el.value = header[id] ?? '';
      }
    });
  }

  function loadGeneratorFromPayload(payload, rootBatchId) {
    if (!payload || !payload.header || !Array.isArray(payload.transactions)) {
      throw new Error('Batch payload is incomplete.');
    }
    const header = payload.header;
    const preset = inferPresetFromHeader(header);
    if (preset && headerPresetSel) {
      headerPresetSel.value = preset;
      fillHeaderFromPreset(preset);
    }
    applyHeaderToGenerator(header);
    transactions = payload.transactions.map((tx) => ({
      bsb: tx.bsb || '',
      account: tx.account || '',
      amount: Number.isFinite(tx.amount) ? Number(tx.amount) : parseFloat(tx.amount) || 0,
      accountTitle: tx.accountTitle || '',
      lodgementRef: tx.lodgementRef || '',
      txnCode: '53',
      withholdingCents: null
    }));
    transactionSearchTerm = '';
    if (transactionSearchInput) transactionSearchInput.value = '';
    renderTransactions();
    saveToLocalStorage();
    updateTotals();
    checkValidationIssues();
    currentSubmissionRootId = rootBatchId || null;
    setTab('gen');
  }

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
      openBatchInReader(batch);
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

  async function openMyBatchDetail(code) {
    if (!code) return;
    if (!isAuthActive()) {
      ensureAuth('user', () => openMyBatchDetail(code));
      return;
    }
    try {
      setMyBatchesFeedback(`Loading ${code}…`);
      const data = await apiRequest(`/my/batches/${encodeURIComponent(code)}`);
      clearMyBatchesFeedback();
      showMyBatchDetail(data);
    } catch (err) {
      setMyBatchesFeedback(err?.message || 'Unable to load batch details.', 'error');
    }
  }

  async function verifySession() {
    if (!authState.token) return;
    try {
      const data = await apiRequest('/auth/me');
      if (data?.reviewer) {
        authState = {
          token: authState.token,
          reviewer: data.reviewer,
          expires_at: data.reviewer.session_expires_at || authState.expires_at
        };
        saveAuthState(authState);
        await refreshActiveBlacklist();
      }
    } catch (err) {
      console.warn('Session verification failed', err);
      clearAuthState();
    }
  }

  async function loginReviewerAccount(email, password) {
    const resp = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(text || 'Login failed');
    }
    const parsed = text ? JSON.parse(text) : null;
    if (!parsed?.token || !parsed?.reviewer) throw new Error('Login response invalid');
    saveAuthState({ token: parsed.token, reviewer: parsed.reviewer, expires_at: parsed.expires_at || parsed.reviewer.session_expires_at });
    return parsed;
  }

  async function logoutReviewerAccount() {
    try {
      if (authState.token) {
        await apiRequest('/auth/logout', { method: 'POST' });
      }
    } catch (err) {
      console.warn('Logout warning', err);
    }
    modalLocked = false;
    clearAuthState();
    setTab('gen');
  }

  function openLoginModal(requiredRole = 'reviewer', onSuccess) {
    const title = requiredRole === 'admin' ? 'Admin Login' : 'Login';
    const hint = requiredRole === 'admin'
      ? 'Admin access is required. Sign in with an admin account.'
      : 'Enter your credentials to continue.';
    openModal(`
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
    getById('auth-login-cancel')?.addEventListener('click', closeModal);
    const form = getById('auth-login-form');
    const errorEl = getById('auth-login-error');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl?.classList.add('hidden');
      const email = getById('auth-login-email')?.value.trim();
      const password = getById('auth-login-password')?.value || '';
      try {
        await loginReviewerAccount(email, password);
        closeModal();
        const continuation = () => {
          if (requiredRole === 'admin') loadAdminDashboard();
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
  }

  function handlePostLogin(onSuccess) {
    refreshActiveBlacklist(true);
    if (authState?.reviewer?.must_change_password) {
      openChangePasswordModal(true, onSuccess);
    } else if (typeof onSuccess === 'function') {
      onSuccess();
    }
  }

  function openChangePasswordModal(force = false, onSuccess) {
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
    openModal(`
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
    modalLocked = force;
    if (force) modalClose?.classList.add('hidden'); else modalClose?.classList.remove('hidden');
    const form = getById('change-password-form');
    const errorEl = getById('change-password-error');
    const cancelBtn = getById('change-password-cancel');
    const logoutForceBtn = getById('change-password-logout');
    cancelBtn?.addEventListener('click', closeModal);
    logoutForceBtn?.addEventListener('click', () => {
      modalLocked = false;
      logoutReviewerAccount();
      closeModal();
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
        const data = await apiRequest('/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ current_password: current, new_password: next })
        });
        saveAuthState({ token: data.token, reviewer: data.reviewer, expires_at: data.expires_at });
        modalLocked = false;
        closeModal();
                if (typeof onSuccess === 'function') onSuccess();
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message || 'Unable to update password.';
          errorEl.classList.remove('hidden');
        }
      }
    });
  }

  function ensureAuth(requiredRole = 'reviewer', onSuccess) {
    if (!hasRole(requiredRole)) {
      openLoginModal(requiredRole, onSuccess);
      return false;
    }
    return true;
  }

  function setTab(which){
    const tabs = { gen: tabGen, my: tabMy, reader: tabReader, banking: tabBanking, saas: tabSaas, reviewer: tabReviewer, admin: tabAdmin };
    const panels = { gen: panelGen, my: panelMy, reader: panelReader, banking: panelBanking, saas: panelSaas, reviewer: panelReviewer, admin: panelAdmin };
    if (!tabs[which] || tabs[which]?.classList.contains('hidden')) {
      which = 'gen';
    }
    Object.values(tabs).forEach(tab => tab?.classList.remove('tab-active'));
    Object.values(panels).forEach(panel => panel?.classList.add('hidden'));
    switch(which){
      case 'reader':
        tabReader?.classList.add('tab-active');
        panelReader?.classList.remove('hidden');
        break;
      case 'banking':
        tabBanking?.classList.add('tab-active');
        panelBanking?.classList.remove('hidden');
        setBankingSection(currentBankingSection || 'converter');
        break;
      case 'saas':
        tabSaas?.classList.add('tab-active');
        panelSaas?.classList.remove('hidden');
        loadSaasSync();
        break;
      case 'reviewer':
        tabReviewer?.classList.add('tab-active');
        panelReviewer?.classList.remove('hidden');
        loadReviewerArchives();
        break;
      case 'admin':
        tabAdmin?.classList.add('tab-active');
        panelAdmin?.classList.remove('hidden');
        loadAdminDashboard();
        break;
      case 'my':
        tabMy?.classList.add('tab-active');
        panelMy?.classList.remove('hidden');
        loadMyBatches();
        break;
      case 'gen':
      default:
        tabGen?.classList.add('tab-active');
        panelGen?.classList.remove('hidden');
    }
    currentTab = which;
  }

  loadAuthFromStorage();
  updateAuthUI();
  if (isAuthActive()) {
    refreshActiveBlacklist();
  }
  function handleBatchFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const batchParam = params.get('batch');
    if (!batchParam || !retrieveBatchCodeInput) return;
    const formatted = ensureBatchCodeFormat(batchParam);
    retrieveBatchCodeInput.value = formatted;
    const launch = () => {
      setTab('reviewer');
      setTimeout(() => {
        if (retrieveBatchForm?.requestSubmit) retrieveBatchForm.requestSubmit();
        else retrieveBatchForm?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }, 120);
    };
    if (!hasRole('reviewer')) {
      ensureAuth('reviewer', launch);
    } else {
      launch();
    }
  }

  if (authState.token) {
    verifySession().finally(() => {
      handleBatchFromQuery();
      if (authState?.reviewer?.must_change_password) openChangePasswordModal(true);
    });
  } else {
    handleBatchFromQuery();
  }

  // DOM, Reader
  const readerErrors = getById('reader-errors');
  const readerTbody = getById('reader-tbody');
  const rFI = getById('r-fi'), rUser = getById('r-user'), rAPCA = getById('r-apca'), rDesc = getById('r-desc'), rProc = getById('r-proc'), rReel = getById('r-reel');
  const rNet = getById('r-net'), rCredits = getById('r-credits'), rDebits = getById('r-debits'), rCount = getById('r-count');
  const rBalPreset = getById('r-bal-preset');
  const rBalRow = getById('r-bal-row');
  const rBalAcctRow = getById('r-bal-acct-row');
  const rBalBsb = getById('r-bal-bsb');
  const rBalAcct = getById('r-bal-acct');
  const abaFileInput = getById('aba-file-input');
  const btnOpenABA = getById('btn-load-aba');
  const btnClearReader = getById('btn-clear-reader');
  const btnLoadIntoGenerator = getById('btn-load-into-generator');
  const readerDuplicateSummary = getById('reader-duplicate-summary');

  modalBackdrop?.addEventListener('click', (e)=>{
    if (modalLocked) return;
    if (e.target === modalBackdrop) closeModal();
  });
  modalClose?.addEventListener('click', closeModal);

  let parsedTransactions = []; // from reader
  let parsedHeader = null;
  let parsedControl = null;

  function clearReaderView() {
    parsedTransactions = [];
    parsedHeader = null;
    parsedControl = null;
    readerContext = { rootBatchId: null, code: null };
    if (abaFileInput) abaFileInput.value = '';
    if (readerTbody) readerTbody.innerHTML = '';
    if (readerErrors) readerErrors.textContent = '';
    if (readerDuplicateSummary) {
      readerDuplicateSummary.textContent = '';
      readerDuplicateSummary.classList.add('hidden');
    }
    if (btnLoadIntoGenerator) btnLoadIntoGenerator.disabled = true;
    [rFI, rUser, rAPCA, rDesc, rProc, rReel, rNet, rCredits, rDebits, rCount].forEach((el) => {
      if (el) el.textContent = '';
    });
    if (rBalRow) rBalRow.classList.add('hidden');
    if (rBalAcctRow) rBalAcctRow.classList.add('hidden');
    if (rBalPreset) rBalPreset.textContent = '';
    if (rBalBsb) rBalBsb.textContent = '';
    if (rBalAcct) rBalAcct.textContent = '';
  }

  /* ===== Local Storage ===== */
  const saveToLocalStorage = () => {
    const headerData = {};
    headerFields.forEach(id => { headerData[id] = getById(id).value; });
    getById('balance_required').checked = true;
    getById('balance_txn_code').value = '13';
    balanceFields.forEach(id => {
      const el = getById(id);
      headerData[id] = (el.type === 'checkbox') ? el.checked : el.value;
    });
    headerData.__preset = headerPresetSel.value;
    localStorage.setItem('aba-header', JSON.stringify(headerData));
    localStorage.setItem('aba-transactions', JSON.stringify(transactions));
  };

  const loadFromLocalStorage = () => {
    const storedHeader = localStorage.getItem('aba-header');
    const storedTransactions = localStorage.getItem('aba-transactions');

    if (storedHeader) {
      const headerData = JSON.parse(storedHeader);
      headerPresetSel.value = headerData.__preset || 'CBA-RON';
      fillHeaderFromPreset(headerPresetSel.value);
      ['user','desc','proc','remitter'].forEach(id => {
        if (headerData[id] !== undefined) getById(id).value = headerData[id];
      });
    } else {
      headerPresetSel.value = 'CBA-RON';
      fillHeaderFromPreset('CBA-RON');
    }

    ensureProcToday();

    if (storedTransactions) {
      transactions = JSON.parse(storedTransactions);
    } else {
      transactions = [
        { bsb:"062-000", account:"12345678", amount:10.00, accountTitle:"John Smith", lodgementRef:"WAGE-WEEKLY-01", txnCode:"53", withholdingCents:null },
        { bsb:"062-000", account:"98765432", amount:60.00, accountTitle:"Jane Doe",  lodgementRef:"WAGE-WEEKLY-02", txnCode:"53", withholdingCents:null }
      ];
    }
    transactions = transactions.map(t => ({ ...t, txnCode:'53', withholdingCents:null }));
    renderTransactions();
    updateTotals();
  };

  function fillHeaderFromPreset(presetKey){
    const p = HEADER_PRESETS[presetKey];
    if(!p) return;
    Object.entries(p).forEach(([k,v])=>{
      const el = getById(k);
      if(el){ if(el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; }
    });
    getById('reel').value = '1';
    getById('balance_required').checked = true;
    getById('balance_required').disabled = true;
    getById('balance_txn_code').value = '13';

    ["fi","apca","reel","trace_bsb","trace_acct","balance_bsb","balance_acct","balance_title","balance_txn_code"]
      .forEach(id => { const el = getById(id); if(el){ el.readOnly = true; el.classList.add('locked'); el.disabled = el.id==='balance_txn_code' ? true : el.disabled; } });

    ensureProcToday();
    saveToLocalStorage();
  }
  headerPresetSel.addEventListener('change', ()=>{ fillHeaderFromPreset(headerPresetSel.value); });

  // State
  let transactions = [];
  let transactionSearchTerm = '';
  let transactionSort = { key: null, direction: 'asc' };
  let duplicateGroups = [];
  let duplicateIndexSet = new Set();
  let duplicateIndexToGroup = new Map();
  let currentRetrievedBatch = null;
  let currentRetrievedCode = null;



  /* ===== Generator table ===== */
  function getBatchMetrics(){
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

  function checkBlockedAccounts() {
    const blockedWarning = document.getElementById('blocked-accounts-warning');
    const blockedList = document.getElementById('blocked-accounts-list');
    
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

  function checkMissingLodgementRefs() {
    const lodgementWarning = document.getElementById('missing-lodgement-warning');
    const lodgementList = document.getElementById('missing-lodgement-list');
    
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

  function checkValidationIssues() {
    checkBlockedAccounts();
    checkMissingLodgementRefs();
  }

  function updateTotals(){
    const { creditsCents, debitsCents, transactionCount } = getBatchMetrics();
    const txt = `Transactions: ${transactionCount} | Credits: ${U.money(creditsCents)} | Debits: ${U.money(debitsCents)}`;
    summaryElement.textContent = txt;
  }

  function updateSortIndicators(){
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

  // BAI2 converter and checker functionality has been moved to features/banking/index.js

  // Removed all BAI functions - they are now in features/banking/index.js

  tabGen?.addEventListener('click', ()=>setTab('gen'));
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cell += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          result.push(cell);
          cell = '';
        } else {
          cell += ch;
        }
      }
    }
    result.push(cell);
    return result;
  }

  function parseCsvText(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(line => line.trimEnd())
      .filter(line => line.trim().length > 0)
      .map(parseCsvLine);
  }

  function parseCsvDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    let year, month, day;
    let match = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (match) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else {
      match = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (match) {
        day = Number(match[1]);
        month = Number(match[2]);
        year = Number(match[3]);
        if (year < 100) year += year >= 70 ? 1900 : 2000;
      } else {
        match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (match) {
          year = Number(match[1]);
          month = Number(match[2]);
          day = Number(match[3]);
        }
      }
    }
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function parseAmountField(value) {
    const cleaned = String(value || '').replace(/[^0-9.\-]/g, '');
    if (!cleaned) return 0;
    const num = Number(cleaned);
    return Number.isNaN(num) ? 0 : num;
  }

  function sanitizeTime(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 4);
    return digits ? digits.padStart(4, '0') : '0000';
  }

  function formatYYMMDD(date) {
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return yy + mm + dd;
  }

  function formatHHMM(date) {
    return String(date.getHours()).padStart(2, '0') + String(date.getMinutes()).padStart(2, '0');
  }

  function formatSignedCents(value) {
    const sign = value < 0 ? '-' : '';
    return sign + String(Math.abs(Math.trunc(value)));
  }

  function formatUnsignedCents(value) {
    return String(Math.abs(Math.trunc(value)));
  }

  function sanitizeDetailText(value, max = 80) {
    return String(value || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/,+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  function parseStatementCsv(csvText) {
    const rows = parseCsvText(csvText);
    if (!rows.length) throw new Error('CSV is empty.');
    const headerCells = rows.shift();
    const normalizedHeaders = headerCells.map(normalizeHeaderLabel);

    const findIndex = (label) => normalizedHeaders.indexOf(label);
    const idxProcessDate = findIndex('process date');
    const idxDescription = findIndex('description');
    const idxCurrency = findIndex('currency code');
    const idxDebit = findIndex('debit');
    let idxCredit = findIndex('credit');
    if (idxCredit === -1) idxCredit = findIndex('dedit');

    if (idxProcessDate === -1) throw new Error('Column "Process date" not found.');
    if (idxDescription === -1) throw new Error('Column "Description" not found.');
    if (idxDebit === -1 && idxCredit === -1) throw new Error('At least one of "Debit" or "Credit" columns must be present.');

    const entries = [];
    const errors = [];
    let earliestDate = null;
    let latestDate = null;
    const currencies = new Set();
    let skippedRows = 0;

    rows.forEach((cells, index) => {
      const rowNumber = index + 2;
      if (!cells || cells.every(cell => !String(cell || '').trim())) {
        skippedRows++;
        return;
      }
      const rawDate = cells[idxProcessDate] ?? '';
      const date = parseCsvDate(rawDate);
      if (!date) {
        errors.push(`Row ${rowNumber}: invalid Process date "${rawDate}".`);
        return;
      }
      const debitAmount = idxDebit === -1 ? 0 : parseAmountField(cells[idxDebit]);
      const creditAmount = idxCredit === -1 ? 0 : parseAmountField(cells[idxCredit]);
      const debitCents = Math.round(debitAmount * 100);
      const creditCents = Math.round(creditAmount * 100);
      let signedCents = 0;
      if (creditCents && debitCents) signedCents = creditCents - debitCents;
      else if (creditCents) signedCents = creditCents;
      else if (debitCents) signedCents = -debitCents;
      if (!signedCents) {
        skippedRows++;
        return;
      }
      const description = cells[idxDescription] ?? '';
      const currencyValue = idxCurrency === -1 ? '' : String(cells[idxCurrency] || '').trim().toUpperCase();
      if (currencyValue) currencies.add(currencyValue);
      if (!earliestDate || date < earliestDate) earliestDate = date;
      if (!latestDate || date > latestDate) latestDate = date;
      entries.push({
        rowNumber,
        date,
        description,
        currency: currencyValue,
        signedCents,
        amountCents: Math.abs(signedCents),
        isCredit: signedCents >= 0
      });
    });

    if (errors.length) {
      const preview = errors.slice(0, 5).join(' ');
      const suffix = errors.length > 5 ? ` (and ${errors.length - 5} more issues)` : '';
      throw new Error(preview + suffix);
    }
    if (!entries.length) throw new Error('No transactions with values were found in the CSV.');

    return {
      entries,
      earliestDate,
      latestDate,
      currencies: Array.from(currencies),
      skippedRows,
      rowCount: rows.length + 1
    };
  }

  function buildBaiFile(parsed, meta) {
    const now = new Date();
    const creationDate = formatYYMMDD(now);
    const creationTime = formatHHMM(now);
    const asOfDate = meta.asOfDate || parsed.earliestDate || now;
    const asOfDateYYMMDD = formatYYMMDD(asOfDate);
    const asOfTime = meta.asOfTime ? sanitizeTime(meta.asOfTime) : '';

    let creditTotalCents = 0;
    let debitTotalCents = 0;
    let netTotalCents = 0;
    let creditCount = 0;
    let debitCount = 0;

    const detailRecords = parsed.entries.map((entry, idx) => {
      if (entry.signedCents >= 0) {
        creditTotalCents += entry.amountCents;
        creditCount += 1;
      } else {
        debitTotalCents += entry.amountCents;
        debitCount += 1;
      }
      netTotalCents += entry.signedCents;
      const txnCode = entry.signedCents >= 0 ? meta.creditCode : meta.debitCode;
      const detailText = sanitizeDetailText(entry.description);
      const reference = detailText ? detailText.slice(0, 16) : '';
      return [
        '16',
        txnCode,
        formatUnsignedCents(entry.amountCents),
        '',
        meta.detailFundsType || '',
        reference,
        detailText
      ];
    });

    const transactionCount = parsed.entries.length;
    const accountSummaryCode = (meta.summaryCode || '015').slice(0, 3);
    const summarySegments = [];
    summarySegments.push({ code: accountSummaryCode, amountCents: netTotalCents, itemCount: '', signed: true, fundsType: '' });
    summarySegments.push({ code: '100', amountCents: creditTotalCents, itemCount: creditCount, signed: false, fundsType: '' });
    summarySegments.push({ code: '400', amountCents: debitTotalCents, itemCount: debitCount, signed: false, fundsType: '' });
    ['900','901','902','903','904','905'].forEach(code => {
      summarySegments.push({ code, amountCents: 0, itemCount: '', signed: false, fundsType: '' });
    });

    const accountRecord = ['03', meta.accountNumber, ''];
    const formatSegmentAmount = (segment) => segment.signed ? formatSignedCents(segment.amountCents) : formatUnsignedCents(segment.amountCents);
    summarySegments.forEach((segment) => {
      accountRecord.push(
        segment.code,
        formatSegmentAmount(segment),
        segment.itemCount === '' ? '' : String(segment.itemCount || 0),
        segment.fundsType || '',
        ''
      );
    });

    const lines = [];
    const pushLine = (fields) => {
      lines.push(fields.join(',') + '/');
    };

    pushLine([
      '01',
      meta.senderId,
      meta.receiverId,
      creationDate,
      creationTime,
      meta.fileId,
      meta.recordLength || '',
      meta.blockSize || '',
      '2'
    ]);

    pushLine([
      '02',
      '',
      meta.senderId,
      meta.groupStatus,
      asOfDateYYMMDD,
      asOfTime,
      meta.currency || '',
      meta.asOfDateModifier || '0'
    ]);

    pushLine(accountRecord);
    detailRecords.forEach(rec => pushLine(rec));

    const groupRecordCount = transactionCount + 2;
    const fileRecordCount = transactionCount + 4;

    pushLine(['49', formatSignedCents(netTotalCents), String(transactionCount)]);
    pushLine(['98', formatSignedCents(netTotalCents), String(groupRecordCount)]);
    pushLine(['99', formatSignedCents(netTotalCents), '1', String(fileRecordCount)]);

    return {
      content: lines.join('\n'),
      creditTotalCents,
      debitTotalCents,
      netTotalCents,
      transactionCount,
      fileRecordCount
    };
  }

  function clearBaiError() {
    if (!baiError) return;
    baiError.textContent = '';
    baiError.classList.add('hidden');
  }

  function showBaiError(message) {
    if (!baiError) return;
    baiError.textContent = message;
    baiError.classList.remove('hidden');
  }

  function resetBaiOutput() {
    if (baiOutput) baiOutput.value = '';
    if (baiDownloadBtn) baiDownloadBtn.disabled = true;
    if (baiSummary) baiSummary.textContent = '';
    baiSummaryBase = '';
  }

  function formatCurrencyFromCents(cents, currency) {
    const value = (Number(cents) || 0) / 100;
    try {
      return new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency || 'AUD' }).format(value);
    } catch (_) {
      return `${currency || 'CUR'} ${value.toFixed(2)}`;
    }
  }

  function handleGenerateBai() {
    clearBaiError();
    if (!baiCsvRawText) {
      showBaiError('Select a CSV file before generating the BAI2 output.');
      return;
    }
    const senderId = (baiSenderInput?.value || '').trim();
    const receiverId = (baiReceiverInput?.value || '').trim();
    const accountNumber = (baiAccountInput?.value || '').trim();
    const currency = (baiCurrencyInput?.value || '').trim().toUpperCase() || 'AUD';
    const groupStatus = baiGroupStatusSelect?.value || '1';
    const creditCode = (baiCreditCodeInput?.value || '').trim() || '195';
    const debitCode = (baiDebitCodeInput?.value || '').trim() || '395';
    const summaryCode = (baiSummaryCodeInput?.value || '').trim() || '015';
    const detailFundsType = (baiDetailFundsInput?.value || '').trim();
    const asOfDateModifier = '2';
    let fileId = Number(baiFileIdInput?.value || '1');
    if (!Number.isFinite(fileId) || fileId <= 0) fileId = 1;
    let asOfDate = null;

    const missing = [];
    if (!senderId) missing.push('Sender ID');
    if (!receiverId) missing.push('Receiver ID');
    if (!accountNumber) missing.push('Account number');
    if (!currency) missing.push('Currency code');
    if (!creditCode) missing.push('Credit transaction code');
    if (!debitCode) missing.push('Debit transaction code');
    if (missing.length) {
      showBaiError(`Please fill in: ${missing.join(', ')}.`);
      return;
    }

    let parsed;
    try {
      parsed = parseStatementCsv(baiCsvRawText);
    } catch (err) {
      showBaiError(err?.message || 'Unable to parse CSV file.');
      resetBaiOutput();
      return;
    }

    asOfDate = parsed.latestDate || parsed.earliestDate || new Date();

    const meta = {
      senderId,
      receiverId,
      fileId: String(fileId),
      groupStatus,
      asOfDate,
      currency,
      accountNumber,
      creditCode,
      debitCode,
      summaryCode,
      detailFundsType,
      asOfDateModifier,
      recordLength: '',
      blockSize: ''
    };

    let built;
    try {
      built = buildBaiFile(parsed, meta);
    } catch (err) {
      showBaiError(err?.message || 'Unable to build BAI2 output.');
      resetBaiOutput();
      return;
    }

    if (baiOutput) baiOutput.value = built.content;
    if (baiDownloadBtn) baiDownloadBtn.disabled = !built.content;
    const creditSummary = formatCurrencyFromCents(built.creditTotalCents, currency);
    const debitSummary = formatCurrencyFromCents(built.debitTotalCents, currency);
    const netSummary = formatCurrencyFromCents(built.netTotalCents, currency);
    const fileRecordCount = built.fileRecordCount || (built.transactionCount + 4);
    const pieces = [
      `${built.transactionCount} transactions`,
      `Credits ${creditSummary}`,
      `Debits ${debitSummary}`,
      `Net ${netSummary}`,
      `${fileRecordCount} file records`
    ];
    if (parsed.currencies.length && (parsed.currencies.length > 1 || parsed.currencies[0] !== currency)) {
      pieces.push(`Currencies found: ${parsed.currencies.join(', ')}`);
    }
    if (parsed.skippedRows) pieces.push(`${parsed.skippedRows} rows skipped`);
    baiSummaryBase = pieces.join(' • ');
    if (baiSummary) baiSummary.textContent = baiSummaryBase;
  }

  function handleBaiCsvSelection(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      baiCsvRawText = String(reader.result || '');
      baiCsvFileName = file.name;
      if (baiFileInfo) {
        const sizeKb = file.size ? `${(file.size / 1024).toFixed(1)} kB` : '';
        baiFileInfo.textContent = sizeKb ? `${file.name} (${sizeKb})` : file.name;
      }
      clearBaiError();
      resetBaiOutput();
    };
    reader.onerror = () => {
      showBaiError('Failed to read CSV file.');
      baiCsvRawText = '';
      baiCsvFileName = '';
      resetBaiOutput();
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function downloadBaiFile() {
    if (!baiOutput || !baiOutput.value) return;
    const blob = new Blob([baiOutput.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = baiCsvFileName ? baiCsvFileName.replace(/\.csv$/i, '') : 'statement';
    link.href = url;
    link.download = `${baseName || 'statement'}.bai`; 
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleCopyBaiOutput() {
    if (!baiOutput || !baiOutput.value) return;
    if (!navigator?.clipboard?.writeText) {
      showBaiError('Clipboard API not available in this browser.');
      return;
    }
    navigator.clipboard.writeText(baiOutput.value).then(() => {
      if (baiSummary) {
        baiSummary.textContent = baiSummaryBase
          ? `${baiSummaryBase} • Output copied to clipboard`
          : 'Output copied to clipboard';
        setTimeout(() => {
          if (baiSummary) baiSummary.textContent = baiSummaryBase;
        }, 2500);
      }
    }).catch(() => {
      showBaiError('Unable to copy to clipboard.');
    });
  }

  function clearBaiCheckError() {
    if (!baiCheckError) return;
    baiCheckError.textContent = '';
    baiCheckError.classList.add('hidden');
  }

  function showBaiCheckError(message) {
    if (!baiCheckError) return;
    baiCheckError.textContent = message;
    baiCheckError.classList.remove('hidden');
  }

  function resetBaiCheckResults() {
    if (baiCheckSummary) baiCheckSummary.textContent = 'No results yet.';
    if (baiCheckIssues) baiCheckIssues.textContent = 'No issues reported yet.';
    if (baiCheckPreview) {
      baiCheckPreview.innerHTML = '<div class="px-3 py-2 text-gray-500">Run checks to see parsed lines here.</div>';
    }
    baiCheckParsedRecords = [];
    baiCheckIssueLines = new Set();
    baiCheckSanitizedText = '';
    if (baiCheckSanitizeMsg) {
      baiCheckSanitizeMsg.textContent = '';
      baiCheckSanitizeMsg.classList.add('hidden');
      baiCheckSanitizeMsg.classList.remove('text-red-600', 'text-green-600');
    }
    if (baiCheckSanitizeBtn) {
      baiCheckSanitizeBtn.disabled = true;
    }
    if (baiCheckDownloadBtn) {
      baiCheckDownloadBtn.disabled = true;
    }
  }

  function renderBaiCheckSummary(lines) {
    if (!baiCheckSummary) return;
    if (!lines || !lines.length) {
      baiCheckSummary.textContent = 'No results yet.';
      return;
    }
    baiCheckSummary.textContent = lines.join('\n');
  }

  function renderBaiCheckIssues(items) {
    if (!baiCheckIssues) return;
    baiCheckIssueLines = new Set();
    if (!items || !items.length) {
      baiCheckIssues.textContent = 'No structural issues detected.';
      return;
    }
    const list = items
      .map(({ message, lines }) => {
        const safeMessage = escapeHtml(message || '');
        let lineMarkup = '';
        if (Array.isArray(lines) && lines.length) {
          lines.forEach((line) => {
            if (Number.isFinite(line)) baiCheckIssueLines.add(line);
          });
          lineMarkup = `<div class="text-[11px] text-gray-500 font-mono">Line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}</div>`;
        }
        return `<li>${safeMessage}${lineMarkup}</li>`;
      })
      .join('');
    baiCheckIssues.innerHTML = `<ul class="list-disc list-inside space-y-1">${list}</ul>`;
  }

  function renderBaiCheckPreview(records) {
    if (!baiCheckPreview) return;
    if (!records || !records.length) {
      baiCheckPreview.innerHTML = '<div class="px-3 py-2 text-gray-500">Run checks to see parsed lines here.</div>';
      return;
    }
    const rows = records.map((record) => {
      const hasIssue = baiCheckIssueLines.has(record.lineNumber);
      const rowClasses = hasIssue ? 'bg-red-50' : '';
      const indicator = hasIssue ? '<span class="text-red-500">⚠</span>' : '<span class="text-transparent">⚠</span>';
      return `<div class="flex items-start gap-3 px-3 py-1 border-b border-gray-100 last:border-b-0 ${rowClasses}">
        <span class="w-14 text-right font-mono text-[11px] text-gray-500">${record.lineNumber}</span>
        <div class="flex items-start gap-2 flex-1">
          ${indicator}
          <pre class="flex-1 whitespace-pre-wrap font-mono text-xs text-gray-700">${escapeHtml(record.raw || '')}</pre>
        </div>
      </div>`;
    }).join('');
    baiCheckPreview.innerHTML = rows;
  }

  const BAI_DISALLOWED_CHARS = /"/g;

  function sanitizeBaiRecords(records) {
    if (!Array.isArray(records) || !records.length) return '';
    const sanitized = records
      .map((record) => {
        const source = record?.sanitizedRaw ?? record?.raw ?? '';
        const trimmed = String(source).trim();
        if (!trimmed) return '';
        return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
      })
      .filter((line) => line.length > 0);
    return sanitized.join('\n');
  }

  function showBaiCheckSanitizeMessage(message, tone = 'success') {
    if (!baiCheckSanitizeMsg) return;
    baiCheckSanitizeMsg.textContent = message;
    baiCheckSanitizeMsg.classList.remove('hidden', 'text-red-600', 'text-green-600');
    baiCheckSanitizeMsg.classList.add(tone === 'error' ? 'text-red-600' : 'text-green-600');
  }

  function parseBaiRecords(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((raw, idx) => {
        const hasTerminator = raw.endsWith('/');
        const cleaned = hasTerminator ? raw.slice(0, -1) : raw;
        const fields = cleaned.split(',');
        return {
          lineNumber: idx + 1,
          raw,
          fields,
          type: fields[0] || '',
          hasTerminator,
          sanitizedRaw: cleaned
        };
      });
  }

  function analyzeBaiContent(text) {
    const records = parseBaiRecords(text);
    const issueDetails = [];
    const addIssue = (message, lineNumbers = []) => {
      const lines = Array.isArray(lineNumbers)
        ? lineNumbers.filter((line) => Number.isFinite(line))
        : Number.isFinite(lineNumbers)
          ? [lineNumbers]
          : [];
      issueDetails.push({ message, lines });
    };

    if (!records.length) {
      addIssue('BAI2 content is empty.');
      return { summary: [], issues: issueDetails, records };
    }

    let fileHeader = null;
    let fileTrailer = null;
    let currentGroup = null;
    let currentAccount = null;
    let totalTransactions = 0;
    let accountCount = 0;
    let fileRecordCount = 0;
    let fileNetFromGroups = 0;
    let groupCount = 0;
    let fileCurrency = '';

    const parseIntSafe = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };

    records.forEach((record) => {
      fileRecordCount += 1;
      const { type, fields, lineNumber } = record;
      if (!record.hasTerminator) {
        addIssue('Record missing "/" terminator.', lineNumber);
      }
      if (!type) {
        addIssue('Record type is blank.', lineNumber);
        return;
      }
      switch (type) {
        case '01': {
          if (fileHeader) addIssue('Duplicate file header (01) record.', lineNumber);
          fileHeader = record;
          break;
        }
        case '02': {
          if (!fileHeader) addIssue('Group header (02) appears before file header.', lineNumber);
          if (currentGroup) addIssue('Previous group missing group trailer (98).', currentGroup.startLine);
          currentGroup = {
            index: groupCount + 1,
            startLine: lineNumber,
            netCents: 0,
            transactions: 0
          };
          currentAccount = null;
          groupCount += 1;
          const currency = fields[6] || '';
          if (currency) fileCurrency = fileCurrency || currency;
          break;
        }
        case '03': {
          if (!currentGroup) {
            addIssue('Account header (03) found outside of a group.', lineNumber);
            break;
          }
          if (currentAccount) {
            addIssue('Previous account missing trailer (49).', currentAccount.line);
          }
          currentAccount = {
            id: fields[1] || '',
            line: lineNumber,
            transactions: 0
          };
          accountCount += 1;
          break;
        }
        case '16': {
          if (!currentAccount) {
            addIssue('Transaction detail (16) without a preceding account (03).', lineNumber);
          } else {
            currentAccount.transactions += 1;
          }
          if (currentGroup) currentGroup.transactions = (currentGroup.transactions || 0) + 1;
          totalTransactions += 1;
          break;
        }
        case '49': {
          if (!currentGroup) {
            addIssue('Account trailer (49) found outside of a group.', lineNumber);
            break;
          }
          if (!currentAccount) {
            addIssue('Account trailer (49) encountered without an open account.', lineNumber);
          }
          const trailerNet = parseIntSafe(fields[1]);
          if (trailerNet === null) {
            addIssue('Account trailer net total is not numeric.', lineNumber);
          } else {
            currentGroup.netCents = (currentGroup.netCents || 0) + trailerNet;
          }
          const trailerCount = parseIntSafe(fields[2]);
          if (trailerCount !== null && currentAccount && trailerCount !== currentAccount.transactions) {
            addIssue(`Account ${currentAccount.id || '(unknown)'} trailer expects ${trailerCount} transactions but ${currentAccount.transactions} recorded. Update the 49 trailer record or adjust the detail lines to match.`, lineNumber);
          }
          currentAccount = null;
          break;
        }
        case '88': {
          break;
        }
        case '98': {
          if (!currentGroup) {
            addIssue('Group trailer (98) without an open group.', lineNumber);
            break;
          }
          if (currentAccount) {
            addIssue('Account missing trailer (49) before group trailer (98).', currentAccount.line);
            currentAccount = null;
          }
          const groupNet = parseIntSafe(fields[1]);
          if (groupNet !== null && groupNet !== currentGroup.netCents) {
            addIssue(`Group net ${groupNet} does not match account totals ${currentGroup.netCents || 0}.`, lineNumber);
          }
          const expectedRecords = parseIntSafe(fields[2]);
          if (expectedRecords !== null) {
            const observedRecords = (currentGroup.transactions || 0) + 2;
            if (expectedRecords !== observedRecords) {
              addIssue(`Group record count ${expectedRecords} does not match observed ${observedRecords}. Update the 98 group trailer or adjust the detail lines to match.`, lineNumber);
            }
          }
          if (groupNet !== null) fileNetFromGroups += groupNet;
          currentGroup = null;
          currentAccount = null;
          break;
        }
        case '99': {
          if (fileTrailer) addIssue('Duplicate file trailer (99) record.', lineNumber);
          fileTrailer = record;
          break;
        }
        default: {
          break;
        }
      }

      if (record.sanitizedRaw && record.sanitizedRaw.includes('"')) {
        addIssue('Double quotes detected; replace them with apostrophes or remove them before submission.', lineNumber);
        record.sanitizedRaw = record.sanitizedRaw.replace(/"/g, "'");
      }
    });

    if (currentAccount) {
      addIssue('Account missing trailer (49).', currentAccount.line);
    }
    if (currentGroup) {
      addIssue('Group missing group trailer (98).', currentGroup.startLine);
    }
    if (!fileHeader) {
      addIssue('Missing file header (01) record.');
    }
    if (!fileTrailer) {
      addIssue('Missing file trailer (99) record.');
    }

    const parseTrailerValue = (record, index) => {
      if (!record || !record.fields) return null;
      return parseIntSafe(record.fields[index]);
    };

    const trailerNet = parseTrailerValue(fileTrailer, 1);
    const trailerGroupCount = parseTrailerValue(fileTrailer, 2);
    const trailerRecordCount = parseTrailerValue(fileTrailer, 3);

    if (trailerGroupCount !== null && trailerGroupCount !== groupCount) {
      addIssue(`File trailer reports ${trailerGroupCount} groups but ${groupCount} observed.`, fileTrailer?.lineNumber);
    }
    if (trailerRecordCount !== null && trailerRecordCount !== fileRecordCount) {
      addIssue(`File trailer reports ${trailerRecordCount} records but ${fileRecordCount} observed. Update the 99 trailer or group detail counts so they align.`, fileTrailer?.lineNumber);
    }
    if (trailerNet !== null && trailerNet !== fileNetFromGroups) {
      addIssue(`File trailer net ${trailerNet} does not match sum of group nets ${fileNetFromGroups}.`, fileTrailer?.lineNumber);
    }

    const summary = [];
    if (fileHeader?.fields) {
      const [ , sender, receiver, creationDate, creationTime ] = fileHeader.fields;
      if (sender || receiver) summary.push(`Sender ${sender || 'unknown'} → Receiver ${receiver || 'unknown'}`);
      if (creationDate) summary.push(`File creation: ${creationDate}${creationTime ? ` ${creationTime}` : ''}`);
    }
    summary.push(`Groups: ${groupCount}`);
    summary.push(`Accounts: ${accountCount}`);
    summary.push(`Transactions: ${totalTransactions}`);
    summary.push(`Records: ${fileRecordCount}`);
    if (trailerNet !== null) {
      summary.push(`File net: ${formatCurrencyFromCents(trailerNet, fileCurrency || 'AUD')}`);
    }

    return { summary, issues: issueDetails, records };
  }

  function handleBaiCheckFileSelection(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      baiCheckRawText = String(reader.result || '');
      baiCheckFileName = file.name;
      if (baiCheckFileInfo) {
        const sizeKb = file.size ? `${(file.size / 1024).toFixed(1)} kB` : '';
        baiCheckFileInfo.textContent = sizeKb ? `${file.name} (${sizeKb})` : file.name;
      }
      if (baiCheckText) baiCheckText.value = baiCheckRawText;
      clearBaiCheckError();
      resetBaiCheckResults();
    };
    reader.onerror = () => {
      showBaiCheckError('Failed to read BAI2 file.');
      baiCheckRawText = '';
      baiCheckFileName = '';
      if (baiCheckFileInfo) baiCheckFileInfo.textContent = 'No file selected.';
    };
    reader.readAsText(file);
    if (event?.target) event.target.value = '';
  }

  function handleBaiCheckRun() {
    clearBaiCheckError();
    if (baiCheckSanitizeMsg) {
      baiCheckSanitizeMsg.textContent = '';
      baiCheckSanitizeMsg.classList.add('hidden');
      baiCheckSanitizeMsg.classList.remove('text-red-600', 'text-green-600');
    }
    const typed = (baiCheckText?.value || '').trim();
    const text = typed || String(baiCheckRawText || '').trim();
    if (!text) {
      showBaiCheckError('Select a BAI2 file or paste its contents before running checks.');
      return;
    }
    const { summary, issues, records } = analyzeBaiContent(text);
    const summaryLines = summary ? [...summary] : [];
    if (baiCheckFileName) summaryLines.unshift(`File: ${baiCheckFileName}`);
    renderBaiCheckSummary(summaryLines);
    renderBaiCheckIssues(issues);
    baiCheckParsedRecords = Array.isArray(records) ? records : [];
    renderBaiCheckPreview(baiCheckParsedRecords);
    baiCheckSanitizedText = sanitizeBaiRecords(baiCheckParsedRecords);
    if (baiCheckSanitizeBtn) {
      baiCheckSanitizeBtn.disabled = !baiCheckSanitizedText;
    }
    if (baiCheckDownloadBtn) {
      baiCheckDownloadBtn.disabled = !baiCheckSanitizedText;
    }
    if (baiCheckSanitizeMsg) {
      if (baiCheckSanitizedText) {
        const hasRemainingIssues = Array.isArray(issues) && issues.length > 0;
        showBaiCheckSanitizeMessage(
          hasRemainingIssues
            ? 'Sanitized output prepared (quotes and terminators normalized). Review the remaining issues before resubmitting.'
            : 'Sanitized output prepared (quotes and terminators normalized).'
        );
      } else {
        baiCheckSanitizeMsg.textContent = '';
        baiCheckSanitizeMsg.classList.add('hidden');
        baiCheckSanitizeMsg.classList.remove('text-red-600', 'text-green-600');
      }
    }
  }

  function handleBaiCheckSanitize() {
    if (!baiCheckSanitizedText) return;
    if (!navigator?.clipboard?.writeText) {
      showBaiCheckSanitizeMessage('Clipboard API not available for copying.', 'error');
      return;
    }
    navigator.clipboard.writeText(baiCheckSanitizedText).then(() => {
      showBaiCheckSanitizeMessage('Sanitized output copied to clipboard.');
    }).catch(() => {
      showBaiCheckSanitizeMessage('Unable to copy sanitized output.', 'error');
    });
  }

  function handleBaiCheckDownload() {
    if (!baiCheckSanitizedText) return;
    try {
      const content = baiCheckSanitizedText.endsWith('\n') ? baiCheckSanitizedText : `${baiCheckSanitizedText}\n`;
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const baseName = baiCheckFileName ? baiCheckFileName.replace(/\.(bai|txt)$/i, '') : 'bai2';
      link.href = url;
      link.download = `${baseName || 'bai2'}-sanitized.bai`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showBaiCheckSanitizeMessage('Sanitized file downloaded.');
    } catch (err) {
      showBaiCheckSanitizeMessage('Unable to download sanitized file.', 'error');
    }
  }

  function handleBaiCheckClear() {
    baiCheckRawText = '';
    baiCheckFileName = '';
    if (baiCheckText) baiCheckText.value = '';
    if (baiCheckFileInfo) baiCheckFileInfo.textContent = 'No file selected.';
    resetBaiCheckResults();
    clearBaiCheckError();
  }

  resetBaiCheckResults();
  setBankingSection(currentBankingSection);


  tabGen?.addEventListener('click', ()=>setTab('gen'));
  tabMy?.addEventListener('click', ()=>setTab('my'));
  tabReader?.addEventListener('click', ()=>setTab('reader'));
  tabBanking?.addEventListener('click', (event)=>{ event.preventDefault(); setTab('banking'); });
  tabSaas?.addEventListener('click', ()=>setTab('saas'));
  tabReviewer?.addEventListener('click', (event)=>{ event.preventDefault(); setTab('reviewer'); });
  tabAdmin?.addEventListener('click', (event)=>{ event.preventDefault(); setTab('admin'); });
  baiMetadataForm?.addEventListener('submit', (event)=>event.preventDefault());
  baiSelectCsvBtn?.addEventListener('click', ()=>baiCsvInput?.click());
  baiCsvInput?.addEventListener('change', handleBaiCsvSelection);
  baiGenerateBtn?.addEventListener('click', handleGenerateBai);
  baiDownloadBtn?.addEventListener('click', downloadBaiFile);
  baiCopyBtn?.addEventListener('click', handleCopyBaiOutput);
  baiCheckSelectBtn?.addEventListener('click', () => baiCheckInput?.click());
  baiCheckInput?.addEventListener('change', handleBaiCheckFileSelection);
  baiCheckRunBtn?.addEventListener('click', handleBaiCheckRun);
  baiCheckSanitizeBtn?.addEventListener('click', handleBaiCheckSanitize);
  baiCheckDownloadBtn?.addEventListener('click', handleBaiCheckDownload);
  baiCheckClearBtn?.addEventListener('click', handleBaiCheckClear);
  bankingNavButtons.forEach((btn) => {
    btn?.addEventListener('click', (event) => {
      event?.preventDefault?.();
      const section = btn.dataset?.bankingSection || 'converter';
      setBankingSection(section);
    });
  });
  landingLoginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    landingLoginError?.classList.add('hidden');
    const email = landingEmailInput?.value.trim();
    const password = landingPasswordInput?.value || '';
    if (!email || !password) {
      if (landingLoginError) {
        landingLoginError.textContent = 'Enter email and password to continue.';
        landingLoginError.classList.remove('hidden');
      }
      return;
    }
    try {
      await loginReviewerAccount(email, password);
      if (landingPasswordInput) landingPasswordInput.value = '';
      handlePostLogin(() => setTab('gen'));
    } catch (err) {
      if (landingLoginError) {
        landingLoginError.textContent = err.message || 'Login failed.';
        landingLoginError.classList.remove('hidden');
      }
    }
  });
  
  changePasswordBtn?.addEventListener('click', ()=>openChangePasswordModal(false));
  logoutBtn?.addEventListener('click', ()=>logoutReviewerAccount());

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

  adminTestingToggle?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => showAdminSection('testing', true));
      return;
    }
    if (adminTestingLoading) return;
    const nextEnabled = !adminTestingMode?.enabled;
    adminTestingLoading = true;
    clearAdminTestingFeedback();
    renderAdminTestingMode();
    try {
      const data = await apiRequest('/admin/testing-mode', {
        method: 'POST',
        body: JSON.stringify({ enabled: nextEnabled })
      });
      adminTestingMode = data || { enabled: nextEnabled };
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
      renderAdminTestingMode();
    }
  });

  showAdminSection(currentAdminSection);
  updateAdminArchiveScopeButton();

  adminRefreshReviewersBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => showAdminSection('accounts', true));
      return;
    }
    await loadAdminReviewers(true);
  });

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
    updateAdminArchiveScopeButton();
    await loadAdminArchives(true);
    adminSectionLoaded.add('archives');
  });

  adminRefreshBlacklistBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => showAdminSection('blacklist', true));
      return;
    }
    await loadAdminBlacklist(true);
  });

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
        await apiRequest(`/blacklist/${id}`, { method: 'PUT', body: JSON.stringify({ active: nextActive }) });
        await loadAdminBlacklist(true);
        adminSectionLoaded.add('blacklist');
      } else if (action === 'delete') {
        if (!confirm(`Remove ${entry.bsb} / ${entry.account} from the blacklist?`)) return;
        await apiRequest(`/blacklist/${id}`, { method: 'DELETE' });
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
        adminBlacklistError?.classList.add('hidden');
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

  adminBlacklistForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => adminBlacklistForm.requestSubmit());
      return;
    }
    adminBlacklistError?.classList.add('hidden');
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
        await apiRequest(`/blacklist/${adminBlacklistEditingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await apiRequest('/blacklist', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      const successMessage = isEdit ? 'Blacklist entry updated.' : 'Blacklist entry added.';
      setAdminBlacklistForm(null);
      adminBlacklistError?.classList.add('hidden');
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
    adminBlacklistError?.classList.add('hidden');
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
    adminBlacklistError?.classList.add('hidden');
    adminBlacklistFeedback?.classList.add('hidden');
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
      const response = await apiRequest('/blacklist/import', {
        method: 'POST',
        body: JSON.stringify({ entries })
      });
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

  if (adminBlacklistForm) setAdminBlacklistForm(null);

  adminArchiveSearchInput?.addEventListener('input', () => {
    adminArchiveSearchTermRaw = adminArchiveSearchInput.value || '';
    adminArchiveSearchTerm = adminArchiveSearchTermRaw.trim().toLowerCase();
    renderAdminArchives(filteredAdminArchives());
    adminArchiveFeedback?.classList.add('hidden');
  });

  reviewerArchiveSearchInput?.addEventListener('input', () => {
    reviewerArchiveSearchTermRaw = reviewerArchiveSearchInput.value || '';
    reviewerArchiveSearchTerm = reviewerArchiveSearchTermRaw.trim().toLowerCase();
    renderReviewerArchives(filteredReviewerArchives());
    reviewerArchiveFeedback?.classList.add('hidden');
  });

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
      const disableSendEmail = role !== 'reviewer' || isEditingAccount;
      adminNewSendEmailSelect.disabled = disableSendEmail;
      if (disableSendEmail) adminNewSendEmailSelect.value = 'no';
      emailWrapper?.classList.toggle('opacity-50', disableSendEmail);
    }
  }

  adminNewRoleSelect?.addEventListener('change', () => {
    syncAdminCreateFormRole();
    if (adminReviewerEditingId && adminNewRoleSelect?.value !== 'user' && adminNewDeptInput) {
      adminNewDeptInput.value = '';
    }
  });
  setAdminReviewerForm(null);

  const updateAdminReviewerFilters = () => {
    adminReviewerSearchTermRaw = (adminReviewerSearchInput?.value || '').trim();
    adminReviewerSearchTerm = adminReviewerSearchTermRaw.toLowerCase();
    renderFilteredAdminReviewers();
  };

  adminReviewerSearchInput?.addEventListener('input', updateAdminReviewerFilters);
  adminReviewerSearchInput?.addEventListener('search', updateAdminReviewerFilters);

  adminReviewerRoleSelect?.addEventListener('change', () => {
    adminReviewerRoleFilterValue = adminReviewerRoleSelect?.value || 'all';
    renderFilteredAdminReviewers();
  });

  const updateBlacklistFilter = () => {
    adminBlacklistSearchTermRaw = (adminBlacklistSearchInput?.value || '').trim();
    adminBlacklistSearchTerm = adminBlacklistSearchTermRaw.toLowerCase();
    renderAdminBlacklist(adminBlacklistCache);
  };

  adminBlacklistSearchInput?.addEventListener('input', updateBlacklistFilter);
  adminBlacklistSearchInput?.addEventListener('search', updateBlacklistFilter);

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
        const result = await apiRequest(`/reviewers/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ send_email: false }) });
        if (result?.temporary_password) {
          // Show temporary password in a modal that doesn't auto-disappear
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
          
          // Add copy functionality
          const copyBtn = document.getElementById('copy-temp-password');
          const passwordDisplay = document.getElementById('temp-password-display');
          const closeBtn = document.getElementById('close-password-modal');
          
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
          
          closeBtn?.addEventListener('click', () => {
            closeModal();
          });
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
        await apiRequest(`/reviewers/${id}`, { method: 'PUT', body: JSON.stringify({ status: next }) });
        await loadAdminReviewers();
        adminSectionLoaded.add('accounts');
      } else if (action === 'toggle-notify') {
        const next = btn.dataset.next === 'on';
        await apiRequest(`/reviewers/${id}`, { method: 'PUT', body: JSON.stringify({ notify_on_submission: next }) });
        await loadAdminReviewers(true);
        adminSectionLoaded.add('accounts');
      } else if (action === 'delete') {
        const confirmed = confirm('Delete this account? This cannot be undone.');
        if (!confirmed) return;
        await apiRequest(`/reviewers/${id}`, { method: 'DELETE' });
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
        adminCreateReviewerError?.classList.add('hidden');
        adminCreateReviewerSuccess?.classList.add('hidden');
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
        await apiRequest(`/reviewers/${id}`, { method: 'PUT', body: JSON.stringify({ department_code: nextValue }) });
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
      const response = await apiRequest(`/reviewers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
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

  async function refreshRetrievedBatch(code) {
    const normalized = normalizeBatchCode(code);
    if (!normalized) return;
    try {
      const batch = await apiRequest(`/batches/${normalized.encoded}`);
      currentRetrievedBatch = batch;
      currentRetrievedCode = ensureBatchCodeFormat(batch.code);
      const updatedReviews = batch.batch_id ? await loadReviewsForBatch(batch.batch_id) : [];
      renderRetrievedBatch(batch, updatedReviews);
    } catch (err) {
      console.warn('Failed to refresh retrieved batch', err);
    }
  }

  async function processArchiveAction(action, code, tableRole = 'admin') {
    const normalized = normalizeBatchCode(code);
    if (!normalized) return;
    const { raw, formatted, encoded } = normalized;
    if (action === 'copy') {
      try { await navigator.clipboard?.writeText?.(formatted); } catch (err) { console.warn('Copy failed', err); }
      return;
    }

    if (action === 'approve' || action === 'reject') {
      if (!hasRole('admin')) {
        ensureAuth('admin', () => showAdminSection('archives', true));
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
          notify = notifyChoice; // true if OK, false if Cancel
        }
        const payload = { stage: action === 'approve' ? 'approved' : 'rejected' };
        if (comments) payload.comments = comments;
        if (action === 'reject') payload.notify = notify;
        const updated = await apiRequest(`/batches/${encoded}/stage`, { method: 'PATCH', body: JSON.stringify(payload) });
        // Update caches and UI
        const updateListItem = (list) => {
          if (!Array.isArray(list)) return list;
          return list.map((item) => item.code === raw ? { ...item, ...updated } : item);
        };
        adminArchivesCache = updateListItem(adminArchivesCache);
        renderAdminArchives(filteredAdminArchives());
        reviewerArchivesCache = updateListItem(reviewerArchivesCache);
        renderReviewerArchives(filteredReviewerArchives());
        adminSectionLoaded.add('archives');
        if (adminArchiveFeedback) {
          const verb = action === 'approve' ? 'approved' : 'rejected';
          adminArchiveFeedback.textContent = `Batch ${formatted} ${verb}.`;
          adminArchiveFeedback.classList.remove('hidden');
          setTimeout(() => adminArchiveFeedback.classList.add('hidden'), 4000);
        }
        if (currentRetrievedCode === formatted) {
          // Refresh the open batch view to reflect new stage/file availability
          await refreshRetrievedBatch(formatted);
        }
      } catch (err) {
        if (adminArchiveFeedback) {
          adminArchiveFeedback.textContent = err.message || 'Unable to change stage.';
          adminArchiveFeedback.classList.remove('hidden');
          setTimeout(() => adminArchiveFeedback.classList.add('hidden'), 4000);
        }
      }
      return;
    }

    if (action === 'delete') {
      if (!hasRole('admin')) {
        ensureAuth('admin', () => showAdminSection('archives', true));
        return;
      }
      if (!confirm(`Delete batch ${formatted}? This cannot be undone.`)) return;
      try {
        await apiRequest(`/batches/${encoded}`, { method: 'DELETE' });
        if (adminArchiveFeedback) {
          adminArchiveFeedback.textContent = `Batch ${formatted} deleted.`;
          adminArchiveFeedback.classList.remove('hidden');
          setTimeout(() => adminArchiveFeedback.classList.add('hidden'), 4000);
        }
        adminArchivesCache = adminArchivesCache.filter(item => item.code !== raw);
        renderAdminArchives(filteredAdminArchives());
        reviewerArchivesCache = reviewerArchivesCache.filter(item => item.code !== raw);
        renderReviewerArchives(filteredReviewerArchives());
        adminSectionLoaded.add('archives');
        if (currentRetrievedCode === formatted) {
          retrieveBatchResult.innerHTML = '<p class="text-sm text-gray-500">Batch has been deleted.</p>';
        }
      } catch (err) {
        if (adminArchiveFeedback) {
          adminArchiveFeedback.textContent = err.message || 'Unable to delete batch.';
          adminArchiveFeedback.classList.remove('hidden');
          setTimeout(() => adminArchiveFeedback.classList.add('hidden'), 4000);
        }
      }
      return;
    }

    if (action === 'open') {
      const ensureRole = ensureAuth('reviewer', () => {
        if (retrieveBatchCodeInput) retrieveBatchCodeInput.value = formatted;
        setTab('reviewer');
        setTimeout(() => {
          if (retrieveBatchForm?.requestSubmit) retrieveBatchForm.requestSubmit();
          else retrieveBatchForm?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }, 100);
      });
      if (!ensureRole) return;
      if (retrieveBatchCodeInput) retrieveBatchCodeInput.value = formatted;
      if (panelReviewer?.classList.contains('hidden')) setTab('reviewer');
      else {
        if (retrieveBatchForm?.requestSubmit) retrieveBatchForm.requestSubmit();
        else retrieveBatchForm?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
      return;
    }

    if (action === 'download') {
      if (!hasRole('reviewer')) {
        ensureAuth('reviewer', () => {});
        return;
      }
      try {
        const batch = await apiRequest(`/batches/${encoded}`);
        if (batch?.file_base64) {
          downloadBase64File(batch.file_base64, batch.file_name || `${formatted}.aba`);
        } else {
          throw new Error('File available once approved.');
        }
      } catch (err) {
        const feedbackEl = tableRole === 'admin' ? adminArchiveFeedback : reviewerArchiveFeedback;
        if (feedbackEl) {
          feedbackEl.textContent = err.message || 'Unable to download batch.';
          feedbackEl.classList.remove('hidden');
          setTimeout(() => feedbackEl.classList.add('hidden'), 4000);
        }
      }
    }
  }


  function attachArchiveTableHandler(tbody, role) {
    tbody?.addEventListener('click', async (event) => {
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const code = btn.dataset.code;
      if (!code) return;
      await processArchiveAction(btn.dataset.action, code, role);
    });
  }

  attachArchiveTableHandler(adminArchiveTbody, 'admin');
  attachArchiveTableHandler(reviewerArchiveTbody, 'reviewer');

  reviewerRefreshArchivesBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!hasRole('reviewer')) {
      ensureAuth('reviewer', () => loadReviewerArchives(true));
      return;
    }
    loadReviewerArchives(true);
  });

  adminCreateReviewerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!hasRole('admin')) {
      ensureAuth('admin', () => adminCreateReviewerForm.requestSubmit());
      return;
    }
    adminCreateReviewerError?.classList.add('hidden');
    adminCreateReviewerSuccess?.classList.add('hidden');
    const email = (adminNewEmailInput?.value || '').trim();
    if (!email) {
      adminCreateReviewerError.textContent = 'Email is required.';
      adminCreateReviewerError.classList.remove('hidden');
      return;
    }
    const nameValue = (adminNewNameInput?.value || '').trim();
    const name = nameValue ? nameValue : null;
    const role = adminNewRoleSelect?.value || 'reviewer';
    const deptValue = (adminNewDeptInput?.value || '').trim();
    const notifyPref = adminNewNotifySelect?.value || 'yes';
    const sendEmailPref = adminNewSendEmailSelect?.value === 'yes';
    if (role === 'user' && !/^\d{2}$/.test(deptValue)) {
      adminCreateReviewerError.textContent = 'Users must have a two-digit Department Head.';
      adminCreateReviewerError.classList.remove('hidden');
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
      requestBody.send_email = role === 'reviewer' ? sendEmailPref : false;
    }
    try {
      if (isEdit) {
        await apiRequest(endpoint, {
          method,
          body: JSON.stringify(requestBody)
        });
        setAdminReviewerForm(null);
        await loadAdminReviewers();
        adminSectionLoaded.add('accounts');
        adminCreateReviewerSuccess.textContent = 'Account updated.';
        adminCreateReviewerSuccess.classList.remove('hidden');
        setTimeout(() => adminCreateReviewerSuccess?.classList.add('hidden'), 4000);
      } else {
        const payload = await apiRequest(endpoint, {
          method,
          body: JSON.stringify(requestBody)
        });
        setAdminReviewerForm(null);
        adminCreateReviewerSuccess.textContent = payload?.temporary_password
          ? `Account created. Temporary password: ${payload.temporary_password} (change required on first login).`
          : 'Account created. User must change their password on first login.';
        adminCreateReviewerSuccess.classList.remove('hidden');
        setTimeout(() => adminCreateReviewerSuccess?.classList.add('hidden'), 6000);
        await loadAdminReviewers();
        adminSectionLoaded.add('accounts');
      }
    } catch (err) {
      adminCreateReviewerError.textContent = err.message || (isEdit ? 'Unable to update account.' : 'Unable to create account.');
      adminCreateReviewerError.classList.remove('hidden');
    }
  });

  adminCreateReviewerCancelBtn?.addEventListener('click', () => {
    setAdminReviewerForm(null);
    adminCreateReviewerError?.classList.add('hidden');
  });



  function openSubmissionModal({ batchId, metrics, duplicates }){
    const account = authState?.reviewer || {};
    const deptCode = account.department_code || '';
    const hasDept = !!deptCode;
    const duplicateInfo = duplicates.sets > 0
      ? `<li>Duplicate sets: <strong>${duplicates.sets}</strong> (rows affected: ${duplicates.rows})</li>`
      : '<li>No duplicate transactions detected.</li>';
    const totalCredits = U.money(metrics.creditsCents);
    const totalDebits = U.money(metrics.debitsCents);
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
            <label class="block mb-1 font-medium" for="submission-pd">FMIS PD reference</label>
            <input id="submission-pd" type="text" required maxlength="6" pattern="\\d{6}" inputmode="numeric" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring focus:ring-amber-200" placeholder="123456">
            <p class="text-xs text-gray-500 mt-1">Enter the six-digit FMIS PD number. <strong>Do not</strong> enter the PD prefix.</p>
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
        const form = document.getElementById('submission-form');
        const errorEl = document.getElementById('submission-error');
        const pdInput = document.getElementById('submission-pd');
        const cancelBtn = document.getElementById('submission-cancel');
        
        if (pdInput) {
          pdInput.focus();
          pdInput.addEventListener('input', () => {
            const digits = (pdInput.value || '').replace(/[^0-9]/g, '').slice(0, 6);
            pdInput.value = digits;
          });
        }
        
        cancelBtn?.addEventListener('click', () => { 
          document.getElementById('dynamic-modal')?.remove(); 
          resolve(null); 
        });
        
        form?.addEventListener('submit', (e)=>{
          e.preventDefault();
          errorEl?.classList.add('hidden');
          let deptOverride = null;
          if (!hasDept) {
            const deptVal = (document.getElementById('submission-dept')?.value || '').trim();
            if (!/^\d{2}$/.test(deptVal)) {
              if (errorEl) {
                errorEl.textContent = 'Enter the first two digits of the department FMIS code.';
                errorEl.classList.remove('hidden');
              }
              return;
            }
            deptOverride = deptVal;
          }
          const rawPd = (pdInput?.value || '').trim();
          const normalizedPd = rawPd.replace(/[^0-9]/g, '');
          if (!/^\d{6}$/.test(normalizedPd)) {
            if (errorEl) {
              errorEl.textContent = 'Enter the six-digit FMIS PD reference (e.g. 123456).';
              errorEl.classList.remove('hidden');
            }
            pdInput?.focus();
            return;
          }
          const pdNumber = normalizedPd;
          const preparer = preparedDefault.trim();
          if (!preparer) {
            if (errorEl) {
              errorEl.textContent = 'Prepared by could not be resolved from your account.';
              errorEl.classList.remove('hidden');
            }
            return;
          }
          const notes = document.getElementById('submission-notes')?.value.trim();
          document.getElementById('dynamic-modal')?.remove();
          resolve({ pdNumber, preparer, notes, deptOverride });
        });
      }, 100);
    });
  }

  function getSortValue(tx, key){
    const lower = (val) => String(val || '').toLowerCase();
    switch(key){
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

  function getFilteredMatches(){
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

  function renderTransactions(){
    const tbody = transactionTableBody;
    tbody.innerHTML = '';
    updateSortIndicators();
    recomputeDuplicates();

    if (transactions.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = `<td colspan="8" class="text-center py-3 text-gray-500 border-r border-gray-300">No transactions added yet.</td>`;
      tbody.appendChild(emptyRow);
      updateDuplicateSummary();
      return;
    }
    const matches = getFilteredMatches();
    if (matches.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = `<td colspan="8" class="text-center py-3 text-gray-500 border-r border-gray-300">No transactions match the current search.</td>`;
      tbody.appendChild(emptyRow);
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
      row.innerHTML = `
        <td class="p-2 whitespace-nowrap border-r border-gray-300 text-center text-gray-500">${displayIndex + 1}${badgeHtml}</td>
        <td class="p-2 whitespace-nowrap border-r border-gray-300 w-24"><input type="text" value="${tx.bsb||''}" class="w-full max-w-[6rem] bg-transparent border-none focus:outline-none" data-field="bsb" data-index="${index}"></td>
        <td class="p-2 whitespace-nowrap border-r border-gray-300 w-32"><input type="text" value="${tx.account||''}" class="w-full max-w-[8rem] bg-transparent border-none focus:outline-none" data-field="account" data-index="${index}"></td>
        <td class="p-2 whitespace-nowrap border-r border-gray-300 w-28"><input type="number" step="0.01" value="${Number(tx.amount||0).toFixed(2)}" class="w-full bg-transparent border-none focus:outline-none text-right" data-field="amount" data-index="${index}"></td>
        <td class="p-2 whitespace-nowrap border-r border-gray-300"><input type="text" value="${tx.accountTitle||''}" class="w-full min-w-[16rem] bg-transparent border-none focus:outline-none" data-field="accountTitle" data-index="${index}"></td>
        <td class="p-2 whitespace-nowrap border-r border-gray-300 min-w-[14rem]"><input type="text" required maxlength="18" value="${tx.lodgementRef||''}" class="w-full min-w-[14rem] bg-transparent border border-transparent focus:border-gray-300 focus:outline-none" data-field="lodgementRef" data-index="${index}" placeholder="Required" title="Max 18 characters"></td>
        <td class="p-2 whitespace-nowrap border-r border-gray-300 text-center">
          <input type="text" value="53" class="w-16 text-center border-none text-gray-500 cursor-not-allowed select-none bg-gray-100" data-field="txnCode" data-index="${index}" readonly tabindex="-1">
        </td>
        <td class="p-2 text-center whitespace-nowrap border-r border-gray-300">
          <button class="delete-row-btn px-2 py-1 text-sm text-red-600 hover:text-red-800 transition-colors duration-200 rounded-md" data-index="${index}">Delete</button>
        </td>
      `;
      if (duplicateGroup) row.classList.add('duplicate-row');
      tbody.appendChild(row);
    });

    tbody.querySelectorAll('input:not([readonly])').forEach(input => { input.addEventListener('change', handleTransactionUpdate); });
    tbody.querySelectorAll('.delete-row-btn').forEach(button => { button.addEventListener('click', handleDeleteRow); });
    updateDuplicateSummary();
  }

  function handleTransactionUpdate(e){
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
      
      // Only re-render if BSB actually changed in a way that might affect blocked status
      const oldAccount = transactions[index].account;
      if (oldAccount) {
        const wasBlocked = oldBsb && isBlacklistedCombo(oldBsb, oldAccount);
        const isNowBlocked = newBsb && isBlacklistedCombo(newBsb, oldAccount);
        needsRerender = (wasBlocked !== isNowBlocked);
      }
    } else if (field === 'account') {
      const oldAccount = transactions[index][field];
      transactions[index][field] = value;
      
      // Only re-render if account change might affect blocked status
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
      // Lodgement ref changes affect validation warnings
      if (field === 'lodgementRef') {
        const hadLodgement = transactions[index].lodgementRef && transactions[index].lodgementRef.trim() !== '';
        const hasLodgement = value && value.trim() !== '';
        needsRerender = (hadLodgement !== hasLodgement);
      }
    }

    saveToLocalStorage(); 
    updateTotals(); 
    
    // Update validation warnings without full re-render most of the time
    if (needsRerender) {
      checkValidationIssues(); 
      renderTransactions();
    } else {
      // Just update validation warnings without re-rendering table
      checkValidationIssues();
    }
  }
  function handleDeleteRow(e){
    const index = parseInt(e.target.dataset.index, 10);
    if (!isNaN(index)) {
      transactions.splice(index, 1);
      renderTransactions(); saveToLocalStorage(); updateTotals(); checkValidationIssues();
    }
  }
  addRowBtn.addEventListener('click', ()=>{
    transactions.push({ bsb:"", account:"", amount:0, accountTitle:"", lodgementRef:"", txnCode:"53", withholdingCents:null });
    renderTransactions(); saveToLocalStorage(); updateTotals(); checkValidationIssues();
  });

  function applyLodgementToAll(val){
    transactions = transactions.map(t => ({ ...t, lodgementRef: val }));
    renderTransactions();
    saveToLocalStorage();
    updateTotals();
    checkValidationIssues();
  }

  function confirmBulkApply(val){
    const count = transactions.length;
    const limited = (val || '').slice(0,18);
    const shown = limited.length > 30 ? (limited.slice(0,30) + '…') : limited;
    return confirm(`Apply this Lodgement Ref (max 18 chars) to all ${count} transactions?\n\n"${shown}"`);
  }

  // Bulk set Lodgement Ref across all transactions from input
  if (bulkLodgementBtn) {
    bulkLodgementBtn.addEventListener('click', ()=>{
      let val = (bulkLodgementInput?.value || '').trim();
      if (val === '') return; // ignore empty
      val = val.slice(0,18);
      if (bulkLodgementInput) bulkLodgementInput.value = val; // reflect truncation
      if (!confirmBulkApply(val)) return;
      applyLodgementToAll(val);
    });
  }

  if (transactionSearchInput) {
    const updateSearch = () => {
      transactionSearchTerm = transactionSearchInput.value || '';
      renderTransactions();
    };
    transactionSearchInput.addEventListener('input', updateSearch);
    transactionSearchInput.addEventListener('search', updateSearch);
  }

  sortButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sortKey;
      if (!key) return;
      if (transactionSort.key !== key) {
        transactionSort = { key, direction: 'asc' };
      } else if (transactionSort.direction === 'asc') {
        transactionSort.direction = 'desc';
      } else {
        transactionSort = { key: null, direction: 'asc' };
      }
      renderTransactions();
    });
  });

  

  clearAllBtn.addEventListener('click', ()=>{
    if (confirm("Are you sure you want to clear all transactions?")) {
      transactions = [];
      renderTransactions();
      saveToLocalStorage();
      updateTotals();
      if (importSummaryElement) importSummaryElement.innerHTML = '';
      currentSubmissionRootId = null;
      readerContext = { rootBatchId: null, code: null };
    }
  });

  importCsvBtn.addEventListener('click', ()=> csvFileInput.click());
  csvFileInput.addEventListener('change', (event)=>{
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e)=>{
      try{
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
          const tableRow = accepted.length + 1; // generator row once imported
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
          errorsElement.textContent = 'No valid rows found in CSV. Resolve the noted issues and try again.';
          return;
        }

        errorsElement.textContent = '';
        const summaryLines = [
          `Accepted rows: ${accepted.length}`,
          `Duplicate rows detected: ${duplicateRowTotal}`,
          `Duplicate groups: ${duplicateDetailMap.size}`,
          `Rows skipped: ${errors.length}`
        ].join('\n');
        const confirmMsg = `CSV import summary\n\n${summaryLines}\n\nImporting will replace the current transaction list. Continue?`;
        if (!confirm(confirmMsg)) return;

        transactions = accepted;
        currentSubmissionRootId = null;
        readerContext = { rootBatchId: null, code: null };
        transactionSearchTerm = '';
        transactionSort = { key: null, direction: 'asc' };
        if (transactionSearchInput) transactionSearchInput.value = '';
        renderTransactions(); saveToLocalStorage(); updateTotals(); checkValidationIssues();
      }catch(err){ errorsElement.textContent = `Error importing CSV: ${err.message}`; }
    };
    reader.readAsText(file);
  });

  exportCsvBtn.addEventListener('click', ()=>{
    if (!transactions.length) {
      errorsElement.textContent = 'No transactions available to export.';
      return;
    }
    const matches = getFilteredMatches();
    if (!matches.length) {
      errorsElement.textContent = 'Nothing to export with the current search or sort filters applied.';
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
    errorsElement.textContent = '';
  });

  /* ===== ABA builder, format preserved (120 chars, CRLF) ===== */
  function buildAba(h, rows){
    if (!h.user || !h.remitter) throw new Error("User Name and Remitter Name are required.");
    const apca = U.digitsOnly(h.apca || "");
    if (apca.length !== 6) throw new Error("APCA/User ID must be exactly 6 digits.");

    const proc = /^\d{6}$/.test(h.proc) ? h.proc : todayDDMMYY();

    // Type 0
    const t0 = "0"
      + U.padR('', 17)
      + U.padL(String(h.reel || '1'), 2)
      + U.padR((h.fi || '').slice(0,3), 3)
      + U.padR('', 7)
      + U.padR((h.user || '').slice(0,26), 26)
      + U.padL(apca, 6)
      + U.padR((h.desc || '').slice(0,12), 12)
      + U.padR(proc, 6)
      + U.padR('', 40);
    const lines = [ (t0 + ' '.repeat(120)).slice(0,120) ];

    let credits = 0, count = 0;

    // Type 1 credits
    rows.forEach((r, i) => {
      const n = i + 1;

      if (!r.lodgementRef || r.lodgementRef.trim() === '') {
        throw new Error(`Row ${n}: Lodgement Ref is required.`);
      }

      const bsbDigits  = U.digitsOnly(r.bsb || '');
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

      const bsb7    = normalizedBsb.padEnd(7, ' ').slice(0,7);
      const acct9   = U.padL(acctDigits, 9, ' ');
      const ind1    = ' ';
      const code2   = '53';
      const amt10   = U.padL(String(cents), 10);
      const name32  = U.padR((r.accountTitle || '').slice(0,32), 32);
      const lodg18  = U.padR((r.lodgementRef || '').slice(0,18), 18);
      const trbsb7  = (h.trace_bsb || '').padEnd(7, ' ').slice(0,7);
      const tracct9 = U.padL(U.digitsOnly(h.trace_acct || ''), 9, ' ');
      const remit16 = U.padR((h.remitter || '').slice(0,16), 16);
      const wtax8   = U.padL('0', 8);

      const t1 = "1"+bsb7+acct9+ind1+code2+amt10+name32+lodg18+trbsb7+tracct9+remit16+wtax8;
      lines.push((t1 + ' '.repeat(120)).slice(0,120));
      count++;
      credits += cents;
    });

    // Balancing debit (code 13), equals total credits
    const balAcctDigits = U.digitsOnly(getById('balance_acct').value || '');
    const balBsbDigits  = U.digitsOnly(getById('balance_bsb').value  || '');
    if (balBsbDigits.length !== 6) throw new Error("Balance BSB must be 6 digits.");
    const normalizedBalanceBsb = normalizeBSBStrict(getById('balance_bsb').value || '');
    if (!normalizedBalanceBsb) throw new Error("Balance BSB must be 6 digits.");
    if (balAcctDigits.length < 5 || balAcctDigits.length > 9) throw new Error("Balance Account must be 5–9 digits.");

    const balCents = credits;
    const b_bsb7    = normalizedBalanceBsb.padEnd(7, ' ').slice(0,7);
    const b_acct9   = U.padL(balAcctDigits, 9, ' ');
    const b_ind1    = ' ';
    const b_code2   = '13';
    const b_amt10   = U.padL(String(balCents), 10);
    const b_name32  = U.padR((getById('balance_title').value || '').slice(0,32), 32);
    const b_lodg18  = U.padR(`${(getById('desc').value || '').slice(0,12)}-${proc}`.slice(0,18), 18);
    const b_trbsb7  = (getById('trace_bsb').value || '').padEnd(7, ' ').slice(0,7);
    const b_tracct9 = U.padL(U.digitsOnly(getById('trace_acct').value || ''), 9, ' ');
    const b_remit16 = U.padR((getById('remitter').value || '').slice(0,16), 16);
    const b_wtax8   = U.padL('0', 8);

    const balT1 = "1"+b_bsb7+b_acct9+b_ind1+b_code2+b_amt10+b_name32+b_lodg18+b_trbsb7+b_tracct9+b_remit16+b_wtax8;
    lines.push((balT1 + ' '.repeat(120)).slice(0,120));
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
    lines.push((t7 + ' '.repeat(120)).slice(0,120));
    return lines.join('\r\n') + '\r\n';
  }

  function downloadAbaFile(content, remitter, procDate){
    const fileName = `${(remitter||'REM').replace(/\s+/g, '')}_${procDate}.aba`;
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return fileName;
  }

  document.getElementById('generate-aba').addEventListener('click', async () => {
    try {
      if (!transactions.length) {
        errorsElement.textContent = 'Add at least one transaction before generating.';
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
        
        // Show error modal instead of background message
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
          document.getElementById('blocked-account-ok')?.addEventListener('click', () => {
            document.getElementById('dynamic-modal')?.remove();
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
        
        // Show error modal for missing lodgement refs
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
          document.getElementById('missing-lodgement-ok')?.addEventListener('click', () => {
            document.getElementById('dynamic-modal')?.remove();
          });
        }, 100);
        return;
      }
      
      const metrics = getBatchMetrics();
      const duplicatesSummary = { sets: duplicateGroups.length, rows: duplicateIndexSet.size };
      const batchId = generateBatchId();

      const submission = await openSubmissionModal({ batchId, metrics, duplicates: duplicatesSummary });
      if (!submission) return; // cancelled by user

      const account = authState?.reviewer || {};
      const accountDept = account.department_code || '';
      const deptCode = accountDept || submission.deptOverride || '';
      if (!/^\d{2}$/.test(deptCode)) {
        errorsElement.textContent = 'Department Head is required before submitting.';
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
      metadata.submitted_by_email = account.email || null;
      metadata.submitted_by_role = account.role || null;
      if (account.display_name) metadata.submitted_by_name = account.display_name;
      metadata.submitted_at = submittedIso;

      const abaBase64 = toBase64(abaContent);
      const requestBody = {
        aba_content: abaBase64,
        pd_number: submission.pdNumber,
        metadata,
        checksum,
        suggested_file_name: `ABA_${deptCode}-${submission.pdNumber}.aba`
      };
      if (currentSubmissionRootId) {
        requestBody.root_batch_id = currentSubmissionRootId;
      }
      if (!accountDept && submission.deptOverride) {
        requestBody.dept_code = submission.deptOverride;
      }
      const response = await apiRequest('/batches', {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });

      errorsElement.textContent = '';
      showBatchStoredModal({
        code: response.code,
        fileName: response.file_name || `ABA_${response.code}.aba`,
        base64: abaBase64,
        metadata,
        batchId: response.batch_id
      });
      currentSubmissionRootId = null;
      readerContext = { rootBatchId: null, code: null };
      if (authState?.reviewer?.role === 'user') {
        myBatchesCache = [];
        loadMyBatches(true);
      }
    } catch (error) {
      errorsElement.textContent = `Error: ${error.message}`;
    }
  });

  loadFromLocalStorage();
  ["fi","apca","reel","trace_bsb","trace_acct","balance_bsb","balance_acct","balance_title","balance_txn_code"]
    .forEach(id => { const el = getById(id); if(el){ el.readOnly = true; el.classList.add('locked'); el.disabled = (id==='balance_txn_code'); } });

  retrieveBatchForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!hasRole('reviewer')) {
      ensureAuth('reviewer', () => {
        if (retrieveBatchForm?.requestSubmit) retrieveBatchForm.requestSubmit();
        else retrieveBatchForm?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      });
      retrieveBatchResult.innerHTML = '';
      return;
    }
    retrieveBatchError?.classList.add('hidden');
    retrieveBatchResult.innerHTML = '<p class="text-sm text-gray-500">Loading…</p>';
    const rawCode = (retrieveBatchCodeInput?.value || '').trim();
    if (!rawCode) {
      retrieveBatchError.textContent = 'Enter a batch code.';
      retrieveBatchError.classList.remove('hidden');
      retrieveBatchResult.innerHTML = '';
      return;
    }
    const digits = rawCode.replace(/\D/g, '');
    const formatted = ensureBatchCodeFormat(rawCode);
    const candidates = [];
    const addCandidate = (val) => { if (val && !candidates.includes(val)) candidates.push(val); };
    addCandidate(formatted);
    addCandidate(digits);
    addCandidate(rawCode);
    if (retrieveBatchCodeInput) retrieveBatchCodeInput.value = formatted || rawCode;

    let fetchedBatch = null;
    let usedCode = candidates[0];
    let lastError = null;
    for (const candidate of candidates) {
      const normalizedCandidate = normalizeBatchCode(candidate);
      if (!normalizedCandidate) continue;
      try {
        fetchedBatch = await apiRequest(`/batches/${normalizedCandidate.encoded}`);
        usedCode = normalizedCandidate.raw;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!fetchedBatch) {
      retrieveBatchError.textContent = lastError?.message || 'Batch not found.';
      retrieveBatchError.classList.remove('hidden');
      retrieveBatchResult.innerHTML = '';
      return;
    }

    currentRetrievedBatch = fetchedBatch;
    const reviews = fetchedBatch.batch_id ? await loadReviewsForBatch(fetchedBatch.batch_id) : [];
    retrieveBatchError?.classList.add('hidden');
    const normalizedCode = ensureBatchCodeFormat(fetchedBatch.code || usedCode);
    if (retrieveBatchCodeInput) retrieveBatchCodeInput.value = normalizedCode;
    currentRetrievedCode = normalizedCode;
    renderRetrievedBatch(fetchedBatch, reviews);
  });

  myBatchesSearchInput?.addEventListener('input', (e) => {
    myBatchesSearchTermRaw = e.target.value || '';
    myBatchesSearchTerm = myBatchesSearchTermRaw.trim().toLowerCase();
    renderMyBatches();
  });

  myBatchesRefreshBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    loadMyBatches(true);
  });

  myBatchesTbody?.addEventListener('click', (e) => {
    const target = e.target.closest('button[data-code]');
    if (!target) return;
    const { code } = target.dataset;
    openMyBatchDetail(code);
  });

  function getHeaderData(){
    const headerData = {};
    ['fi','reel','user','apca','desc','proc','trace_bsb','trace_acct','remitter'].forEach(id => { headerData[id] = getById(id).value; });
    headerData.balance_required = true;
    headerData.balance_txn_code = '13';
    headerData.balance_bsb   = getById('balance_bsb').value;
    headerData.balance_acct  = getById('balance_acct').value;
    headerData.balance_title = getById('balance_title').value;
    return headerData;
  }

  /* ===== ABA Reader ===== */
  function parseAndRenderAbaText(rawText, context){
    readerContext = context && typeof context === 'object'
      ? { rootBatchId: context.rootBatchId || null, code: context.code || null }
      : { rootBatchId: null, code: null };
    const text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    parsedTransactions = []; parsedHeader = null; parsedControl = null;
    readerTbody.innerHTML = ''; readerErrors.textContent = '';
    if (readerDuplicateSummary) { readerDuplicateSummary.textContent = ''; readerDuplicateSummary.classList.add('hidden'); }

  let txCounter = 0; // transaction display counter starting at 1
  let lastDebitBalance = null; // capture the balancing debit (code 13)
    lines.forEach((raw, idx)=>{
      const line = raw.padEnd(120, ' ').slice(0,120);
      const type = line[0];
      if(!['0','1','7'].includes(type)){
        throw new Error(`Line ${idx+1}: Unknown record type '${type}'.`);
      }
      if(type==='0'){
        parsedHeader = {
          reel:  line.slice(18,20).trim(),
          fi:    line.slice(20,23).trim(),
          user:  line.slice(30,56).trimEnd(),
          apca:  line.slice(56,62).trim(),
          desc:  line.slice(62,74).trimEnd(),
          proc:  line.slice(74,80).trim(),
        };
      } else if(type==='1'){
        // Detail per ABA spec we generate
        const bsb7     = line.slice(1,8);
        const acct9    = line.slice(8,17);
        const code2    = line.slice(18,20);
        const amt10    = line.slice(20,30);
        const name32   = line.slice(30,62);
        const lodg18   = line.slice(62,80);
        const trbsb7   = line.slice(80,87);
        const tracct9  = line.slice(87,96);

        const cents = parseInt(amt10.trim() || '0', 10) || 0; // keep integer cents

        parsedTransactions.push({
          line: (++txCounter),
          bsb: bsb7.trim(),
          account: acct9.trim(),
          amount: (cents/100).toFixed(2),  // for display
          cents,                            // for control maths
          accountTitle: name32.trimEnd(),
          lodgementRef: lodg18.trimEnd(),
          txnCode: code2.trim(),
          trace_bsb: trbsb7.trim(),
          trace_acct: tracct9.trim()
        });
        // Capture balancing debit details (code 13)
        if (code2.trim() === '13') {
          lastDebitBalance = {
            bsb: bsb7.trim(),
            account: acct9.trim(),
            title: name32.trimEnd()
          };
        }
      } else if(type==='7'){
        parsedControl = {
          net:     parseInt(line.slice(20,30).trim()||'0',10)||0,
          credits: parseInt(line.slice(30,40).trim()||'0',10)||0,
          debits:  parseInt(line.slice(40,50).trim()||'0',10)||0,
          count:   parseInt(line.slice(74,80).trim()||'0',10)||0,
        };
      }
    });

    // Populate header/control panels
    if(parsedHeader){
      rFI.textContent = parsedHeader.fi || '';
      rUser.textContent = parsedHeader.user || '';
      rAPCA.textContent = parsedHeader.apca || '';
      rDesc.textContent = parsedHeader.desc || '';
      rProc.textContent = parsedHeader.proc || '';
      rReel.textContent = parsedHeader.reel || '';
    }
    if(parsedControl){
      rNet.textContent     = U.money(parsedControl.net);
      rCredits.textContent = U.money(parsedControl.credits);
      rDebits.textContent  = U.money(parsedControl.debits);
      rCount.textContent   = String(parsedControl.count);
    }

    // Show balancing account details and match preset name
    if (rBalPreset && rBalRow && rBalAcctRow && rBalBsb && rBalAcct) {
      let matchedPreset = '';
      if (lastDebitBalance) {
        try {
          const entries = Object.entries(HEADER_PRESETS || {});
          for (const [name, preset] of entries) {
            const pBsb = normalizeBSBStrict(preset?.balance_bsb || '') || '';
            const pAcct = (preset?.balance_acct || '').trim();
            if (pBsb && pAcct && pBsb === lastDebitBalance.bsb && pAcct === lastDebitBalance.account) {
              matchedPreset = name;
              break;
            }
          }
        } catch (_) { /* ignore */ }
      }
      if (matchedPreset) {
        rBalPreset.textContent = matchedPreset;
        rBalRow.classList.remove('hidden');
        // Format and show the account underneath
        const bsbFormatted = normalizeBSBStrict(lastDebitBalance?.bsb || '') || (lastDebitBalance?.bsb || '');
        const acctDigits = U.digitsOnly(lastDebitBalance?.account || '');
        rBalBsb.textContent = bsbFormatted;
        rBalAcct.textContent = acctDigits;
        rBalAcctRow.classList.remove('hidden');
      } else {
        rBalPreset.textContent = '';
        rBalRow.classList.add('hidden');
        rBalBsb.textContent = '';
        rBalAcct.textContent = '';
        rBalAcctRow.classList.add('hidden');
      }
    }

    // Render transactions
    if(parsedTransactions.length===0){ readerTbody.innerHTML = `<tr><td colspan="9" class="text-center py-3 text-gray-500">No Type 1 records found.</td></tr>`; }
    else {
      // Duplicate highlighting inside Reader
      const dupMap = new Map();
      const dupKey = (t) => `${normalizeBSBStrict(t.bsb) || t.bsb}|${U.digitsOnly(t.account)}|${(parseFloat(t.amount)||0).toFixed(2)}|${String(t.lodgementRef||'').trim().toLowerCase()}`;
      parsedTransactions.forEach((t, i) => {
        const key = dupKey(t);
        if (!key) return;
        if (!dupMap.has(key)) dupMap.set(key, []);
        dupMap.get(key).push(i);
      });
      const duplicateIndexes = new Set();
      let duplicateSets = 0, duplicateRows = 0;
      dupMap.forEach((idxs) => {
        if (idxs.length > 1) {
          duplicateSets++;
          duplicateRows += idxs.length;
          idxs.forEach(i => duplicateIndexes.add(i));
        }
      });

      const frag = document.createDocumentFragment();
      parsedTransactions.forEach((pt, idx)=>{
        const tr = document.createElement('tr');
        const isDup = duplicateIndexes.has(idx);
        tr.className = (isDup ? 'duplicate-row ' : '') + 'bg-white border-b hover:bg-gray-50';
        tr.innerHTML = `
          <td class="p-2 border-r border-gray-300">${pt.line}${isDup ? ' <span class="duplicate-badge">dup</span>' : ''}</td>
          <td class="p-2 border-r border-gray-300">${pt.bsb}</td>
          <td class="p-2 border-r border-gray-300">${pt.account}</td>
          <td class="p-2 border-r border-gray-300 text-right">${U.money(pt.cents||0)}</td>
          <td class="p-2 border-r border-gray-300">${pt.accountTitle}</td>
          <td class="p-2 border-r border-gray-300">${pt.lodgementRef}</td>
          <td class="p-2 border-r border-gray-300">${pt.txnCode}</td>
          <td class="p-2 border-r border-gray-300">${pt.trace_bsb}</td>
          <td class="p-2 border-r border-gray-300">${pt.trace_acct}</td>
        `;
        frag.appendChild(tr);
      });
      readerTbody.innerHTML = ''; readerTbody.appendChild(frag);

      if (readerDuplicateSummary) {
        if (duplicateSets > 0) {
          readerDuplicateSummary.textContent = `Duplicate sets: ${duplicateSets} • Rows: ${duplicateRows}`;
          readerDuplicateSummary.classList.remove('hidden');
        } else {
          readerDuplicateSummary.textContent = '';
          readerDuplicateSummary.classList.add('hidden');
        }
      }
    }

    // Enable load button if there are transactions
    btnLoadIntoGenerator.disabled = parsedTransactions.length===0;

    // Integrity check: compare only credit records to Control credits, integer cents
    const sumCredits = parsedTransactions
      .filter(t => CREDIT_CODE_SET.has(String(t.txnCode)))
      .reduce((a, t) => a + (t.cents || 0), 0);

    if (parsedControl && typeof parsedControl.credits === 'number' && sumCredits !== parsedControl.credits) {
      readerErrors.textContent =
        `Warning, credit sum ${U.money(sumCredits)} does not match Control credits ${U.money(parsedControl.credits)}.`;
    } else {
      readerErrors.textContent = '';
    }
  }

  // Programmatic open into Reader from archive/retrieval
  function openBatchInReader(batch){
    try {
      let content = '';
      if (batch?.file_base64) {
        content = fromBase64(batch.file_base64);
      } else {
        const meta = batch?.transactions || {};
        const payload = meta.payload;
        if (payload && Array.isArray(payload.transactions) && payload.header) {
          content = buildAbaFromHeader(payload.header, payload.transactions);
        } else {
          throw new Error('No file available and no payload to reconstruct.');
        }
      }
  setTab('reader');
  parseAndRenderAbaText(content, { rootBatchId: batch?.root_batch_id || null, code: batch?.code || null });
    } catch (err) {
      setTab('reader');
      readerErrors.textContent = err?.message || 'Unable to open batch in Reader.';
      readerTbody.innerHTML = '';
      btnLoadIntoGenerator.disabled = true;
      readerContext = { rootBatchId: null, code: null };
    }
  }

  btnOpenABA.onclick = ()=>abaFileInput.click();
  btnClearReader?.addEventListener('click', () => {
    clearReaderView();
  });
  abaFileInput.onchange = (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev)=>{
      try{
        parseAndRenderAbaText(ev.target.result);
      } catch(err){
        readerErrors.textContent = `Error reading ABA: ${err.message}`;
        readerTbody.innerHTML = '';
        btnLoadIntoGenerator.disabled = true;
      }
    };
    reader.readAsText(file);
  };

  // Load only credits into generator, do not touch headers
  btnLoadIntoGenerator.onclick = ()=>{
    if(parsedTransactions.length===0) return;
    currentSubmissionRootId = readerContext.rootBatchId || null;
    const creditOnly = parsedTransactions.filter(t => CREDIT_CODE_SET.has(String(t.txnCode)));

    transactions = creditOnly.map(t => ({
      bsb: t.bsb,
      account: t.account,
      amount: parseFloat(t.amount) || 0,
      accountTitle: t.accountTitle,
      lodgementRef: t.lodgementRef,
      txnCode: '53',
      withholdingCents: null
    }));


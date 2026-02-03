/**
 * Tab Management Module
 * Handles tab switching and role-based visibility
 */

import { appState } from '../state/app-state.js';
import { ROLE_ORDER } from '../constants.js';
import { getById } from '../utils/dom.js';

// Tab and panel elements (will be initialized)
let tabs = {};
let panels = {};

function resolveBankingNavButtons() {
  if (typeof window !== 'undefined' && Array.isArray(window.bankingNavButtons) && window.bankingNavButtons.length) {
    return window.bankingNavButtons;
  }
  const buttons = Array.from(document.querySelectorAll('.banking-nav-btn[data-banking-section]'));
  if (typeof window !== 'undefined') {
    window.bankingNavButtons = buttons;
  }
  return buttons;
}

function resolveBankingPanels() {
  if (typeof window !== 'undefined' && Array.isArray(window.bankingPanels) && window.bankingPanels.length) {
    return window.bankingPanels;
  }
  const sectionPanels = Array.from(document.querySelectorAll('.banking-panel[data-banking-section]'));
  if (typeof window !== 'undefined') {
    window.bankingPanels = sectionPanels;
  }
  return sectionPanels;
}

/**
 * Initialize tabs module with DOM elements
 */
export function initTabs(elements = {}) {
  tabs = {
    gen: elements.tabGen || getById('tab-generator'),
    my: elements.tabMy || getById('tab-my'),
    reader: elements.tabReader || getById('tab-reader'),
    banking: elements.tabBanking || getById('tab-banking'),
    saas: elements.tabSaas || getById('tab-saas'),
    reviewer: elements.tabReviewer || getById('tab-reviewer'),
    admin: elements.tabAdmin || getById('tab-admin')
  };
  
  panels = {
    gen: elements.panelGen || getById('panel-generator'),
    my: elements.panelMy || getById('panel-my'),
    reader: elements.panelReader || getById('panel-reader'),
    banking: elements.panelBanking || getById('panel-banking'),
    saas: elements.panelSaas || getById('panel-saas'),
    reviewer: elements.panelReviewer || getById('panel-reviewer'),
    admin: elements.panelAdmin || getById('panel-admin')
  };

  // Attach click event listeners to tabs
  if (tabs.gen) {
    tabs.gen.style.cursor = 'pointer';
    tabs.gen.addEventListener('click', (e) => {
      e.preventDefault();
      setTab('gen');
    });
  }
  if (tabs.my) {
    tabs.my.style.cursor = 'pointer';
    tabs.my.addEventListener('click', (e) => {
      e.preventDefault();
      setTab('my');
    });
  }
  if (tabs.reader) {
    tabs.reader.style.cursor = 'pointer';
    tabs.reader.addEventListener('click', (e) => {
      e.preventDefault();
      setTab('reader');
    });
  }
  if (tabs.banking) {
    tabs.banking.style.cursor = 'pointer';
    tabs.banking.addEventListener('click', (e) => {
      e.preventDefault();
      setTab('banking');
    });
  }
  if (tabs.saas) {
    tabs.saas.style.cursor = 'pointer';
    tabs.saas.addEventListener('click', (e) => {
      e.preventDefault();
      setTab('saas');
    });
  }
  if (tabs.reviewer) {
    tabs.reviewer.style.cursor = 'pointer';
    tabs.reviewer.addEventListener('click', (e) => {
      e.preventDefault();
      setTab('reviewer');
    });
  }
  if (tabs.admin) {
    tabs.admin.style.cursor = 'pointer';
    tabs.admin.addEventListener('click', (e) => {
      e.preventDefault();
      setTab('admin');
    });
  }
}

/**
 * Toggle tab and panel visibility
 */
export function toggleTabAndPanel(tabEl, panelEl, show) {
  if (!tabEl || !panelEl) return;
  if (show) {
    tabEl.classList.remove('hidden');
  } else {
    tabEl.classList.add('hidden');
    panelEl.classList.add('hidden');
  }
}

/**
 * Update role-based tab visibility
 */
export function updateRoleTabs(role, active) {
  const rank = ROLE_ORDER[role] ?? 0;
  const showGen = active;
  const showMy = active;
  const showReader = active;
  const showBankingTab = active && rank >= ROLE_ORDER.banking;
  const showSaasTab = active && rank >= ROLE_ORDER.reviewer;
  const showReviewerTab = active && rank >= ROLE_ORDER.reviewer;
  const showAdminTab = active && rank >= ROLE_ORDER.admin;

  toggleTabAndPanel(tabs.gen, panels.gen, showGen);
  toggleTabAndPanel(tabs.my, panels.my, showMy);
  toggleTabAndPanel(tabs.reader, panels.reader, showReader);
  toggleTabAndPanel(tabs.banking, panels.banking, showBankingTab);
  toggleTabAndPanel(tabs.saas, panels.saas, showSaasTab);
  toggleTabAndPanel(tabs.reviewer, panels.reviewer, showReviewerTab);
  toggleTabAndPanel(tabs.admin, panels.admin, showAdminTab);

  const allowedTabs = [];
  if (showGen) allowedTabs.push('gen');
  if (showMy) allowedTabs.push('my');
  if (showReader) allowedTabs.push('reader');
  if (showBankingTab) allowedTabs.push('banking');
  if (showSaasTab) allowedTabs.push('saas');
  if (showReviewerTab) allowedTabs.push('reviewer');
  if (showAdminTab) allowedTabs.push('admin');
  
  const currentTab = appState.getCurrentTab();
  if (!allowedTabs.includes(currentTab)) {
    const fallback = allowedTabs.includes('gen') ? 'gen' : (allowedTabs[0] || 'gen');
    setTab(fallback);
  }
}

/**
 * Set active tab
 */
export function setTab(which) {
  // Check if tab is available
  if (!tabs[which] || tabs[which]?.classList.contains('hidden')) {
    which = 'gen';
  }
  
  // Remove active class from all tabs
  Object.values(tabs).forEach(tab => {
    if (tab) tab.classList.remove('tab-active');
  });
  
  // Hide all panels
  Object.values(panels).forEach(panel => {
    if (panel) panel.classList.add('hidden');
  });
  
  // Show selected tab and panel
  switch(which) {
    case 'reader':
      tabs.reader?.classList.add('tab-active');
      panels.reader?.classList.remove('hidden');
      // Reader doesn't need to load data - user loads files manually
      break;
    case 'banking':
      tabs.banking?.classList.add('tab-active');
      panels.banking?.classList.remove('hidden');
      // Re-initialize banking navigation when tab is shown
      // Always start with converter (first tool) when opening banking tab
      appState.setCurrentBankingSection('converter');
      if (typeof window.initBanking === 'function') {
        window.initBanking();
      } else if (typeof window.setBankingSection === 'function') {
        window.setBankingSection('converter');
      }
      break;
    case 'saas':
      tabs.saas?.classList.add('tab-active');
      panels.saas?.classList.remove('hidden');
      if (typeof window.loadSaasSync === 'function') {
        window.loadSaasSync();
      }
      break;
    case 'reviewer':
      tabs.reviewer?.classList.add('tab-active');
      panels.reviewer?.classList.remove('hidden');
      if (typeof window.loadReviewerArchives === 'function') {
        window.loadReviewerArchives();
      }
      break;
    case 'admin':
      tabs.admin?.classList.add('tab-active');
      panels.admin?.classList.remove('hidden');
      
      // Ensure admin-content is visible if user has admin role
      const adminContent = document.getElementById('admin-content');
      const adminLocked = document.getElementById('admin-locked');
      if (adminContent && adminLocked) {
        const reviewer = appState.getReviewer();
        const hasAdminRole = reviewer?.role === 'admin';
        if (hasAdminRole) {
          adminContent.classList.remove('hidden');
          adminLocked.classList.add('hidden');
        } else {
          adminContent.classList.add('hidden');
          adminLocked.classList.remove('hidden');
        }
      }
      if (typeof window.loadAdminDashboard === 'function') {
        window.loadAdminDashboard();
      }
      break;
    case 'my':
      tabs.my?.classList.add('tab-active');
      panels.my?.classList.remove('hidden');
      if (typeof window.loadMyBatches === 'function') {
        window.loadMyBatches();
      }
      break;
    case 'gen':
    default:
      tabs.gen?.classList.add('tab-active');
      panels.gen?.classList.remove('hidden');
      // Generator doesn't need to load data - it's always ready
      break;
  }
  
  appState.setCurrentTab(which);
}

/**
 * Set banking section
 */
export function setBankingSection(section = 'converter') {
  appState.setCurrentBankingSection(section);

  const navButtons = resolveBankingNavButtons();
  navButtons.forEach((btn) => {
    if (!btn?.dataset) return;
    const active = btn.dataset.bankingSection === section;
    btn.classList.toggle('bg-amber-100', active);
    btn.classList.toggle('text-amber-900', active);
    btn.classList.toggle('shadow-sm', active);
    btn.classList.toggle('text-gray-700', !active);
  });

  const sectionPanels = resolveBankingPanels();
  sectionPanels.forEach((panel) => {
    if (!panel?.dataset) return;
    const shouldShow = panel.dataset.bankingSection === section;
    
    // Ensure all panels use absolute positioning for consistent top alignment
    if (!panel.classList.contains('absolute')) {
      panel.classList.add('absolute', 'top-0', 'left-0', 'right-0');
    }
    
    // Toggle visibility - use hidden class (which sets display: none)
    if (shouldShow) {
      panel.classList.remove('hidden');
      // Clear any inline display styles that might interfere
      panel.style.display = '';
      panel.style.visibility = '';
    } else {
      panel.classList.add('hidden');
    }
  });
}

// Export for global access during migration
window.setTab = setTab;
window.toggleTabAndPanel = toggleTabAndPanel;
window.updateRoleTabs = updateRoleTabs;
window.setBankingSection = setBankingSection;
window.initTabs = initTabs;


/**
 * Reader Module
 * Handles ABA file parsing, display, and loading into generator
 */

import { appState } from '../../state/app-state.js';
import { getById } from '../../utils/dom.js';
import { setTab } from '../../core/tabs.js';
import {
  normalizeBSBStrict,
  formatMoney,
  fromBase64,
  buildAbaFromHeader
} from '../../utils/index.js';
import { CREDIT_CODE_SET, HEADER_PRESETS } from '../../constants.js';

// Module state
let parsedTransactions = [];
let parsedHeader = null;
let parsedControl = null;

// DOM elements (will be initialized)
let readerErrors;
let readerTbody;
let rFI, rUser, rAPCA, rDesc, rProc, rReel;
let rNet, rCredits, rDebits, rCount;
let rBalPreset, rBalRow, rBalAcctRow, rBalBsb, rBalAcct;
let abaFileInput;
let btnOpenABA;
let btnClearReader;
let btnLoadIntoGenerator;
let readerDuplicateSummary;

// Utility object
const U = {
  digitsOnly: (s) => String(s || '').replace(/[^0-9]/g, ''),
  money: formatMoney
};

/**
 * Clear reader view
 */
function clearReaderView() {
  parsedTransactions = [];
  parsedHeader = null;
  parsedControl = null;
  appState.setReaderContext({ rootBatchId: null, code: null });
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

/**
 * Parse and render ABA text
 */
function parseAndRenderAbaText(rawText, context) {
  const readerContext = context && typeof context === 'object'
    ? { rootBatchId: context.rootBatchId || null, code: context.code || null }
    : { rootBatchId: null, code: null };
  appState.setReaderContext(readerContext);
  
  const text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  parsedTransactions = [];
  parsedHeader = null;
  parsedControl = null;
  if (readerTbody) readerTbody.innerHTML = '';
  if (readerErrors) readerErrors.textContent = '';
  if (readerDuplicateSummary) {
    readerDuplicateSummary.textContent = '';
    readerDuplicateSummary.classList.add('hidden');
  }

  let txCounter = 0;
  let lastDebitBalance = null;
  
  lines.forEach((raw, idx) => {
    const line = raw.padEnd(120, ' ').slice(0, 120);
    const type = line[0];
    if (!['0', '1', '7'].includes(type)) {
      throw new Error(`Line ${idx + 1}: Unknown record type '${type}'.`);
    }
    if (type === '0') {
      parsedHeader = {
        reel: line.slice(18, 20).trim(),
        fi: line.slice(20, 23).trim(),
        user: line.slice(30, 56).trimEnd(),
        apca: line.slice(56, 62).trim(),
        desc: line.slice(62, 74).trimEnd(),
        proc: line.slice(74, 80).trim(),
      };
    } else if (type === '1') {
      const bsb7 = line.slice(1, 8);
      const acct9 = line.slice(8, 17);
      const code2 = line.slice(18, 20);
      const amt10 = line.slice(20, 30);
      const name32 = line.slice(30, 62);
      const lodg18 = line.slice(62, 80);
      const trbsb7 = line.slice(80, 87);
      const tracct9 = line.slice(87, 96);

      const cents = parseInt(amt10.trim() || '0', 10) || 0;

      parsedTransactions.push({
        line: (++txCounter),
        bsb: bsb7.trim(),
        account: acct9.trim(),
        amount: (cents / 100).toFixed(2),
        cents,
        accountTitle: name32.trimEnd(),
        lodgementRef: lodg18.trimEnd(),
        txnCode: code2.trim(),
        trace_bsb: trbsb7.trim(),
        trace_acct: tracct9.trim()
      });
      
      if (code2.trim() === '13') {
        lastDebitBalance = {
          bsb: bsb7.trim(),
          account: acct9.trim(),
          title: name32.trimEnd()
        };
      }
    } else if (type === '7') {
      parsedControl = {
        net: parseInt(line.slice(20, 30).trim() || '0', 10) || 0,
        credits: parseInt(line.slice(30, 40).trim() || '0', 10) || 0,
        debits: parseInt(line.slice(40, 50).trim() || '0', 10) || 0,
        count: parseInt(line.slice(74, 80).trim() || '0', 10) || 0,
      };
    }
  });

  // Populate header/control panels
  if (parsedHeader) {
    if (rFI) rFI.textContent = parsedHeader.fi || '';
    if (rUser) rUser.textContent = parsedHeader.user || '';
    if (rAPCA) rAPCA.textContent = parsedHeader.apca || '';
    if (rDesc) rDesc.textContent = parsedHeader.desc || '';
    if (rProc) rProc.textContent = parsedHeader.proc || '';
    if (rReel) rReel.textContent = parsedHeader.reel || '';
  }
  if (parsedControl) {
    if (rNet) rNet.textContent = U.money(parsedControl.net);
    if (rCredits) rCredits.textContent = U.money(parsedControl.credits);
    if (rDebits) rDebits.textContent = U.money(parsedControl.debits);
    if (rCount) rCount.textContent = String(parsedControl.count);
  }

  // Show balancing account details
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
  if (parsedTransactions.length === 0) {
    if (readerTbody) {
      readerTbody.innerHTML = `<tr><td colspan="9" class="text-center py-3 text-gray-500">No Type 1 records found.</td></tr>`;
    }
  } else {
    // Duplicate highlighting
    const dupMap = new Map();
    const dupKey = (t) => `${normalizeBSBStrict(t.bsb) || t.bsb}|${U.digitsOnly(t.account)}|${(parseFloat(t.amount) || 0).toFixed(2)}|${String(t.lodgementRef || '').trim().toLowerCase()}`;
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
    parsedTransactions.forEach((pt, idx) => {
      const tr = document.createElement('tr');
      const isDup = duplicateIndexes.has(idx);
      tr.className = (isDup ? 'duplicate-row ' : '') + 'bg-white border-b hover:bg-gray-50';
      tr.innerHTML = `
        <td class="p-2 border-r border-gray-300">${pt.line}${isDup ? ' <span class="duplicate-badge">dup</span>' : ''}</td>
        <td class="p-2 border-r border-gray-300">${pt.bsb}</td>
        <td class="p-2 border-r border-gray-300">${pt.account}</td>
        <td class="p-2 border-r border-gray-300 text-right">${U.money(pt.cents || 0)}</td>
        <td class="p-2 border-r border-gray-300">${pt.accountTitle}</td>
        <td class="p-2 border-r border-gray-300">${pt.lodgementRef}</td>
        <td class="p-2 border-r border-gray-300">${pt.txnCode}</td>
        <td class="p-2 border-r border-gray-300">${pt.trace_bsb}</td>
        <td class="p-2 border-r border-gray-300">${pt.trace_acct}</td>
      `;
      frag.appendChild(tr);
    });
    if (readerTbody) {
      readerTbody.innerHTML = '';
      readerTbody.appendChild(frag);
    }

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

  // Enable load button
  if (btnLoadIntoGenerator) {
    btnLoadIntoGenerator.disabled = parsedTransactions.length === 0;
  }

  // Integrity check
  const sumCredits = parsedTransactions
    .filter(t => CREDIT_CODE_SET.has(String(t.txnCode)))
    .reduce((a, t) => a + (t.cents || 0), 0);

  if (parsedControl && typeof parsedControl.credits === 'number' && sumCredits !== parsedControl.credits) {
    if (readerErrors) {
      readerErrors.textContent = `Warning, credit sum ${U.money(sumCredits)} does not match Control credits ${U.money(parsedControl.credits)}.`;
    }
  } else {
    if (readerErrors) readerErrors.textContent = '';
  }
}

/**
 * Open batch in reader
 */
export function openBatchInReader(batch) {
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
    if (readerErrors) {
      readerErrors.textContent = err?.message || 'Unable to open batch in Reader.';
    }
    if (readerTbody) readerTbody.innerHTML = '';
    if (btnLoadIntoGenerator) btnLoadIntoGenerator.disabled = true;
    appState.setReaderContext({ rootBatchId: null, code: null });
  }
}

/**
 * Initialize reader module
 */
export function initReader() {
  // Initialize DOM elements
  readerErrors = getById('reader-errors');
  readerTbody = getById('reader-tbody');
  rFI = getById('r-fi');
  rUser = getById('r-user');
  rAPCA = getById('r-apca');
  rDesc = getById('r-desc');
  rProc = getById('r-proc');
  rReel = getById('r-reel');
  rNet = getById('r-net');
  rCredits = getById('r-credits');
  rDebits = getById('r-debits');
  rCount = getById('r-count');
  rBalPreset = getById('r-bal-preset');
  rBalRow = getById('r-bal-row');
  rBalAcctRow = getById('r-bal-acct-row');
  rBalBsb = getById('r-bal-bsb');
  rBalAcct = getById('r-bal-acct');
  abaFileInput = getById('aba-file-input');
  btnOpenABA = getById('btn-load-aba');
  btnClearReader = getById('btn-clear-reader');
  btnLoadIntoGenerator = getById('btn-load-into-generator');
  readerDuplicateSummary = getById('reader-duplicate-summary');

  // Event listeners
  if (btnOpenABA) {
    btnOpenABA.onclick = () => abaFileInput?.click();
  }
  
  if (btnClearReader) {
    btnClearReader.addEventListener('click', () => {
      clearReaderView();
    });
  }
  
  if (abaFileInput) {
    abaFileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          parseAndRenderAbaText(ev.target.result);
        } catch (err) {
          if (readerErrors) {
            readerErrors.textContent = `Error reading ABA: ${err.message}`;
          }
          if (readerTbody) readerTbody.innerHTML = '';
          if (btnLoadIntoGenerator) btnLoadIntoGenerator.disabled = true;
        }
      };
      reader.readAsText(file);
    };
  }

  // Load only credits into generator
  if (btnLoadIntoGenerator) {
    btnLoadIntoGenerator.onclick = () => {
      if (parsedTransactions.length === 0) return;
      
      // Import generator functions dynamically
      import('../generator/index.js').then((generatorModule) => {
        const readerContext = appState.getReaderContext();
        if (typeof generatorModule.setCurrentSubmissionRootId === 'function') {
          generatorModule.setCurrentSubmissionRootId(readerContext.rootBatchId || null);
        }
        
        const creditOnly = parsedTransactions.filter(t => CREDIT_CODE_SET.has(String(t.txnCode)));
        const newTransactions = creditOnly.map(t => ({
          bsb: t.bsb,
          account: t.account,
          amount: parseFloat(t.amount) || 0,
          accountTitle: t.accountTitle,
          lodgementRef: t.lodgementRef,
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
        setTab('gen');
      }).catch((err) => {
        console.error('Failed to load generator module:', err);
      });
    };
  }
}

// Export for global access during migration
window.openBatchInReader = openBatchInReader;
window.parseAndRenderAbaText = parseAndRenderAbaText;


/**
 * Banking Module
 * Handles BAI2 file conversion and validation
 */

import { getById, escapeHtml } from '../../utils/dom.js';
import { setBankingSection } from '../../core/tabs.js';

// DOM elements
let baiMetadataForm;
let baiSenderInput;
let baiReceiverInput;
let baiFileIdInput;
let baiGroupStatusSelect;
let baiAccountInput;
let baiCurrencyInput;
let baiCreditCodeInput;
let baiDebitCodeInput;
let baiSummaryCodeInput;
let baiDetailFundsInput;
let baiCsvInput;
let baiSelectCsvBtn;
let baiGenerateBtn;
let baiDownloadBtn;
let baiCopyBtn;
let baiFileInfo;
let baiError;
let baiOutput;
let baiSummary;
let baiCheckInput;
let baiCheckSelectBtn;
let baiCheckText;
let baiCheckRunBtn;
let baiCheckSummary;
let baiCheckIssues;
let baiCheckError;
let baiCheckFileInfo;
let baiCheckPreview;
let baiCheckSanitizeBtn;
let baiCheckDownloadBtn;
let baiCheckSanitizeMsg;
let baiCheckClearBtn;
let bankingNavButtons;

// Module state
let baiCsvRawText = '';
let baiCsvFileName = '';
let baiCheckRawText = '';
let baiCheckFileName = '';
let baiSummaryBase = '';
let baiCheckParsedRecords = [];
let baiCheckIssueLines = new Set();
let baiCheckSanitizedText = '';

// Helper functions
function normalizeHeaderLabel(label) {
  return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseCsvLine(line) {
  const result = [];
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
    // Clear the input value after successful read to allow re-selecting the same file
    if (event?.target) event.target.value = '';
  };
  reader.onerror = () => {
    showBaiCheckError('Failed to read BAI2 file.');
    baiCheckRawText = '';
    baiCheckFileName = '';
    if (baiCheckFileInfo) baiCheckFileInfo.textContent = 'No file selected.';
    // Clear the input value even on error
    if (event?.target) event.target.value = '';
  };
  reader.readAsText(file);
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

export function initBanking() {
  // Initialize DOM elements
  baiMetadataForm = getById('bai-metadata-form');
  baiSenderInput = getById('bai-sender-id');
  baiReceiverInput = getById('bai-receiver-id');
  baiFileIdInput = getById('bai-file-id');
  baiGroupStatusSelect = getById('bai-group-status');
  baiAccountInput = getById('bai-account-number');
  baiCurrencyInput = getById('bai-currency');
  baiCreditCodeInput = getById('bai-credit-code');
  baiDebitCodeInput = getById('bai-debit-code');
  baiSummaryCodeInput = getById('bai-summary-code');
  baiDetailFundsInput = getById('bai-detail-funds');
  baiCsvInput = getById('bai-csv-input');
  baiSelectCsvBtn = getById('bai-select-csv');
  baiGenerateBtn = getById('bai-generate-btn');
  baiDownloadBtn = getById('bai-download-btn');
  baiCopyBtn = getById('bai-copy-btn');
  baiFileInfo = getById('bai-file-info');
  baiError = getById('bai-error');
  baiOutput = getById('bai-output');
  baiSummary = getById('bai-summary');
  baiCheckInput = getById('bai-check-input');
  baiCheckSelectBtn = getById('bai-check-select');
  baiCheckText = getById('bai-check-text');
  baiCheckRunBtn = getById('bai-check-run');
  baiCheckSummary = getById('bai-check-summary');
  baiCheckIssues = getById('bai-check-issues');
  baiCheckError = getById('bai-check-error');
  baiCheckFileInfo = getById('bai-check-file-info');
  baiCheckPreview = getById('bai-check-preview');
  baiCheckSanitizeBtn = getById('bai-check-sanitize');
  baiCheckDownloadBtn = getById('bai-check-download');
  baiCheckSanitizeMsg = getById('bai-check-sanitize-msg');
  baiCheckClearBtn = getById('bai-check-clear');
  // Use document-level event delegation for maximum reliability
  // This works even if elements are added/removed dynamically
  if (!window._bankingGlobalListener) {
    window._bankingGlobalListener = (event) => {
      // Only handle clicks on banking nav buttons
      const btn = event.target.closest?.('.banking-nav-btn[data-banking-section]');
      if (!btn) return;
      
      event.preventDefault();
      event.stopPropagation();
      
      const section = btn.dataset.bankingSection || 'converter';
      setBankingSection(section);
    };
    document.addEventListener('click', window._bankingGlobalListener, true); // Use capture phase
  }
  
  // Also try nav-level delegation as backup
  const bankingNav = document.querySelector('#panel-banking nav');
  if (bankingNav) {
    // Remove old listener if exists
    if (window._bankingNavListener) {
      bankingNav.removeEventListener('click', window._bankingNavListener);
    }
    // Create new listener
    window._bankingNavListener = (event) => {
      const btn = event.target.closest('.banking-nav-btn[data-banking-section]');
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      const section = btn.dataset.bankingSection || 'converter';
      setBankingSection(section);
    };
    bankingNav.addEventListener('click', window._bankingNavListener);
  }
  
  bankingNavButtons = Array.from(document.querySelectorAll('.banking-nav-btn[data-banking-section]'));
  window.bankingNavButtons = bankingNavButtons;
  window.bankingPanels = Array.from(document.querySelectorAll('.banking-panel[data-banking-section]'));

  // Ensure buttons are visible and clickable
  bankingNavButtons.forEach((btn) => {
    if (!btn) return;
    const styles = window.getComputedStyle(btn);
    
    // Force show button if it's hidden
    if (styles.display === 'none' || styles.visibility === 'hidden' || styles.opacity === '0') {
      btn.style.display = 'block';
      btn.style.visibility = 'visible';
      btn.style.opacity = '1';
    }
    
    // Ensure button is clickable
    btn.style.pointerEvents = 'auto';
    btn.style.cursor = 'pointer';
  });

  // Event Listeners - Remove old listeners first to prevent duplicates
  const oldClickListener = baiCheckSelectBtn?._clickListener;
  if (oldClickListener) {
    baiCheckSelectBtn?.removeEventListener('click', oldClickListener);
  }
  const oldChangeListener = baiCheckInput?._changeListener;
  if (oldChangeListener) {
    baiCheckInput?.removeEventListener('change', oldChangeListener);
  }
  
  // Create new listeners
  const clickListener = () => baiCheckInput?.click();
  const changeListener = handleBaiCheckFileSelection;
  
  // Store references for future cleanup
  if (baiCheckSelectBtn) baiCheckSelectBtn._clickListener = clickListener;
  if (baiCheckInput) baiCheckInput._changeListener = changeListener;
  
  // Attach listeners
  baiMetadataForm?.addEventListener('submit', (event) => event.preventDefault());
  baiSelectCsvBtn?.addEventListener('click', () => baiCsvInput?.click());
  baiCsvInput?.addEventListener('change', handleBaiCsvSelection);
  baiGenerateBtn?.addEventListener('click', handleGenerateBai);
  baiDownloadBtn?.addEventListener('click', downloadBaiFile);
  baiCopyBtn?.addEventListener('click', handleCopyBaiOutput);
  baiCheckSelectBtn?.addEventListener('click', clickListener);
  baiCheckInput?.addEventListener('change', changeListener);
  baiCheckRunBtn?.addEventListener('click', handleBaiCheckRun);
  baiCheckSanitizeBtn?.addEventListener('click', handleBaiCheckSanitize);
  baiCheckDownloadBtn?.addEventListener('click', handleBaiCheckDownload);
  baiCheckClearBtn?.addEventListener('click', handleBaiCheckClear);
  
  // Also attach direct listeners as backup (event delegation is primary)
  bankingNavButtons.forEach((btn) => {
    if (!btn) return;
    // Remove old listener if exists
    const oldListener = btn._bankingClickListener;
    if (oldListener) {
      btn.removeEventListener('click', oldListener);
    }
    // Create new listener
    const listener = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const section = btn.dataset?.bankingSection || 'converter';
      setBankingSection(section);
    };
    btn._bankingClickListener = listener;
    btn.addEventListener('click', listener);
  });

  // Initialize state - always start with converter (first tool)
  resetBaiCheckResults();
  setBankingSection('converter');
}

// Export for global access
window.initBanking = initBanking;


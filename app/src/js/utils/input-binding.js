/**
 * Input Binding Utilities
 * Handles BSB and amount input formatting
 */

const fmtAU = new Intl.NumberFormat("en-AU", { 
  style: "currency", 
  currency: "AUD", 
  minimumFractionDigits: 2, 
  maximumFractionDigits: 2 
});

function digits(s) { 
  return String(s || "").replace(/\D+/g, ""); 
}

function formatBSB(v) { 
  const d = digits(v).slice(0, 6); 
  return d.length <= 3 ? d : d.slice(0, 3) + "-" + d.slice(3); 
}

function parseNum(v) { 
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); 
  return isNaN(n) ? null : n; 
}

function to2(v) { 
  const n = parseNum(v); 
  return n === null ? null : n.toFixed(2); 
}

function formatDisplayCurrency(v) { 
  const n = parseNum(v); 
  return n === null ? v : fmtAU.format(n); 
}

function bindBSB(input) {
  if (!input || input.__bsbBound) return; 
  input.__bsbBound = true;
  if (!input.hasAttribute("pattern")) input.setAttribute("pattern", "\\d{3}-\\d{3}");
  input.setAttribute("inputmode", "numeric"); 
  input.setAttribute("autocomplete", "off");
  if (typeof window.normalizeBSBStrict === "function") {
    const strict = window.normalizeBSBStrict(input.value);
    input.value = strict || formatBSB(input.value);
  } else {
    input.value = formatBSB(input.value);
  }
  input.addEventListener("input", () => { input.value = formatBSB(input.value); });
  input.addEventListener("blur", () => { input.value = formatBSB(input.value); });
}

function bindAmount(input) {
  if (!input || input.__amtBound) return; 
  input.__amtBound = true;
  try { input.type = "text"; } catch (_) {}
  const rawInit = to2(input.value);
  if (rawInit !== null) { 
    input.dataset.raw = rawInit; 
    input.value = formatDisplayCurrency(rawInit); 
  }
  input.addEventListener("focus", () => {
    if (input.dataset && input.dataset.raw) input.value = input.dataset.raw;
    requestAnimationFrame(() => { 
      try { input.setSelectionRange(0, input.value.length); } 
      catch (_) { input.select?.(); } 
    });
    const onceMouseUp = (e) => { 
      e.preventDefault(); 
      input.removeEventListener("mouseup", onceMouseUp); 
    };
    input.addEventListener("mouseup", onceMouseUp);
  });
  function commit() {
    const raw = to2(input.value);
    if (raw !== null) {
      input.dataset.raw = raw;
      input.value = raw;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      setTimeout(() => { input.value = formatDisplayCurrency(raw); }, 0);
    }
  }
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => { 
    if (e.key === "Enter") { 
      e.preventDefault(); 
      input.blur(); 
    } 
  });
}

function idxByHeader(table, rx) {
  const ths = Array.from(table.querySelectorAll("thead th"));
  for (let i = 0; i < ths.length; i++) { 
    if (rx.test((ths[i].textContent || "").trim())) return i; 
  }
  return -1;
}

function processTable() {
  const table = document.querySelector("table"); 
  if (!table) return;
  const bsbIdx = idxByHeader(table, /(^|\s)bsb(\s|$)/i);
  let amtIdx = idxByHeader(table, /amount\s*\(|\bamount\b/i); 
  if (amtIdx === -1) amtIdx = 3;
  const rows = table.querySelectorAll("tbody tr");
  rows.forEach(tr => {
    const tds = tr.querySelectorAll("td");
    if (bsbIdx >= 0 && tds[bsbIdx]) {
      tds[bsbIdx].querySelectorAll("input,textarea").forEach(bindBSB);
    }
    if (tds[amtIdx]) {
      tds[amtIdx].classList.add("text-right");
      const inp = tds[amtIdx].querySelector("input,textarea");
      if (inp) { 
        inp.classList.add("text-right"); 
        bindAmount(inp); 
      }
    }
  });
}

/**
 * Initialize input binding for BSB and amount inputs
 */
export function initInputBinding() {
  document.querySelectorAll('input[id*="bsb" i]').forEach(bindBSB);
  processTable();
  const obs = new MutationObserver((muts) => {
    let changed = false;
    muts.forEach(m => { 
      m.addedNodes.forEach(n => { 
        if (n.nodeType === 1 && (n.matches?.('tr') || n.querySelector?.('tr'))) { 
          changed = true; 
        } 
      }); 
    });
    if (changed) processTable();
  });
  obs.observe(document.body, { childList: true, subtree: true });
}


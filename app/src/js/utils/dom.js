/**
 * DOM Utility Functions
 * DOM manipulation helpers
 */

/**
 * Get element by ID (shorthand)
 */
export function getById(id) {
  return document.getElementById(id);
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show element
 */
export function showElement(element) {
  if (element) {
    element.classList.remove('hidden');
  }
}

/**
 * Hide element
 */
export function hideElement(element) {
  if (element) {
    element.classList.add('hidden');
  }
}

/**
 * Toggle element visibility
 */
export function toggleElement(element, show) {
  if (element) {
    if (show) {
      element.classList.remove('hidden');
    } else {
      element.classList.add('hidden');
    }
  }
}

/**
 * Set element text content safely
 */
export function setText(element, text) {
  if (element) {
    element.textContent = text || '';
  }
}

/**
 * Set element HTML content safely (escaped)
 */
export function setHtml(element, html) {
  if (element) {
    element.innerHTML = html || '';
  }
}


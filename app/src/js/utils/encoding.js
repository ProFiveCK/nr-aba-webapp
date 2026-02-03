/**
 * Encoding/Decoding Utility Functions
 * Base64, file downloads, etc.
 */

/**
 * Encode string to base64
 */
export function toBase64(str) {
  return window.btoa(unescape(encodeURIComponent(str)));
}

/**
 * Decode base64 to string
 */
export function fromBase64(base64) {
  return decodeURIComponent(escape(window.atob(base64)));
}

/**
 * Download a base64 file
 */
export function downloadBase64File(base64, fileName, mime = 'application/octet-stream') {
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

/**
 * Compute SHA-256 hash of text and return as hex string
 */
export async function sha256Hex(text) {
  if (!window.crypto?.subtle) return null;
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}


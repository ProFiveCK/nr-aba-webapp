/**
 * Opens a printable report in a new window. The caller supplies a title and the
 * inner HTML (typically a table), and this wraps it in minimal print styling.
 */
export function printReport(title: string, bodyHtml: string, targetWindow?: Window): void {
  const win = targetWindow || window.open('', '_blank', 'noopener,width=1000,height=800');
  if (!win) return;
  const styles = `
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 28px; color: #111827; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .meta { color: #6b7280; font-size: 12px; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 600; }
    .right { text-align: right; }
    .totals { margin-top: 18px; }
    .totals h2 { font-size: 15px; margin: 0 0 6px; }
    @media print { body { margin: 0; } }
  `;
  win.document.open();
  win.document.write(
    `<!doctype html><html><head><title>${escapeHtml(title)}</title><style>${styles}</style></head><body>${bodyHtml}<script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script></body></html>`
  );
  win.document.close();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

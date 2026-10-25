import { afterEach, describe, expect, it, vi } from 'vitest';
import { printReport } from './print';

function fakeWindow() {
  const written: string[] = [];
  const win = {
    opener: {} as unknown,
    document: { open: vi.fn(), write: (html: string) => written.push(html), close: vi.fn() },
    focus: vi.fn(),
    print: vi.fn(),
  };
  return { win: win as unknown as Window, raw: win, written };
}

describe('printReport', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens a window it can write to, then prints it from the page that opened it', () => {
    vi.useFakeTimers();
    const { win, raw, written } = fakeWindow();
    const open = vi.fn<(url: string, target: string, features: string) => Window>(() => win);
    vi.stubGlobal('window', { open });

    printReport('Pay Run <Summary>', '<table></table>');

    // `noopener` makes window.open return null, which left the buttons doing nothing.
    expect(open.mock.calls[0][2]).not.toMatch(/noopener/);
    expect(written[0]).toContain('<title>Pay Run &lt;Summary&gt;</title>');
    expect(written[0]).toContain('<table></table>');
    // The portal's CSP (script-src 'self') blocks inline scripts, so none may be relied on.
    expect(written[0]).not.toContain('<script');
    expect(raw.print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(raw.print).toHaveBeenCalledOnce();
    expect(raw.opener).toBeNull();
  });

  it('does nothing when the browser blocks the pop-up', () => {
    vi.stubGlobal('window', { open: () => null });
    expect(() => printReport('Blocked', '<p>x</p>')).not.toThrow();
  });
});

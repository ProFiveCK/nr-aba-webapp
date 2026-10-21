import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ApiClient from './api';

let client: ApiClient;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    client = new ApiClient('/api');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('aborts a stalled read, releases its deadline, and permits a subsequent request', async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const result = expect(client.get('/leave')).rejects.toThrow('Please try again');
    const signal = fetchMock.mock.calls[0][1]?.signal;
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(signal?.aborted).toBe(true);
    fetchMock.mockResolvedValueOnce(Response.json({ ready: true }));
    await expect(client.get('/leave')).resolves.toEqual({ ready: true });
    expect(vi.getTimerCount()).toBe(0);
});

it('covers a stalled JSON response body as well as waiting for headers', async () => {
    fetchMock.mockResolvedValue(new Response(new ReadableStream()));
    const result = expect(client.get('/leave', { timeoutMs: 100 })).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(vi.getTimerCount()).toBe(0);
});

it('covers stalled binary response bodies', async () => {
    fetchMock.mockResolvedValue(new Response(new ReadableStream()));
    const result = expect(client.getBlob('/leave.pdf', { timeoutMs: 100 })).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
});

it('warns about an uncertain write outcome without automatically repeating it', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const result = expect(client.post('/decision', { decision: 'approved' })).rejects.toThrow('the change may have been saved');
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('allows two minutes for attachments and supports an explicit deadline override', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const result = expect(client.upload('/leave', new FormData())).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(90_000);
    await result;
    const overridden = expect(client.upload('/leave', new FormData(), { timeoutMs: 100 })).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(100);
    await overridden;
});

it('honours cancellation immediately, including a signal cancelled before the call', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const result = expect(client.get('/leave', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await result;
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await expect(client.get('/leave', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('keeps server error details and clears deadlines on errors and empty responses', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Assignment changed', revision: 2 }, { status: 409 }));
    await expect(client.post('/decision')).rejects.toMatchObject({ message: 'Assignment changed', status: 409, details: { revision: 2 } });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(client.delete('/draft')).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
});

it('preserves authentication handling for JSON and binary responses', async () => {
    const handleAuthExpired = vi.fn();
    vi.stubGlobal('window', { handleAuthExpired });
    client.setAuthToken('test-token');
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Session expired' }, { status: 401 }));
    await expect(client.get('/leave', { suppressAuthExpired: true })).rejects.toThrow('Session expired');
    expect(handleAuthExpired).not.toHaveBeenCalled();
    expect(client.getAuthToken()).toBe('test-token');
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Session expired' }, { status: 401 }));
    await expect(client.getBlob('/leave.pdf')).rejects.toThrow('Session expired');
    expect(handleAuthExpired).toHaveBeenCalledOnce();
    expect(client.getAuthToken()).toBeNull();
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'include', headers: { Authorization: 'Bearer test-token' } });
    expect(vi.getTimerCount()).toBe(0);
});

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => String(body) } as Response);
const fail = (status: number) => ({ ok: false, status, json: async () => ({ error: 'x' }) } as Response);

describe('api', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('listItems hits /api/items and returns typed items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([{ name: 'a.png', path: 'Images/a.png', kind: 'image', size: 1, isDir: false, modifiedAt: 'x' }]));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('../api');
    const items = await api.listItems();
    expect(items[0].kind).toBe('image');
    expect(fetchMock.mock.calls[0][0]).toContain('/api/items');
  });

  it('sendFiles uploads each file as multipart', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ entry: { id: '1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('../api');
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await api.sendFiles([file]);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain('/api/send/file');
    expect(call[1].method).toBe('POST');
  });

  it('proxyUrl carries the auth token as a query param', async () => {
    localStorage.setItem('privy-token', 't');
    const { api } = await import('../api');
    expect(api.proxyUrl('/foo')).toContain('token=t');
  });
});

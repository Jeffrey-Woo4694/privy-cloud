import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { warmOfficeEngine, __resetOfficeWarmForTests } from '../officeWarm';
import { api } from '../api';

vi.mock('../api', async () => {
  const actual = (await vi.importActual('../api')) as typeof import('../api');
  return { api: { ...actual.api, officeEngine: vi.fn() }, API_BASE: actual.API_BASE };
});

const officeEngine = () => api.officeEngine as unknown as ReturnType<typeof vi.fn>;
const loaders = () => document.querySelectorAll('script[src*="api/documents/api.js"]');
const preconnects = () => document.querySelectorAll('link[rel="preconnect"]');

describe('warmOfficeEngine', () => {
  beforeEach(() => __resetOfficeWarmForTests());
  afterEach(() => {
    officeEngine().mockReset();
    document.head.querySelectorAll('script, link').forEach((n) => n.remove());
    delete window.DocsAPI;
  });

  // Opening a document otherwise pays for the engine handshake and the no-store
  // loader on the spot. Doing it at launch means the first open is already warm.
  it('preconnects to the engine and loads the editor loader', async () => {
    officeEngine().mockResolvedValue({ enabled: true, engineUrl: 'https://doc.example' });

    await warmOfficeEngine();

    expect(loaders().length).toBe(1);
    expect(loaders()[0].getAttribute('src')).toBe('https://doc.example/web-apps/apps/api/documents/api.js');
    expect([...preconnects()].map((l) => l.getAttribute('href'))).toContain('https://doc.example');
  });

  it('does nothing when no engine is configured', async () => {
    officeEngine().mockResolvedValue({ enabled: false });

    await warmOfficeEngine();

    expect(loaders().length).toBe(0);
    expect(preconnects().length).toBe(0);
  });

  // Warming is a launch-time nicety, never a reason for the app to fail to start.
  it('stays silent when the engine cannot be reached', async () => {
    officeEngine().mockRejectedValue(new Error('offline'));

    await expect(warmOfficeEngine()).resolves.toBeUndefined();
    expect(loaders().length).toBe(0);
  });

  it('warms once even if called again', async () => {
    officeEngine().mockResolvedValue({ enabled: true, engineUrl: 'https://doc.example' });

    await warmOfficeEngine();
    await warmOfficeEngine();

    expect(officeEngine()).toHaveBeenCalledTimes(1);
    expect(loaders().length).toBe(1);
  });

  // The editor mount skips its own injection when DocsAPI is already defined, so
  // re-adding the loader here would re-download it for nothing.
  it('skips the loader when DocsAPI is already present', async () => {
    officeEngine().mockResolvedValue({ enabled: true, engineUrl: 'https://doc.example' });
    window.DocsAPI = { DocEditor: vi.fn() as never };

    await warmOfficeEngine();

    expect(loaders().length).toBe(0);
  });
});

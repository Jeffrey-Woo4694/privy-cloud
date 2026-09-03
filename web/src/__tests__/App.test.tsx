import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../App';

// Mock the api module so App's on-load token validation and the tabs' fetches
// resolve deterministically (no real network/backend in these tests).
vi.mock('../api', () => ({
  API_BASE: '',
  api: {
    getMeta: vi.fn().mockResolvedValue({ root: '/', owner: 'owner' }),
    listItems: vi.fn().mockResolvedValue([]),
    listChat: vi.fn().mockResolvedValue([]),
    getFileText: vi.fn().mockResolvedValue(''),
    saveFileText: vi.fn().mockResolvedValue({ ok: true }),
    sendText: vi.fn().mockResolvedValue({}),
    sendFiles: vi.fn().mockResolvedValue([]),
    sendFolder: vi.fn().mockResolvedValue({}),
    hermesCall: vi.fn().mockResolvedValue({}),
    listHermesRoles: vi.fn().mockResolvedValue({ roles: [{ id: 'hermes', label: 'Hermes' }] }),
    listTrash: vi.fn().mockResolvedValue({ items: [] }),
    trashPath: vi.fn().mockResolvedValue({ ok: true }),
    restoreFromTrash: vi.fn().mockResolvedValue({ ok: true }),
    deleteFromTrash: vi.fn().mockResolvedValue({ ok: true }),
    proxyUrl: (p: string) => p,
    fileUrl: (p: string) => p,
    setRoot: vi.fn().mockResolvedValue('/'),
    officeEngine: vi.fn().mockResolvedValue({ enabled: false }),
  },
}));

import { api } from '../api';
import { __resetOfficeWarmForTests } from '../officeWarm';

describe('App', () => {
  beforeEach(() => localStorage.setItem('privy-token', 't'));

  // The editor loader is fetched at launch rather than on first open, so opening a
  // document doesn't pay for the engine handshake on the spot.
  it('warms the office engine once the session is authenticated', async () => {
    __resetOfficeWarmForTests();
    const officeEngine = api.officeEngine as unknown as ReturnType<typeof vi.fn>;
    officeEngine.mockClear();
    render(<App />);
    await waitFor(() => expect(officeEngine).toHaveBeenCalled());
  });

  it('boots into the Privy Cloud tab', async () => {
    render(<App />);
    // The on-load validation resolves, then the shell mounts with Privy Cloud active.
    await waitFor(() => expect(document.querySelector('.tab.active')?.textContent).toContain('Privy Cloud'));
  });

  it('switches tabs and theme', async () => {
    render(<App />);
    await screen.findByLabelText('toggle theme');
    fireEvent.click(screen.getAllByText('Privy Cloud')[0]); // the tab bar button
    expect(document.querySelector('.tab.active')?.textContent).toContain('Privy Cloud');
    fireEvent.click(screen.getByLabelText('toggle theme'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('logs out and returns to the login gate', async () => {
    render(<App />);
    await screen.findByLabelText('logout');
    fireEvent.click(screen.getByLabelText('logout'));
    expect(localStorage.getItem('privy-token')).toBeNull();
    expect(screen.getByPlaceholderText(/access token/i)).toBeInTheDocument();
  });

  it('returns to the gate when the stored token is rejected on load (stale token)', async () => {
    const { api } = await import('../api');
    (api.getMeta as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('unauthorized'));
    localStorage.setItem('privy-token', 'stale');
    render(<App />);
    expect(await screen.findByPlaceholderText(/access token/i)).toBeInTheDocument();
    expect(localStorage.getItem('privy-token')).toBeNull(); // stale token cleared
  });

  it('rejects an invalid token on unlock and stays logged out', async () => {
    localStorage.clear();
    const { api } = await import('../api');
    (api.getMeta as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('unauthorized'));
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/access token/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText(/unlock/i));
    expect(await screen.findByText(/invalid access token/i)).toBeInTheDocument();
    expect(localStorage.getItem('privy-token')).toBeNull();
    expect(screen.queryByLabelText('logout')).toBeNull(); // still on the gate
  });
});

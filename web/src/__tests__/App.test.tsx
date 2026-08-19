import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../App';

describe('App', () => {
  beforeEach(() => localStorage.setItem('privy-token', 't'));
  it('boots into the Hermes tab', () => {
    render(<App />);
    // The Hermes chat composer is unique to the Hermes tab (the tab label shares the name).
    expect(screen.getByPlaceholderText(/Ask Hermes/)).toBeInTheDocument();
    expect(document.querySelector('.tab.active')?.textContent).toContain('Hermes Agent');
  });

  it('switches tabs and theme', () => {
    render(<App />);
    fireEvent.click(screen.getAllByText('Privy Cloud')[0]); // the tab bar button
    expect(document.querySelector('.tab.active')?.textContent).toContain('Privy Cloud');
    fireEvent.click(screen.getByLabelText('toggle theme'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('logs out and returns to the login gate', () => {
    render(<App />); // token 't' is in localStorage → authed
    fireEvent.click(screen.getByLabelText('logout'));
    expect(localStorage.getItem('privy-token')).toBeNull();
    expect(screen.getByPlaceholderText(/access token/i)).toBeInTheDocument();
  });

  it('rejects an invalid token on unlock and stays logged out', async () => {
    localStorage.clear();
    // /api/meta returns 401 for a bad token → the login must fail, not unlock.
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }), text: async () => '{}' });
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<App />);
      fireEvent.change(screen.getByPlaceholderText(/access token/i), { target: { value: 'wrong' } });
      fireEvent.click(screen.getByText(/unlock/i));
      expect(await screen.findByText(/invalid access token/i)).toBeInTheDocument();
      expect(localStorage.getItem('privy-token')).toBeNull();
      expect(screen.queryByLabelText('logout')).toBeNull(); // still on the gate
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

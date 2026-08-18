import { describe, expect, it, beforeEach } from 'vitest';
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
});

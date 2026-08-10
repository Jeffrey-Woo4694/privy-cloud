import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../theme';

function Probe() {
  const { theme, toggle } = useTheme();
  return <button onClick={toggle}>theme:{theme}</button>;
}

describe('theme', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to dark and applies data-theme on mount', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('button').textContent).toBe('theme:dark');
  });

  it('restores a saved theme from localStorage', () => {
    localStorage.setItem('privy-theme', 'light');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('toggle flips the theme and persists it', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('privy-theme')).toBe('light');
  });
});

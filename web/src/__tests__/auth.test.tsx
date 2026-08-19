import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginGate } from '../components/LoginGate';
import { getToken, setToken, clearToken } from '../auth';

describe('auth', () => {
  beforeEach(() => localStorage.clear());

  it('getToken/setToken/clearToken roundtrip', () => {
    expect(getToken()).toBeNull();
    setToken('abc');
    expect(getToken()).toBe('abc');
    clearToken();
    expect(getToken()).toBeNull();
  });

  it('LoginGate renders the form and calls onLogin with the entered token', () => {
    const onLogin = vi.fn();
    render(<LoginGate onLogin={onLogin} />);
    expect(screen.getByPlaceholderText(/access token/i)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/access token/i), { target: { value: 'tok' } });
    fireEvent.click(screen.getByText(/unlock/i));
    expect(onLogin).toHaveBeenCalledWith('tok');
  });

  it('LoginGate shows a validation error when present', () => {
    render(<LoginGate onLogin={() => {}} error="Invalid access token" />);
    expect(screen.getByText('Invalid access token')).toBeTruthy();
  });

  it('LoginGate disables the button while busy', () => {
    render(<LoginGate onLogin={() => {}} busy />);
    expect(screen.getByText(/checking/i)).toBeTruthy();
  });
});

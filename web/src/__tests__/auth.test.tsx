import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginGate } from '../components/LoginGate';
import { getToken, setToken } from '../auth';

describe('LoginGate', () => {
  beforeEach(() => localStorage.clear());
  it('shows the token form when no token is set', () => {
    render(<LoginGate><div>app content</div></LoginGate>);
    expect(screen.getByPlaceholderText(/access token/i)).toBeTruthy();
    expect(screen.queryByText('app content')).toBeNull();
  });
  it('stores the token and reveals children', () => {
    render(<LoginGate><div>app content</div></LoginGate>);
    fireEvent.change(screen.getByPlaceholderText(/access token/i), { target: { value: 'tok' } });
    fireEvent.click(screen.getByText(/unlock/i));
    expect(getToken()).toBe('tok');
    expect(screen.getByText('app content')).toBeTruthy();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PathBar } from '../components/PathBar';

function renderBar(overrides: Partial<Parameters<typeof PathBar>[0]> = {}) {
  const base = {
    location: { type: 'folder', path: 'Images/sub' } as const,
    onNavigate: vi.fn(),
    onBack: vi.fn(),
    onForward: vi.fn(),
    canGoBack: true,
    canGoForward: false,
    ...overrides,
  };
  render(<PathBar {...base} />);
  return base;
}

describe('PathBar', () => {
  it('renders back and forward in the nav group; forward disabled when unavailable', () => {
    const base = renderBar();
    fireEvent.click(screen.getByLabelText('back'));
    expect(base.onBack).toHaveBeenCalled();
    expect(screen.getByLabelText('forward')).toBeDisabled();
  });

  it('renders ancestor crumbs as buttons and the current segment as plain text', () => {
    const base = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(base.onNavigate).toHaveBeenCalledWith({ type: 'home' });
    // The Images folder is shown by its friendly category label, "Pictures".
    fireEvent.click(screen.getByRole('button', { name: 'Pictures' }));
    expect(base.onNavigate).toHaveBeenCalledWith({ type: 'folder', path: 'Images' });
    // The current directory ("sub") is where you are — it reads, it is not clickable.
    expect(screen.getByText('sub')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'sub' })).toBeNull();
  });

  it('enables forward and fires onForward when canGoForward', () => {
    const base = renderBar({ location: { type: 'home' } as const, canGoForward: true });
    expect(screen.getByLabelText('forward')).toBeEnabled();
    fireEvent.click(screen.getByLabelText('forward'));
    expect(base.onForward).toHaveBeenCalled();
  });
});

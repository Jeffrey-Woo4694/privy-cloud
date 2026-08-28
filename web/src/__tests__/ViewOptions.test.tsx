import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewOptions, type DisplaySize } from '../components/ViewOptions';
import type { Sort } from '../sortItems';

const base = (extra: Record<string, unknown> = {}) => ({
  open: true, onClose: vi.fn(), sort: { key: 'name', dir: 'asc' } as Sort, onSort: vi.fn(),
  displaySize: 'medium' as DisplaySize, onDisplaySize: vi.fn(), showHidden: false, onShowHidden: vi.fn(), ...extra,
});

describe('ViewOptions', () => {
  it('renders nothing when closed', () => {
    render(<ViewOptions {...base({ open: false })} />);
    expect(screen.queryByText(/Sort/)).toBeNull();
  });

  it('shows all sort presets and marks the active one', () => {
    render(<ViewOptions {...base({ sort: { key: 'name', dir: 'asc' } as Sort })} />);
    expect(screen.getByText('A-Z')).toBeTruthy();
    expect(screen.getByText('Z-A')).toBeTruthy();
    expect(screen.getByText('Last Modified')).toBeTruthy();
    expect(screen.getByText('First Modified')).toBeTruthy();
    expect(screen.getByText('Size')).toBeTruthy();
    expect(screen.getByText('Type')).toBeTruthy();
    const az = screen.getByText('A-Z').closest('.vo-option')!;
    expect(az.querySelector('.vo-radio.on')).toBeTruthy();
  });

  it('clicking a preset calls onSort with the sort and closes', () => {
    const onSort = vi.fn();
    const onClose = vi.fn();
    render(<ViewOptions {...base({ onSort, onClose })} />);
    fireEvent.click(screen.getByText('Z-A'));
    expect(onSort).toHaveBeenCalledWith({ key: 'name', dir: 'desc' });
    expect(onClose).toHaveBeenCalled();
  });

  it('toggles show hidden files', () => {
    const onShowHidden = vi.fn();
    render(<ViewOptions {...base({ showHidden: false, onShowHidden })} />);
    fireEvent.click(screen.getByText('Show Hidden Files'));
    expect(onShowHidden).toHaveBeenCalledWith(true);
  });

  it('icon size steps call onDisplaySize with the delta', () => {
    const onDisplaySize = vi.fn();
    render(<ViewOptions {...base({ onDisplaySize })} />);
    fireEvent.click(screen.getByLabelText('Smaller'));
    fireEvent.click(screen.getByLabelText('Larger'));
    expect(onDisplaySize).toHaveBeenCalledWith(-1);
    expect(onDisplaySize).toHaveBeenCalledWith(1);
  });
});

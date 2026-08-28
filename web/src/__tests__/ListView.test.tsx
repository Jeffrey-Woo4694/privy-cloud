import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ListView } from '../components/ListView';
import type { Sort } from '../sortItems';
import type { FileItem } from '@privy/shared';

const file: FileItem = { name: 'a.txt', path: 'a.txt', kind: 'document', size: 5, isDir: false, modifiedAt: '2026-01-01T00:00:00Z' };
const dir: FileItem = { name: 'Docs', path: 'Docs', kind: 'folder', size: 0, isDir: true, modifiedAt: '2026-01-02T00:00:00Z' };

const base = (extra: Record<string, unknown> = {}) => ({
  items: [file, dir], onSelect: vi.fn(), onOpen: vi.fn(), onMoveTo: vi.fn(),
  sort: { key: 'name', dir: 'asc' } as Sort, onSort: vi.fn(), ...extra,
});

describe('ListView', () => {
  it('renders name, size and modified columns', () => {
    render(<ListView {...base()} />);
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Size')).toBeTruthy();
    expect(screen.getByText('Modified')).toBeTruthy();
    expect(screen.getByText(/a\.txt/)).toBeTruthy();
    expect(screen.getByText('5 B')).toBeTruthy();
  });

  it('clicking a header calls onSort with the column', () => {
    const onSort = vi.fn();
    render(<ListView {...base({ onSort })} />);
    fireEvent.click(screen.getByText('Size'));
    expect(onSort).toHaveBeenCalledWith('size');
  });

  it('marks the active sort column and shows the direction arrow', () => {
    render(<ListView {...base({ sort: { key: 'size', dir: 'desc' } as Sort })} />);
    const sizeTh = screen.getByText('Size').closest('th');
    expect(sizeTh?.className).toContain('active');
    expect(sizeTh?.textContent).toContain('▼');
  });

  it('single click selects the row; double click opens it', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(<ListView {...base({ onSelect, onOpen })} />);
    fireEvent.click(screen.getByText(/a\.txt/));
    expect(onSelect).toHaveBeenCalledWith(file, false);
    fireEvent.doubleClick(screen.getByText(/a\.txt/));
    expect(onOpen).toHaveBeenCalledWith(file);
  });

  it('dragging a row onto a folder row calls onMoveTo', () => {
    const onMoveTo = vi.fn();
    const dt = { setData: vi.fn(), getData: vi.fn(() => 'a.txt'), dropEffect: '', effectAllowed: '' };
    render(<ListView {...base({ onMoveTo })} />);
    const fileRow = screen.getByText(/a\.txt/).closest('tr')!;
    const dirRow = screen.getByText(/Docs/).closest('tr')!;
    fireEvent.dragStart(fileRow, { dataTransfer: dt });
    fireEvent.drop(dirRow, { dataTransfer: dt });
    expect(onMoveTo).toHaveBeenCalledWith('a.txt', 'Docs');
  });
});

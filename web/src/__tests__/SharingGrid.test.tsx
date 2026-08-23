import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SharingGrid } from '../components/SharingGrid';
import type { FileItem } from '@privy/shared';

const items: FileItem[] = [
  { name: 'note.md', path: 'Markdown/note.md', kind: 'markdown', size: 100, isDir: false, modifiedAt: '2026-08-09T00:00:00Z' },
  { name: 'pic.png', path: 'Images/pic.png', kind: 'image', size: 2048, isDir: false, modifiedAt: '2026-08-09T00:00:00Z' },
];

describe('SharingGrid', () => {
  it('renders tiles and reports selection', () => {
    const onSelect = vi.fn();
    render(<SharingGrid items={items} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('note.md'));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('shows an empty state', () => {
    render(<SharingGrid items={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
  });

  it('fires onTileContextMenu with the item and lets the caller preventDefault', () => {
    const onTileContextMenu = vi.fn((e: { preventDefault: () => void; defaultPrevented: boolean }, _item: FileItem) => e.preventDefault());
    render(<SharingGrid items={items} onSelect={vi.fn()} onTileContextMenu={onTileContextMenu} />);
    fireEvent.contextMenu(screen.getByText('note.md'));
    expect(onTileContextMenu).toHaveBeenCalledTimes(1);
    const [e, item] = onTileContextMenu.mock.calls[0];
    expect(item).toBe(items[0]);
    expect(e.defaultPrevented).toBe(true);
  });

  it('renders a rename input for the renaming tile and commits on Enter', () => {
    const onCommitRename = vi.fn();
    render(<SharingGrid items={items} onSelect={vi.fn()} renaming="Markdown/note.md" onCommitRename={onCommitRename} onCancelRename={vi.fn()} />);
    const input = screen.getByDisplayValue('note.md') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'notes.md' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommitRename).toHaveBeenCalledWith(items[0], 'notes.md');
  });

  it('cancels rename on Escape', () => {
    const onCancelRename = vi.fn();
    render(<SharingGrid items={items} onSelect={vi.fn()} renaming="Markdown/note.md" onCommitRename={vi.fn()} onCancelRename={onCancelRename} />);
    fireEvent.keyDown(screen.getByDisplayValue('note.md'), { key: 'Escape' });
    expect(onCancelRename).toHaveBeenCalled();
  });
});

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
});

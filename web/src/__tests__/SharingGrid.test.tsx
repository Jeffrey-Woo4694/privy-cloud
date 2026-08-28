import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SharingGrid } from '../components/SharingGrid';
import type { FileItem } from '@privy/shared';

const file: FileItem = { name: 'a.txt', path: 'a.txt', kind: 'document', size: 1, isDir: false, modifiedAt: 'x' };
const dir: FileItem = { name: 'Docs', path: 'Docs', kind: 'folder', size: 0, isDir: true, modifiedAt: 'x' };

describe('SharingGrid', () => {
  it('single click selects (onSelect) on desktop; double click opens (onOpen)', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(<SharingGrid items={[file]} onSelect={onSelect} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('a.txt'));
    expect(onSelect).toHaveBeenCalledWith(file, false);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.doubleClick(screen.getByText('a.txt'));
    expect(onOpen).toHaveBeenCalledWith(file);
  });

  it('passes shiftKey to onSelect for range selection', () => {
    const onSelect = vi.fn();
    render(<SharingGrid items={[file, dir]} onSelect={onSelect} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByText('a.txt'), { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(file, true);
  });

  it('single click opens directly on touch/mobile (singleClickOpens)', () => {
    const onOpen = vi.fn();
    render(<SharingGrid items={[file]} onSelect={vi.fn()} onOpen={onOpen} singleClickOpens />);
    fireEvent.click(screen.getByText('a.txt'));
    expect(onOpen).toHaveBeenCalledWith(file);
  });

  it('highlights only the selected tiles', () => {
    render(<SharingGrid items={[file, dir]} onSelect={vi.fn()} onOpen={vi.fn()} selected={new Set(['a.txt'])} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0].className).toContain('selected');
    expect(buttons[1].className).not.toContain('selected');
  });

  it('dragging a tile onto a folder tile calls onMoveTo', () => {
    const onMoveTo = vi.fn();
    const dt = { setData: vi.fn(), getData: vi.fn(() => 'a.txt'), dropEffect: '', effectAllowed: '' };
    render(<SharingGrid items={[file, dir]} onSelect={vi.fn()} onOpen={vi.fn()} onMoveTo={onMoveTo} />);
    const fileTile = screen.getByRole('button', { name: /a\.txt/ });
    const dirTile = screen.getByRole('button', { name: /Docs/ });
    fireEvent.dragStart(fileTile, { dataTransfer: dt });
    fireEvent.drop(dirTile, { dataTransfer: dt });
    expect(onMoveTo).toHaveBeenCalledWith('a.txt', 'Docs');
  });

  it('does not move when dropped onto a file tile (silently undoes the drag)', () => {
    const onMoveTo = vi.fn();
    const dt = { setData: vi.fn(), getData: vi.fn(() => 'Docs'), dropEffect: '', effectAllowed: '' };
    render(<SharingGrid items={[file, dir]} onSelect={vi.fn()} onOpen={vi.fn()} onMoveTo={onMoveTo} />);
    const dirTile = screen.getByRole('button', { name: /Docs/ });
    const fileTile = screen.getByRole('button', { name: /a\.txt/ });
    fireEvent.dragStart(dirTile, { dataTransfer: dt });
    fireEvent.drop(fileTile, { dataTransfer: dt }); // dropped onto a FILE, not a folder
    expect(onMoveTo).not.toHaveBeenCalled();
  });
});

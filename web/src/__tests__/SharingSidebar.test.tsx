import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SharingSidebar } from '../components/SharingSidebar';
import type { Bookmark } from '../bookmarks';

const BS: Bookmark[] = [{ path: 'Project', label: 'Project' }, { path: 'Temp', label: 'Temp' }];

// jsdom has no DataTransfer; the component only touches types/getData/setData.
// `types` must be a live view (like the real thing), so setData during dragstart
// is visible to the dragover/drop handlers.
const dt = (map: Record<string, string>) => ({
  get types() { return Object.keys(map); },
  getData: (t: string) => map[t] ?? '',
  setData: (t: string, v: string) => { map[t] = v; },
  effectAllowed: '', dropEffect: '',
});

function setup(over: Record<string, unknown> = {}) {
  const props = {
    location: { type: 'home' } as const, onSelect: vi.fn(),
    bookmarks: BS,
    onDropFolder: vi.fn(), onReorder: vi.fn(), onRemove: vi.fn(), onRename: vi.fn(),
    ...over,
  };
  render(<SharingSidebar {...props} />);
  return props;
}

describe('SharingSidebar quick-access bookmarks', () => {
  it('lists bookmarks and navigates on click', () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByText('Project'));
    expect(onSelect).toHaveBeenCalledWith({ type: 'folder', path: 'Project' });
  });

  it('accepts a folder dragged in from the grid', () => {
    const { onDropFolder } = setup();
    const zone = document.querySelector('.bookmark-zone') as HTMLElement;
    const drag = dt({ 'text/plain': 'Project' });
    fireEvent.dragOver(zone, { dataTransfer: drag });
    fireEvent.drop(zone, { dataTransfer: drag });
    expect(onDropFolder).toHaveBeenCalledWith('Project');
  });

  it('shows the empty hint when there are no bookmarks', () => {
    render(<SharingSidebar location={{ type: 'home' }} onSelect={vi.fn()} bookmarks={[]} onDropFolder={vi.fn()} />);
    expect(screen.getByText(/Drag a folder here/)).toBeInTheDocument();
  });

  it('reorders by dragging a bookmark row (own drag type, not a grid drop)', () => {
    const { onReorder, onDropFolder } = setup();
    const rows = screen.getAllByText(/Project|Temp/).filter((el) => el.classList.contains('bookmark-row'));
    const drag = dt({});
    fireEvent.dragStart(rows[0], { dataTransfer: drag });
    expect(drag.getData('application/x-privy-bookmark')).toBe('0'); // row announced itself
    const zone = document.querySelector('.bookmark-zone') as HTMLElement;
    fireEvent.dragOver(zone, { dataTransfer: drag });
    fireEvent.drop(zone, { dataTransfer: drag });
    expect(onDropFolder).not.toHaveBeenCalled(); // treated as a move, not a new folder
    expect(onReorder).toHaveBeenCalledWith(0, 2);
  });

  it('right-click opens the popover with Rename + Remove from bookmarks', () => {
    const { onRemove } = setup();
    const row = screen.getByText('Temp').closest('.bookmark-row') as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
    fireEvent.click(screen.getByText('Remove from bookmarks'));
    expect(onRemove).toHaveBeenCalledWith('Temp');
  });

  it('popover Rename opens an inline editor and Enter commits the new directory name', () => {
    const { onRename } = setup();
    const row = screen.getByText('Temp').closest('.bookmark-row') as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Scratch' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(BS[1], 'Scratch');
  });

  it('Escape while renaming cancels without a rename', () => {
    const { onRename } = setup();
    const row = screen.getByText('Temp').closest('.bookmark-row') as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Scratch' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
  });
});

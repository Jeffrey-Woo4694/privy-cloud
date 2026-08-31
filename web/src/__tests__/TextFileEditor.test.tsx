import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { TextFileEditor } from '../components/TextFileEditor';

// The head row has two typing surfaces now (name field + content textarea), so the
// content area is selected by tag, not role.
const areaOf = (container: HTMLElement) => container.querySelector('textarea') as HTMLTextAreaElement;

describe('TextFileEditor autosave', () => {
  afterEach(() => vi.useRealTimers());

  it('autosaves ~1.2s after the last keystroke', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<TextFileEditor name="n.txt" initialText="hello" onSave={onSave} />);
    const box = areaOf(container);
    fireEvent.change(box, { target: { value: 'hello world' } });
    expect(onSave).not.toHaveBeenCalled(); // not yet — still debouncing
    act(() => { vi.advanceTimersByTime(1200); });
    await act(async () => { await Promise.resolve(); }); // flush the async save
    expect(onSave).toHaveBeenCalledWith('hello world');
    // The reaction is ghost text, not a button-label change.
    expect(screen.getByText('Save')).toBeInTheDocument(); // same label, unchanged
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('coalesces a typing burst into one save', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<TextFileEditor name="n.txt" initialText="" onSave={onSave} />);
    const box = areaOf(container);
    fireEvent.change(box, { target: { value: 'a' } });
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.change(box, { target: { value: 'ab' } });
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.change(box, { target: { value: 'abc' } });
    act(() => { vi.advanceTimersByTime(1200); });
    await act(async () => { await Promise.resolve(); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('abc');
  });

  it('flushes a pending autosave when the editor unmounts (no lost edits)', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container, unmount } = render(<TextFileEditor name="n.txt" initialText="" onSave={onSave} />);
    fireEvent.change(areaOf(container), { target: { value: 'last words' } });
    act(() => { vi.advanceTimersByTime(400); }); // still within the debounce window
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(onSave).toHaveBeenCalledWith('last words');
  });

  it('a click-Save with nothing pending reports "Saved" without rewriting the file', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TextFileEditor name="n.txt" initialText="hello" onSave={onSave} />);
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).not.toHaveBeenCalled(); // deduped — no version churn
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('committing the name field renames via the parent (flushing a pending edit first)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onRename = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <TextFileEditor name="n.txt" initialText="hello" onSave={onSave} onRename={onRename} />,
    );
    fireEvent.change(areaOf(container), { target: { value: 'edited' } }); // dirty buffer
    const nameField = screen.getByLabelText('File name');
    expect(nameField).toHaveValue('n.txt');
    fireEvent.change(nameField, { target: { value: 'report.txt' } });
    fireEvent.keyDown(nameField, { key: 'Enter' });
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('report.txt'));
    // The save (under the old path) landed before the rename was issued.
    expect(onSave).toHaveBeenCalledWith('edited');
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(onRename.mock.invocationCallOrder[0]);
  });

  it('Escape in the name field reverts without renaming', async () => {
    const onRename = vi.fn();
    render(<TextFileEditor name="n.txt" initialText="hello" onSave={vi.fn()} onRename={onRename} />);
    const nameField = screen.getByLabelText('File name');
    fireEvent.change(nameField, { target: { value: 'oops.txt' } });
    fireEvent.keyDown(nameField, { key: 'Escape' });
    expect(nameField).toHaveValue('n.txt');
    expect(onRename).not.toHaveBeenCalled();
  });
});

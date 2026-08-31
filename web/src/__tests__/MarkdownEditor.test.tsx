import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act, screen } from '@testing-library/react';
import { MarkdownEditor } from '../components/MarkdownEditor';

// The head row carries a name field as well as the raw textarea (once editing),
// so the content area is selected by tag.
const areaOf = (container: HTMLElement) => container.querySelector('textarea') as HTMLTextAreaElement | null;

describe('MarkdownEditor', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('opens on the rendered design; the single Edit/Show button toggles faces', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<MarkdownEditor name="a.md" initialText="# hi" onSave={onSave} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('hi');
    expect(areaOf(container)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(areaOf(container)).toHaveValue('# hi');
    fireEvent.click(screen.getByRole('button', { name: 'Show' })); // same button, new label
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('hi');
  });

  it('autosaves ~1.2s after the last change (debounced)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<MarkdownEditor name="a.md" initialText="hi" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const area = areaOf(container)!;
    fireEvent.change(area, { target: { value: 'hi there' } });
    // A fresh keystroke before the debounce resets the timer, so no save yet.
    fireEvent.change(area, { target: { value: 'hi there world' } });
    act(() => vi.advanceTimersByTime(500));
    expect(onSave).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    await act(async () => { await Promise.resolve(); }); // flush the async save's state updates
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('hi there world');
    // The Save button never changes size/label; the reaction is ghost text.
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('saves on Ctrl+S', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<MarkdownEditor name="a.md" initialText="hi" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(areaOf(container)!, { target: { value: 'hi edits' } }); // dirty the buffer
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith('hi edits');
  });

  it('saves on Cmd+S (metaKey)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<MarkdownEditor name="a.md" initialText="hi" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(areaOf(container)!, { target: { value: 'hi edits' } });
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(onSave).toHaveBeenCalledWith('hi edits');
  });

  it('does not save on a plain S key', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<MarkdownEditor name="a.md" initialText="hi" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(areaOf(container)!, { target: { value: 'hi edits' } });
    fireEvent.keyDown(window, { key: 's' });
    // The debounce hasn't elapsed (fake timers, not advanced) — nothing saved yet.
    expect(onSave).not.toHaveBeenCalled();
  });

  it('prevents the browser default (Save Page) on Ctrl+S', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<MarkdownEditor name="a.md" initialText="hi" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(areaOf(container)!, { target: { value: 'x' } });
    const evt = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    const prevented = !window.dispatchEvent(evt); // dispatchEvent returns false if preventDefault was called
    expect(prevented).toBe(true);
  });

  it('an unedited Save writes nothing (no version churn)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MarkdownEditor name="a.md" initialText="hi" onSave={onSave} />);
    fireEvent.click(screen.getByText('Save')); // rendered mode, nothing changed
    expect(onSave).not.toHaveBeenCalled();
    // fireEvent wraps in act, so the synchronous "Saved" flash is already applied.
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('renaming flushes the raw edit under the old path first', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onRename = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <MarkdownEditor name="a.md" initialText="hi" onSave={onSave} onRename={onRename} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(areaOf(container)!, { target: { value: 'hi there' } });
    const nameField = screen.getByLabelText('File name');
    fireEvent.change(nameField, { target: { value: 'b.md' } });
    fireEvent.keyDown(nameField, { key: 'Enter' });
    // Flush the save → rename promise chain (waitFor's timers are fake here).
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onRename).toHaveBeenCalledWith('b.md');
    expect(onSave).toHaveBeenCalledWith('hi there');
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(onRename.mock.invocationCallOrder[0]);
  });
});

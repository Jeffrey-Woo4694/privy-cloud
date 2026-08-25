import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MarkdownEditor } from '../components/MarkdownEditor';

describe('MarkdownEditor', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('autosaves ~1.2s after the last change (debounced)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<MarkdownEditor path="a.md" initialText="hi" onSave={onSave} />);
    const area = container.querySelector('textarea')!;
    fireEvent.change(area, { target: { value: 'hi there' } });
    // A fresh keystroke before the debounce resets the timer, so no save yet.
    fireEvent.change(area, { target: { value: 'hi there world' } });
    act(() => vi.advanceTimersByTime(500));
    expect(onSave).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('hi there world');
  });

  it('saves on Ctrl+S', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MarkdownEditor path="a.md" initialText="hi" onSave={onSave} />);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith('hi');
  });

  it('saves on Cmd+S (metaKey)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MarkdownEditor path="a.md" initialText="hi" onSave={onSave} />);
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(onSave).toHaveBeenCalledWith('hi');
  });

  it('does not save on a plain S key', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MarkdownEditor path="a.md" initialText="hi" onSave={onSave} />);
    fireEvent.keyDown(window, { key: 's' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('prevents the browser default (Save Page) on Ctrl+S', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MarkdownEditor path="a.md" initialText="hi" onSave={onSave} />);
    const evt = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    const prevented = !window.dispatchEvent(evt); // dispatchEvent returns false if preventDefault was called
    expect(prevented).toBe(true);
  });
});

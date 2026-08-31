import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { TextFileEditor } from '../components/TextFileEditor';

describe('TextFileEditor autosave', () => {
  afterEach(() => vi.useRealTimers());

  it('autosaves ~1.2s after the last keystroke', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TextFileEditor path="Documents/n.txt" initialText="hello" onSave={onSave} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'hello world' } });
    expect(onSave).not.toHaveBeenCalled(); // not yet — still debouncing
    act(() => { vi.advanceTimersByTime(1200); });
    await act(async () => { await Promise.resolve(); }); // flush the async save
    expect(onSave).toHaveBeenCalledWith('hello world');
  });

  it('coalesces a typing burst into one save', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TextFileEditor path="Documents/n.txt" initialText="" onSave={onSave} />);
    const box = screen.getByRole('textbox');
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
    const { unmount } = render(<TextFileEditor path="Documents/n.txt" initialText="" onSave={onSave} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'last words' } });
    act(() => { vi.advanceTimersByTime(400); }); // still within the debounce window
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(onSave).toHaveBeenCalledWith('last words');
  });
});

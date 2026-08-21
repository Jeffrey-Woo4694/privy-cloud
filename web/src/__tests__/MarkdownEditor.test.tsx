import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MarkdownEditor } from '../components/MarkdownEditor';

describe('MarkdownEditor', () => {
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

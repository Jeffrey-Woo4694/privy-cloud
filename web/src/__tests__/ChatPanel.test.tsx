import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from '../components/ChatPanel';
import type { ChatEntry } from '@privy/shared';

const entry: ChatEntry = { id: '1', ts: '2026-08-09T14:00:00Z', type: 'text', kind: 'text', name: 'hi.md', text: 'hello', sender: 'owner' };

describe('ChatPanel', () => {
  it('renders a text entry', () => {
    render(<ChatPanel entries={[entry]} onSendText={vi.fn()} onSendFiles={vi.fn()} onSendFolder={vi.fn()} onOpenFile={vi.fn()} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('opens the stored file when a text entry is clicked', () => {
    const onOpenFile = vi.fn();
    const withPath = { ...entry, path: 'Markdown/hi.md' };
    render(<ChatPanel entries={[withPath]} onSendText={vi.fn()} onSendFiles={vi.fn()} onSendFolder={vi.fn()} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByText('hello'));
    expect(onOpenFile).toHaveBeenCalledWith('Markdown/hi.md');
  });

  it('sends text on Enter', () => {
    const onSendText = vi.fn();
    render(<ChatPanel entries={[]} onSendText={onSendText} onSendFiles={vi.fn()} onSendFolder={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/Send message/), { target: { value: 'ping' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Send message/), { key: 'Enter' });
    expect(onSendText).toHaveBeenCalledWith('ping');
  });
});

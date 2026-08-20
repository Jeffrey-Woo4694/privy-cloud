import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from '../components/ChatPanel';
import type { ChatEntry } from '@privy/shared';

const entry: ChatEntry = { id: '1', ts: '2026-08-09T14:00:00Z', type: 'text', kind: 'text', name: 'hi.md', text: 'hello', sender: 'owner' };
const props = { entries: [] as ChatEntry[], botThread: [], onSendText: vi.fn(), onSendHermes: vi.fn(), onSendFiles: vi.fn(), onSendFolder: vi.fn(), onOpenFile: vi.fn() };

describe('ChatPanel', () => {
  it('renders a text entry', () => {
    render(<ChatPanel {...props} entries={[entry]} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('sends text on Enter', () => {
    const onSendText = vi.fn();
    render(<ChatPanel {...props} onSendText={onSendText} />);
    fireEvent.change(screen.getByPlaceholderText(/Send message/), { target: { value: 'ping' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Send message/), { key: 'Enter' });
    expect(onSendText).toHaveBeenCalledWith('ping');
  });

  it('routes @hermes messages to the bot, not to file storage', () => {
    const onSendText = vi.fn();
    const onSendHermes = vi.fn();
    render(<ChatPanel {...props} onSendText={onSendText} onSendHermes={onSendHermes} />);
    fireEvent.change(screen.getByPlaceholderText(/Send message/), { target: { value: '@hermes sort my files' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSendHermes).toHaveBeenCalledWith('@hermes sort my files');
    expect(onSendText).not.toHaveBeenCalled();
  });

  it('does not route a normal message to the bot', () => {
    const onSendText = vi.fn();
    const onSendHermes = vi.fn();
    render(<ChatPanel {...props} onSendText={onSendText} onSendHermes={onSendHermes} />);
    fireEvent.change(screen.getByPlaceholderText(/Send message/), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSendText).toHaveBeenCalledWith('hello');
    expect(onSendHermes).not.toHaveBeenCalled();
  });

  it('shows the mention menu when typing @', () => {
    render(<ChatPanel {...props} />);
    fireEvent.change(screen.getByPlaceholderText(/Send message/), { target: { value: '@' } });
    expect(screen.getByText('Hermes')).toBeInTheDocument();
    expect(screen.getByText('@hermes')).toBeInTheDocument();
  });

  it('pressing Enter on the mention menu selects it (label case) and adds a trailing space', () => {
    render(<ChatPanel {...props} />);
    const input = screen.getByPlaceholderText(/Send message/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '@' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('@Hermes ');
  });

  it('routes a message @-mentioning the selected role to the bot regardless of case', () => {
    const onSendText = vi.fn();
    const onSendHermes = vi.fn();
    render(<ChatPanel {...props} onSendText={onSendText} onSendHermes={onSendHermes} />);
    const input = screen.getByPlaceholderText(/Send message/);
    fireEvent.change(input, { target: { value: '@Hermes tidy the files' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSendHermes).toHaveBeenCalledWith('@Hermes tidy the files');
    expect(onSendText).not.toHaveBeenCalled();
  });

  it('routes a message with a selected mention to the bot', () => {
    const onSendText = vi.fn();
    const onSendHermes = vi.fn();
    render(<ChatPanel {...props} onSendText={onSendText} onSendHermes={onSendHermes} />);
    const input = screen.getByPlaceholderText(/Send message/);
    fireEvent.change(input, { target: { value: '@hermes ' } });
    fireEvent.change(input, { target: { value: '@hermes tidy the files' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSendHermes).toHaveBeenCalledWith('@hermes tidy the files');
    expect(onSendText).not.toHaveBeenCalled();
  });

  it('renders a Hermes bot bubble (with a streaming indicator)', () => {
    render(<ChatPanel {...props} botThread={[
      { id: 'u1', role: 'user', text: '@hermes hi', streaming: false },
      { id: 'b1', role: 'assistant', text: 'hel', streaming: true },
    ]} />);
    expect(screen.getByText('Hermes')).toBeInTheDocument();
    expect(screen.getByText('hel')).toBeInTheDocument();
    expect(screen.getByText('thinking…')).toBeInTheDocument();
  });

  it('opens the stored file when a text entry is clicked', () => {
    const onOpenFile = vi.fn();
    const withPath = { ...entry, path: 'Markdown/hi.md' };
    render(<ChatPanel {...props} entries={[withPath]} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByText('hello'));
    expect(onOpenFile).toHaveBeenCalledWith('Markdown/hi.md');
  });
});

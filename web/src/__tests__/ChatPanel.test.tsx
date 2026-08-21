import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from '../components/ChatPanel';
import type { ChatEntry } from '@privy/shared';

const entry: ChatEntry = { id: '1', ts: '2026-08-09T14:00:00Z', type: 'text', kind: 'text', name: 'hi.md', text: 'hello', sender: 'owner' };
const props = { entries: [] as ChatEntry[], botThread: [], onSendText: vi.fn(), onSendHermes: vi.fn(), onNewSession: vi.fn(), onSendFiles: vi.fn(), onSendFolder: vi.fn(), onOpenFile: vi.fn() };

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
    // "@hermes" is the menu row's hint text (the tab button says "Hermes").
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
    // The bot conversation lives on the Hermes tab — switch to it, then the content is visible.
    fireEvent.click(screen.getByRole('button', { name: /Hermes/ }));
    expect(screen.getByText('hel')).toBeVisible();
    expect(screen.getByText('thinking…')).toBeVisible();
  });

  it('separates file messages (Sharing tab) from the bot thread (Hermes tab)', () => {
    render(<ChatPanel {...props} entries={[entry]} botThread={[
      { id: 'b1', role: 'assistant', text: 'hi bot', streaming: false },
    ]} />);
    // Sharing tab is active by default → the file entry is visible, the bot is not.
    expect(screen.getByText('hello')).toBeVisible();
    expect(screen.getByText('hi bot')).not.toBeVisible();
    // Switch to Hermes → the bot thread shows, the file entry is hidden.
    fireEvent.click(screen.getByRole('button', { name: /Hermes/ }));
    expect(screen.getByText('hi bot')).toBeVisible();
    expect(screen.getByText('hello')).not.toBeVisible();
  });

  it('shows an unread dot on Hermes when bot activity happens while on Sharing, and clears on switch', () => {
    // Streaming deltas rewrite the same bubble, so the dot must track thread
    // changes, not length — this simulates a turn streaming while on Sharing.
    const { rerender } = render(<ChatPanel {...props} botThread={[{ id: 'u1', role: 'user', text: '@hermes hi', streaming: false }]} />);
    rerender(<ChatPanel {...props} botThread={[
      { id: 'u1', role: 'user', text: '@hermes hi', streaming: false },
      { id: 'b1', role: 'assistant', text: '', streaming: true },
    ]} />);
    expect(screen.getByRole('button', { name: /Hermes ●/ })).toBeInTheDocument();
    // Switching to the Hermes tab clears it.
    fireEvent.click(screen.getByRole('button', { name: /Hermes/ }));
    expect(screen.queryByText('●')).toBeNull();
  });

  it('auto-switches to the Hermes tab when an @hermes message is sent', () => {
    const onSendHermes = vi.fn();
    render(<ChatPanel {...props} onSendHermes={onSendHermes} />);
    const input = screen.getByPlaceholderText(/Send message/);
    fireEvent.change(input, { target: { value: '@hermes hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSendHermes).toHaveBeenCalledWith('@hermes hi');
    // The Hermes tab empty state is now visible (we auto-switched to it).
    expect(screen.getByText(/Message the agent below/)).toBeVisible();
  });

  it('shows the New session button on the Hermes tab (hidden on Sharing to keep the tabs stable)', () => {
    const onNewSession = vi.fn();
    render(<ChatPanel {...props} onNewSession={onNewSession} />);
    const btn = screen.getByText('＋ New session');
    expect(btn).not.toBeVisible(); // rendered but hidden on Sharing
    fireEvent.click(screen.getByRole('button', { name: /Hermes/ }));
    expect(btn).toBeVisible();
    fireEvent.click(btn);
    expect(onNewSession).toHaveBeenCalled();
  });

  it('on the Hermes tab, a plain message goes to the agent without @', () => {
    const onSendText = vi.fn();
    const onSendHermes = vi.fn();
    render(<ChatPanel {...props} onSendText={onSendText} onSendHermes={onSendHermes} />);
    fireEvent.click(screen.getByRole('button', { name: /Hermes/ })); // open the agent view
    const input = screen.getByPlaceholderText(/Message Hermes/);
    fireEvent.change(input, { target: { value: 'list the files' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSendHermes).toHaveBeenCalledWith('list the files');
    expect(onSendText).not.toHaveBeenCalled();
  });

  it('does not show the @ mention menu on the Hermes tab', () => {
    render(<ChatPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Hermes/ }));
    const input = screen.getByPlaceholderText(/Message Hermes/);
    fireEvent.change(input, { target: { value: '@' } });
    expect(screen.queryByText('@hermes')).toBeNull(); // no mention menu in the agent view
  });

  it('opens the stored file when a text entry is clicked', () => {
    const onOpenFile = vi.fn();
    const withPath = { ...entry, path: 'Markdown/hi.md' };
    render(<ChatPanel {...props} entries={[withPath]} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByText('hello'));
    expect(onOpenFile).toHaveBeenCalledWith('Markdown/hi.md');
  });
});

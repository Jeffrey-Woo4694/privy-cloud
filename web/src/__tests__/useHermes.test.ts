import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHermes } from '../hermes/useHermes';

// Mock the API + WS modules the hook depends on. `connect` returns a no-op
// disconnect; `hermesCall` is driven per-test. The mount effect auto-creates a
// session and refreshes the list.
const { hermesCall, connect } = vi.hoisted(() => ({ hermesCall: vi.fn(), connect: vi.fn() }));

vi.mock('../api', () => ({ api: { hermesCall } }));
vi.mock('../ws', () => ({ connect }));

type WsEvent = { event: unknown; sessionId: string | null };
let onHermesEvent: ((e: WsEvent) => void) | undefined;

function emit(event: unknown) {
  act(() => onHermesEvent?.({ event, sessionId: 's1' }));
}

beforeEach(() => {
  onHermesEvent = undefined;
  hermesCall.mockReset();
  connect.mockReset();
  connect.mockImplementation((cb: { onHermesEvent: (e: WsEvent) => void }) => {
    onHermesEvent = cb.onHermesEvent;
    return () => {};
  });
  hermesCall.mockImplementation(async (method: string) => {
    if (method === 'session.create') return { session_id: 's1', stored_session_id: 'k1' };
    if (method === 'session.list') return { sessions: [] };
    return {};
  });
});

/// Mount the hook and flush the initial `session.create` so a live session is
/// bound before the action under test runs.
async function mount(): Promise<{ current: ReturnType<typeof useHermes> }> {
  const { result } = renderHook(() => useHermes());
  await act(async () => {});
  return result;
}

describe('useHermes bridge', () => {
  it('auto-creates a session on mount and binds the live id', async () => {
    const result = await mount();
    expect(hermesCall).toHaveBeenCalledWith('session.create', {});
    expect(result.current.state.sessionId).toBe('s1');
    expect(result.current.state.sessionKey).toBe('k1');
  });

  it('setModel issues config.set with a CLI-style value (session-scoped)', async () => {
    const result = await mount();
    await act(async () => {
      await result.current.setModel('anthropic', 'claude-opus-5');
    });
    expect(hermesCall).toHaveBeenCalledWith('config.set', {
      key: 'model',
      value: 'claude-opus-5 --provider anthropic --session',
      session_id: 's1',
    });
    expect(result.current.state.currentModel).toBe('claude-opus-5');
    expect(result.current.state.currentProvider).toBe('anthropic');
  });

  it('setModel uses --global and confirm_expensive_model when requested', async () => {
    const result = await mount();
    await act(async () => {
      await result.current.setModel('openrouter', 'opex', 'global', true);
    });
    expect(hermesCall).toHaveBeenCalledWith('config.set', {
      key: 'model',
      value: 'opex --provider openrouter --global',
      session_id: 's1',
      confirm_expensive_model: true,
    });
  });

  it('setEffort issues config.set for reasoning', async () => {
    const result = await mount();
    await act(async () => {
      await result.current.setEffort('high');
    });
    expect(hermesCall).toHaveBeenCalledWith('config.set', { key: 'reasoning', value: 'high', session_id: 's1' });
    expect(result.current.state.currentEffort).toBe('high');
  });

  it('respondApproval calls approval.respond and clears the pending prompt', async () => {
    const result = await mount();
    emit({ type: 'approval.request', id: 'r1', command: 'cargo test', payload: {} });
    expect(result.current.state.pendingApproval).toMatchObject({ id: 'r1', command: 'cargo test' });

    await act(async () => {
      result.current.respondApproval('allow_once');
    });
    expect(hermesCall).toHaveBeenCalledWith('approval.respond', { session_id: 's1', choice: 'allow_once', all: false });
    expect(result.current.state.pendingApproval).toBeUndefined();
  });

  it('respondApproval deny + all=true', async () => {
    const result = await mount();
    await act(async () => {
      result.current.respondApproval('deny', true);
    });
    expect(hermesCall).toHaveBeenCalledWith('approval.respond', { session_id: 's1', choice: 'deny', all: true });
  });

  it('respondClarify calls clarify.respond with the pending request id', async () => {
    const result = await mount();
    emit({ type: 'clarify.request', id: 'c1', question: 'Pick one?', choices: ['A', 'B'] });
    expect(result.current.state.pendingClarify).toMatchObject({ id: 'c1' });

    await act(async () => {
      result.current.respondClarify('A');
    });
    expect(hermesCall).toHaveBeenCalledWith('clarify.respond', { session_id: 's1', request_id: 'c1', answer: 'A' });
    expect(result.current.state.pendingClarify).toBeUndefined();
  });

  it('attachFile adds a chip and send prepends the ref', async () => {
    hermesCall.mockImplementation(async (method: string) => {
      if (method === 'session.create') return { session_id: 's1', stored_session_id: 'k1' };
      if (method === 'session.list') return { sessions: [] };
      if (method === 'file.attach') return { ref_text: '@file:docs/b.txt' };
      return {};
    });
    const result = await mount();
    await act(async () => {
      await result.current.attachFile('docs/b.txt', 'b.txt');
    });
    expect(result.current.state.pendingAttachments).toHaveLength(1);
    expect(result.current.state.pendingAttachments[0].label).toBe('b.txt');

    hermesCall.mockClear();
    let ok = false;
    act(() => { ok = result.current.send('hello'); });
    expect(ok).toBe(true);
    expect(hermesCall).toHaveBeenCalledWith('prompt.submit', { session_id: 's1', text: '@file:docs/b.txt\nhello' });
    // Attachments cleared after submission.
    expect(result.current.state.pendingAttachments).toHaveLength(0);
  });

  it('attachImage uses image.attach and labels with the file name', async () => {
    hermesCall.mockImplementation(async (method: string) => {
      if (method === 'session.create') return { session_id: 's1', stored_session_id: 'k1' };
      if (method === 'session.list') return { sessions: [] };
      if (method === 'image.attach') return { text: '[User attached image: a.png]' };
      return {};
    });
    const result = await mount();
    await act(async () => {
      await result.current.attachImage('folder/a.png');
    });
    expect(result.current.state.pendingAttachments).toHaveLength(1);
    expect(result.current.state.pendingAttachments[0].label).toBe('a.png');
    expect(result.current.state.pendingAttachments[0].refText).toBe('[User attached image: a.png]');
  });

  it('send routes a slash command to slash.exec and surfaces the output', async () => {
    hermesCall.mockImplementation(async (method: string) => {
      if (method === 'session.create') return { session_id: 's1', stored_session_id: 'k1' };
      if (method === 'session.list') return { sessions: [] };
      if (method === 'slash.exec') return { output: 'ran the command', notice: '' };
      return {};
    });
    const result = await mount();
    hermesCall.mockClear();
    let ok = false;
    act(() => { ok = result.current.send('/help'); });
    expect(ok).toBe(true);
    expect(hermesCall).toHaveBeenCalledWith('slash.exec', { session_id: 's1', command: '/help' });
    // The output is surfaced as an assistant message once the RPC resolves.
    await act(async () => {});
    expect(result.current.state.messages.some((m) => m.role === 'assistant' && m.text === 'ran the command')).toBe(true);
  });

  it('archive returns a markdown transcript from session.history', async () => {
    hermesCall.mockImplementation(async (method: string) => {
      if (method === 'session.create') return { session_id: 's1', stored_session_id: 'k1' };
      if (method === 'session.list') return { sessions: [] };
      if (method === 'session.history') {
        return {
          messages: [
            { role: 'user', text: 'hello' },
            { role: 'assistant', text: 'hi there' },
            { role: 'tool', text: '', name: 'shell', context: '{"cmd":"ls"}' },
          ],
        };
      }
      return {};
    });
    const result = await mount();
    let md = '';
    await act(async () => {
      md = await result.current.archive();
    });
    expect(hermesCall).toHaveBeenCalledWith('session.history', { session_id: 's1' });
    expect(md).toContain('# New session');
    expect(md).toContain('hello');
    expect(md).toContain('hi there');
    expect(md).toContain('shell');
  });

  it('rename sets the title and calls session.title', async () => {
    const result = await mount();
    await act(async () => {
      await result.current.rename('Fix login test');
    });
    expect(hermesCall).toHaveBeenCalledWith('session.title', { session_id: 's1', title: 'Fix login test' });
    expect(result.current.state.title).toBe('Fix login test');
  });

  it('remove closes the live session then deletes by the durable key', async () => {
    const result = await mount();
    await act(async () => {
      await result.current.remove();
    });
    expect(hermesCall).toHaveBeenCalledWith('session.close', { session_id: 's1' });
    expect(hermesCall).toHaveBeenCalledWith('session.delete', { session_id: 'k1' });
    expect(result.current.state.sessionId).toBeUndefined();
    expect(result.current.state.title).toBe('New session');
  });

  it('mostRecent resumes the returned session', async () => {
    hermesCall.mockImplementation(async (method: string) => {
      if (method === 'session.create') return { session_id: 's1', stored_session_id: 'k1' };
      if (method === 'session.list') return { sessions: [] };
      if (method === 'session.most_recent') return { session_id: 'k9', title: 'Last chat' };
      if (method === 'session.resume') return { session_id: 'live-k9', session_key: 'k9', messages: [{ role: 'user', text: 'last' }] };
      return {};
    });
    const result = await mount();
    await act(async () => {
      await result.current.mostRecent();
    });
    expect(hermesCall).toHaveBeenCalledWith('session.most_recent', {});
    expect(hermesCall).toHaveBeenCalledWith('session.resume', { session_id: 'k9' });
    expect(result.current.state.sessionId).toBe('live-k9');
  });
});

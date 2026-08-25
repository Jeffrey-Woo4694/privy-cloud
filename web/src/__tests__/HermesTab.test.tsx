import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { HermesTab } from '../pages/HermesTab';

// Mock the API + WS modules the hook depends on. `connect` captures the
// onHermesEvent callback so tests can drive WS events through the reducer.
const { hermesCall, connect } = vi.hoisted(() => ({
  hermesCall: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('../api', () => ({ api: { hermesCall } }));
vi.mock('../ws', () => ({ connect }));

type WsEvent = { event: unknown; sessionId: string | null };
let onHermesEvent: ((e: WsEvent) => void) | undefined;

function emit(event: unknown, sessionId: string | null = 's1') {
  act(() => onHermesEvent?.({ event, sessionId }));
}

beforeEach(() => {
  onHermesEvent = undefined;
  hermesCall.mockReset();
  connect.mockReset();
  connect.mockImplementation((cb: { onHermesEvent: (e: WsEvent) => void }) => {
    onHermesEvent = cb.onHermesEvent;
    return () => {};
  });
  hermesCall.mockImplementation(async (method: string, params?: { session_id?: string }) => {
    if (method === 'session.create') return { session_id: 's1', stored_session_id: 'k1' };
    if (method === 'session.list') {
      return {
        sessions: [
          { id: 'k1', title: 'Fix login test' },
          { id: 'k2', title: '' },
        ],
      };
    }
    if (method === 'session.resume') {
      const sid = params?.session_id ?? 'k1';
      return {
        session_id: `live-${sid}`,
        session_key: sid,
        messages: [
          { role: 'user', text: `resumed msg for ${sid}` },
          { role: 'assistant', text: `resumed reply for ${sid}` },
        ],
      };
    }
    return {};
  });
});

afterEach(() => cleanup());

describe('HermesTab', () => {
  it('renders the composer and auto-creates a session on mount', async () => {
    render(<HermesTab />);
    expect(screen.getByPlaceholderText(/Ask Hermes/)).toBeInTheDocument();
    await waitFor(() => expect(hermesCall).toHaveBeenCalledWith('session.create', {}));
    expect(connect).toHaveBeenCalled();
  });

  it('sends a user message on Enter: prompt.submit + user bubble', async () => {
    render(<HermesTab />);
    await waitFor(() => expect(hermesCall).toHaveBeenCalledWith('session.create', {}));

    const input = screen.getByPlaceholderText(/Ask Hermes/);
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(hermesCall).toHaveBeenCalledWith('prompt.submit', { session_id: 's1', text: 'hello' });
    expect(await screen.findByText('hello')).toBeInTheDocument();
  });

  it('streams assistant text from WS events', async () => {
    render(<HermesTab />);
    await waitFor(() => expect(hermesCall).toHaveBeenCalledWith('session.create', {}));

    emit({ type: 'message.start' });
    emit({ type: 'message.delta', text: 'hel' });
    emit({ type: 'message.delta', text: 'lo' });

    expect(await screen.findByText('hello')).toBeInTheDocument();
  });

  it('shows tool cards with a running indicator under the assistant message', async () => {
    render(<HermesTab />);
    await waitFor(() => expect(hermesCall).toHaveBeenCalledWith('session.create', {}));

    emit({ type: 'message.start' });
    emit({ type: 'tool.start', id: 't1', name: 'shell', preview: 'cargo test' });
    emit({ type: 'tool.complete', id: 't1', name: 'shell', ok: true });

    expect(await screen.findByText('shell')).toBeInTheDocument();
    expect(screen.getByText('cargo test')).toBeInTheDocument();
  });

  it('button becomes Stop while streaming; click calls session.interrupt', async () => {
    render(<HermesTab />);
    await waitFor(() => expect(hermesCall).toHaveBeenCalledWith('session.create', {}));

    emit({ type: 'message.start' });

    const stopBtn = await screen.findByRole('button', { name: /stop/i });
    fireEvent.click(stopBtn);
    expect(hermesCall).toHaveBeenCalledWith('session.interrupt', { session_id: 's1' });
  });

  it('steers mid-turn when streaming: Enter calls session.steer and renders a steer note', async () => {
    render(<HermesTab />);
    await waitFor(() => expect(hermesCall).toHaveBeenCalledWith('session.create', {}));

    emit({ type: 'message.start' });

    const input = screen.getByPlaceholderText(/Ask Hermes/);
    fireEvent.change(input, { target: { value: 'go faster' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(hermesCall).toHaveBeenCalledWith('session.steer', { session_id: 's1', text: 'go faster' });
    // The steer text is pushed via pushSteer, so it renders as a distinct
    // steer note (with the "mid-turn steer" label), NOT a user bubble.
    expect(await screen.findByText('go faster')).toBeInTheDocument();
    expect(screen.getByText('mid-turn steer')).toBeInTheDocument();
  });

  it('send() no-ops without a session (session.create failed)', async () => {
    hermesCall.mockImplementation(async () => {
      throw new Error('hermes down');
    });
    render(<HermesTab />);
    await waitFor(() => expect(hermesCall).toHaveBeenCalledWith('session.create', {}));

    const input = screen.getByPlaceholderText(/Ask Hermes/);
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(hermesCall).not.toHaveBeenCalledWith('prompt.submit', expect.anything());
    expect(screen.queryByText('hi')).not.toBeInTheDocument();
    // send() returned false (no session), so the draft input is NOT cleared.
    expect(input).toHaveValue('hi');
  });

  it('undo pops the last turn and calls session.undo', async () => {
    render(<HermesTab />);
    await waitFor(() => expect(hermesCall).toHaveBeenCalledWith('session.create', {}));

    const input = screen.getByPlaceholderText(/Ask Hermes/);
    fireEvent.change(input, { target: { value: 'fix it' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    emit({ type: 'message.start' });
    emit({ type: 'message.delta', text: 'don' });
    emit({ type: 'message.complete', text: 'done', status: 'ok' });
    expect(await screen.findByText('done')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(hermesCall).toHaveBeenCalledWith('session.undo', { session_id: 's1' });
    await waitFor(() => {
      expect(screen.queryByText('fix it')).not.toBeInTheDocument();
      expect(screen.queryByText('done')).not.toBeInTheDocument();
    });
  });

  it('renders a New session button and lists sessions from session.list', async () => {
    render(<HermesTab />);
    expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();

    await waitFor(() => expect(hermesCall).toHaveBeenCalledWith('session.list', { limit: 200 }));
    expect(await screen.findByRole('button', { name: /fix login test/i })).toBeInTheDocument();
    // `session.list` keys entries by `id` (not `session_id`); an empty title
    // falls back to the id.
    expect(screen.getByRole('button', { name: 'k2' })).toBeInTheDocument();

    // The auto-created session (durable key `k1`) is the highlighted row.
    expect(screen.getByRole('button', { name: /fix login test/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('New session button creates a fresh session and clears the transcript', async () => {
    render(<HermesTab />);
    await waitFor(() => expect(hermesCall).toHaveBeenCalledWith('session.create', {}));

    const input = screen.getByPlaceholderText(/Ask Hermes/);
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('hello')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /new session/i }));

    await waitFor(() => {
      expect(hermesCall.mock.calls.filter(([m]) => m === 'session.create')).toHaveLength(2);
    });
    await waitFor(() => expect(screen.queryByText('hello')).not.toBeInTheDocument());
  });

  it('resumes a session from the list: calls session.resume and loads its transcript', async () => {
    render(<HermesTab />);
    await waitFor(() => expect(hermesCall).toHaveBeenCalledWith('session.list', { limit: 200 }));

    const row = await screen.findByRole('button', { name: 'k2' });
    fireEvent.click(row);

    expect(hermesCall).toHaveBeenCalledWith('session.resume', { session_id: 'k2' });
    expect(await screen.findByText('resumed msg for k2')).toBeInTheDocument();
    expect(screen.getByText('resumed reply for k2')).toBeInTheDocument();

    // The resumed session is now the highlighted row.
    expect(screen.getByRole('button', { name: 'k2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /fix login test/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders an assistant reply as markdown (bold becomes a strong element)', async () => {
    render(<HermesTab />);
    await waitFor(() => expect(hermesCall).toHaveBeenCalledWith('session.create', {}));

    emit({ type: 'message.start' });
    emit({ type: 'message.complete', text: '**hi**', status: 'ok' });

    const strong = await waitFor(() => {
      const el = document.querySelector('strong');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(strong.textContent).toBe('hi');
  });
});

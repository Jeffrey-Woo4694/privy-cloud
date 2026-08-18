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
  hermesCall.mockImplementation(async (method: string) => {
    if (method === 'session.create') return { session_id: 's1', stored_session_id: 'k1' };
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

  it('steers mid-turn when streaming: Enter calls session.steer', async () => {
    render(<HermesTab />);
    await waitFor(() => expect(hermesCall).toHaveBeenCalledWith('session.create', {}));

    emit({ type: 'message.start' });

    const input = screen.getByPlaceholderText(/Ask Hermes/);
    fireEvent.change(input, { target: { value: 'go faster' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(hermesCall).toHaveBeenCalledWith('session.steer', { session_id: 's1', text: 'go faster' });
    expect(await screen.findByText('go faster')).toBeInTheDocument();
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
});

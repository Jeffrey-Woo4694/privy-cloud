// Hermes WebSocket client for the Hermes Agent integration.
// Ported from the Rust reference implementation (`hermes_client::client` in
// Native-Hermes). Faithfully mirrors: the `ws://127.0.0.1:{port}/api/ws?token={token}`
// URL, the incrementing id + pending-map response correlation, the `ClientEvent`
// variants (event/response/error/disconnected), the heartbeat (WS ping every 15s,
// idle timeout 120s -> Disconnected), the request timeout (120s), and the
// pending-drain on close/error (reject all in-flight calls).

import { WebSocket } from 'ws';
import { decodeFrame, encodeRequest } from './jsonrpc.js';
import { parseAgentEvent, type AgentEvent } from './events.js';

export type ClientEvent =
  | { kind: 'event'; event: AgentEvent; sessionId: string | null }
  | { kind: 'response'; id: number; result: unknown }
  | { kind: 'error'; id: number; code: number; message: string }
  | { kind: 'disconnected' };

export interface HermesClient {
  call(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): void;
  shutdown(): void;
}

/// Request timeout for RPC calls, per the plan's global constraint
/// "Request timeout default 120 s (RPC calls)".
export const REQUEST_TIMEOUT_MS = 120_000;
/// How often the heartbeat sends a WS ping.
export const HEARTBEAT_INTERVAL_MS = 15_000;
/// If no frame (including pong replies) arrives within this window, the
/// connection is presumed dead and the client emits `Disconnected`.
export const HEARTBEAT_IDLE_TIMEOUT_MS = 120_000;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/// An RPC-call rejection carrying the JSON-RPC error code, mirroring Rust's
/// `ClientError::Call { code, message }`.
function clientError(code: number, message: string): Error & { code: number } {
  const err = new Error(message) as Error & { code: number };
  err.code = code;
  return err;
}

export function connectHermes(
  port: number,
  token: string,
  onEvent: (e: ClientEvent) => void,
): Promise<HermesClient> {
  const url = `ws://127.0.0.1:${port}/api/ws?token=${token}`;
  const ws = new WebSocket(url);

  return new Promise<HermesClient>((resolve, reject) => {
    let nextId = 1;
    const pending = new Map<number, PendingCall>();
    let lastActivity = Date.now();
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let tornDown = false;
    let disconnectedFired = false;
    let opened = false;

    function fireEvent(e: ClientEvent): void {
      try {
        onEvent(e);
      } catch (err) {
        // A throwing consumer must not break the read loop.
        // eslint-disable-next-line no-console
        console.error('hermes client onEvent threw', err);
      }
    }

    function fireDisconnectedOnce(): void {
      if (disconnectedFired) return;
      disconnectedFired = true;
      fireEvent({ kind: 'disconnected' });
    }

    function teardown(): void {
      if (tornDown) return;
      tornDown = true;
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      // Reject every in-flight call so `call()` futures resolve with an error
      // instead of hanging forever (mirrors the Rust pending drain).
      for (const call of pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error('Hermes connection closed'));
      }
      pending.clear();
    }

    function heartbeatTick(): void {
      if (tornDown) return;
      const now = Date.now();
      if (now - lastActivity >= HEARTBEAT_IDLE_TIMEOUT_MS) {
        // The connection has been silent too long; presume it dead.
        fireDisconnectedOnce();
        teardown();
        try { ws.close(); } catch { /* already closing */ }
        return;
      }
      // A healthy-but-idle connection earns a pong (activity) and a dead one
      // stays silent (-> the idle timeout above).
      try { ws.ping(); } catch { /* socket gone; the close handler owns teardown */ }
    }

    ws.on('open', () => {
      opened = true;
      heartbeatTimer = setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();
      resolve(client);
    });

    // The Rust read loop stamps `last_activity` on every incoming frame — not
    // just text frames. In `ws`, the peer's auto-pong (and a peer ping) are
    // surfaced as `pong`/`ping` events rather than `message`, so stamp those
    // too: a healthy-but-idle connection earning pongs must not trip the idle
    // timeout.
    ws.on('pong', () => { lastActivity = Date.now(); });
    ws.on('ping', () => { lastActivity = Date.now(); });

    ws.on('message', (data: unknown) => {
      lastActivity = Date.now();
      const text = typeof data === 'string' ? data : (data as Buffer).toString('utf8');

      let frame;
      try {
        frame = decodeFrame(text);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('hermes client failed to decode frame', err);
        return;
      }

      switch (frame.kind) {
        case 'response': {
          const call = pending.get(frame.id);
          if (call) {
            pending.delete(frame.id);
            clearTimeout(call.timer);
            call.resolve(frame.result);
          } else {
            // No pending call for this id: surface it so the frame isn't
            // silently dropped (mirrors the Rust `Response` event).
            fireEvent({ kind: 'response', id: frame.id, result: frame.result });
          }
          break;
        }
        case 'error': {
          // An Error frame with a null id can't be represented in
          // ClientEvent::Error; drop it (mirrors Rust).
          if (frame.id === null) break;
          const call = pending.get(frame.id);
          if (call) {
            pending.delete(frame.id);
            clearTimeout(call.timer);
            call.reject(clientError(frame.code, frame.message));
          } else {
            fireEvent({ kind: 'error', id: frame.id, code: frame.code, message: frame.message });
          }
          break;
        }
        case 'event': {
          const event = parseAgentEvent(frame.eventType, frame.payload);
          fireEvent({ kind: 'event', event, sessionId: frame.sessionId });
          break;
        }
        default:
          // Request frames from the gateway are not expected on a client
          // socket; ignore them (mirrors Rust `Ok(_) => {}`).
          break;
      }
    });

    ws.on('error', (err) => {
      if (!opened) {
        reject(err);
        return;
      }
      // eslint-disable-next-line no-console
      console.warn('hermes client ws error', err.message);
      fireDisconnectedOnce();
      teardown();
    });

    ws.on('close', () => {
      if (!opened) {
        reject(new Error(`WebSocket closed before opening (${url})`));
        return;
      }
      // An explicit `shutdown()` already tore down without emitting
      // Disconnected; a server/network close emits it here.
      if (tornDown) return;
      fireDisconnectedOnce();
      teardown();
    });

    const client: HermesClient = {
      call(method, params) {
        return new Promise<unknown>((resolveCall, rejectCall) => {
          const id = nextId++;
          const timer = setTimeout(() => {
            // The call never got a correlated response in time; drop the
            // pending entry so a late response surfaces as an event.
            pending.delete(id);
            rejectCall(clientError(-32000, 'request timed out after 120s'));
          }, REQUEST_TIMEOUT_MS);
          timer.unref?.();
          pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });

          if (ws.readyState !== WebSocket.OPEN) {
            pending.delete(id);
            clearTimeout(timer);
            rejectCall(new Error('Hermes connection is not open'));
            return;
          }
          try {
            ws.send(encodeRequest(id, method, params), (err) => {
              if (!err) return;
              // The frame could not be sent; the channel is likely gone.
              if (pending.has(id)) {
                pending.delete(id);
                clearTimeout(timer);
                rejectCall(new Error(`Hermes send failed: ${err.message}`));
              }
            });
          } catch (err) {
            if (pending.has(id)) {
              pending.delete(id);
              clearTimeout(timer);
              rejectCall(err instanceof Error ? err : new Error(String(err)));
            }
          }
        });
      },
      notify(method, params) {
        // Fire-and-forget: allocate an id (so a late response surfaces as a
        // Response event, mirroring Rust) but register no pending entry.
        const id = nextId++;
        if (ws.readyState !== WebSocket.OPEN) return; // drop silently
        try {
          ws.send(encodeRequest(id, method, params));
        } catch {
          // Nothing to reject.
        }
      },
      shutdown() {
        // Mirror Rust: an explicit shutdown drains pending with a channel
        // error but does NOT emit Disconnected.
        teardown();
        try { ws.close(); } catch { /* already closed */ }
      },
    };
  });
}

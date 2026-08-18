// `useHermes()` — the React bridge between the Hermes tab UI and the backend
// relay (REST commands + WS event stream). Owns the reducer state, auto-creates
// a session on mount (R5), and exposes the send/stop/undo actions.
//
// Session bootstrap (R5): the chat UI needs a session to submit to, but the
// session *list* is a later task. So on mount we call `session.create` and
// stash the returned `session_id` (live) / `stored_session_id` (durable key)
// into the reducer state. If it fails (backend/hermes down) we stay in a
// no-session state and `send()` no-ops gracefully — the UI never crashes.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { connect } from '../ws';
import { applyAgentEvent, initialHermesState, pushUser, undoLastTurn } from './reducer';
import type { HermesState } from './types';

interface SessionCreated {
  session_id?: string;
  stored_session_id?: string;
}

export function useHermes(): {
  state: HermesState;
  send(text: string): void;
  stop(): void;
  undo(): void;
} {
  const [state, setState] = useState<HermesState>(initialHermesState());

  // Keep the latest committed state readable from the stable callbacks below
  // (send/stop/undo are recreated once and must not capture stale state).
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const disconnect = connect({
      onHermesEvent: (e) => setState((s) => applyAgentEvent(s, e.event)),
    });
    api
      .hermesCall('session.create', {})
      .then((result) => {
        const r = (result ?? {}) as SessionCreated;
        if (r.session_id) {
          setState((s) => ({
            ...s,
            sessionId: r.session_id,
            sessionKey: r.stored_session_id ?? r.session_id,
          }));
        }
      })
      .catch(() => {
        // Backend/hermes down — no session, send() no-ops.
      });
    return disconnect;
  }, []);

  const send = useCallback((text: string) => {
    const { sessionId, streaming } = stateRef.current;
    if (!sessionId) return;
    setState((s) => pushUser(s, text));
    void api.hermesCall(streaming ? 'session.steer' : 'prompt.submit', { session_id: sessionId, text });
  }, []);

  const stop = useCallback(() => {
    const { sessionId } = stateRef.current;
    if (!sessionId) return;
    void api.hermesCall('session.interrupt', { session_id: sessionId });
  }, []);

  const undo = useCallback(() => {
    const { sessionId } = stateRef.current;
    if (!sessionId) return;
    void api.hermesCall('session.undo', { session_id: sessionId });
    setState((s) => undoLastTurn(s));
  }, []);

  return { state, send, stop, undo };
}

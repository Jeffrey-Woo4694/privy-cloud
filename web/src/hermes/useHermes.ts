// `useHermes()` — the React bridge between the Hermes tab UI and the backend
// relay (REST commands + WS event stream). Owns the reducer state, auto-creates
// a session on mount (R5), exposes the send/stop/undo actions, and manages the
// session list (new / resume / list).
//
// Session bootstrap (R5): the chat UI needs a session to submit to. On mount we
// call `session.create` and stash the returned `session_id` (live) /
// `stored_session_id` (durable key) into the reducer state, and refresh the
// session list via `session.list`. If it fails (backend/hermes down) we stay in
// a no-session state and `send()` no-ops gracefully — the UI never crashes.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { connect } from '../ws';
import { applyAgentEvent, initialHermesState, pushUser, undoLastTurn, resyncMessages } from './reducer';
import type { AgentEvent, HermesState, ResyncItem } from './types';

interface SessionCreated {
  session_id?: string;
  stored_session_id?: string;
}

interface SessionResumed {
  session_id?: string;
  session_key?: string;
  stored_session_id?: string;
  messages?: Array<{ role?: string; text?: string; name?: string; context?: string }>;
}

export interface SessionSummary {
  id: string;
  title: string;
}

/// Parse a `session.list` response. Entries are keyed by `id` (the DB primary
/// key), NOT `session_id` — accept `session_id` as a fallback for robustness.
/// An empty/absent title falls back to the id (matching the reference
/// `parse_sessions` in Native-Hermes/src/app.rs).
function parseSessions(result: unknown): SessionSummary[] {
  const r = (result ?? {}) as { sessions?: Array<{ id?: string; session_id?: string; title?: string }> };
  const arr = Array.isArray(r.sessions) ? r.sessions : [];
  const out: SessionSummary[] = [];
  for (const s of arr) {
    const id = s.id ?? s.session_id ?? '';
    if (!id) continue;
    out.push({ id, title: s.title || id });
  }
  return out;
}

/// Parse the `messages` array of a `session.resume` response into the
/// `ResyncItem[]` the reducer's `resyncMessages` expects. Tool items carry
/// `name`/`context`; unknown roles are dropped (matching the reference
/// `parse_history`).
function parseResumeMessages(result: unknown): ResyncItem[] {
  const r = result as SessionResumed;
  const arr = Array.isArray(r?.messages) ? r.messages : [];
  const out: ResyncItem[] = [];
  for (const m of arr) {
    const role = m.role ?? '';
    if (role !== 'user' && role !== 'assistant' && role !== 'tool') continue;
    out.push({ role, text: m.text ?? '', toolName: m.name, toolContext: m.context });
  }
  return out;
}

export function useHermes(): {
  state: HermesState;
  send(text: string): void;
  stop(): void;
  undo(): void;
  sessions: SessionSummary[];
  newSession(): void;
  resume(id: string): void;
} {
  const [state, setState] = useState<HermesState>(initialHermesState());
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  // Keep the latest committed state readable from the stable callbacks below
  // (send/stop/undo are recreated once and must not capture stale state).
  const stateRef = useRef(state);
  stateRef.current = state;

  const refreshSessions = useCallback(() => {
    api
      .hermesCall('session.list', { limit: 200 })
      .then((result) => setSessions(parseSessions(result)))
      .catch(() => {
        // Backend/hermes down — leave the list as-is.
      });
  }, []);

  useEffect(() => {
    const disconnect = connect({
      onHermesEvent: (e) => {
        setState((s) => applyAgentEvent(s, e.event));
        // Keep the sidebar in sync as turns complete (the reference debounces
        // this; v1 refreshes directly — one `session.list` RPC per turn).
        if ((e.event as AgentEvent).type === 'message.complete') refreshSessions();
      },
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
    refreshSessions();
    return disconnect;
  }, [refreshSessions]);

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

  const newSession = useCallback(() => {
    api
      .hermesCall('session.create', {})
      .then((result) => {
        const r = (result ?? {}) as SessionCreated;
        if (!r.session_id) return;
        setState((s) => ({
          // A fresh session starts with an empty transcript; drop the previous
          // session's messages (mirrors the reference `create_session`).
          ...resyncMessages(s, []),
          sessionId: r.session_id,
          sessionKey: r.stored_session_id ?? r.session_id,
        }));
        refreshSessions();
      })
      .catch(() => {
        // Backend/hermes down — keep the current session.
      });
  }, [refreshSessions]);

  const resume = useCallback((id: string) => {
    api
      .hermesCall('session.resume', { session_id: id })
      .then((result) => {
        const r = (result ?? {}) as SessionResumed;
        if (!r.session_id) return;
        // `session_key` / `stored_session_id` is the durable id — used to
        // resume this session on a fresh serve after a reconnect. `session_id`
        // is the live id the gateway routes events to.
        const durable = r.session_key ?? r.stored_session_id ?? id;
        setState((s) => ({
          ...resyncMessages(s, parseResumeMessages(r)),
          sessionId: r.session_id,
          sessionKey: durable,
        }));
        refreshSessions();
      })
      .catch(() => {
        // Resume failed — keep the current session.
      });
  }, [refreshSessions]);

  return { state, send, stop, undo, sessions, newSession, resume };
}

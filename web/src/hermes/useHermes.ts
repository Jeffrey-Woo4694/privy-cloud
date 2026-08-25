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
import {
  addAttachment,
  applyAgentEvent,
  clearAttachments,
  initialHermesState,
  pushAssistant,
  pushSteer,
  pushUser,
  resyncMessages,
  takeAttachments,
  undoLastTurn,
} from './reducer';
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

/// Build a Markdown transcript for the Archive action, mirroring Native-Hermes's
/// archive format (role headers + text; tool items as blockquotes).
function buildMarkdownTranscript(title: string, items: ResyncItem[]): string {
  const lines = [`# ${title || 'Hermes session'}`, ''];
  for (const item of items) {
    if (item.role === 'user') {
      lines.push('**You:**', '', item.text, '');
    } else if (item.role === 'assistant') {
      lines.push('**Assistant:**', '', item.text, '');
    } else if (item.role === 'tool') {
      lines.push(`> \`${item.toolName ?? 'tool'}\`${item.toolContext ? ` — ${item.toolContext}` : ''}`, '');
    }
  }
  return lines.join('\n');
}

export type ApprovalChoice = 'approve' | 'allow_once' | 'deny';

export function useHermes(): {
  state: HermesState;
  send(text: string): boolean;
  stop(): void;
  undo(): void;
  sessions: SessionSummary[];
  newSession(): void;
  resume(id: string): void;
  setModel(providerSlug: string, model: string, scope?: 'session' | 'global', confirmExpensive?: boolean): Promise<unknown>;
  setEffort(level: string): Promise<void>;
  respondApproval(choice: ApprovalChoice, all?: boolean): void;
  respondClarify(answer: string): void;
  attachImage(path: string): Promise<void>;
  attachFile(path: string, name: string): Promise<void>;
  archive(): Promise<string>;
  rename(title: string): Promise<void>;
  remove(): Promise<void>;
  mostRecent(): Promise<void>;
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

  const send = useCallback((text: string): boolean => {
    const { sessionId, streaming } = stateRef.current;
    if (!sessionId) return false;
    const trimmed = text.trim();
    if (!trimmed) return false;

    // Slash command: route to `slash.exec` and surface its output as an
    // assistant message, instead of submitting a normal prompt.
    if (trimmed.startsWith('/')) {
      setState((s) => pushUser(s, trimmed));
      void api
        .hermesCall('slash.exec', { session_id: sessionId, command: trimmed })
        .then((result) => {
          const r = (result ?? {}) as { output?: string; notice?: string; message?: string };
          const out = [r.output, r.notice, r.message].filter((x): x is string => !!x).join('\n');
          if (out) setState((s) => pushAssistant(s, out));
        })
        .catch(() => {
          // Slash failed — the user message stays; no crash.
        });
      return true;
    }

    // Attachment refs are prepended to the submitted prompt, then cleared.
    const refs = takeAttachments(stateRef.current);
    const finalText = refs.length ? `${refs.join('\n')}\n${text}` : text;
    // A mid-turn steer note is rendered distinctly from a user message (the
    // reducer's `pushSteer` + the `'steer'` role), so route it accordingly
    // instead of always pushing a user bubble.
    setState((s) => {
      const withMsg = streaming ? pushSteer(s, text) : pushUser(s, text);
      return clearAttachments(withMsg);
    });
    void api.hermesCall(streaming ? 'session.steer' : 'prompt.submit', { session_id: sessionId, text: finalText });
    return true;
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

  const setModel = useCallback(
    async (providerSlug: string, model: string, scope: 'session' | 'global' = 'session', confirmExpensive = false) => {
      const { sessionId } = stateRef.current;
      // `config.set` takes a CLI-style string, not a JSON object. Session-scoped
      // switches avoid writing config.yaml (which would trip the watcher and
      // force a serve restart mid-chat).
      const value = `${model} --provider ${providerSlug} --${scope === 'global' ? 'global' : 'session'}`;
      const params: Record<string, unknown> = { key: 'model', value, session_id: sessionId };
      if (confirmExpensive) params.confirm_expensive_model = true;
      setState((s) => ({ ...s, currentModel: model, currentProvider: providerSlug }));
      return api.hermesCall('config.set', params);
    },
    []
  );

  const setEffort = useCallback(async (level: string) => {
    const { sessionId } = stateRef.current;
    setState((s) => ({ ...s, currentEffort: level }));
    await api.hermesCall('config.set', { key: 'reasoning', value: level, session_id: sessionId });
  }, []);

  const respondApproval = useCallback((choice: ApprovalChoice, all = false) => {
    const { sessionId } = stateRef.current;
    setState((s) => ({ ...s, pendingApproval: undefined }));
    if (sessionId) void api.hermesCall('approval.respond', { session_id: sessionId, choice, all });
  }, []);

  const respondClarify = useCallback((answer: string) => {
    const { sessionId, pendingClarify } = stateRef.current;
    const requestId = pendingClarify?.id ?? '';
    setState((s) => ({ ...s, pendingClarify: undefined }));
    if (sessionId && requestId) void api.hermesCall('clarify.respond', { session_id: sessionId, request_id: requestId, answer });
  }, []);

  const attachImage = useCallback(async (path: string) => {
    const { sessionId } = stateRef.current;
    if (!sessionId) return;
    try {
      const result = (await api.hermesCall('image.attach', { session_id: sessionId, path })) as { text?: string };
      const label = path.split('/').pop() ?? path;
      setState((s) => addAttachment(s, label, result?.text ?? `[User attached image: ${label}]`));
    } catch {
      // Attach failed — ignore; the chip is not added.
    }
  }, []);

  const attachFile = useCallback(async (path: string, name: string) => {
    const { sessionId } = stateRef.current;
    if (!sessionId) return;
    try {
      const result = (await api.hermesCall('file.attach', { session_id: sessionId, path, name })) as { ref_text?: string };
      setState((s) => addAttachment(s, name, result?.ref_text ?? `@file:${path}`));
    } catch {
      // Attach failed — ignore; the chip is not added.
    }
  }, []);

  const archive = useCallback(async () => {
    const { sessionId, title } = stateRef.current;
    if (!sessionId) return '';
    const result = (await api.hermesCall('session.history', { session_id: sessionId })) as SessionResumed;
    return buildMarkdownTranscript(title, parseResumeMessages(result));
  }, []);

  const rename = useCallback(
    async (title: string) => {
      const { sessionId } = stateRef.current;
      setState((s) => ({ ...s, title }));
      if (!sessionId) return;
      await api.hermesCall('session.title', { session_id: sessionId, title });
      refreshSessions();
    },
    [refreshSessions]
  );

  const remove = useCallback(async () => {
    const { sessionId, sessionKey } = stateRef.current;
    if (!sessionId) return;
    // Close the live session first (delete refuses active sessions), then
    // delete by the durable key.
    await api.hermesCall('session.close', { session_id: sessionId });
    if (sessionKey && sessionKey !== sessionId) {
      await api.hermesCall('session.delete', { session_id: sessionKey });
    }
    setState((s) => ({
      ...resyncMessages(s, []),
      sessionId: undefined,
      sessionKey: undefined,
      title: 'New session',
    }));
    refreshSessions();
  }, [refreshSessions]);

  const mostRecent = useCallback(async () => {
    const result = (await api.hermesCall('session.most_recent', {})) as { session_id?: string; title?: string };
    if (result?.session_id) resume(result.session_id);
  }, [resume]);

  return { state, send, stop, undo, sessions, newSession, resume, setModel, setEffort, respondApproval, respondClarify, attachImage, attachFile, archive, rename, remove, mostRecent };
}

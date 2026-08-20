// A dedicated Hermes session for the Privy Cloud chat, so `@hermes <task>` can
// drive the agent against the shared files. Keeps ONE session whose working
// directory is the Privy Cloud base, resumes it across reloads (restoring the
// recent conversation), and renders the bot thread (user turns + streamed
// assistant replies) into the chat. Tool activity is intentionally hidden
// (user choice) — only the agent's text replies are shown.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { AgentEvent } from './types';

export interface PrivyBotMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming: boolean;
  error?: boolean;
}

const SESSION_KEY = 'privy-hermes-session-key';
const HISTORY_LIMIT = 10;

let counter = 0;
const nextId = (): string => `b${++counter}`;

export function usePrivyHermes(cwd: string): {
  botThread: PrivyBotMessage[];
  sendTask(text: string): void;
  handleEvent(e: { event: AgentEvent; sessionId: string | null }): void;
} {
  const [botThread, setBotThread] = useState<PrivyBotMessage[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  const setLiveSession = useCallback((sid: string, key: string) => {
    sessionIdRef.current = sid;
    localStorage.setItem(SESSION_KEY, key);
  }, []);

  const push = useCallback((msg: Omit<PrivyBotMessage, 'id'>) => {
    setBotThread((t) => [...t, { ...msg, id: nextId() }]);
  }, []);

  // Restore the persisted session (and its recent conversation) once cwd is known.
  useEffect(() => {
    if (!cwd || sessionIdRef.current) return;
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return;
    let cancelled = false;
    api
      .hermesCall('session.resume', { session_id: stored })
      .then((r) => {
        if (cancelled) return;
        const res = (r ?? {}) as { session_id?: string; session_key?: string; stored_session_id?: string; messages?: Array<{ role?: string; text?: string }> };
        if (!res.session_id) return;
        setLiveSession(res.session_id, res.session_key ?? res.stored_session_id ?? stored);
        const msgs = (res.messages ?? []).filter((m) => m.role === 'user' || m.role === 'assistant').slice(-HISTORY_LIMIT);
        setBotThread(msgs.map((m) => ({ id: nextId(), role: m.role as 'user' | 'assistant', text: m.text ?? '', streaming: false })));
      })
      .catch(() => { if (!cancelled) localStorage.removeItem(SESSION_KEY); });
    return () => { cancelled = true; };
  }, [cwd, setLiveSession]);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    try {
      const params = cwdRef.current ? { cwd: cwdRef.current } : {};
      const created = (await api.hermesCall('session.create', params)) as { session_id?: string; stored_session_id?: string };
      if (!created.session_id) return null;
      setLiveSession(created.session_id, created.stored_session_id ?? created.session_id);
      return created.session_id;
    } catch {
      return null;
    }
  }, [setLiveSession]);

  const sendTask = useCallback((text: string) => {
    const task = text.replace(/^@hermes\b\s*/i, '').trim();
    push({ role: 'user', text, streaming: false });
    if (!task) {
      push({ role: 'assistant', text: 'What would you like me to do?', streaming: false });
      return;
    }
    void ensureSession().then((sid) => {
      if (!sid) {
        push({ role: 'assistant', text: '⚠️ Could not reach Hermes — is the backend/hermes running?', streaming: false, error: true });
        return;
      }
      api
        .hermesCall('prompt.submit', { session_id: sid, text: task })
        .catch(() => push({ role: 'assistant', text: '⚠️ Failed to send the task to Hermes.', streaming: false, error: true }));
    });
  }, [ensureSession, push]);

  const handleEvent = useCallback((e: { event: AgentEvent; sessionId: string | null }) => {
    if (e.sessionId && e.sessionId !== sessionIdRef.current) return;
    const ev = e.event;
    switch (ev.type) {
      case 'message.start':
        push({ role: 'assistant', text: '', streaming: true });
        break;
      case 'message.delta':
        setBotThread((t) => {
          const last = t[t.length - 1];
          if (!last || last.role !== 'assistant' || !last.streaming) return t;
          const copy = [...t];
          copy[copy.length - 1] = { ...last, text: last.text + ev.text };
          return copy;
        });
        break;
      case 'message.complete':
        setBotThread((t) => {
          const last = t[t.length - 1];
          if (!last || last.role !== 'assistant' || !last.streaming) return t;
          const copy = [...t];
          copy[copy.length - 1] = { ...last, text: ev.text, streaming: false };
          return copy;
        });
        break;
      default:
        break;
    }
  }, [push]);

  return { botThread, sendTask, handleEvent };
}

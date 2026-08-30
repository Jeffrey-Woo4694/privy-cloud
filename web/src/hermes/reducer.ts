// Pure agent-event reducer for the Hermes Agent integration.
// Ported from the Rust reference implementation (`src/state/view.rs` in
// Native-Hermes). The Rust `apply(&mut self)` mutates in place; every function
// here is a PURE function that returns a NEW `HermesState` and never mutates
// the input.
//
// Scope: message lifecycle, tool cards, thinking/reasoning (buffered before
// `message.start`, then committed), subagent tree (snapshotted into the message
// on complete), approval/clarify prompts, session.info (model/provider),
// status/error, delegation-plumbing + contentless + model-switch-marker
// filtering, attachments, push/pop/resync/undo.

import type {
  AgentEvent,
  HermesState,
  Message,
  ResyncItem,
  SubagentNode,
  ToolCard,
} from './types';

/// True when `text` is a gateway-injected delegation plumbing message — the
/// synthetic `[ASYNC DELEGATION BATCH COMPLETE — deleg_…]` (fan-out) or
/// `[ASYNC DELEGATION COMPLETE — deleg_…]` (single) turn the gateway forges
/// when a background subagent finishes. It is agent-internal bookkeeping, not
/// content the user asked for, so the UI drops it instead of rendering it.
export function isDelegationPlumbing(text: string): boolean {
  return (
    text.startsWith('[ASYNC DELEGATION BATCH COMPLETE') ||
    text.startsWith('[ASYNC DELEGATION COMPLETE')
  );
}

/// True when `text` is the gateway's model-switch marker — the synthetic
/// `[System: The active model for this chat has changed to …]` user message
/// appended to history after a live model switch. Its purpose is to inform the
/// model's context, not the user; rendering it as a transcript message is
/// plumbing noise, so the UI drops it.
export function isModelSwitchMarker(text: string): boolean {
  return text.startsWith('[System: The active model for this chat has changed to');
}

/// True when a message carries nothing worth rendering: no text, no tool cards,
/// no thinking/reasoning. Such a message is pure plumbing — e.g. the agent's
/// main turn that only delegated to a background subagent — and is removed from
/// the transcript instead of rendering as a bare empty role marker.
export function isContentless(msg: Message): boolean {
  return (
    msg.text.trim().length === 0 &&
    msg.tools.length === 0 &&
    (msg.thinking?.trim().length ?? 0) === 0 &&
    (msg.reasoning?.trim().length ?? 0) === 0
  );
}

/// Index of the last element satisfying `pred`, or -1 when none does.
function findLastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

export function initialHermesState(): HermesState {
  return {
    title: 'New session',
    messages: [],
    streaming: false,
    status: '',
    nextMessageId: 1,
    pendingAttachments: [],
    subagents: [],
    pendingThinking: '',
    pendingReasoning: '',
  };
}

/// Append a completed user message (returns the new state).
export function pushUser(state: HermesState, text: string): HermesState {
  const id = state.nextMessageId;
  const msg: Message = { id, role: 'user', text, streaming: false, tools: [], complete: true };
  return { ...state, messages: [...state.messages, msg], nextMessageId: id + 1 };
}

/// Append a completed assistant message — used to surface slash-command output
/// (`slash.exec`) in the transcript, mirroring the Rust `push_assistant`.
export function pushAssistant(state: HermesState, text: string): HermesState {
  const id = state.nextMessageId;
  const msg: Message = { id, role: 'assistant', text, streaming: false, tools: [], complete: true };
  return { ...state, messages: [...state.messages, msg], nextMessageId: id + 1 };
}

/// Append a completed steer note — mid-turn guidance the user injected via
/// `session.steer`. Rendered distinctly from user/assistant messages.
export function pushSteer(state: HermesState, text: string): HermesState {
  const id = state.nextMessageId;
  const msg: Message = { id, role: 'steer', text, streaming: false, tools: [], complete: true };
  return { ...state, messages: [...state.messages, msg], nextMessageId: id + 1 };
}

/// Remove the last turn from the transcript, mirroring the gateway's
/// `session.undo`: pop trailing assistant/steer messages, then one user
/// message. Tool cards live on their assistant message, so they are removed
/// with it.
export function undoLastTurn(state: HermesState): HermesState {
  const messages = state.messages.slice();
  let removed = 0;
  while (messages.length > 0) {
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' || last.role === 'steer') {
      messages.pop();
      removed++;
    } else {
      break;
    }
  }
  if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
    messages.pop();
    removed++;
  }
  if (removed === 0) return state;
  return { ...state, messages };
}

/// Record an attachment to include in the next submitted prompt.
export function addAttachment(state: HermesState, label: string, refText: string): HermesState {
  return { ...state, pendingAttachments: [...state.pendingAttachments, { label, refText }] };
}

/// Remove the attachment at `index` (a composer pill's ✕). Out-of-range is a
/// no-op returning the same state.
export function removeAttachment(state: HermesState, index: number): HermesState {
  if (index < 0 || index >= state.pendingAttachments.length) return state;
  const pendingAttachments = state.pendingAttachments.slice();
  pendingAttachments.splice(index, 1);
  return { ...state, pendingAttachments };
}

/// Clear all pending attachments after a prompt is submitted.
export function clearAttachments(state: HermesState): HermesState {
  if (state.pendingAttachments.length === 0) return state;
  return { ...state, pendingAttachments: [] };
}

/// The ref texts that will be prepended to the next submitted prompt. Does not
/// clear them (see `clearAttachments`).
export function takeAttachments(state: HermesState): string[] {
  return state.pendingAttachments.map((a) => a.refText);
}

/// Replace the transcript with a fresh `session.history` response. Used to
/// resync a view after a reconnect. Because `session.history` returns full
/// messages, the view is rebuilt from the response rather than relying on
/// `message.complete` overwrite semantics. Delegation plumbing (`user` items
/// whose text starts with the `[ASYNC DELEGATION … COMPLETE]` marker) and the
/// model-switch marker are skipped so a resumed/reopened session stays clean.
export function resyncMessages(state: HermesState, items: ResyncItem[]): HermesState {
  const messages: Message[] = [];
  let nextMessageId = 1;
  for (const item of items) {
    switch (item.role) {
      case 'user':
        if (!isDelegationPlumbing(item.text) && !isModelSwitchMarker(item.text)) {
          const id = nextMessageId++;
          messages.push({ id, role: 'user', text: item.text, streaming: false, tools: [], complete: true });
        }
        break;
      case 'assistant': {
        const id = nextMessageId++;
        messages.push({ id, role: 'assistant', text: item.text, streaming: false, tools: [], complete: true });
        break;
      }
      case 'tool': {
        const card: ToolCard = {
          id: `hist-${nextMessageId}`,
          name: item.toolName ?? 'tool',
          preview: item.toolContext ?? '',
          state: 'done',
          ok: true,
        };
        attachTool(messages, card, () => nextMessageId++);
        break;
      }
      default:
        break;
    }
  }
  return {
    ...state,
    messages,
    streaming: false,
    status: '',
    nextMessageId,
    pendingApproval: undefined,
    pendingClarify: undefined,
    pendingAttachments: [],
    subagents: [],
    pendingThinking: '',
    pendingReasoning: '',
  };
}

/// Attach a tool card to the last assistant message, or create a new
/// (non-streaming) assistant message to hold it when none exists. Mutates
/// `messages` in place (this is an internal helper operating on a fresh array
/// being built by a pure function). `takeId` returns the next message id and
/// advances the counter.
function attachTool(messages: Message[], card: ToolCard, takeId: () => number): void {
  const idx = findLastIndex(messages, (m) => m.role === 'assistant');
  if (idx !== -1) {
    messages[idx] = { ...messages[idx], tools: [...messages[idx].tools, card] };
  } else {
    messages.push({ id: takeId(), role: 'assistant', text: '', streaming: false, tools: [card], complete: false });
  }
}

/// Mark the tool card with `id` done, searching messages newest-first (matching
/// the Rust `tool_mut`), and record duration/result preview. Returns a new
/// state, or the same state when no card matches.
function completeTool(state: HermesState, id: string, ok: boolean, duration?: number, resultPreview?: string): HermesState {
  const messages = state.messages.slice();
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const cardIdx = msg.tools.findIndex((t) => t.id === id);
    if (cardIdx !== -1) {
      messages[i] = {
        ...msg,
        tools: msg.tools.map((t, j) =>
          j === cardIdx
            ? { ...t, state: 'done' as const, ok, duration, resultPreview }
            : t
        ),
      };
      return { ...state, messages };
    }
  }
  return state;
}

/// Snapshot the live subagents + pending thinking/reasoning into the message
/// just finalized (mirrors Native-Hermes `message.complete` / `error`).
function finalizeMessage(msg: Message, state: HermesState): Message {
  return { ...msg, subagents: state.subagents.slice() };
}

/// Surface a stalled turn to the user. When the gateway is connected but a turn
/// produces no progress for a long window (e.g. the model provider rejects every
/// request with a 429, so the gateway retries silently and never emits
/// `message.complete`/`error`), the tab would spin forever. This marks the open
/// streaming message as finished/errored with `text` and stops streaming, so the
/// failure is visible instead of an indefinite spinner. The gateway turn is NOT
/// interrupted — this only updates the local view; the user can still press Stop
/// to cancel.
export function stallTurn(state: HermesState, text: string): HermesState {
  const idx = findLastIndex(state.messages, (m) => m.streaming);
  if (idx === -1) return { ...state, streaming: false, status: text };
  const messages = state.messages.map((m, i) =>
    i === idx ? finalizeMessage({ ...m, text, streaming: false, complete: true }, state) : m
  );
  return { ...state, messages, streaming: false, status: text };
}

export function applyAgentEvent(state: HermesState, event: AgentEvent): HermesState {
  switch (event.type) {
    case 'message.start': {
      // A new turn starts a fresh subagent list. A turn that opened but never
      // produced content is abandoned once a new turn starts (the main turn
      // that only delegated, or the first of two consecutive `message.start`s).
      let messages = state.messages.slice();
      while (messages.length > 0) {
        const last = messages[messages.length - 1];
        if (last.streaming && isContentless(last)) {
          messages.pop();
        } else {
          break;
        }
      }
      const id = state.nextMessageId;
      // Commit any thinking/reasoning buffered before `message.start`.
      const thinking = state.pendingThinking ? state.pendingThinking : undefined;
      const reasoning = state.pendingReasoning ? state.pendingReasoning : undefined;
      messages.push({
        id,
        role: 'assistant',
        text: '',
        streaming: true,
        tools: [],
        complete: false,
        thinking,
        reasoning,
        subagents: [],
      });
      return {
        ...state,
        subagents: [],
        pendingThinking: '',
        pendingReasoning: '',
        messages,
        streaming: true,
        nextMessageId: id + 1,
      };
    }

    case 'message.delta': {
      const idx = findLastIndex(state.messages, (m) => m.streaming);
      if (idx === -1) return state;
      const last = state.messages[idx];
      const text = last.text + event.text;
      const updated: Message = { ...last, text };
      const messages = state.messages.map((m, i) => (i === idx ? updated : m));
      if (isDelegationPlumbing(text)) {
        // Gateway-injected delegation plumbing is dropped as soon as its
        // marker is recognized, so it never shows in the transcript — not even
        // as a brief flash mid-stream.
        messages.splice(idx, 1);
      }
      return { ...state, messages };
    }

    case 'message.complete': {
      const idx = findLastIndex(state.messages, (m) => m.streaming);
      const status = event.status === 'error' ? 'last turn errored' : state.status;
      if (idx === -1) return { ...state, streaming: false, status };
      const messages = state.messages.map((m, i) => {
        if (i !== idx) return m;
        return finalizeMessage({ ...m, text: event.text, streaming: false, complete: true }, state);
      });
      const updated = messages[idx];
      if (isDelegationPlumbing(updated.text) || isContentless(updated)) {
        messages.pop();
      }
      return { ...state, messages, streaming: false, status };
    }

    case 'tool.start': {
      const card: ToolCard = {
        id: event.id,
        name: event.name,
        preview: event.preview ?? '',
        // The tool is executing once `tool.start` arrives, so the card shows
        // the spinner immediately and only stops on `tool.complete`.
        state: 'running',
      };
      const messages = state.messages.slice();
      let nextMessageId = state.nextMessageId;
      attachTool(messages, card, () => {
        const id = nextMessageId;
        nextMessageId += 1;
        return id;
      });
      return { ...state, messages, nextMessageId };
    }

    // `tool.generating` fires while the model is generating the tool call
    // arguments, i.e. BEFORE `tool.start` creates the card. It carries no tool
    // id, so flipping the last card here would wrongly re-start the *previous*
    // (already-completed) tool's spinner and leave it stuck. Card state is
    // driven solely by `tool.start` (running) and `tool.complete` (done).
    case 'tool.generating':
      return state;

    case 'tool.complete':
      return completeTool(state, event.id, event.ok, event.duration, event.resultPreview);

    case 'thinking.delta': {
      const idx = findLastIndex(state.messages, (m) => m.streaming);
      if (idx === -1) {
        return { ...state, pendingThinking: state.pendingThinking + event.text };
      }
      const messages = state.messages.map((m, i) => {
        if (i !== idx) return m;
        return { ...m, thinking: (m.thinking ?? '') + event.text };
      });
      return { ...state, messages };
    }

    case 'reasoning.delta': {
      const idx = findLastIndex(state.messages, (m) => m.streaming);
      if (idx === -1) {
        return { ...state, pendingReasoning: state.pendingReasoning + event.text };
      }
      const messages = state.messages.map((m, i) => {
        if (i !== idx) return m;
        return { ...m, reasoning: (m.reasoning ?? '') + event.text };
      });
      return { ...state, messages };
    }

    case 'reasoning.available': {
      // The gateway emits the canonical reasoning at the end of the turn, after
      // `message.start` has opened the assistant message (and while it is still
      // streaming). Attach it to that message, replacing the streamed deltas;
      // buffer only when no assistant message is open yet.
      const idx = findLastIndex(state.messages, (m) => m.streaming || m.role === 'assistant');
      if (idx === -1) {
        return { ...state, pendingReasoning: event.text };
      }
      const messages = state.messages.map((m, i) => (i === idx ? { ...m, reasoning: event.text } : m));
      return { ...state, messages };
    }

    case 'approval.request':
      return {
        ...state,
        pendingApproval: {
          id: event.id,
          command: event.command ?? 'approve this tool call',
          tool: event.tool,
        },
      };

    case 'clarify.request':
      return {
        ...state,
        pendingClarify: { id: event.id, question: event.question, choices: event.choices },
      };

    case 'session.title':
      return { ...state, title: event.title };

    case 'session.info':
      return {
        ...state,
        currentModel: event.model ?? state.currentModel,
        currentProvider: event.provider ?? state.currentProvider,
      };

    case 'subagent.start': {
      // A gateway can re-emit `subagent.start` for an already-open node; don't
      // push a duplicate.
      if (state.subagents.some((n) => n.id === event.id)) return state;
      const node: SubagentNode = {
        id: event.id,
        parentId: event.parentId,
        depth: event.depth,
        goal: event.goal,
        model: event.model,
      };
      return { ...state, subagents: [...state.subagents, node] };
    }

    case 'subagent.complete': {
      // Early-out when the id matches nothing (live list or any message
      // snapshot) — a genuine no-op so callers keep their reference.
      const hasLive = state.subagents.some((n) => n.id === event.id);
      const hasSnapshot = state.messages.some((m) => (m.subagents?.some((n) => n.id === event.id) ?? false));
      if (!hasLive && !hasSnapshot) return state;
      // Update the live node status…
      const subagents = state.subagents.map((n) => (n.id === event.id ? { ...n, status: event.status } : n));
      // …and mirror into every message's snapshot so a background subagent that
      // finishes after its turn's `message.complete` clears its running sign.
      const messages = state.messages.map((m) => {
        if (!m.subagents || m.subagents.length === 0) return m;
        const next = m.subagents.map((n) => (n.id === event.id ? { ...n, status: event.status } : n));
        return next.some((n, i) => n !== m.subagents![i]) ? { ...m, subagents: next } : m;
      });
      return { ...state, subagents, messages };
    }

    case 'status.update':
      return { ...state, status: event.text };

    case 'error': {
      const idx = findLastIndex(state.messages, (m) => m.streaming);
      const status = `error: ${event.message}`;
      if (idx === -1) return { ...state, streaming: false, status };
      const messages = state.messages.map((m, i) => {
        if (i !== idx) return m;
        return finalizeMessage({ ...m, streaming: false, complete: true }, state);
      });
      if (isContentless(messages[idx])) {
        messages.pop();
      }
      return { ...state, messages, streaming: false, status };
    }

    case 'gateway.ready':
    case 'unknown':
      return state;
  }
}

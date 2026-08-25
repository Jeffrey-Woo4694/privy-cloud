// Pure agent-event reducer for the Hermes Agent integration.
// Ported from the Rust reference implementation (`src/state/view.rs` in
// Native-Hermes). The Rust `apply(&mut self)` mutates in place; every function
// here is a PURE function that returns a NEW `HermesState` and never mutates
// the input.
//
// v1 scope: message lifecycle, tool cards, status/error, pushUser/pushSteer/
// undoLastTurn/resyncMessages, plus the is_delegation_plumbing/is_contentless
// helpers. The deferred variants (thinking.*, reasoning.*, subagent.*,
// approval.request, clarify.request, session.*, gateway.ready) are clean
// no-ops: the v1 state has no fields to store them in.

import type { AgentEvent, HermesState, Message, ResyncItem, ToolCard } from './types';

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

/// True when a message carries nothing worth rendering: no text and no tool
/// cards (v1 drops thinking/reasoning, which are deferred). Such a message is
/// pure plumbing — e.g. the agent's main turn that only delegated to a
/// background subagent — and is removed from the transcript instead of
/// rendering as a bare empty role marker.
export function isContentless(msg: Message): boolean {
  return msg.text.trim().length === 0 && msg.tools.length === 0;
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

/// Replace the transcript with a fresh `session.history` response. Used to
/// resync a view after a reconnect. Because `session.history` returns full
/// messages, the view is rebuilt from the response rather than relying on
/// `message.complete` overwrite semantics. Delegation plumbing (`user` items
/// whose text starts with the `[ASYNC DELEGATION … COMPLETE]` marker) is
/// skipped so a resumed/reopened session stays clean.
export function resyncMessages(state: HermesState, items: ResyncItem[]): HermesState {
  const messages: Message[] = [];
  let nextMessageId = 1;
  for (const item of items) {
    switch (item.role) {
      case 'user':
        if (!isDelegationPlumbing(item.text)) {
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
  return { ...state, messages, streaming: false, status: '', nextMessageId };
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
/// the Rust `tool_mut`). Returns a new state, or the same state when no card
/// matches.
function completeTool(state: HermesState, id: string, ok: boolean): HermesState {
  const messages = state.messages.slice();
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const cardIdx = msg.tools.findIndex((t) => t.id === id);
    if (cardIdx !== -1) {
      messages[i] = {
        ...msg,
        tools: msg.tools.map((t, j) => (j === cardIdx ? { ...t, state: 'done' as const, ok } : t)),
      };
      return { ...state, messages };
    }
  }
  return state;
}

export function applyAgentEvent(state: HermesState, event: AgentEvent): HermesState {
  switch (event.type) {
    case 'message.start': {
      // A turn that opened but never produced content is abandoned once a new
      // turn starts. This covers the main turn that only delegated to a
      // background subagent, and the first of two consecutive `message.start`s
      // the gateway can emit when re-injecting a delegation result.
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
      messages.push({ id, role: 'assistant', text: '', streaming: true, tools: [], complete: false });
      return { ...state, messages, streaming: true, nextMessageId: id + 1 };
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
        return { ...m, text: event.text, streaming: false, complete: true };
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
      return completeTool(state, event.id, event.ok);

    case 'status.update':
      return { ...state, status: event.text };

    case 'error': {
      const idx = findLastIndex(state.messages, (m) => m.streaming);
      const status = `error: ${event.message}`;
      if (idx === -1) return { ...state, streaming: false, status };
      const messages = state.messages.map((m, i) => {
        if (i !== idx) return m;
        return { ...m, streaming: false, complete: true };
      });
      if (isContentless(messages[idx])) {
        messages.pop();
      }
      return { ...state, messages, streaming: false, status };
    }

    // Deferred variants — clean no-ops in v1 (thinking.*, reasoning.*,
    // subagent.*, approval.request, clarify.request, session.*, gateway.ready,
    // unknown).
    default:
      return state;
  }
}

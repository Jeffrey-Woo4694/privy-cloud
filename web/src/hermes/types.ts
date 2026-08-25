// Hermes agent event + view-state types for the web client.
//
// `AgentEvent` mirrors the FULL union in `server/src/hermes/events.ts` — the
// two must stay in sync. The reducer treats the deferred variants (thinking.*,
// reasoning.*, subagent.*, approval.request, clarify.request, session.*,
// gateway.ready) as no-ops because the v1 `HermesState` has nowhere to store
// them.

export type AgentEvent =
  | { type: 'gateway.ready' }
  | { type: 'session.info'; model?: string; provider?: string; cwd?: string }
  | { type: 'session.title'; sessionId: string; title: string }
  | { type: 'message.start' }
  | { type: 'message.delta'; text: string }
  | { type: 'message.complete'; text: string; status: string }
  | { type: 'tool.start'; id: string; name: string; preview?: string }
  | { type: 'tool.generating'; name: string }
  | { type: 'tool.complete'; id: string; name: string; ok: boolean; duration?: number; resultPreview?: string }
  | { type: 'approval.request'; id: string; command?: string; tool?: string; payload: unknown }
  | { type: 'clarify.request'; id: string; question: string; choices: string[] }
  | { type: 'thinking.delta'; text: string }
  | { type: 'reasoning.delta'; text: string }
  | { type: 'reasoning.available'; text: string }
  | { type: 'subagent.start'; id: string; parentId?: string; depth: number; goal: string; model?: string }
  | { type: 'subagent.complete'; id: string; status?: string }
  | { type: 'status.update'; kind?: string; text: string }
  | { type: 'error'; message: string }
  | { type: 'unknown'; eventType: string; payload: unknown };

export type MessageRole = 'user' | 'assistant' | 'steer';

/// One subagent spawned by the agent, from `subagent.*` events. Only the
/// identity + status are kept — the UI renders a one-line status card. The tree
/// is built at render time via `parentId` (roots = nodes whose parent is absent).
/// Mirrors `SubagentNode` in Native-Hermes `src/state/view.rs`.
export interface SubagentNode {
  id: string;
  parentId?: string;
  depth: number;
  goal: string;
  model?: string;
  status?: string; // 'ok' | 'error' | 'failed' | 'timeout' | undefined(running)
}

/// A gateway tool-approval prompt (`approval.request`). Mirrors `ApprovalPrompt`.
export interface ApprovalPrompt {
  id: string;
  command: string;
  tool?: string;
}

/// A gateway clarifying question (`clarify.request`). Mirrors `ClarifyPrompt`.
export interface ClarifyPrompt {
  id: string;
  question: string;
  choices: string[];
}

/// A pending attachment queued for the next prompt. `label` is the human-readable
/// chip text; `refText` is what gets prepended to the submitted prompt
/// (`[User attached image: …]` / `@file:…`). Mirrors `Attachment` in view.rs.
export interface Attachment {
  label: string;
  refText: string;
}

export interface ToolCard {
  id: string;
  name: string;
  preview: string;
  state: 'running' | 'done';
  ok?: boolean;
  /// Seconds the tool ran, from `tool.complete` (None when unknown).
  duration?: number;
  /// Short result text, from `tool.complete` (None when unknown).
  resultPreview?: string;
  /// Full tool output, from `tool.complete` (None when unknown).
  output?: string;
}

export interface Message {
  id: number;
  role: MessageRole;
  text: string;
  streaming: boolean;
  tools: ToolCard[];
  complete: boolean;
  /// Thinking (scratchpad) text, streamed inside a turn. Mirrors view.rs.
  thinking?: string;
  /// Reasoning (visible chain-of-thought) text. Mirrors view.rs.
  reasoning?: string;
  /// Snapshot of the turn's subagent tree, taken at `message.complete` so the
  /// process strip keeps its nodes + count after the next turn clears the live
  /// `HermesState.subagents` list.
  subagents?: SubagentNode[];
}

export interface HermesState {
  sessionId?: string;
  sessionKey?: string;
  title: string;
  messages: Message[];
  streaming: boolean;
  status: string;
  nextMessageId: number;
  /// A gateway tool-approval awaiting a response (`approval.request`).
  pendingApproval?: ApprovalPrompt;
  /// A gateway clarifying question awaiting a response (`clarify.request`).
  pendingClarify?: ClarifyPrompt;
  /// The session's active model, from `session.info` (None before the first one).
  currentModel?: string;
  /// The provider serving the active model, from `session.info`.
  currentProvider?: string;
  /// The session's active reasoning effort, from `config.get reasoning`.
  currentEffort?: string;
  /// Attachments queued for the next prompt.
  pendingAttachments: Attachment[];
  /// Subagents spawned by the agent, in arrival order (live per-turn list).
  subagents: SubagentNode[];
  /// Buffered thinking/reasoning deltas received before the next `message.start`.
  pendingThinking: string;
  pendingReasoning: string;
}

/// Reasoning-effort levels the gateway accepts for `config.set key="reasoning"`.
export const EFFORT_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;


/// One message from a `session.history` response (see `resyncMessages`).
export interface ResyncItem {
  role: string;
  text: string;
  toolName?: string;
  toolContext?: string;
}

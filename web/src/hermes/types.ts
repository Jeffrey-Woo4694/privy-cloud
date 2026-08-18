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

export interface ToolCard {
  id: string;
  name: string;
  preview: string;
  state: 'running' | 'done';
  ok?: boolean;
}

export interface Message {
  id: number;
  role: MessageRole;
  text: string;
  streaming: boolean;
  tools: ToolCard[];
  complete: boolean;
}

export interface HermesState {
  sessionId?: string;
  sessionKey?: string;
  title: string;
  messages: Message[];
  streaming: boolean;
  status: string;
  nextMessageId: number;
}

/// One message from a `session.history` response (see `resyncMessages`).
export interface ResyncItem {
  role: string;
  text: string;
  toolName?: string;
  toolContext?: string;
}

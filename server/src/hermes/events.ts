// Agent event parser for the Hermes Agent integration.
// Ported from the Rust reference implementation (`hermes_client::events` in
// Native-Hermes). Every `AgentEvent` variant and the full `parse` field
// mapping is mirrored faithfully, including the gateway field aliases
// (`tool_id`/`id`, `preview`/`context`, `duration_s`/`duration`,
// `summary`/`result`/`result_preview`) and the defaults (a missing `ok` on
// `tool.complete` means success; `message.complete`/`subagent.start` default
// `status`/`goal`; `error` defaults to `"unknown error"`).

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

// Mirror Rust's serde_json accessors. `as_str` on a non-string (or null)
// yields None; absent optional fields stay `undefined` so downstream
// JSON.stringify drops them (Rust would emit `null` for the `Option`).
function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asStrOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function asNum(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

export function parseAgentEvent(eventType: string, payload: any): AgentEvent {
  // The gateway may omit `payload` entirely (decodeFrame then hands us `null`).
  // Coerce to `{}` before the switch so every `asStr(payload.*, …)` read below
  // hits an object instead of dereferencing `null` (which would throw inside
  // the ws message listener and crash the whole backend).
  payload = payload ?? {};
  switch (eventType) {
    case 'gateway.ready':
      return { type: 'gateway.ready' };
    case 'session.info':
      return {
        type: 'session.info',
        model: asStr(payload.model),
        provider: asStr(payload.provider),
        cwd: asStr(payload.cwd),
      };
    case 'session.title':
      return {
        type: 'session.title',
        sessionId: asStrOr(payload.session_id, ''),
        title: asStrOr(payload.title, ''),
      };
    case 'message.start':
      return { type: 'message.start' };
    case 'message.delta':
      return { type: 'message.delta', text: asStrOr(payload.text, '') };
    case 'message.complete':
      return {
        type: 'message.complete',
        text: asStrOr(payload.text, ''),
        status: asStrOr(payload.status, 'ok'),
      };
    case 'tool.start':
      return {
        type: 'tool.start',
        id: asStrOr(payload.tool_id ?? payload.id, ''),
        name: asStrOr(payload.name, ''),
        preview: asStr(payload.preview ?? payload.context),
      };
    case 'tool.generating':
      return { type: 'tool.generating', name: asStrOr(payload.name, '') };
    case 'tool.complete': {
      // The gateway emits `tool.complete` only after a tool ran to completion
      // and does not send an `ok` field, so a missing field means success (not
      // failure). An explicit `ok: false` is still honored.
      const ok = asBool(payload.ok) ?? true;
      return {
        type: 'tool.complete',
        id: asStrOr(payload.tool_id ?? payload.id, ''),
        name: asStrOr(payload.name, ''),
        ok,
        duration: asNum(payload.duration_s ?? payload.duration),
        resultPreview: asStr(payload.summary ?? payload.result ?? payload.result_preview),
      };
    }
    case 'approval.request':
      return {
        type: 'approval.request',
        id: asStrOr(payload.id, ''),
        command: asStr(payload.command),
        tool: asStr(payload.tool),
        payload,
      };
    case 'clarify.request':
      return {
        type: 'clarify.request',
        id: asStrOr(payload.request_id, ''),
        question: asStrOr(payload.question, ''),
        choices: Array.isArray(payload.choices)
          ? payload.choices.filter((c: unknown): c is string => typeof c === 'string')
          : [],
      };
    case 'subagent.start':
      return {
        type: 'subagent.start',
        id: asStrOr(payload.subagent_id, ''),
        parentId: asStr(payload.parent_id),
        depth: asNum(payload.depth) ?? 0,
        goal: asStrOr(payload.goal, ''),
        model: asStr(payload.model),
      };
    case 'subagent.complete':
      return {
        type: 'subagent.complete',
        id: asStrOr(payload.subagent_id, ''),
        status: asStr(payload.status),
      };
    case 'status.update':
      return {
        type: 'status.update',
        kind: asStr(payload.kind),
        text: asStrOr(payload.text, ''),
      };
    case 'error':
      return { type: 'error', message: asStrOr(payload.message, 'unknown error') };
    case 'thinking.delta':
      return { type: 'thinking.delta', text: asStrOr(payload.text, '') };
    case 'reasoning.delta':
      return { type: 'reasoning.delta', text: asStrOr(payload.text, '') };
    case 'reasoning.available':
      return { type: 'reasoning.available', text: asStrOr(payload.text, '') };
    default:
      return { type: 'unknown', eventType, payload };
  }
}

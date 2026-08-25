# Hermes Agent Feature Parity — Design Specification

**Date:** 2026-08-25
**Status:** Draft for review
**Goal:** Bring the Privy Cloud **Hermes Agent** tab to feature parity with the reference `Native-Hermes` GTK app. The Hermes *core* (transport + state reducer) is already ported and working; this spec closes the **interaction + rendering gap** so the tab matches what Native-Hermes can do.

**Reference implementation:** [Native-Hermes](file:///home/jeffrey/Project/Native-Hermes%20(Copy)) — Rust + GTK4 at `~/Project/Native-Hermes (Copy)`. Its UI-agnostic core (`src/state/view.rs` reducer, `src/hermes_client/*` transport) was already ported to TypeScript in `server/src/hermes/*` + `web/src/hermes/*`. This spec ports the *rest*: the advanced RPC calls, the richer reducer semantics, and the React UI that gives them shape.

---

## 1. The one architectural insight that de-risks everything

**No server change is required.** The whole parity effort is web-side.

- `POST /api/hermes/call` (`server/src/api/routes.ts:361`) is a **generic JSON-RPC pass-through** — it forwards any `{ method, params }` to the live `HermesManager`. Every RPC in this spec already travels it; we never add a route.
- The `AgentEvent` union is already **complete** and identical in `server/src/hermes/events.ts:10-29` and `web/src/hermes/types.ts:9-28` (19 variants, including all the "deferred" ones: `thinking.*`, `reasoning.*`, `subagent.*`, `approval.request`, `clarify.request`). No new event types arrive — the server already parses and forwards them.
- The relay already emits `hermes:event` over `/ws` and the web client already routes `onHermesEvent` into `applyAgentEvent` (`web/src/hermes/useHermes.ts:94-101`, `web/src/ws.ts:24-34`).

So the work is: **make the reducer store what these events carry, then build the UI that reads it and calls the RPCs that respond to them.** The current reducer discards them as no-ops because the v1 `HermesState` had nowhere to put them.

---

## 2. What already works (v1, the ported core)

| Capability | Status | Where |
|---|---|---|
| Spawn `hermes serve`, JSON-RPC-over-WS, response correlation, heartbeat, reconnect/resume | ✅ working | `server/src/hermes/{jsonrpc,events,serve,client,manager}.ts` |
| Single-session chat: streaming text, tool cards, send/steer/stop/undo, session list | ✅ working | `web/src/hermes/*`, `web/src/pages/HermesTab.tsx` |
| `@hermes` bot in the sharing chat (`cwd` = shared library) | ✅ working | `web/src/hermes/usePrivyHermes.ts` |
| Message lifecycle reducer (start/delta/complete), tool card lifecycle, delegation-plumbing & contentless filters, history resync | ✅ working | `web/src/hermes/reducer.ts` |

## 3. The gap — what Native-Hermes does that Privy Cloud doesn't yet

| Group | Native-Hermes | Privy Cloud |
|---|---|---|
| **RPC surface** | 23 methods | 14 methods (the essential chat/session set) |
| **Reducer** full semantics | thinking/reasoning/subagent/approval/clarify/session.info | those variants are **no-ops** |
| **Model/effort picker** | composer badge → provider+model+effort picker; Settings dialog + API keys | none |
| **Permission/clarify dialogs** | modal prompts → `approval.respond` / `clarify.respond` | none (would hang on a tool approval) |
| **Process strip** | collapsible per-message strip: tools + subagent tree + thinking/reasoning | tool cards only, flat |
| **Slash commands** | `complete.slash` autocomplete + `slash.exec` | none |
| **Attachments** | `image.attach` / `file.attach`, chips, refs prepended to the prompt | none |
| **Session actions** | archive (`session.history`→markdown), rename (`session.title`), delete (`session.close`+`session.delete`), most-recent | none |

---

## 4. Data model extension (web-side only)

All in `web/src/hermes/types.ts` + `web/src/hermes/reducer.ts`, mirroring the Rust `state/view.rs` structs.

### 4.1 `HermesState` gains fields (`view.rs:108-147`)

```ts
export interface HermesState {
  sessionId?: string;      // live id (per-serve, stale on reconnect)
  sessionKey?: string;     // durable key (resumable)
  title: string;
  messages: Message[];
  streaming: boolean;
  status: string;
  nextMessageId: number;
  // NEW — from the deferred events
  pendingApproval?: ApprovalPrompt;
  pendingClarify?: ClarifyPrompt;
  currentModel?: string;    // from session.info
  currentProvider?: string; // from session.info
  currentEffort?: string;   // from config.get reasoning
  pendingAttachments: Attachment[]; // queued for the next prompt
  subagents: SubagentNode[];        // live per-turn list (cleared on message.start)
  pendingThinking: string;          // buffered before message.start
  pendingReasoning: string;         // buffered before message.start
}
```

Note: `pendingThinking` / `pendingReasoning` are private buffers that mirror Rust's fields; they are reset by `resyncMessages`/`reset`.

### 4.2 `Message` gains thinking/reasoning/subagent snapshot (`view.rs:23-36`)

```ts
export interface Message {
  id: number;
  role: MessageRole;                 // 'user' | 'assistant' | 'steer'
  text: string;
  streaming: boolean;
  tools: ToolCard[];
  complete: boolean;
  thinking?: string;                 // NEW
  reasoning?: string;                // NEW
  subagents: SubagentNode[];         // NEW — snapshot of the turn's tree at MessageComplete
}
```

### 4.3 `ToolCard` gains output/duration/result (view.rs picks Rust up)

```ts
export interface ToolCard {
  id: string;
  name: string;
  preview: string;
  state: 'running' | 'done';
  ok?: boolean;
  output?: string;          // NEW
  duration?: number;        // NEW — s
  resultPreview?: string;   // NEW
}
```

### 4.4 New types

```ts
export interface SubagentNode {
  id: string;
  parentId?: string;
  depth: number;
  goal: string;
  model?: string;
  status?: string;          // 'ok' | 'error' | 'failed' | 'timeout' | undefined(running)
}
export interface ApprovalPrompt { id: string; command: string; tool?: string }
export interface ClarifyPrompt { id: string; question: string; choices: string[] }
export interface Attachment { label: string; refText: string }
```

---

## 5. Reducer semantics — ported faithfully from `state/view.rs`

Every edge case below is taken from the Rust `apply`/`resync_messages` (`view.rs:302-562`) and must be reproduced exactly, immutably.

| Event | Behavior |
|---|---|
| `message.start` | **Clear live `subagents`.** Pop a trailing content-less streaming turn. Open a new streaming assistant message, **committing `pendingThinking`/`pendingReasoning` into it**. Set `streaming=true`. |
| `message.delta` | Append to the last streaming message; drop mid-stream if the accumulated text becomes delegation plumbing. |
| `message.complete` | Finalize text; **snapshot `state.subagents` into the message**; set `streaming=false`; drop the message if delegation-plumbing or content-less; set status `"last turn errored"` when `status==='error'`. |
| `tool.start` | Attach a `running` card. (Creates a card-holder assistant message if none open.) |
| `tool.generating` | **No-op** (must not re-start a completed tool's spinner). |
| `tool.complete` | Flip matching card to `done{ok}`, set `duration`/`resultPreview`. |
| `thinking.delta` | Append to the open streaming message's `thinking`, else buffer into `pendingThinking`. |
| `reasoning.delta` | Append to open streaming message's `reasoning`, else buffer into `pendingReasoning`. |
| `reasoning.available` | Attach canonical text to the open assistant/streaming message's `reasoning` (replacing deltas); else buffer. |
| `approval.request` | Set `pendingApproval` (command defaults to `"approve this tool call"`). |
| `clarify.request` | Set `pendingClarify`. |
| `subagent.start` | Push a node **unless the id already exists** (dedup). |
| `subagent.complete` | Set status on the live node **and mirror it into every message's subagent snapshot** (so a post-`message.complete` completion clears the running sign). |
| `session.info` | Set `currentModel`/`currentProvider`. |
| `error` | Set status `error: <msg>`; finalize the streaming message **and snapshot subagents**; drop if content-less. |
| `status.update` | Set `status`. |

### 5.1 Fixed helpers

- `isContentless` now also considers `thinking`/`reasoning` (a turn with only a subagent is still content-less → dropped; a turn with thinking/reasoning is **kept**).
- `resyncMessages` adds the **model-switch marker** filter: drop user items whose text starts with `[System: The active model for this chat has changed to` (in addition to the existing delegation-plumbing filter).
- New helpers: `pushAssistant` (for slash output), `addAttachment`/`takeAttachments`/`removeAttachment`, `pushUser` unchanged.
- `EFFORT_LEVELS = ['none','minimal','low','medium','high','xhigh','max','ultra']` (`chat_view.rs:22-24`).

---

## 6. RPC surface — full reference table

All already flow through `POST /api/hermes/call`. The **14 already in use** plus the **11 to add** (from Native-Hermes `app.rs`):

| Method | Params | Result | Added? |
|---|---|---|---|
| `session.create` | `{}` | `{ session_id, stored_session_id }` | — |
| `session.resume` | `{ session_id }` | `{ session_id, session_key\|stored_session_id, messages[] }` | — |
| `session.list` | `{ limit }` | `{ sessions:[{ id, title }] }` (keyed by **`id`**) | — |
| `session.most_recent` | `{}` | `{ session_id, title }` | **🔵 new** |
| `session.history` | `{ session_id }` | `{ messages:[{ role, text, name, context }] }` | **🔵 new** |
| `session.title` | `{ session_id, title }` | `{}` | **🔵 new** |
| `session.close` | `{ session_id }` (live) | `{}` | **🔵 new** |
| `session.delete` | `{ session_id: <durable_key> }` | `{}` | **🔵 new** |
| `session.steer` / `interrupt` / `undo` | `{ session_id, … }` | `{}` | — |
| `prompt.submit` | `{ session_id, text }` | `{ status: "accepted" }` | — |
| `slash.exec` | `{ session_id, command }` | `{ type, output, notice, message, target }` | **🔵 new** |
| `complete.slash` | `{ text }` | `{ items:[{ text, meta }] }` | **🔵 new** |
| `config.get` | `{ key, session_id }` | `{ value }` | **🔵 new** |
| `config.set` | `{ key, value, session_id, confirm_expensive_model? }` | `{ confirm_required?, confirm_message? }` | **🔵 new** |
| `model.options` | `{ explicit_only }` ± `include_unconfigured` ± `session_id` | `{ current_model, providers:[{ slug, models[], authenticated, auth_type, warning, is_current, is_user_defined }] }` | **🔵 new** |
| `model.save_key` | `{ slug, api_key }` | `{}` | **🔵 new** |
| `approval.respond` | `{ session_id, choice: 'approve'\|'allow_once'\|'deny', all: false }` | `{}` | **🔵 new** |
| `clarify.respond` | `{ session_id, request_id, answer }` | `{}` | **🔵 new** |
| `image.attach` | `{ session_id, path }` → `{ text }` | `{ text }` | **🔵 new** |
| `file.attach` | `{ session_id, path, name }` → `{ ref_text }` | `{ ref_text }` | **🔵 new** |

**Critical formatting rules (from Native-Hermes `settings.rs:73-83` + `app.rs`):**

- `config.set key="model"` → **value is a CLI-style string**, not a JSON object:
  `value = "<model> --provider <providerSlug> --session"` (session-scoped). `--global` instead of `--session` sets the default.
- `config.set key="reasoning"` → value is a **bare effort string** (`"high"`, `"xhigh"`, …).
- Model/effort switches are **session-scoped** (`--session`) to avoid writing `config.yaml` (which would trip the config watcher and force a serve restart) — same reason as Native-Hermes.
- `session.delete` uses the **durable key**; `session.close` uses the **live id**.
- Attachment refs are prepended to the next `prompt.submit` text: `[User attached image: <name>]` and `@file:<path>`.

### 6.1 Live vs durable session identity

`session_id` is per-serve and goes stale on reconnect; `stored_session_id`/`session_key` is durable and is what `session.resume` accepts. On a fresh serve, a bound session must be **re-resumed** or `prompt.submit` fails "session not found".

**Latent gap (must fix in this work):** the server manager has a `setResume` hook (`server/src/hermes/manager.ts:198`) that re-resumes a session and forwards `{ kind: 'resynced', messages }` on reconnect (`manager.ts:136-150`) — but **nothing calls `setResume` in production** (only the test does, `server/test/hermes/manager.test.ts:125`). `resumeKey` is always `null`, so the manager never re-resumes. The frontend also ignores `hermes:status`. Net effect: after a backend restart (provider switch / crash / config.yaml change), the tab's live `session_id` goes stale and the next `prompt.submit` fails "session not found" until the user manually re-clicks a session row. Native-Hermes re-resumes automatically; the port must too.

**Fix (web-only):** in `useHermes`, detect `hermes:status === 'connected'` in the WS callback (`web/src/ws.ts:33` already forwards it to `onHermesEvent` as `{ event: { type:'hermes:status', status }, sessionId: null }`). On that transition, if a durable `sessionKey` is already bound (guard against the *initial* connect, which auto-creates a new session), re-call `session.resume { session_id: sessionKey }`, update `sessionId` to the new live id, and resync messages — exactly reusing the existing `resume(sessionKey)` path. This keeps the fix client-side; the server needs no change.

---

## 7. UI design (React, reusing existing classes + labels)

Reuse the existing `Markdown`, `ChatPanel`, and theme tokens; the current `HermesTab` uses inline styles + the `chat-entry`/`chat-bubble`/`btn`/`empty-state`/`send-input`/`panel-title` classes. New components:

### 7.1 Composer model/effort badge + picker
- A badge in the composer showing `currentModel` / `currentProvider` / `currentEffort`.
- Clicking it opens a popover: on open, call `model.options { explicit_only: true }` + `config.get { key: 'reasoning' }` in parallel.
- Render one section per provider (models), check the active `(provider, model)` (from `state.currentModel`/`currentProvider`). Effort is a row of `EFFORT_LEVELS` chips.
- Applying a model → `config.set key="model" value="<model> --provider <slug> --session"`; if `confirm_required`, show a confirm dialog and re-issue with `confirm_expensive_model: true`.
- Applying effort → `config.set key="reasoning" value=<effort>`.
- Update `state.currentModel/currentProvider/currentEffort` from the gateway response and `session.info`.

### 7.2 Permission / clarify dialogs
- When `state.pendingApproval` is set, render a centered modal: the command, and three buttons — **Allow once** (`approval.respond { choice:'allow_once' }`), **Allow always** (`{ choice:'approve', all:true }`), **Deny** (`{ choice:'deny' }`). Dismiss ⇒ Deny.
- When `state.pendingClarify` is set, render a modal: the question + optional choice buttons filling an input; submit ⇒ `clarify.respond { request_id, answer }`.
- Both resolve the **current** session id at call time (the WS may have reconnected while the dialog was open).

### 7.3 Process strip (per-message collapsible)
- A `<details>`-style strip under each assistant message when it has tools, subagents, thinking, or reasoning.
- **Tools** row: icon (`…` running / `✓` / `✗`), monospace name, preview, and on completion a small duration (`1.5s`) + result preview.
- **Subagents** tree: nested one-line cards by `parent_id` (roots = nodes whose parent isn't present), status icon (`✓ done` / `✗ failed` / `⏱ timeout` / spinner when running).
- **Thinking** and **Reasoning**: muted monospace blocks, truncated/collapsible.

### 7.4 Slash commands
- When the composer text starts with `/`, fetch `complete.slash { text }` (debounced) and show an autocomplete list; selecting fills the input.
- On send, if the text starts with `/`, call `slash.exec { session_id, command }` and render its `output`/`notice`/`message` via `pushAssistant` instead of `prompt.submit`.

### 7.5 Attachments
- Attach button (`📎`): file picker → `image.attach` or `file.attach` (by extension) → chip with the returned label. `×` removes it.
- On send, prepend each attachment's `refText` to the submitted text.

### 7.6 Session actions menu (per-row `⋯`)
- **Archive** — `session.history { session_id }` → build a Markdown transcript → trigger a download (Blob) named `<title>-<YYYY-MM-DD>.md`.
- **Rename** — `session.title { session_id, title }` (inline prompt), syncs to `state.title` + sidebar row.
- **Delete** — confirm → `session.close { session_id: live }` then `session.delete { session_id: durable_key }`; reset the view if it's the active session.
- **Most recent** — a "reopen last session" shortcut → `session.most_recent { }`.

### 7.7 Deferred (not in scope, note for later)
- Full **Settings dialog** (model/provider + API-key management via `model.save_key`, `model.options include_unconfigured`). Native-Hermes has a rich one; suggest a follow-up after the composer picker.
- **Multi-session split views** — Privy Cloud is single-session; Native-Hermes has 3 fixed slots. Keep single-session for now.
- The `@hermes` bot (`usePrivyHermes`) keeps its text-only rendering; it benefits automatically from the richer reducer but need not surface subagents.

---

## 8. Testing strategy

The server relay needs no new tests (generic pass-through already covered by `server/test/api.test.ts`). The bulk is web-side:

- **Reducer** (`web/src/__tests__/reducer.test.ts`): port every Rust `view.rs` test to TS. **Crucially, replace the existing "deferred events are clean no-ops" test** (lines 269-289) — those events now mutate state. Add immutability assertions for the new mutations.
- **UI** (`web/src/__tests__/HermesTab.test.tsx`): model picker opens and issues `model.options`+`config.get`; approval dialog renders and calls `approval.respond`; clarify dialog calls `clarify.respond`; slash autocomplete calls `complete.slash`; archive calls `session.history`; delete calls `session.close`+`session.delete`; attachment chip → `file.attach`.
- Keep the reducer pure and immutable (return a new state; never mutate the input) — the existing tests at `reducer.test.ts:291-340` enforce this pattern.

---

## 9. Risks & caveats

1. **Reducer immutability** is the biggest correctness hazard — the existing tests guard it. Every new event handler must build new arrays/objects, never splice the input.
2. **`config.set` value format** is a string, not an object; a wrong shape silently writes a malformed model config. Guard with a helper + tests (`model_config_value` bridge).
3. **Two `hermes serve` daemons** (Native-Hermes + Privy Cloud) each use an isolated `HERMES_HOME` so they don't deadlock over `sessions.json` — a deliberate design, not a bug. Don't "fix" it by sharing home.
4. **`session.delete` after `session.close`** — delete refuses active sessions, so always close the live id first, then delete the durable key.
5. **`config.yaml` watcher** — session-scoped model switches avoid a config write; do not switch to `--global` in the middle of a chat or you'll force a serve restart mid-conversation.

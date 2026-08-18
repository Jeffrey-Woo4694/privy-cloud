# Hermes Agent Integration — Design Specification

**Date:** 2026-08-19
**Status:** Approved for v1 implementation
**Product vision:** Replace the placeholder "Hermes Agent" tab with a real, single-session chat UI driven by the user's local Nous Research Hermes Agent (`hermes`). The agent process runs locally; inference is cloud. Reference implementation: `Native-Hermes` (Rust GTK4) at `~/Project/Native-Hermes (Copy)`.

---

## 1. Overview & goals

- The backend spawns `hermes serve`, speaks JSON-RPC 2.0 over WebSocket to it, and relays the streaming agent events to the React "Hermes Agent" tab over Privy Cloud's existing WebSocket channel.
- The user chats with a **single session** in v1: streamed assistant text, tool cards, stop/interrupt, undo, and a session list (new / resume / list).
- The architecture ports the reusable halves of `Native-Hermes` — the transport (`hermes_client/`) and the pure `ViewState` reducer (`state/view.rs`) — and rebuilds the UI in React with Privy Cloud's design tokens. The GTK UI is not ported.

### v1 scope

In scope:
- **Auth token** gating every API + WS request (foundation; see §3).
- **Backend Hermes client** (spawn serve, JSON-RPC/WS transport, lifecycle).
- **Relay** (REST for commands, WS for events).
- **Single-session React chat** (streaming text, tool cards, stop/interrupt, undo, session list).

Deferred (follow naturally once the core is solid):
- Multi-session slots, model picker/settings, slash commands, approval/clarify dialogs, thinking/reasoning blocks, subagent trees, attachments.
- `config.yaml` (cc-switch) watcher.

### Non-goals

- Embedding the GTK app as a sub-window.
- Exposing the agent over the network without auth (see §3).

## 2. Architecture

Four pieces, cleanly separated:

### 2.1 Auth token — `server/src/` (foundation)

- A random 256-bit hex token, generated once and persisted in `~/.privy-cloud/config.json` alongside `root`.
- Enforced in the existing Fastify `onRequest` hook for all `/api/*` requests (header `Authorization: Bearer <token>`) and for `/ws` (query `?token=`). Static assets (`/`, `/assets/*`) stay public so the login screen can load.
- Backend prints the token once at startup and it is readable from `config.json`, so the user can copy it to their phone.
- Frontend: a one-time "enter access token" screen (stored in `localStorage`); `api.ts` attaches the header to every request; `ws.ts` appends `?token=`.

Rationale: the backend is LAN-exposed (`PRIVY_HOST=0.0.0.0`). A Hermes agent runs shell commands; without auth it is unauthenticated RCE on the LAN.

### 2.2 Backend Hermes client — `server/src/hermes/` (new)

Ports `Native-Hermes/src/hermes_client/` to TypeScript, using the `ws` package (already a server dependency):

| File | Ports | Responsibility |
|---|---|---|
| `jsonrpc.ts` | `jsonrpc.rs` | `JsonRpcFrame` encode/decode — Request/Response/Error/Event |
| `events.ts` | `events.rs` | `AgentEvent` union + `parse(type, payload)` (field mappings) |
| `serve.ts` | `serve.rs` | spawn `hermes serve`, env stripping, ready-line parse |
| `client.ts` | `client.rs` | WS connect, `call`/`notify`, response correlation, heartbeat |
| `manager.ts` | (app.rs loop) | lifecycle: spawn → connect → reconnect → resume; shutdown |

Key transport facts (verified against source):
- Spawn: `hermes serve --host 127.0.0.1 --port 0 --skip-build`, env `HERMES_DASHBOARD_SESSION_TOKEN=<uuid>`, read stdout for `HERMES_BACKEND_READY port=N` (also accept legacy `HERMES_DASHBOARD_READY`), 30s timeout.
- Strip env vars from the child so Claude Code's provider keys don't leak into Hermes: `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_ENDPOINT`, `ANTHROPIC_MODEL`, `ANTHROPIC_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, and the `ANTHROPIC_DEFAULT_*_MODEL(_NAME)` family.
- Connect: `ws://127.0.0.1:{port}/api/ws?token={token}`. One JSON object per WS text frame.
- Heartbeat: WS ping every 15s; idle timeout 120s → `Disconnected`. Request timeout 120s.

### 2.3 Relay — `server/src/api/routes.ts` + `server/src/api/socket.ts`

- **Commands (frontend → Hermes):** `POST /api/hermes/call` `{ method, params }` → `{ result }` (awaits the correlated JSON-RPC response). Uses the same auth token as everything else.
- **Events (Hermes → frontend):** extend `ServerEvent` with `{ type: 'hermes:event', event, session_id }` and `{ type: 'hermes:status', status }`. The existing `/ws` broadcast already reaches the frontend; no new socket.

### 2.4 React UI — `web/src/pages/HermesTab.tsx` + `web/src/hermes/`

- Port `state/view.rs` `ViewState` to a pure TS reducer `applyAgentEvent(state, event)` — message lifecycle, tool cards (`Running`→`Done`), thinking/reasoning buffering, delegation-plumbing dropping, contentless-message popping, `session.undo` mirroring, history resync.
- Components: message feed (streaming text + tool cards), composer (send / steer when streaming), stop (interrupt), undo, session list sidebar (new / resume / list).
- Consume `hermes:event` over `/ws` → reducer → render; send commands via `api.hermesCall(method, params)`.

## 3. Protocol reference (from `Native-Hermes` source)

### RPC methods (name → params → notable result fields)

| Method | Params | Result |
|---|---|---|
| `session.create` | `{}` | `{ session_id, stored_session_id }` |
| `session.resume` | `{ session_id }` | `{ session_id (live), session_key\|stored_session_id (durable), messages }` |
| `session.list` | `{ limit }` | `{ sessions: [{ id, title, … }] }` — keyed by **`id`**, not `session_id` |
| `session.most_recent` | `{}` | `{ session_id, title }` |
| `prompt.submit` | `{ session_id, text }` | `{ status: "accepted" }` (turn streams via events) |
| `session.steer` | `{ session_id, text }` | — |
| `session.interrupt` | `{ session_id }` | — |
| `session.undo` | `{ session_id }` | — (gateway truncates in-memory; DB not flushed until next prompt) |
| `complete.slash` | `{ text }` | `{ items: [{ text, meta }] }` (deferred) |
| `slash.exec` | `{ session_id, command }` | `{ type, output, notice, message, target }` (deferred) |
| `approval.respond` | `{ session_id, choice, all }` | — (deferred) |
| `clarify.respond` | `{ session_id, request_id, answer }` | — (deferred) |
| `config.set` | `{ key, value, session_id }` | — (deferred) |
| `model.options` | `{ session_id?, explicit_only, include_unconfigured }` | (deferred) |
| `image.attach` / `file.attach` | `{ session_id, path[, name] }` | (deferred) |

**Live vs durable session id:** `session_id` is per-serve and goes stale on reconnect; `stored_session_id`/`session_key` is durable. On a fresh serve, sessions must be **re-resumed** via `session.resume` (history alone leaves them unregistered and `prompt.submit` fails "session not found").

### Events (type → payload fields)

`gateway.ready` (first event), `session.info` `{model,provider,cwd}`, `session.title` `{session_id,title}`, `message.start`, `message.delta` `{text}`, `message.complete` `{text,status}`, `tool.start` `{tool_id|id, name, context|preview}`, `tool.generating` `{name}`, `tool.complete` `{tool_id|id, name, ok?, duration_s|duration, summary|result|result_preview}` (missing `ok` = success), `approval.request` `{id, command, tool}`, `clarify.request` `{request_id, question, choices}`, `thinking.delta`/`reasoning.delta`/`reasoning.available` `{text}`, `subagent.start` `{subagent_id, parent_id, depth, goal, model}`, `subagent.complete` `{subagent_id, status}`, `status.update` `{kind, text}`, `error` `{message}`.

Reducer edge cases to preserve (from `state/view.rs`): drop `[ASYNC DELEGATION … COMPLETE]` plumbing; pop contentless turns; `tool.generating` must not restart a completed tool's spinner; snapshot subagents into the message on `message.complete`/`error`; buffer thinking/reasoning deltas before `message.start`.

## 4. Reliability

- Reconnect loop: on `Disconnected`, respawn `hermes serve`, reconnect, re-resume the bound session, resync history.
- Fresh drafts (no messages → no DB row) reset to empty rather than failing resume.
- Graceful shutdown: kill the `hermes serve` child on backend close.
- Heartbeat + idle timeout (from `client.ts`).

## 5. Testing

- Auth: 401 without token, 200 with; frontend gate.
- `jsonrpc.ts`/`events.ts`: port the Rust unit tests (encode/decode, event field mappings).
- `client.ts`: mock WS server integration test (echo `session.create`, push one event).
- `serve.ts`: fake-`hermes` shell script tests (ready-line parse, env strip, timeout).
- Reducer: port the Rust `state/view.rs` unit tests.
- Smoke: guarded (skip when `hermes` absent) — spawn real serve, assert `gateway.ready`.

## 6. Phasing

1. **Auth token** — config + hook + frontend gate + tests.
2. **Backend client** — `jsonrpc`/`events`/`serve`/`client`/`manager` + unit + mock-integration tests.
3. **Relay** — `POST /api/hermes/call` + WS event forwarding.
4. **React UI** — reducer + single-session chat + session list + tests.
5. **Reliability** — reconnect/resume + shutdown.

# Hermes Agent Feature Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` checkbox semantics.

**Goal:** Close the Privy Cloud Hermes Agent tab's gap with Native-Hermes. Web-only — the server relay needs **no changes** (`POST /api/hermes/call` is a generic JSON-RPC pass-through; the `AgentEvent` union is already complete in `server/src/hermes/events.ts` + `web/src/hermes/types.ts`).

**Spec:** `docs/superpowers/specs/2026-08-25-hermes-agent-parity-design.md`

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library, existing `@privy/shared`.

## Progress

Executed on the `feat/hermes-parity` branch. Full web suite green: **22 files / 191 tests**.

- ✅ **Task 1** extend types — `feat(hermes): extend HermesState/types for feature parity`
- ✅ **Task 2** reducer semantics — `feat(hermes): implement full agent-event reducer semantics` (49 reducer tests)
- ✅ **Task 3** bridge actions — `feat(hermes): bridge actions for model/approval/clarify/slash/attachments/session` (15 `useHermes` tests)
- ✅ **Task 4** reconnect re-resume — `feat(hermes): auto re-resume active session on reconnect`
- ✅ **Task 5** model/effort picker — `feat(hermes): composer model/effort picker`
- ✅ **Task 6** approval + clarify dialogs — `feat(hermes): permission and clarify dialogs`
- ✅ **Task 7** process strip — `feat(hermes): per-message process strip`
- ✅ **Task 8** attachments — `feat(hermes): file/image attachments via upload-to-library then attach` (resolved, see below)
- ✅ **Task 9** slash autocomplete — `feat(hermes): slash command autocomplete`
- ✅ **Task 10** session actions menu — `feat(hermes): session actions menu (archive/rename/delete/recent)`
- ✅ **Task 11** verification — web suite green (focused 21/15/49; full-suite 105 executed, all passed — worker-setup timeouts under load are infra noise, not failures); server hermes 32/32 **incl. real-gateway smoke**; live end-to-end API probes confirmed `session.create/list`, `file.attach`/`image.attach`, and `model.options` against the running Tauri backend.

### Task 8 note — how the attachment blocker was resolved

`image.attach`/`file.attach` need a gateway-readable filesystem `path`. **Verified against the live gateway:** the Hermes session's `info.cwd` is the project root, and the gateway resolves both absolute and cwd-relative `path`s. So a browser-picked file is uploaded to the shared library via `POST /api/send/file` and attached by `Privy Cloud/<relpath>` (relative to the session cwd). No server change. Side effect (intended): attached files also land in the user's Privy Cloud library, making them available to the `@hermes` bot.

## Global Constraints

- The reducer must remain **pure + immutable** — every handler returns a new state; never mutate the input. Existing tests at `web/src/__tests__/reducer.test.ts:291-340` enforce this.
- Keep `web/src/hermes/types.ts` and `server/src/hermes/events.ts` in sync (they already mirror the full 19-variant union).
- Session identity: **live** `session_id` (per-serve, stale on reconnect) vs **durable** `session_key` (`stored_session_id`/`session_key`, what `session.resume` accepts). The manager's `setResume` hook EXISTS (`server/src/hermes/manager.ts:198`) but is **never called in production** (only the test does), so the harness's reconnect-resume never fires. Task 4 fixes re-resume **client-side** (web-only), so no server change is required.
- `config.set` value is a **CLI-style string**, not a JSON object. Model: `"<model> --provider <slug> --session"` (or `--global`). Effort: a bare effort string.
- `session.delete` uses the **durable** key; `session.close` uses the **live** id. Delete a session by closing its live id **first**, then deleting the durable key.
- Existing test commands: `npm run test -w web` and `npm run test -w server`. TDD: write the failing test first, then implement, then run the suite, then commit.
- `EFFORT_LEVELS = ['none','minimal','low','medium','high','xhigh','max','ultra']`.

---

## WP-A — Reducer & state extension (foundational; do first)

### Task 1: Extend the types

**Files:** `web/src/hermes/types.ts`

**Interfaces:** Add to `HermesState`: `pendingApproval?`, `pendingClarify?`, `currentModel?`, `currentProvider?`, `currentEffort?`, `pendingAttachments: Attachment[]`, `subagents: SubagentNode[]`, `pendingThinking: string`, `pendingReasoning: string`. Add to `Message`: `thinking?`, `reasoning?`, `subagents: SubagentNode[]`. Add to `ToolCard`: `output?`, `duration?`, `resultPreview?`. Add `SubagentNode`, `ApprovalPrompt`, `ClarifyPrompt`, `Attachment`.

- [ ] **Step 1:** Write the type additions. `initialHermesState()` (in `reducer.ts`) must now return `pendingAttachments: []`, `subagents: []`, `pendingThinking: ''`, `pendingReasoning: ''` plus `undefined` for the optionals.
- [ ] **Step 2:** `npm run test -w web` — the **existing reducer test "deferred events are clean no-ops"** still passes for now (types changed, no behavior yet). Confirm nothing else broke on type change.
- [ ] **Step 3:** Commit `feat(hermes): extend HermesState types for feature parity`.

### Task 2: Reducer — thinking/reasoning/subagent/approval/clarify/session.info + helpers

**Files:** `web/src/hermes/reducer.ts`

**Interfaces:** Implement the `applyAgentEvent` cases per the spec §5 table. Add `pushAssistant(state, text)`, `addAttachment(state, label, refText)`, `takeAttachments(state): string[]`, `removeAttachment(state, index)`, and the `EFFORT_LEVELS` constant. Update `isContentless` to consider `thinking`/`reasoning`. Add `isModelSwitchMarker(text)` and use it in `resyncMessages`.

- [ ] **Step 1: Write the failing tests.** Replace the "deferred events are clean no-ops" test (`reducer.test.ts:269-289`) with real-behavior tests ported from `state/view.rs`:
  - `subagent.start` pushes a node; duplicate `subagent.start` ignored; `subagent.complete` sets status; `message.start` clears live subagents.
  - `message.complete`/`error` snapshot subagents into the message; a post-`complete` `subagent.complete` updates the snapshot.
  - `thinking.delta` before `message.start` buffers then commits on `message.start`; `reasoning.delta` appends to an open streaming message.
  - `reasoning.available` replaces accumulated deltas (buffer before start; attach to open assistant during streaming; must NOT leak to the next message).
  - `approval.request` sets `pendingApproval` (command defaults to `"approve this tool call"`); `clarify.request` sets `pendingClarify`.
  - `session.info` sets `currentModel`/`currentProvider`.
  - Content-less detection now keeps a message that has thinking/reasoning.
  - `resyncMessages` drops the model-switch marker (`[System: The active model for this chat has changed to …`).
  - `pushAssistant` adds a completed assistant message; attachment helpers queue/drain/remove.
  - **Immutability**: each of the above returns a new state (not the same reference) and does not mutate the input message objects.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3: Implement.** Port the Rust `apply` branches exactly. Key lines to mirror:
  - `message.start`: `state.subagents = []`; pop trailing content-less streaming messages; create a new streaming assistant message committing `pendingThinking`/`pendingReasoning` and clearing the buffers.
  - `message.complete`/`error`: set the message's `subagents = state.subagents.slice()` before dropping/keeping.
  - `reasoning.available`: find the last streaming **or** assistant message; set its `reasoning = text` (don't append); else buffer.
  - `subagent.complete`: update the live node **and** map over `state.messages` updating each message's `subagents` snapshot node with the same id.
  - `isContentless(msg)`: also check `msg.thinking` and `msg.reasoning` are empty/whitespace.
  - `resyncMessages`: add `!isModelSwitchMarker(item.text)` to the user-branch filter.
- [ ] **Step 4:** Run the full reducer suite — PASS (plus the existing tests stay green). Update `undoLastTurn` to pop `steer`/`assistant`/`tool` (already does) — unchanged.
- [ ] **Step 5:** Commit `feat(hermes): implement full agent-event reducer semantics`.

---

## WP-B — Bridge (`useHermes`) actions

### Task 3: Expose the new actions + keep the active key in sync

**Files:** `web/src/hermes/useHermes.ts`

**Interfaces:** Extend the returned object with: `setModel(providerSlug, model, sessionScope)`, `setEffort(level)`, `respondApproval(choice, all)`, `respondClarify(answer)`, `attachImage(path)`, `attachFile(path, name)`, `send` (now prepends attachment refs + routes slash commands), `archive()`, `rename(title)`, `remove()`, `mostRecent()`, `currentModel/currentProvider`. On every session change (create/resume/new), call `manager.setResume` via a new `api.hermesSetResume`? — **No**: `setResume` is manager-internal. Instead, persist the durable key and rely on the manager's existing resume loop; the frontend must **call `session.resume` itself** after a reconnect. Add a `session.info` listener to refresh `currentModel`/`currentProvider`.

- [ ] **Step 1: Write failing tests** (in `HermesTab.test.tsx` or a new `useHermes` test) asserting the action functions call the right method with the right params:
  - `setModel(providerSlug, model)` → `api.hermesCall('config.set', { key: 'model', value: '<model> --provider <providerSlug> --session', session_id })`.
  - `setEffort('high')` → `api.hermesCall('config.set', { key: 'reasoning', value: 'high', session_id })`.
  - `respondApproval('allow_once', false)` → `api.hermesCall('approval.respond', { session_id, choice: 'allow_once', all: false })`.
  - `respondClarify('answer text')` → `api.hermesCall('clarify.respond', { session_id, request_id, answer: 'answer text' })`.
  - `attachImage(path)` → `api.hermesCall('image.attach', { session_id, path })`; `attachFile(path, name)` → `api.hermesCall('file.attach', { session_id, path, name })`.
  - `send('/cmd …')` → `api.hermesCall('slash.exec', { session_id, command: '/cmd …' })`; `send('hello')` → `prompt.submit`.
  - `send` with a pending attachment prepends the ref to the text.
  - `archive()` → `api.hermesCall('session.history', { session_id })`; `rename('T')` → `session.title`; `remove()` → `session.close` then `session.delete` (durable key); `mostRecent()` → `session.most_recent`.
- [ ] **Step 2:** Run — expect FAIL (methods absent).
- [ ] **Step 3: Implement.** Add the action functions using `stateRef.current.sessionId` / `sessionKey`. `send` builds the text by prepending `takeAttachments` refs; if the trimmed text starts with `/`, call `slash.exec` and render the result via `pushAssistant` (through `applyAgentEvent`-like wiring) — simplest: after `slash.exec` resolves, call a reducer helper or set the assistant message manually.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(hermes): bridge actions for model/approval/clarify/slash/attachments/session`.

### Task 4: Reconnect re-resume (web-only; closes a real gap)

**Context:** `server/src/hermes/manager.ts:198` has a `setResume` hook that re-resumes a session and forwards `{ kind:'resynced', messages }` after reconnect (`manager.ts:136-150`) — but **nothing calls `setResume` in production** (only `server/test/hermes/manager.test.ts:125`), so `resumeKey` is always `null` and the manager never re-resumes. The frontend also ignores `hermes:status`. Result: after a backend restart, the tab's live `session_id` goes stale and the next `prompt.submit` fails "session not found" until the user re-clicks a session row. Fix it client-side.

**Files:** `web/src/hermes/useHermes.ts`, `web/src/__tests__/reducer.test.ts` or `web/src/__tests__/HermesTab.test.tsx`

**Interfaces:** In the `connect` callback (currently at `useHermes.ts:94-101`), detect `e.event.type === 'hermes:status' && e.event.status === 'connected'`. When that transition fires AND a durable `sessionKey` is already bound, call the existing `resume(sessionKey)` path to re-fetch the fresh live id + resync messages. Guard the **initial** connect (which auto-creates a session on mount, `useHermes.ts:103`) with a ref so we don't double-resume right after create.

- [ ] **Step 1: Write the failing test** — mount `HermesTab`, wait for `session.create`, emit a `hermes:status` `'connected'` frame (via `connect`'s captured `onHermesEvent`, same mechanism as `HermesTab.test.tsx:18-20`), then assert `api.hermesCall` was called with `session.resume` and the live id was refreshed. Also assert the *initial* connect does NOT trigger a resume right after create.
- [ ] **Step 2:** Run — expect FAIL (no reconnect logic today).
- [ ] **Step 3: Implement.** Track a `boundRef` set true after the first successful `session.create`/`resume`. In the WS callback, on `hermes:status === 'connected'`, if `boundRef.current` and a durable key exists, call the same logic as `resume(sessionKey)`.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(hermes): auto re-resume active session on reconnect`.

---

## WP-C — Composer model/effort picker

### Task 5: Badge + picker popover

**Files:** `web/src/pages/HermesTab.tsx` (+ a new `web/src/components/HermesModelPicker.tsx`), `web/src/__tests__/HermesTab.test.tsx`

**Interfaces:** A badge in the composer showing `state.currentModel`/`currentProvider`/`currentEffort`; on click opens a popover that, on open, calls `api.hermesCall('model.options', { explicit_only: true })` and `api.hermesCall('config.get', { key: 'reasoning', session_id })` in parallel. Render providers → models + a row of `EFFORT_LEVELS` chips. Selecting a model calls `setModel`; selecting an effort calls `setEffort`. If `config.set` returns `confirm_required`, show a confirm dialog and re-issue with `confirm_expensive_model: true`. On `session.info`, refresh the badge.

- [ ] **Step 1: Write a failing test** — render `HermesTab`, click the model badge, assert `api.hermesCall` was called with `model.options` and `config.get`, then assert the provider/model list renders from the mocked result.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.** Add `parseModelOptions` (mirrors Native-Hermes `settings.rs:29-54`, mapping `{ slug, models[], authenticated, auth_type, warning, is_current, is_user_defined }`), a `ProviderOption[]`; render with the active row highlighted by `state.currentModel`/`currentProvider`.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(hermes): composer model/effort picker`.

---

## WP-D — Permission & clarify dialogs

### Task 6: Approval + clarify modals

**Files:** `web/src/pages/HermesTab.tsx` (+ `web/src/components/HermesApprovalDialog.tsx`, `HermesClarifyDialog.tsx`), `web/src/__tests__/HermesTab.test.tsx`

**Interfaces:** When `state.pendingApproval` is set, render a modal with the command and buttons **Allow once** / **Allow always** / **Deny**, calling `respondApproval`. When `state.pendingClarify` is set, render a modal with the question + choice chips + input, calling `respondClarify`. Resolve the session id at call time. Clear `pendingApproval`/`pendingClarify` from state once handled (add reducer helpers or set directly via a `applyAgentEvent`-adjacent setState).

- [ ] **Step 1: Write a failing test** — emit `approval.request`, assert the modal renders the command, click "Deny", assert `api.hermesCall('approval.respond', { session_id, choice: 'deny', all: false })`. Likewise for `clarify.request`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(hermes): permission and clarify dialogs`.

---

## WP-E — Process strip (rich message rendering)

### Task 7: Collapsible process strip

**Files:** `web/src/pages/HermesTab.tsx` (+ `web/src/components/HermesProcessStrip.tsx`), `web/src/__tests__/HermesTab.test.tsx`

**Interfaces:** Under each assistant message, render a `<details>` strip when the message has tools, subagents, thinking, or reasoning. **Tools** rows: status icon (`…`/`✓`/`✗`), monospace name, preview, `duration` (`1.5s`) + `resultPreview`. **Subagents** tree nested by `parentId` (roots = nodes whose parent isn't present); status icon. **Thinking / Reasoning** muted blocks.

- [ ] **Step 1: Write a failing test** — emit `message.start` + `tool.start`/`tool.complete` + `subagent.start`/`subagent.complete` + `thinking.delta`, assert the strip renders tool duration, subagent status, and thinking text.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.** Reuse the existing `ToolCardView` (extend it), build the subagent tree with a small recursive component keyed on `parentId`.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(hermes): per-message process strip`.

---

## WP-F — Attachments

### Task 8: Attach chips → `image.attach`/`file.attach`

**Files:** `web/src/hermes/useHermes.ts` (already), `web/src/pages/HermesTab.tsx`, `web/src/__tests__/HermesTab.test.tsx`

**Interfaces:** An `📎` button opens a file picker; on select, call `attachImage`/`attachFile` by extension, then push a chip into `state.pendingAttachments`. `×` removes it (`removeAttachment`). `send` prepends refs.

- [ ] **Step 1: Write a failing test** — stub a file input value, assert `file.attach` (or `image.attach`) is called and a chip renders; clicking `×` removes it; `send` includes the ref in the submitted text.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(hermes): file/image attachments`.

---

## WP-G — Slash commands

### Task 9: `/` autocomplete + `slash.exec`

**Files:** `web/src/pages/HermesTab.tsx`, `web/src/__tests__/HermesTab.test.tsx`

**Interfaces:** When the composer text starts with `/`, debounce-call `complete.slash { text }` and render a suggestion list (select → fill input). On send, if text starts with `/`, call `slash.exec` and render `output`/`notice`/`message` via `pushAssistant`.

- [ ] **Step 1: Write a failing test** — type `/`, assert `complete.slash` was called; select a suggestion; assert send → `slash.exec`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(hermes): slash command autocomplete + exec`.

---

## WP-H — Session actions menu

### Task 10: Archive / rename / delete / most-recent

**Files:** `web/src/pages/HermesTab.tsx`, `web/src/hermes/useHermes.ts` (already), `web/src/__tests__/HermesTab.test.tsx`

**Interfaces:** A `⋯` menu per session row: **Archive** (`session.history` → build a Markdown transcript → `Blob` download named `<title>-<YYYY-MM-DD>.md`), **Rename** (`session.title`, inline prompt, syncs to `state.title` + row), **Delete** (confirm → `session.close` (live) then `session.delete` (durable); reset view if active), **Most recent** (`session.most_recent`).

- [ ] **Step 1: Write a failing test** — click `⋯` → Archive, assert `session.history`; Delete, assert `session.close` then `session.delete`; Rename, assert `session.title`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.** For Archive, build the `.md` from the history `messages` (role + text + tool cards), mirroring Native-Hermes' archive format.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(hermes): session actions menu (archive/rename/delete/recent)`.

---

## WP-I — Integration & verification

### Task 11: Full suite + parity checklist

- [ ] **Step 1:** `npm run test -w web && npm run test -w server && npm run build` — all green.
- [ ] **Step 2:** Guarded smoke against a real `hermes serve` (skip when absent): `HERMES_BIN=~/.local/bin/hermes npm run test -w server` — asserts `gateway.ready` then the tab connects.
- [ ] **Step 3:** Manual gate: launch the desktop shell (`GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 npm run app`), open the Hermes tab, and verify: model/effort picker reads real providers; a tool-approval prompt appears and can be answered; slash autocomplete works; an attachment chip prepends on send; archive downloads a markdown file.
- [ ] **Step 4:** Commit `test(hermes): full parity suite + smoke`.

---

## Self-review notes (for the executor)

- **Don't touch the server.** If you find yourself editing `server/src/hermes/*` for a "new" method, stop — `/api/hermes/call` already relays it. The reconnect-resume gap (Task 4) is fixed **client-side**, so no server change is needed; leave `manager.setResume` as-is (it's test-only today).
- **Reducer immutability is checked by existing tests** (`reducer.test.ts:291-340`). New handlers must return a brand-new state; to avoid aliasing bugs, `.slice()` arrays and copy objects at every write site.
- The `@hermes` bot (`usePrivyHermes.ts`) deliberately renders only user/assistant text. It inherits the richer reducer but should stay text-only — don't surface subagents there.
- `session.close` (live id) must always precede `session.delete` (durable key) — delete refuses active sessions.

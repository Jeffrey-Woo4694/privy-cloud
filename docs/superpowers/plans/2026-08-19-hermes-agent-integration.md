# Hermes Agent Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder "Hermes Agent" tab with an authenticated, single-session chat that drives the local `hermes` agent.

**Architecture:** The Node backend spawns `hermes serve`, speaks JSON-RPC 2.0 over WebSocket to it, and relays streaming events to the React tab over Privy Cloud's existing `/ws` channel. Frontend commands go over REST (`POST /api/hermes/call`). Everything is gated by a shared auth token.

**Tech Stack:** TypeScript, Fastify, `ws`, `child_process`, React 18, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-hermes-agent-integration-design.md`

## Global Constraints

- Node ≥ 22; the `hermes` CLI is at `~/.hermes/hermes-agent` and reachable via the `HERMES_BIN` env var (default `hermes` on PATH).
- Auth token: 256-bit hex (64 chars), generated once, persisted in `~/.privy-cloud/config.json` under `token`.
- REST auth header: `Authorization: Bearer <token>`. WS auth: `?token=<token>`.
- JSON-RPC frames: one JSON object per WebSocket text frame (no newline framing).
- Request timeout 120s; WS ping every 15s; idle timeout 120s.
- TDD: write the failing test first, then implement. Commit after every task.
- Existing test commands: `npm run test -w server` and `npm run test -w web`.

---

### Task 1: Auth token — generate and persist in config

**Files:**
- Modify: `server/src/config.ts`
- Test: `server/test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig()` now returns `{ root: string; owner: string; token: string }`. `ensureHomeConfig()` ensures a `token` exists in `~/.privy-cloud/config.json` (generating + writing it when absent).

- [ ] **Step 1: Write the failing test**

Add to `server/test/config.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// Existing tests import loadConfig/ensureHomeConfig/DEFAULT_ROOT from '../src/config.js'.
// This test verifies a token is generated exactly once and persisted.
it('loadConfig generates and persists a 64-hex-char token', async () => {
  // loadConfig reads ~/.privy-cloud/config.json; assert it now has a token field.
  const cfg = await loadConfig();
  expect(cfg.token).toMatch(/^[0-9a-f]{64}$/);
  const raw = JSON.parse(readFileSync(join(homedir(), '.privy-cloud', 'config.json'), 'utf8'));
  expect(raw.token).toBe(cfg.token);
  // A second load returns the same token (idempotent).
  const again = await loadConfig();
  expect(again.token).toBe(cfg.token);
});
```

(Add `import { homedir } from 'node:os';` to the test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/config.test.ts -t 'generates and persists'`
Expected: FAIL — `cfg.token` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `server/src/config.ts`, add `import { randomBytes } from 'node:crypto';`, extend `AppConfig` with `token: string`, and update `ensureHomeConfig` to also write a token when missing, and `loadConfig` to read/return it:

```ts
export interface AppConfig { root: string; owner: string; token: string }

function ensureToken(): string {
  const raw = JSON.parse(readFileSync(CONFIG_FILE(), 'utf8')) as { token?: string };
  if (raw.token && /^[0-9a-f]{64}$/.test(raw.token)) return raw.token;
  const token = randomBytes(32).toString('hex');
  writeFileSync(CONFIG_FILE(), JSON.stringify({ ...raw, token }, null, 2));
  return token;
}

export async function loadConfig(): Promise<AppConfig> {
  ensureHomeConfig();
  const token = ensureToken();
  const env = process.env.PRIVY_ROOT;
  if (env) return { root: resolve(env), owner: OWNER, token };
  const raw = JSON.parse(readFileSync(CONFIG_FILE(), 'utf8')) as { root?: string };
  return { root: resolve(raw.root ?? DEFAULT_ROOT()), owner: OWNER, token };
}
```

Note: `ensureHomeConfig()` already creates the file with `{ root }` if absent; `ensureToken()` runs after it. Keep `setRoot()` writing back only `root` (it must NOT clobber `token` — change it to merge into the existing JSON).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/config.test.ts`
Expected: PASS (all config tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/test/config.test.ts
git commit -m "feat(auth): generate and persist access token in config"
```

---

### Task 2: Auth enforcement hook (401 without token)

**Files:**
- Modify: `server/src/index.ts`
- Test: `server/test/auth.test.ts` (new)

**Interfaces:**
- Consumes: `loadConfig()` returning `{ token }` (Task 1).
- Produces: every `/api/*` request without `Authorization: Bearer <cfg.token>` → 401 `{ error: 'unauthorized' }`; `/ws` without `?token=` → 401. Static assets (`/`, `/assets/*`) and `/api/health`-style health checks remain public (keep `/api/health` public so the frontend can probe reachability before login).

- [ ] **Step 1: Write the failing test**

Create `server/test/auth.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/index.js';
import { initRootStructure } from '../src/directory.js';
import { loadConfig } from '../src/config.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function boot() {
  root = mkdtempSync(join(tmpdir(), 'privy-auth-'));
  await initRootStructure(root);
  return buildApp({ root, token: 'test-token-123' });
}

describe('auth', () => {
  it('rejects /api without a token', async () => {
    const app = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/items' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
  it('rejects /api with a wrong token', async () => {
    const app = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/items', headers: { authorization: 'Bearer nope' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
  it('allows /api with the correct token', async () => {
    const app = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/items', headers: { authorization: 'Bearer test-token-123' } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
  it('keeps /api/health public', async () => {
    const app = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
```

This requires `buildApp` to accept an optional `token` override (so tests don't depend on the real config). Add `token?: string` to `buildApp(opts)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/auth.test.ts`
Expected: FAIL — TypeScript error (`token` not in `buildApp` opts) or 200 instead of 401.

- [ ] **Step 3: Write minimal implementation**

In `server/src/index.ts`:
1. Extend `buildApp(opts?: { root?: string; token?: string })`.
2. Resolve the token: `const token = opts?.token ?? (opts?.root ? (await loadConfig()).token : cfg.token);` — simpler: always call `loadConfig()` once to get `token` when `opts.token` isn't supplied, but keep the existing `cfg` logic. Concretely: add `const authToken = opts?.token ?? (await loadConfig()).token;` and reuse `authToken` in the hook. (When `opts.root` is set but `opts.token` is not, `loadConfig()` still yields the real token; acceptable.)
3. Add an `onRequest` hook (before or merged with the existing permission hook):

```ts
app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api') && !req.url.startsWith('/ws')) return;
  if (req.url === '/api/health') return;
  const got = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    ?? (req.query as Record<string, string | undefined>).token;
  if (got !== authToken) return reply.code(401).send({ error: 'unauthorized' });
});
```

Fastify's `onRequest` runs before routing, so `/ws` and `/api/*` are both covered; the query `token` fallback covers the WS handshake (`/ws?token=…`). The existing permission hook stays (it always returns true today).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/auth.test.ts server/test/api.test.ts server/test/cors.test.ts`
Expected: PASS — but the existing `api.test.ts`/`cors.test.ts` use `boot()` with NO token, so they now 401. Fix: in those tests' `boot()`, pass `token: 'test-token'` and add `headers: { authorization: 'Bearer test-token' }` to their `app.inject` calls, or set a shared helper. Update `api.test.ts` and `cors.test.ts` accordingly (also `transcode.test.ts` calls `buildApp` indirectly? — it does not; it imports functions directly). `watcher.test.ts` uses `buildApp({ root })` too — update its boot helper likewise.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/test/auth.test.ts server/test/api.test.ts server/test/cors.test.ts server/test/watcher.test.ts
git commit -m "feat(auth): enforce bearer token on /api and /ws"
```

---

### Task 3: Frontend auth gate + token propagation

**Files:**
- Create: `web/src/auth.ts`
- Create: `web/src/components/LoginGate.tsx`
- Modify: `web/src/api.ts`, `web/src/ws.ts`, `web/src/App.tsx`
- Test: `web/src/__tests__/auth.test.tsx` (new)

**Interfaces:**
- Produces: `auth.getToken(): string | null`, `auth.setToken(t: string): void`. `api.ts` reads the token from `localStorage` and sends `Authorization: Bearer` on every `req()`. `ws.ts` appends `?token=` to the WS URL. `LoginGate` renders children only when a token is present, else shows an input.

- [ ] **Step 1: Write the failing test**

Create `web/src/__tests__/auth.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginGate } from '../components/LoginGate';
import { getToken, setToken } from '../auth';

describe('LoginGate', () => {
  beforeEach(() => localStorage.clear());
  it('shows the token form when no token is set', () => {
    render(<LoginGate><div>app content</div></LoginGate>);
    expect(screen.getByPlaceholderText(/access token/i)).toBeTruthy();
    expect(screen.queryByText('app content')).toBeNull();
  });
  it('stores the token and reveals children', () => {
    render(<LoginGate><div>app content</div></LoginGate>);
    fireEvent.change(screen.getByPlaceholderText(/access token/i), { target: { value: 'tok' } });
    fireEvent.click(screen.getByText(/unlock/i));
    expect(getToken()).toBe('tok');
    expect(screen.getByText('app content')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/src/__tests__/auth.test.tsx`
Expected: FAIL — module not found (`../auth`, `../components/LoginGate`).

- [ ] **Step 3: Write minimal implementation**

`web/src/auth.ts`:

```ts
const KEY = 'privy-token';
export const getToken = (): string | null => localStorage.getItem(KEY);
export const setToken = (t: string): void => localStorage.setItem(KEY, t);
```

`web/src/components/LoginGate.tsx`:

```tsx
import { useState } from 'react';
import { getToken, setToken } from '../auth';

export function LoginGate({ children }: { children: React.ReactNode }) {
  const [token, setTok] = useState(getToken() ?? '');
  const [stored, setStored] = useState<string | null>(getToken());
  if (stored) return <>{children}</>;
  return (
    <div className="placeholder-page">
      <div style={{ fontSize: 40 }}>🔑</div>
      <div style={{ fontSize: 18 }}>Enter your Privy Cloud access token</div>
      <input placeholder="Access token" value={token} onChange={(e) => setTok(e.target.value)}
        style={{ width: 300, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--inputbg)', color: 'var(--text)' }} />
      <button className="btn primary" onClick={() => { setToken(token); setStored(token); }}>Unlock</button>
    </div>
  );
}
```

`web/src/api.ts`: import `getToken`, and in `req()` and `getFileText()` add `headers: { ...init?.headers, authorization: `Bearer ${getToken() ?? ''}` }`.

`web/src/ws.ts`: `const token = getToken();` and build `const url = base.replace(/^http/, 'ws') + '/ws' + (token ? '?token=' + encodeURIComponent(token) : '')`.

`web/src/App.tsx`: wrap `<Shell />` in `<LoginGate>…</LoginGate>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/src/__tests__/auth.test.tsx web/src/__tests__/App.test.tsx`
Expected: PASS. (App.test may need the token set in `beforeEach` — set `localStorage.setItem('privy-token','t')` in its setup if it fails.)

- [ ] **Step 5: Commit**

```bash
git add web/src/auth.ts web/src/components/LoginGate.tsx web/src/api.ts web/src/ws.ts web/src/App.tsx web/src/__tests__/auth.test.tsx
git commit -m "feat(auth): login gate and token propagation in web client"
```

---

### Task 4: JSON-RPC frame codec (`server/src/hermes/jsonrpc.ts`)

**Files:**
- Create: `server/src/hermes/jsonrpc.ts`
- Test: `server/test/hermes/jsonrpc.test.ts` (new)

**Interfaces:**
- Produces:

```ts
export type JsonRpcFrame =
  | { kind: 'request'; id: number; method: string; params: unknown }
  | { kind: 'response'; id: number; result: unknown }
  | { kind: 'error'; id: number | null; code: number; message: string }
  | { kind: 'event'; eventType: string; sessionId: string | null; payload: unknown };
export function encodeFrame(f: JsonRpcFrame): string;
export function decodeFrame(line: string): JsonRpcFrame;
export function encodeRequest(id: number, method: string, params: unknown): string;
```

- [ ] **Step 1: Write the failing test** (port `jsonrpc.rs` tests)

```ts
import { describe, expect, it } from 'vitest';
import { encodeFrame, decodeFrame, encodeRequest } from '../../src/hermes/jsonrpc.js';

describe('jsonrpc', () => {
  it('encodes a request', () => {
    expect(encodeRequest(1, 'session.create', { cwd: '/tmp' }))
      .toBe('{"jsonrpc":"2.0","id":1,"method":"session.create","params":{"cwd":"/tmp"}}');
  });
  it('decodes a response', () => {
    expect(decodeFrame('{"jsonrpc":"2.0","id":7,"result":{"session_id":"abc12345"}}'))
      .toEqual({ kind: 'response', id: 7, result: { session_id: 'abc12345' } });
  });
  it('decodes an error with null id', () => {
    expect(decodeFrame('{"jsonrpc":"2.0","id":null,"error":{"code":-32601,"message":"method not found"}}'))
      .toEqual({ kind: 'error', id: null, code: -32601, message: 'method not found' });
  });
  it('decodes an event with a session', () => {
    expect(decodeFrame('{"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"abc12345","payload":{"text":"hel"}}}'))
      .toEqual({ kind: 'event', eventType: 'message.delta', sessionId: 'abc12345', payload: { text: 'hel' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/hermes/jsonrpc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Port `jsonrpc.rs` `JsonRpcFrame::encode`/`decode` to TS. `decodeFrame` checks `method === 'event'` first, then `error`, then `method` (request), else response. `encodeFrame` builds the matching object and `JSON.stringify`s it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/hermes/jsonrpc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/hermes/jsonrpc.ts server/test/hermes/jsonrpc.test.ts
git commit -m "feat(hermes): JSON-RPC frame codec"
```

---

### Task 5: Agent event parser (`server/src/hermes/events.ts`)

**Files:**
- Create: `server/src/hermes/events.ts`
- Test: `server/test/hermes/events.test.ts` (new)

**Interfaces:**
- Produces: `export type AgentEvent = ...` (union of `{type}`, exactly the 19 variants in the spec §3) and `export function parseAgentEvent(eventType: string, payload: any): AgentEvent`.

- [ ] **Step 1: Write the failing test** (port `events.rs` tests — at minimum the gateway-field-mapping cases)

```ts
import { describe, expect, it } from 'vitest';
import { parseAgentEvent } from '../../src/hermes/events.js';

describe('events', () => {
  it('parses gateway tool.complete (tool_id/duration_s/summary, no ok = success)', () => {
    expect(parseAgentEvent('tool.complete', { tool_id: 'call_123', name: 'read_file', duration_s: 0.05, summary: 'read 931 chars' }))
      .toEqual({ type: 'tool.complete', id: 'call_123', name: 'read_file', ok: true, duration: 0.05, resultPreview: 'read 931 chars' });
  });
  it('parses gateway tool.start (tool_id/context)', () => {
    expect(parseAgentEvent('tool.start', { tool_id: 'call_123', name: 'read_file', context: 'read_file(path=x)' }))
      .toEqual({ type: 'tool.start', id: 'call_123', name: 'read_file', preview: 'read_file(path=x)' });
  });
  it('parses subagent.start (subagent_id/parent_id/depth)', () => {
    expect(parseAgentEvent('subagent.start', { subagent_id: 'sa1', parent_id: 'root', depth: 1, goal: 'g', model: 'm' }))
      .toEqual({ type: 'subagent.start', id: 'sa1', parentId: 'root', depth: 1, goal: 'g', model: 'm' });
  });
  it('preserves unknown events', () => {
    expect(parseAgentEvent('surprise.event', { x: 1 })).toEqual({ type: 'unknown', eventType: 'surprise.event', payload: { x: 1 } });
  });
  it('defaults missing fields safely', () => {
    expect(parseAgentEvent('message.complete', {})).toEqual({ type: 'message.complete', text: '', status: 'ok' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/hermes/events.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Port `events.rs` `AgentEvent::parse` to TS. Use `payload.get('tool_id') ?? payload.get('id')` etc. `ok` defaults to `true` on `tool.complete`; `duration` from `duration_s ?? duration`; `resultPreview` from `summary ?? result ?? result_preview`. `clarify.request` uses `request_id`; `approval.request` uses `id`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/hermes/events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/hermes/events.ts server/test/hermes/events.test.ts
git commit -m "feat(hermes): agent event parser"
```

---

### Task 6: `hermes serve` spawner (`server/src/hermes/serve.ts`)

**Files:**
- Create: `server/src/hermes/serve.ts`
- Test: `server/test/hermes/serve.test.ts` (new)

**Interfaces:**
- Produces:

```ts
import type { ChildProcess } from 'node:child_process';
export const HERMES_ENV_STRIP: readonly string[];
export function parseReadyLine(line: string): number | null;
export function spawnServe(hermesBin: string, opts?: { timeoutMs?: number }): Promise<{ info: { port: number; token: string }; child: ChildProcess }>;
```

- [ ] **Step 1: Write the failing test** (port `serve.rs` tests using a fake shell script)

```ts
import { describe, expect, it } from 'vitest';
import { writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseReadyLine, spawnServe } from '../../src/hermes/serve.js';

describe('serve', () => {
  it('parses the ready line', () => {
    expect(parseReadyLine('HERMES_BACKEND_READY port=39123')).toBe(39123);
    expect(parseReadyLine('HERMES_DASHBOARD_READY port=1')).toBe(1);
    expect(parseReadyLine('info: loading config')).toBeNull();
  });

  it('spawns a fake hermes and waits for the ready line', async () => {
    const fake = '#!/bin/sh\nprintf \'HERMES_BACKEND_READY port=48002\\n\'\nwhile :; do :; done\n';
    const path = join(tmpdir(), `fake-hermes-${process.pid}.sh`);
    writeFileSync(path, fake); chmodSync(path, 0o755);
    const { info, child } = await spawnServe(path);
    expect(info.port).toBe(48002);
    expect(info.token).toMatch(/^[0-9a-f]{32}$/);
    child.kill('SIGKILL');
  }, 10000);

  it('strips ANTHROPIC_* env from the child', async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'sk-leak';
    const fake = '#!/bin/sh\n[ -n "$ANTHROPIC_AUTH_TOKEN" ] && exit 1\nprintf \'HERMES_BACKEND_READY port=48003\\n\'\nwhile :; do :; done\n';
    const path = join(tmpdir(), `fake-hermes-strip-${process.pid}.sh`);
    writeFileSync(path, fake); chmodSync(path, 0o755);
    const { info, child } = await spawnServe(path);
    expect(info.port).toBe(48003);
    child.kill('SIGKILL');
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  }, 10000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/hermes/serve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Port `serve.rs`: `spawnServe` uses `child_process.spawn(hermesBin, ['serve','--host','127.0.0.1','--port','0','--skip-build'], { env: {...process.env, HERMES_DASHBOARD_SESSION_TOKEN: token}, stdio: ['ignore','pipe','ignore'] })`, removes `HERMES_ENV_STRIP` vars from `env`, generates `token = randomBytes(16).toString('hex')`, reads stdout line-by-line until `parseReadyLine` returns a port or the timeout fires. Copy the `HERMES_ENV_STRIP` list verbatim from `serve.rs` (the 13 `ANTHROPIC_*` / `CLAUDE_CODE_OAUTH_TOKEN` names).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/hermes/serve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/hermes/serve.ts server/test/hermes/serve.test.ts
git commit -m "feat(hermes): spawn hermes serve and parse ready line"
```

---

### Task 7: Hermes WS client (`server/src/hermes/client.ts`)

**Files:**
- Create: `server/src/hermes/client.ts`
- Test: `server/test/hermes/client.test.ts` (new, uses a mock WS server)

**Interfaces:**
- Consumes: `encodeFrame`/`decodeFrame` (Task 4), `parseAgentEvent`/`AgentEvent` (Task 5).
- Produces:

```ts
export type ClientEvent =
  | { kind: 'event'; event: AgentEvent; sessionId: string | null }
  | { kind: 'response'; id: number; result: unknown }
  | { kind: 'error'; id: number; code: number; message: string }
  | { kind: 'disconnected' };
export interface HermesClient {
  call(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): void;
  shutdown(): void;
}
export function connectHermes(port: number, token: string, onEvent: (e: ClientEvent) => void): Promise<HermesClient>;
```

- [ ] **Step 1: Write the failing test** (mock WS server echoing `session.create`)

Create `server/test/hermes/client.test.ts` using `ws` to spin up a `WebSocketServer` on an ephemeral port that: on `session.create` replies `{jsonrpc,id,result:{session_id:'abc12345'}}` and then pushes one `message.delta` event. Assert `call('session.create', {})` resolves `{session_id:'abc12345'}`, and `onEvent` receives the `message.delta` `ClientEvent` with `sessionId === 'abc12345'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/hermes/client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Port `client.rs`: `connectHermes` opens `new WebSocket('ws://127.0.0.1:${port}/api/ws?token=${token}')`; keeps a `Map<number, (r) => void>` of pending calls with an incrementing id; on message, `decodeFrame` and route response/error to the pending callback or `onEvent`; on `message.delta`-style events, `parseAgentEvent` then `onEvent({kind:'event', event, sessionId})`; `call()` returns a promise resolved by the correlated response (rejects after 120s via `setTimeout`); `notify()` sends without registering a pending id; a 15s `setInterval` sends `ws.ping()`; a 120s idle timer fires `onEvent({kind:'disconnected'})`. On close/error, reject all pending and fire `disconnected`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/hermes/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/hermes/client.ts server/test/hermes/client.test.ts
git commit -m "feat(hermes): WebSocket client with call/notify and heartbeat"
```

---

### Task 8: Hermes manager (lifecycle) (`server/src/hermes/manager.ts`)

**Files:**
- Create: `server/src/hermes/manager.ts`
- Modify: `server/src/index.ts` (construct manager, wire shutdown, register its event forwarding)
- Test: `server/test/hermes/manager.test.ts` (new; uses a fake `hermes` script + mock WS server)

**Interfaces:**
- Consumes: `spawnServe` (Task 6), `connectHermes`/`HermesClient` (Task 7).
- Produces:

```ts
export type HermesStatus = 'disconnected' | 'connecting' | 'connected';
export interface HermesManager {
  start(): void;                       // spawn+connect; reconnect loop on disconnect
  call(method: string, params: unknown): Promise<unknown>;
  getStatus(): HermesStatus;
  stop(): Promise<void>;               // shutdown client + kill child
  onEvent(cb: (e: ClientEvent) => void): void;  // forward client events
}
export function createHermesManager(hermesBin: string): HermesManager;
```

The reconnect loop: `start()` spawns serve → connects → `onEvent({connected})`; on `disconnected`, kills the child, waits ~2s, respawns. `call()` delegates to the live client or rejects with `"hermes not connected"`.

- [ ] **Step 1: Write the failing test** — fake `hermes` script prints a ready line then idles; a mock WS server accepts the connection and responds to `session.create`. Assert: after `start()`, `getStatus()` becomes `'connected'` (poll a few times), `call('session.create', {})` resolves, and `stop()` kills the child (process exits).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/hermes/manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Implement `createHermesManager` with an internal `current?: { client: HermesClient; child: ChildProcess; info }` and a `status` field. The reconnect loop lives in an async function with a `running` flag; `stop()` clears the flag, calls `client.shutdown()`, `child.kill('SIGTERM')`, and resolves. Wire `server/src/index.ts`: after `buildApp`, `const hermes = createHermesManager(process.env.HERMES_BIN ?? 'hermes'); hermes.start(); hermes.onEvent((e) => ctx.emit({ type:'hermes:event', event: e.event, sessionId: e.sessionId }));` and add `app.addHook('onClose', () => hermes.stop())`. Keep it lazy: only `start()` when the Hermes tab is actually used — defer this decision to Task 9; for now `start()` unconditionally but guard with a `HERMES_ENABLED` check (default on).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/hermes/manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/hermes/manager.ts server/src/index.ts server/test/hermes/manager.test.ts
git commit -m "feat(hermes): manager with spawn/connect/reconnect lifecycle"
```

---

### Task 9: Relay — WS event forwarding + REST call endpoint

**Files:**
- Modify: `server/src/api/routes.ts` (extend `ServerEvent`, add `POST /api/hermes/call`)
- Modify: `web/src/ws.ts` (handle `hermes:event` / `hermes:status`)
- Test: `server/test/api.test.ts` (add hermes call endpoint tests)

**Interfaces:**
- Consumes: `HermesManager` (Task 8).
- Produces: `ServerEvent` gains `{ type: 'hermes:event'; event: AgentEvent; sessionId: string | null }` and `{ type: 'hermes:status'; status: HermesStatus }`. `POST /api/hermes/call` body `{ method, params }` → `{ result }` (or 503 when disconnected). Frontend `connect()` gains an `onHermesEvent` callback.

- [ ] **Step 1: Write the failing test** — in `api.test.ts`, inject a fake manager (a stub object with `call`/`getStatus`) into `buildApp` via an optional `opts.hermes`, then `app.inject POST /api/hermes/call` with a token and assert the stub's `call` is invoked and its resolved value is returned. Add the `opts.hermes` injection to `buildApp` in the same change.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/api.test.ts -t 'hermes'`
Expected: FAIL — endpoint/opts not present.

- [ ] **Step 3: Write minimal implementation**

In `routes.ts`: add `POST /api/hermes/call` that reads `{ method, params }`, checks `ctx` has a `hermes` manager, awaits `manager.call(method, params)`, returns `{ result }` (or 503 `{ error: 'hermes not connected' }` on rejection). Extend `ApiContext` with `hermes?: HermesManager`. In `index.ts`, pass `hermes` into `ApiContext` and register `hermes.onEvent((e) => ctx.emit({ type:'hermes:event', event: e.event, sessionId: e.sessionId }))`. In `web/src/ws.ts`, add an `onHermesEvent` callback to `connect()` options and dispatch `hermes:event`/`hermes:status` frames.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/routes.ts server/src/index.ts web/src/ws.ts server/test/api.test.ts
git commit -m "feat(hermes): relay events over WS and commands over REST"
```

---

### Task 10: Reducer (`web/src/hermes/reducer.ts`)

**Files:**
- Create: `web/src/hermes/reducer.ts`
- Test: `web/src/__tests__/reducer.test.ts` (new)

**Interfaces:**
- Consumes: `AgentEvent` type (re-declare in a shared-friendly form under `web/src/hermes/types.ts`, or import from a new `shared/` type — simplest: declare `AgentEvent` in `web/src/hermes/types.ts` mirroring Task 5).
- Produces:

```ts
export interface Message { id: number; role: 'user'|'assistant'|'steer'; text: string; streaming: boolean; tools: ToolCard[]; complete: boolean; }
export interface ToolCard { id: string; name: string; preview: string; state: 'running'|'done'; ok?: boolean; }
export interface HermesState { sessionId?: string; sessionKey?: string; title: string; messages: Message[]; streaming: boolean; status: string; nextMessageId: number; }
export function initialHermesState(): HermesState;
export function applyAgentEvent(state: HermesState, event: AgentEvent): HermesState;
export function pushUser(state: HermesState, text: string): HermesState;
export function resyncMessages(state: HermesState, items: { role: string; text: string; toolName?: string; toolContext?: string }[]): HermesState;
```

- [ ] **Step 1: Write the failing test** (port the key `state/view.rs` tests)

At minimum: streams and finalizes a message; tool card lifecycle (start→running, generating doesn't re-open, complete→done); contentless turn popped; delegation plumbing `[ASYNC DELEGATION … COMPLETE]` dropped; `pushUser`; `resyncMessages` rebuilds from history and skips plumbing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/src/__tests__/reducer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Port `state/view.rs` `apply`/`push_user`/`resync_messages`/`undo_last_turn` to TS as pure functions that return a NEW state (immutably), preserving every edge case: `message.start` clears subagents and pops a contentless streaming message; `message.delta` appends and drops delegation plumbing mid-stream; `message.complete` snapshots + pops contentless/plumbing; `tool.generating` is a no-op; thinking/reasoning buffer into pending and commit on `message.start`. Copy `is_delegation_plumbing` / `is_contentless` verbatim.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/src/__tests__/reducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/hermes/reducer.ts web/src/hermes/types.ts web/src/__tests__/reducer.test.ts
git commit -m "feat(hermes): pure agent-event reducer"
```

---

### Task 11: Hermes tab chat UI

**Files:**
- Create: `web/src/hermes/useHermes.ts` (hook: connect WS, apply reducer, expose `send`/`stop`/`undo`)
- Modify: `web/src/pages/HermesTab.tsx` (replace placeholder)
- Modify: `web/src/api.ts` (add `hermesCall(method, params)`)
- Test: `web/src/__tests__/HermesTab.test.tsx` (new)

**Interfaces:**
- Consumes: `applyAgentEvent`/`initialHermesState` (Task 10), `connect` WS (Task 9), `api.hermesCall`.
- Produces: `useHermes()` → `{ state, send(text), stop(), undo() }`. `send` fires `api.hermesCall('prompt.submit', {session_id, text})` (or `session.steer` when `state.streaming`); `stop` fires `session.interrupt`; `undo` fires `session.undo` then pops locally.

- [ ] **Step 1: Write the failing test** — render `HermesTab` with a mocked `api`/`connect`, assert the composer exists, typing + Enter calls `api.hermesCall('prompt.submit', …)` and pushes a user message.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/src/__tests__/HermesTab.test.tsx`
Expected: FAIL — placeholder renders instead of a chat.

- [ ] **Step 3: Write minimal implementation**

`api.ts`: `hermesCall: (method, params) => req('/api/hermes/call', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ method, params }) })`. `useHermes`: on mount, `connect({ onHermesEvent: (e) => setState(s => applyAgentEvent(s, e.event)) })`; expose `send/stop/undo`. `HermesTab`: a message feed (map `state.messages` to user/assistant/steer bubbles; assistant text streams via `text`; tool cards under the assistant message), a composer (input + Send; while `streaming` the send button becomes "Stop"), and an "Undo" button. Use existing theme classes (`chat-bubble`, `send-input`, `btn`, `panel-title`) — reuse styles from `ChatPanel.tsx` rather than inventing new ones.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/src/__tests__/HermesTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/HermesTab.tsx web/src/hermes/useHermes.ts web/src/api.ts web/src/__tests__/HermesTab.test.tsx
git commit -m "feat(hermes): single-session chat UI"
```

---

### Task 12: Session list (new / resume / list)

**Files:**
- Modify: `web/src/hermes/useHermes.ts` (add `sessions`, `newSession`, `resume(sid)`)
- Modify: `web/src/pages/HermesTab.tsx` (session list sidebar)
- Test: `web/src/__tests__/HermesTab.test.tsx` (extend)

**Interfaces:**
- Consumes: `api.hermesCall` (Task 11).
- Produces: `useHermes()` gains `{ sessions: { id: string; title: string }[], newSession(): void, resume(id: string): void }`. `newSession` → `session.create` then `setState` with the new `sessionId`/`sessionKey`; `resume` → `session.resume` then `resyncMessages(state, result.messages)`; `sessions` loaded via `session.list` (map `id` → the entry, falling back to `title || id`).

- [ ] **Step 1: Write the failing test** — assert the tab renders a "New session" button and, given a mocked `session.list` result, lists session titles.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/src/__tests__/HermesTab.test.tsx -t 'session list'`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Extend `useHermes` with `sessions` state, `refreshSessions()` (calls `session.list {limit:200}`), `newSession()`, `resume(id)`. Render a left sidebar in `HermesTab` with a "＋ New session" button and the list (click → `resume`). Wire `refreshSessions` on mount and after each turn completes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/src/__tests__/HermesTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/hermes/useHermes.ts web/src/pages/HermesTab.tsx web/src/__tests__/HermesTab.test.tsx
git commit -m "feat(hermes): session list (new/resume/list)"
```

---

### Task 13: Reliability — reconnect + resume + shutdown

**Files:**
- Modify: `server/src/hermes/manager.ts` (re-resume bound session on reconnect)
- Test: `server/test/hermes/manager.test.ts` (extend)

**Interfaces:**
- Consumes: `HermesManager` (Task 8).
- Produces: `manager.setResume(sessionKey: string | null)` records the durable session key; on reconnect after a `disconnected`, the manager re-runs `session.resume {session_id: sessionKey}` (best-effort) and re-emits the resynced history via a new `ClientEvent { kind:'resynced', messages }` so the frontend can rebuild. Fresh drafts (null key) are skipped.

- [ ] **Step 1: Write the failing test** — with a fake `hermes` + mock WS server, connect, call `manager.setResume('stored1')`, force a disconnect (kill the WS server), then on the reconnect assert `session.resume` was invoked with `{session_id:'stored1'}`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/hermes/manager.test.ts -t 'resume on reconnect'`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

In `manager.ts`, track `resumeKey`. After each successful connect, if `resumeKey` is set, `await client.call('session.resume', { session_id: resumeKey })` (catch and ignore failure) and forward its `messages` via `onEvent({ kind:'resynced', messages })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/hermes/manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/hermes/manager.ts server/test/hermes/manager.test.ts
git commit -m "feat(hermes): resume session on reconnect"
```

---

### Task 14: End-to-end smoke test (guarded)

**Files:**
- Test: `server/test/hermes/smoke.test.ts` (new)

**Interfaces:**
- Consumes: `spawnServe` (Task 6), `connectHermes` (Task 7).

- [ ] **Step 1: Write the test** — skip unless `HERMES_BIN` is set (or `hermes` on PATH): spawn `hermes serve`, connect, assert the first `ClientEvent` is `{ kind:'event', event:{ type:'gateway.ready' } }` within 15s, then `shutdown`.

- [ ] **Step 2: Run it**

Run: `HERMES_BIN=~/.hermes/hermes-agent npx vitest run server/test/hermes/smoke.test.ts` (or `npm run test -w server` — it skips when `hermes` is absent).
Expected: PASS (or SKIP).

- [ ] **Step 3: Run the full suites**

Run: `npm run test -w server && npm run test -w web && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add server/test/hermes/smoke.test.ts
git commit -m "test(hermes): guarded end-to-end smoke test"
```

---

## Self-review notes (for the executor)

- The auth token touches **every** API test: every existing `app.inject` against `/api/*` must send `Authorization: Bearer <token>` (Task 2 Step 4). Don't skip that — the suite must stay green.
- `AgentEvent` is defined in `server/src/hermes/events.ts` (server) and mirrored in `web/src/hermes/types.ts` (web) since the two packages don't share a runtime module. Keep the two in sync; the reducer test (Task 10) pins the web copy.
- The Hermes manager is constructed but only `start()`ed unconditionally in Task 8; if you want it lazy (start on first Hermes tab use), add that as a follow-up — not required for v1.

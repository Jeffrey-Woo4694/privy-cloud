# Privy Cloud v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Privy Cloud v1 — a Tauri desktop app with three tabs (Hermes Agent, Coding Agent, Privy Cloud), backed by a local TypeScript/Fastify server that owns a user-designated root directory, auto-categorizes everything sent through the Privy Cloud chat, and shows a live sharing grid with inline markdown editing.

**Architecture:** Three pieces in one npm workspace. A standalone Node backend (`server/`) is the single source of truth: it manages the root directory, watches it with chokidar, appends to a JSONL chat log, and exposes REST + WebSocket APIs on `localhost:5178`. A React frontend (`web/`) renders the tab bar, the Privy Cloud sharing grid + chat panel, and a full-width markdown editor/viewer. A thin Tauri shell (`desktop/`) wraps the built frontend in a native window and auto-starts the backend. Hermes Agent and Coding Agent are placeholder tabs in v1.

**Tech Stack:** TypeScript (strict), Fastify + @fastify/websocket + @fastify/multipart, chokidar, Vite + React 18, vitest + @testing-library/react, Tauri 2 (Rust), npm workspaces.

## Global Constraints

- Node ≥ 22; Rust ≥ 1.77; system libs `webkit2gtk-4.1` + `gtk+-3.0` installed (verified on this machine).
- All backend/frontend code is **TypeScript with `strict: true`**; Rust in `desktop/src-tauri` uses edition 2021.
- `@privy/shared` is the single source of truth for kinds and API types. Do not redefine `Kind`, `FileItem`, or `ChatEntry` anywhere else.
- Kind detection and folder names come **verbatim** from `KINDS` in `@privy/shared` (Images / Videos / Slides / Documents / Markdown / Folders / Other).
- Backend API base: `http://localhost:5178`. Vite dev server: `http://localhost:5173`.
- Path safety: any relative path coming from the API must pass `resolveSafe()` (rejects `..` and absolute paths). The security boundary is the **`Privy Cloud/` base** — nothing outside it is ever reachable through the API. Never concatenate user input into a filesystem path directly.
- File uploads **stream to disk** (`pipeline`), never fully buffered — multi-GB sends stay off the heap (spec §4.3).
- The file watcher includes a **30-second periodic rescan** as a safety net for missed events (spec §4.2).
- Hidden files (`.privy`, any name starting with `.`) are excluded from all UI listings.
- Text messages are stored as `.md` files under `Markdown/`; `md`/`markdown`/`txt` map to the `markdown` kind.
- Single-user v1: no auth enforced, but every API route is registered through a single `checkPermission()` hook that currently always allows the owner.
- Design tokens only via CSS variables (`--bg`, `--panel`, `--border`, `--text`, `--muted`, `--accent`, etc.) — no hardcoded colors in components. Dark = `data-theme="dark"`, light = `data-theme="light"` on `<html>`.
- Commit after every task. Messages use conventional prefixes (`feat:`, `fix:`, `test:`, `chore:`).

---

## File Structure

```
privy-cloud/
├── package.json                     # npm workspaces root (server, web, desktop) + root scripts
├── tsconfig.base.json
├── shared/
│   ├── package.json                 # @privy/shared (private workspace package)
│   ├── tsconfig.json
│   └── src/index.ts                 # Kind, KINDS, KIND_FOLDER, FileItem, ChatEntry
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── index.ts                 # builds Fastify app, starts listening on 5178
│   │   ├── config.ts                # ~/.privy-cloud/config.json, root resolution, setRoot
│   │   ├── directory.ts             # initRootStructure, listItems, resolveSafe, privyBase
│   │   ├── kinds.ts                 # detectKind(name, isDir) → Kind
│   │   ├── chatLog.ts               # appendEntry, readEntries (JSONL)
│   │   ├── permissions.ts           # ensurePermissions, loadPermissions, checkPermission
│   │   ├── storage.ts               # storeText, storeFile, storeFolder, uniquePath
│   │   ├── watcher.ts               # createWatcher(root, onChange) → { stop }
│   │   └── api/
│   │       ├── routes.ts            # registerRoutes(app, ctx) — all REST routes
│   │       └── socket.ts            # attachSocket(app, ctx) — WebSocket broadcasts
│   └── test/
│       ├── config.test.ts
│       ├── directory.test.ts
│       ├── kinds.test.ts
│       ├── chatLog.test.ts
│       ├── permissions.test.ts
│       ├── storage.test.ts
│       ├── watcher.test.ts
│       └── api.test.ts
├── web/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── vitest.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── vite-env.d.ts            # vite/client types (import.meta.env)
│       ├── App.tsx                  # tab bar + routing + theme
│       ├── styles/theme.css         # design tokens (dark/light)
│       ├── theme.tsx                # ThemeProvider, useTheme, toggle
│       ├── api.ts                   # REST client (fetch wrappers)
│       ├── ws.ts                    # WebSocket client with reconnect
│       ├── pages/
│       │   ├── HermesTab.tsx
│       │   ├── CodingAgentTab.tsx
│       │   └── PrivyCloudTab.tsx
│       └── components/
│           ├── Placeholder.tsx
│           ├── KindFilter.tsx
│           ├── SharingGrid.tsx
│           ├── ChatPanel.tsx
│           ├── FileViewer.tsx
│           └── MarkdownEditor.tsx
│   └── src/__tests__/
│       ├── setup.ts
│       ├── App.test.tsx
│       ├── api.test.ts
│       ├── SharingGrid.test.tsx
│       ├── ChatPanel.test.tsx
│       └── FileViewer.test.tsx
└── desktop/
    ├── package.json
    └── src-tauri/
        ├── Cargo.toml
        ├── build.rs
        ├── tauri.conf.json
        ├── capabilities/default.json
        ├── icons/icon.png
        └── src/
            ├── main.rs
            └── lib.rs                # window + auto-start backend
```

---

## Backend API Contract (implemented by tasks 7–9, consumed by tasks 11–16)

**Types** (from `@privy/shared`):

```ts
export type Kind = 'image' | 'video' | 'slide' | 'document' | 'markdown' | 'folder' | 'other';

export interface KindMeta { key: Kind; label: string; icon: string; folder: string; extensions: string[] }
export const KINDS: KindMeta[];
export const KIND_FOLDER: Record<Kind, string>;

export interface FileItem { name: string; path: string; kind: Kind; size: number; isDir: boolean; modifiedAt: string }
export interface ChatEntry {
  id: string; ts: string;
  type: 'text' | 'file' | 'folder';
  kind: Kind | 'text';
  name: string;
  path?: string;     // set when type is file/folder
  text?: string;     // set when type is text
  sender: string;    // 'owner'
}
```

**REST** (all JSON unless noted; `path` values are relative to `Privy Cloud/`, e.g. `Markdown/notes.md`):
- `GET /api/health` → `{ ok: true }`
- `GET /api/meta` → `{ root, owner }`
- `GET /api/settings/root` → `{ root }`
- `PUT /api/settings/root` body `{ path: string }` → `{ root }`
- `GET /api/items?kind=image` → `FileItem[]` (all if `kind` omitted)
- `GET /api/file?path=...` → raw bytes (Content-Type by extension)
- `PUT /api/file?path=...` body `{ content: string }` → `{ ok: true, modifiedAt: string }`
- `POST /api/send/text` body `{ text: string }` → `{ entry: ChatEntry }`
- `POST /api/send/file` multipart, field `file` → `{ entry: ChatEntry }`
- `POST /api/send/folder` multipart: field `folderName` + N `file` fields, each with a `relativePath` field → `{ entry: ChatEntry }`
- `GET /api/chat?limit=50` → `ChatEntry[]` (newest first)

**WebSocket** (server → client on `/ws`):
- `{ type: 'items:changed', path: string, change: 'created'|'modified'|'deleted'|'renamed' }`
- `{ type: 'chat:new', entry: ChatEntry }`

**Event flow:** watcher (chokidar) and chat-log appends both funnel through a single `ctx.emit(event)`; the WebSocket layer serializes and broadcasts, and REST responses return the same data for non-realtime clients.

---

### Task 1: Monorepo scaffold + `@privy/shared`

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`

**Interfaces:**
- Produces: npm workspace root with `"workspaces": ["server", "web", "desktop", "shared"]`; package `@privy/shared` exporting `KIND_FOLDER`, `KINDS`, `Kind`, `KindMeta`, `FileItem`, `ChatEntry`.

- [ ] **Step 1: Write the root package.json**

```json
{
  "name": "privy-cloud",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "web", "desktop"],
  "scripts": {
    "dev": "concurrently -n server,web -c blue,green \"npm run dev -w server\" \"npm run dev -w web\"",
    "test": "npm run test -w server && npm run test -w web",
    "build": "npm run build -w shared && npm run build -w server && npm run build -w web",
    "app": "npm run tauri -w desktop dev"
  },
  "devDependencies": { "concurrently": "^9.1.0", "typescript": "^5.5.0" }
}
```

- [ ] **Step 2: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true, "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Write `shared/package.json`**

```json
{
  "name": "@privy/shared", "private": true, "version": "0.0.0", "type": "module",
  "main": "src/index.ts", "types": "src/index.ts",
  "scripts": { "build": "tsc --noEmit" }
}
```

- [ ] **Step 4: Write `shared/tsconfig.json`**

```json
{ "extends": "../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 5: Write `shared/src/index.ts`**

```ts
export type Kind = 'image' | 'video' | 'slide' | 'document' | 'markdown' | 'folder' | 'other';

export interface KindMeta { key: Kind; label: string; icon: string; folder: string; extensions: string[] }

export const KINDS: KindMeta[] = [
  { key: 'image',    label: 'Images',    icon: '🖼️', folder: 'Images',    extensions: ['jpg','jpeg','png','gif','webp','svg','bmp','heic'] },
  { key: 'video',    label: 'Videos',    icon: '🎬', folder: 'Videos',    extensions: ['mp4','mov','webm','mkv','avi'] },
  { key: 'slide',    label: 'Slides',    icon: '📑', folder: 'Slides',    extensions: ['ppt','pptx','key','odp'] },
  { key: 'document', label: 'Documents', icon: '📄', folder: 'Documents', extensions: ['pdf','doc','docx','xls','xlsx','odt','csv','json','xml'] },
  { key: 'markdown', label: 'Markdown',  icon: '📝', folder: 'Markdown',  extensions: ['md','markdown','txt'] },
  { key: 'folder',   label: 'Folders',   icon: '📁', folder: 'Folders',   extensions: [] },
  { key: 'other',    label: 'Other',     icon: '📦', folder: 'Other',     extensions: [] },
];

export const KIND_FOLDER: Record<Kind, string> = Object.fromEntries(
  KINDS.map((k) => [k.key, k.folder]),
) as Record<Kind, string>;

export interface FileItem {
  name: string; path: string; kind: Kind; size: number; isDir: boolean; modifiedAt: string;
}

export interface ChatEntry {
  id: string; ts: string;
  type: 'text' | 'file' | 'folder';
  kind: Kind | 'text';
  name: string;
  path?: string;
  text?: string;
  sender: string;
}
```

- [ ] **Step 6: Verify shared compiles**

Run: `npm install && npm run build -w shared`
Expected: no errors, exit 0.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json shared/
git commit -m "chore: scaffold npm workspace and @privy/shared types"
```

---

### Task 2: Backend scaffold + config module

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/index.ts`, `server/src/config.ts`, `server/test/config.test.ts`

**Interfaces:**
- Consumes: `@privy/shared` (none yet).
- Produces: `loadConfig(): Promise<{ root: string; owner: string }>`; `setRoot(path: string): Promise<string>` (writes `~/.privy-cloud/config.json`, returns the absolute normalized path); `ensureHomeConfig(): void` (sync — per Step 6). Fastify app factory `buildApp()` returning a Fastify instance with `GET /api/health` → `{ ok: true }`.

- [ ] **Step 1: Write `server/package.json`**

```json
{
  "name": "@privy/server", "private": true, "version": "0.0.0", "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/multipart": "^9.0.0",
    "@fastify/websocket": "^11.0.0",
    "@privy/shared": "*",
    "chokidar": "^4.0.0",
    "fastify": "^5.0.0",
    "ws": "^8.18.0"
  },
  "devDependencies": { "@types/ws": "^8.5.0", "tsx": "^4.19.0", "vitest": "^2.1.0" }
}
```

- [ ] **Step 2: Write `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist", "rootDir": "src", "module": "NodeNext", "moduleResolution": "NodeNext",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 4: Write the failing test `server/test/config.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, setRoot } from '../src/config.js';

const HOME = process.env.HOME ?? '';
let dirs: string[] = [];
const fakeHome = () => { const d = mkdtempSync(join(tmpdir(), 'privy-home-')); dirs.push(d); return d; };

afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

describe('config', () => {
  it('loadConfig defaults to ~/PrivyCloud when no config file exists', async () => {
    const home = fakeHome();
    process.env.HOME = home;
    process.env.PRIVY_ROOT = '';
    const cfg = await loadConfig();
    expect(cfg.root).toBe(join(home, 'PrivyCloud'));
  });

  it('setRoot persists the root and returns the normalized absolute path', async () => {
    const home = fakeHome(); process.env.HOME = home; process.env.PRIVY_ROOT = '';
    const target = join(tmpdir(), 'my-data-dir');
    const got = await setRoot(target);
    expect(got).toBe(target);
    const cfgFile = join(home, '.privy-cloud', 'config.json');
    expect(existsSync(cfgFile)).toBe(true);
    expect(JSON.parse(readFileSync(cfgFile, 'utf8')).root).toBe(target);
  });
});
```

- [ ] **Step 5: Run tests, verify they fail**

Run: `npm run test -w server`
Expected: FAIL — module `../src/config.js` not found / no exports.

- [ ] **Step 6: Write `server/src/config.ts`**

```ts
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const CONFIG_DIR = () => join(homedir(), '.privy-cloud');
const CONFIG_FILE = () => join(CONFIG_DIR(), 'config.json');
export const DEFAULT_ROOT = () => join(homedir(), 'PrivyCloud');
export const OWNER = 'owner';

export interface AppConfig { root: string; owner: string }

export function ensureHomeConfig(): void {
  mkdirSync(CONFIG_DIR(), { recursive: true });
  if (!existsSync(CONFIG_FILE())) {
    writeFileSync(CONFIG_FILE(), JSON.stringify({ root: DEFAULT_ROOT() }, null, 2));
  }
}

export async function loadConfig(): Promise<AppConfig> {
  ensureHomeConfig();
  const env = process.env.PRIVY_ROOT;
  if (env) return { root: resolve(env), owner: OWNER };
  const raw = JSON.parse(readFileSync(CONFIG_FILE(), 'utf8')) as { root?: string };
  return { root: resolve(raw.root ?? DEFAULT_ROOT()), owner: OWNER };
}

export async function setRoot(path: string): Promise<string> {
  ensureHomeConfig();
  const abs = resolve(path);
  writeFileSync(CONFIG_FILE(), JSON.stringify({ root: abs }, null, 2));
  return abs;
}
```

- [ ] **Step 7: Write `server/src/index.ts` (minimal)**

```ts
import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({ logger: true });
  app.get('/api/health', async () => ({ ok: true }));
  return app;
}

// started only when run directly (`tsx src/index.ts`)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const app = buildApp();
  await app.listen({ port: Number(process.env.PRIVY_PORT ?? 5178) });
}
```

- [ ] **Step 8: Run tests, verify they pass**

Run: `npm run test -w server`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add server/
git commit -m "feat: backend scaffold with config module and health route"
```

---

### Task 3: Directory init + safe path resolution

**Files:**
- Create: `server/src/directory.ts`, `server/test/directory.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `AppConfig` from `config.ts`; `KIND_FOLDER` from `@privy/shared`.
- Produces: `initRootStructure(root: string): Promise<void>` (creates `Hermes Agent/`, `Coding Project/`, `Privy Cloud/` and, under `Privy Cloud/`, `Images/ Videos/ Slides/ Documents/ Markdown/ Folders/ Other/` + `.privy/` with empty `chat-log.jsonl` and a `permissions.json`); `resolveSafe(root: string, rel: string): string | null` (returns absolute path or `null` if `rel` escapes root or is absolute); `listItems(root: string): Promise<FileItem[]>` (recursively lists `Privy Cloud/`, excludes `.privy` and dotfiles, returns `FileItem[]` with `kind` via `detectKind`).

- [ ] **Step 1: Write the failing test `server/test/directory.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure, resolveSafe, listItems, privyBase } from '../src/directory.js';
import { createChatLog } from '../src/chatLog.js';
import { ensurePermissions } from '../src/permissions.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

function makeRoot() {
  root = mkdtempSync(join(tmpdir(), 'privy-root-'));
  mkdirSync(join(root, 'Privy Cloud', 'Markdown'), { recursive: true });
  createChatLog(root);
  ensurePermissions(root);
}

describe('directory', () => {
  it('initRootStructure creates the three top-level dirs and all type folders', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-root-'));
    await initRootStructure(root);
    for (const d of ['Hermes Agent', 'Coding Project', 'Privy Cloud']) {
      expect(existsSync(join(root, d))).toBe(true);
    }
    for (const sub of ['Images','Videos','Slides','Documents','Markdown','Folders','Other']) {
      expect(existsSync(join(root, 'Privy Cloud', sub))).toBe(true);
    }
  });

  it('resolveSafe rejects traversal and absolute paths against the Privy Cloud base', () => {
    makeRoot();
    const base = privyBase(root);
    expect(resolveSafe(base, 'Markdown/a.md')).toBe(join(root, 'Privy Cloud', 'Markdown', 'a.md'));
    expect(resolveSafe(base, '../escape')).toBeNull();
    expect(resolveSafe(base, '/etc/passwd')).toBeNull();
    expect(resolveSafe(base, 'Markdown/../../x')).toBeNull();
    expect(resolveSafe(base, 'Markdown/../../../x')).toBeNull();
  });

  it('listItems walks Privy Cloud, excludes .privy and dotfiles, detects kinds', async () => {
    makeRoot();
    writeFileSync(join(root, 'Privy Cloud', 'Markdown', 'note.md'), '# hi');
    writeFileSync(join(root, 'Privy Cloud', 'Images', 'a.png'), 'img');
    writeFileSync(join(root, 'Privy Cloud', 'Markdown', '.hidden'), 'x');
    const items = await listItems(root);
    const names = items.map((i) => i.path);
    expect(names).toContain('Markdown/note.md');
    expect(names).toContain('Images/a.png');
    expect(names.some((p) => p.includes('.privy'))).toBe(false);
    expect(names.some((p) => p.endsWith('.hidden'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -w server`
Expected: FAIL — `directory.js` / `chatLog.js` / `permissions.js` don't exist.

- [ ] **Step 3: Write `server/src/directory.ts`**

```ts
import { join, relative, isAbsolute, resolve } from 'node:path';
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { KIND_FOLDER, type FileItem, type Kind } from '@privy/shared';
import { detectKind } from './kinds.js';
import { createChatLog } from './chatLog.js';
import { ensurePermissions } from './permissions.js';

export const ROOT_CHILDREN = ['Hermes Agent', 'Coding Project', 'Privy Cloud'];
export const TYPE_FOLDERS = [...new Set(Object.values(KIND_FOLDER))]; // Images Videos Slides Documents Markdown Folders Other

export async function initRootStructure(root: string): Promise<void> {
  for (const child of ROOT_CHILDREN) mkdirSync(join(root, child), { recursive: true });
  for (const folder of TYPE_FOLDERS) mkdirSync(join(root, 'Privy Cloud', folder), { recursive: true });
  mkdirSync(join(root, 'Privy Cloud', '.privy'), { recursive: true });
  createChatLog(root);
  ensurePermissions(root);
}

export function privyBase(root: string): string {
  return join(root, 'Privy Cloud');
}

/** Resolves `rel` under `base`, rejecting anything that escapes `base` (relative or absolute). */
export function resolveSafe(base: string, rel: string): string | null {
  if (isAbsolute(rel)) return null;
  const norm = resolve(base, rel);
  if (norm === base) return base;
  if (!norm.startsWith(resolve(base) + '/')) return null;
  return norm;
}

export async function listItems(root: string): Promise<FileItem[]> {
  const base = join(root, 'Privy Cloud');
  const out: FileItem[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      const rel = relative(base, abs);
      const isDir = st.isDirectory();
      out.push({
        name, path: rel, isDir,
        kind: detectKind(name, isDir),
        size: isDir ? 0 : st.size,
        modifiedAt: st.mtime.toISOString(),
      });
      if (isDir) walk(abs);
    }
  };
  walk(base);
  return out;
}

export function folderFor(kind: Kind): string {
  return KIND_FOLDER[kind];
}
```

- [ ] **Step 4: Stub `server/src/chatLog.ts` and `server/src/permissions.ts`**

```ts
// chatLog.ts (stub — full implementation in Task 5)
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
export function chatLogPath(root: string): string { return join(root, 'Privy Cloud', '.privy', 'chat-log.jsonl'); }
export function createChatLog(root: string): void { writeFileSync(chatLogPath(root), ''); }
```

```ts
// permissions.ts (stub — full implementation in Task 5)
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
export function permissionsPath(root: string): string { return join(root, 'Privy Cloud', '.privy', 'permissions.json'); }
export function ensurePermissions(root: string): void { writeFileSync(permissionsPath(root), JSON.stringify({ owner: 'owner', entries: [] })); }
```

- [ ] **Step 5: Write `server/src/kinds.ts` (full implementation — needed now so `directory.ts` compiles)**

```ts
import { KINDS, type Kind } from '@privy/shared';

export function detectKind(name: string, isDir: boolean): Kind {
  if (isDir) return 'folder';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return KINDS.find((k) => k.extensions.includes(ext))?.key ?? 'other';
}
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `npm run test -w server`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add server/src server/test
git commit -m "feat: directory init, safe path resolution, recursive item listing"
```

---

### Task 4: Chat log (JSONL)

**Files:**
- Create: `server/src/chatLog.ts` (replace stub), `server/test/chatLog.test.ts`

**Interfaces:**
- Consumes: `ChatEntry` from `@privy/shared`.
- Produces: `chatLogPath(root: string): string`; `createChatLog(root: string): void`; `appendEntry(root: string, entry: Omit<ChatEntry, 'id'|'ts'>): Promise<ChatEntry>` (returns the full entry with `id` and ISO `ts`); `readEntries(root: string, limit?: number): Promise<ChatEntry[]>` (newest first).

- [ ] **Step 1: Write the failing test `server/test/chatLog.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatLog, appendEntry, readEntries } from '../src/chatLog.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('chatLog', () => {
  it('appends and reads entries newest-first', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    createChatLog(root);
    const a = await appendEntry(root, { type: 'text', kind: 'text', name: 'hi.md', text: 'hello', sender: 'owner' });
    const b = await appendEntry(root, { type: 'file', kind: 'image', name: 'a.png', path: 'Images/a.png', sender: 'owner' });
    const all = await readEntries(root);
    expect(all.map((e) => e.id)).toEqual([b.id, a.id]);
    expect(all[0].path).toBe('Images/a.png');
    expect(a.id.length).toBeGreaterThan(0);
  });

  it('readEntries respects limit', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    createChatLog(root);
    for (let i = 0; i < 5; i++) await appendEntry(root, { type: 'text', kind: 'text', name: `m${i}.md`, text: 'x', sender: 'owner' });
    expect((await readEntries(root, 2)).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -w server`
Expected: FAIL — `appendEntry`/`readEntries` undefined.

- [ ] **Step 3: Write `server/src/chatLog.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ChatEntry } from '@privy/shared';

export function chatLogPath(root: string): string {
  return join(root, 'Privy Cloud', '.privy', 'chat-log.jsonl');
}

export function createChatLog(root: string): void {
  const file = chatLogPath(root);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '');
  }
}

export async function appendEntry(root: string, entry: Omit<ChatEntry, 'id' | 'ts'>): Promise<ChatEntry> {
  createChatLog(root);
  const full: ChatEntry = {
    ...entry,
    id: randomBytes(8).toString('hex'),
    ts: new Date().toISOString(),
  };
  appendFileSync(chatLogPath(root), JSON.stringify(full) + '\n');
  return full;
}

export async function readEntries(root: string, limit = 50): Promise<ChatEntry[]> {
  if (!existsSync(chatLogPath(root))) return [];
  const lines = readFileSync(chatLogPath(root), 'utf8').split('\n').filter(Boolean);
  const entries = lines.map((l) => JSON.parse(l) as ChatEntry);
  return entries.reverse().slice(0, limit);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/chatLog.ts server/test/chatLog.test.ts
git commit -m "feat: append-only JSONL chat log with newest-first reads"
```

---

### Task 5: Permissions skeleton

**Files:**
- Create: `server/src/permissions.ts` (replace stub), `server/test/permissions.test.ts`

**Interfaces:**
- Produces: `permissionsPath(root): string`; `ensurePermissions(root): void` (writes `{ owner: 'owner', entries: [] }` if missing); `loadPermissions(root): Promise<{ owner: string; entries: PermissionEntry[] }>`; `checkPermission(root: string, action: 'read'|'write'|'edit'): Promise<boolean>` — v1 always returns `true` (owner-only, no enforcement).

- [ ] **Step 1: Write the failing test `server/test/permissions.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePermissions, loadPermissions, checkPermission, permissionsPath } from '../src/permissions.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('permissions', () => {
  it('ensurePermissions creates owner default and is idempotent', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    ensurePermissions(root);
    expect(existsSync(permissionsPath(root))).toBe(true);
    // existing file must never be overwritten
    writeFileSync(permissionsPath(root), JSON.stringify({ owner: 'someone-else', entries: [] }));
    ensurePermissions(root);
    expect((await loadPermissions(root)).owner).toBe('someone-else');
  });

  it('checkPermission always allows in v1', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    ensurePermissions(root);
    expect(await checkPermission(root, 'write')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -w server`
Expected: FAIL — `loadPermissions`/`checkPermission` undefined.

- [ ] **Step 3: Write `server/src/permissions.ts`**

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface PermissionEntry { user: string; read: boolean; write: boolean; edit: boolean }
export interface Permissions { owner: string; entries: PermissionEntry[] }

export function permissionsPath(root: string): string {
  return join(root, 'Privy Cloud', '.privy', 'permissions.json');
}

export function ensurePermissions(root: string): void {
  if (existsSync(permissionsPath(root))) return;
  mkdirSync(dirname(permissionsPath(root)), { recursive: true });
  writeFileSync(permissionsPath(root), JSON.stringify({ owner: 'owner', entries: [] } satisfies Permissions, null, 2));
}

export async function loadPermissions(root: string): Promise<Permissions> {
  ensurePermissions(root);
  return JSON.parse(readFileSync(permissionsPath(root), 'utf8')) as Permissions;
}

export async function checkPermission(_root: string, _action: 'read' | 'write' | 'edit'): Promise<boolean> {
  return true; // v1: single-owner, localhost only. Multi-user enforcement deferred.
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/permissions.ts server/test/permissions.test.ts
git commit -m "feat: permissions skeleton with owner default"
```

---

### Task 6: Storage — send handling

**Files:**
- Create: `server/src/storage.ts`, `server/test/storage.test.ts`

**Interfaces:**
- Consumes: `folderFor`/`resolveSafe` from `directory.ts`; `appendEntry` from `chatLog.ts`; `detectKind` from `kinds.ts`.
- Produces:
  - `uniquePath(root: string, folder: string, name: string): string` — returns `folder/name` or `folder/name-<yyyymmdd-hhmmss>.<ext>` on collision (relative to `Privy Cloud/`).
  - `storeText(root: string, text: string): Promise<ChatEntry>` — writes `Markdown/<slug>-<yyyymmdd-hhmmss>.md`, returns a `type:'text'` entry.
  - `storeFile(root: string, fileName: string, data: Buffer): Promise<ChatEntry>` — routes by kind, returns a `type:'file'` entry with `path` relative to `Privy Cloud/`.
  - `storeFolder(root: string, folderName: string, files: Array<{ relativePath: string; data: Buffer }>): Promise<ChatEntry>` — writes under `Folders/<folderName>/…`, returns a `type:'folder'` entry.

- [ ] **Step 1: Write the failing test `server/test/storage.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { storeText, storeFile, storeFolder, uniquePath } from '../src/storage.js';
import { readEntries } from '../src/chatLog.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('storage', () => {
  it('storeText writes a markdown file and a text chat entry', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    const entry = await storeText(root, 'hello world');
    expect(entry.type).toBe('text');
    expect(entry.path).toMatch(/^Markdown\//);
    expect(entry.path).toMatch(/\.md$/);
    expect(existsSync(join(root, 'Privy Cloud', entry.path!))).toBe(true);
    expect(readFileSync(join(root, 'Privy Cloud', entry.path!), 'utf8')).toBe('hello world');
  });

  it('storeFile routes by kind and appends a chat entry', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    const entry = await storeFile(root, 'photo.png', Buffer.from('png'));
    expect(entry.kind).toBe('image');
    expect(entry.path).toBe('Images/photo.png');
    const entries = await readEntries(root);
    expect(entries[0].path).toBe('Images/photo.png');
  });

  it('uniquePath adds a timestamp suffix on collision', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    const first = uniquePath(root, 'Documents', 'report.pdf');
    expect(first).toBe('Documents/report.pdf');
    // create the file on disk so the second call collides
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'report.pdf'), 'x');
    const second = uniquePath(root, 'Documents', 'report.pdf');
    expect(second).toMatch(/^Documents\/report-\d{8}-\d{6}\.pdf$/);
  });

  it('storeFolder preserves structure under Folders/<name>', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    const entry = await storeFolder(root, 'assets', [
      { relativePath: 'css/app.css', data: Buffer.from('body{}') },
      { relativePath: 'img/logo.png', data: Buffer.from('png') },
    ]);
    expect(entry.type).toBe('folder');
    expect(existsSync(join(root, 'Privy Cloud', 'Folders', 'assets', 'css', 'app.css'))).toBe(true);
    expect(existsSync(join(root, 'Privy Cloud', 'Folders', 'assets', 'img', 'logo.png'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -w server`
Expected: FAIL — `storage.js` not found.

- [ ] **Step 3: Write `server/src/storage.ts`**

```ts
import { mkdirSync, createWriteStream, writeFileSync, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, dirname, basename, extname } from 'node:path';
import type { ChatEntry } from '@privy/shared';
import { resolveSafe, privyBase, folderFor } from './directory.js';
import { detectKind } from './kinds.js';
import { appendEntry } from './chatLog.js';

export type UploadData = Buffer | Readable;

export function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'message';
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function uniquePath(root: string, folder: string, name: string): string {
  const rel = `${folder}/${name}`;
  if (!existsSync(resolveSafe(privyBase(root), rel)!)) return rel;
  const ext = extname(name);
  const base = basename(name, ext);
  return `${folder}/${base}-${stamp()}${ext}`;
}

async function writeAbs(root: string, rel: string, data: UploadData): Promise<void> {
  const abs = resolveSafe(privyBase(root), rel);
  if (!abs) throw new Error('unsafe path');
  mkdirSync(dirname(abs), { recursive: true });
  if (data instanceof Readable) {
    await pipeline(data, createWriteStream(abs)); // stream large files, never full-buffer
  } else {
    writeFileSync(abs, data);
  }
}

export async function storeText(root: string, text: string): Promise<ChatEntry> {
  const name = `${slugify(text)}-${stamp()}.md`;
  const path = uniquePath(root, 'Markdown', name);
  await writeAbs(root, path, Buffer.from(text, 'utf8'));
  return appendEntry(root, { type: 'text', kind: 'text', name, path, text, sender: 'owner' });
}

export async function storeFile(root: string, fileName: string, data: UploadData): Promise<ChatEntry> {
  const safeName = basename(fileName); // strip any directory separators from the filename
  const kind = detectKind(safeName, false);
  const folder = folderFor(kind);
  const path = uniquePath(root, folder, safeName);
  await writeAbs(root, path, data);
  return appendEntry(root, { type: 'file', kind, name: safeName, path, sender: 'owner' });
}

export async function storeFolder(root: string, folderName: string, files: Array<{ relativePath: string; data: UploadData }>): Promise<ChatEntry> {
  const base = uniquePath(root, 'Folders', folderName);
  for (const f of files) {
    const rel = join(base, f.relativePath);
    if (!resolveSafe(privyBase(root), rel)) throw new Error('unsafe folder path');
    await writeAbs(root, rel, f.data);
  }
  return appendEntry(root, { type: 'folder', kind: 'folder', name: folderName, path: base, sender: 'owner' });
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm run test -w server`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/storage.ts server/test/storage.test.ts
git commit -m "feat: send handling — text, files, and folder storage with collision suffixes"
```

---

### Task 7: REST API

**Files:**
- Create: `server/src/api/routes.ts`, `server/test/api.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `AppConfig`/`setRoot` from `config.ts`; `initRootStructure`/`listItems`/`resolveSafe` from `directory.ts`; `storeText`/`storeFile`/`storeFolder` from `storage.ts`; `readEntries` from `chatLog.ts`; `loadPermissions`/`checkPermission` from `permissions.ts`.
- Produces: `registerRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void>` where `ApiContext = { getRoot(): string; setRootPath(p: string): Promise<string>; emit(e: ServerEvent): void }` and `ServerEvent = { type: 'items:changed'; path: string; change: string } | { type: 'chat:new'; entry: ChatEntry }`. Registers all routes in the Backend API Contract.

- [ ] **Step 1: Write the failing test `server/test/api.test.ts`**

```ts
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/index.js';
import { initRootStructure } from '../src/directory.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function boot() {
  root = mkdtempSync(join(tmpdir(), 'privy-api-'));
  await initRootStructure(root);
  const app = await buildApp({ root });
  return app;
}

describe('api', () => {
  it('health + meta + items', async () => {
    const app = await boot();
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toEqual({ ok: true });

    const meta = await app.inject({ method: 'GET', url: '/api/meta' });
    expect(meta.json().root).toBe(root);

    mkdirSync(join(root, 'Privy Cloud', 'Markdown'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Markdown', 'note.md'), '# hi');
    const items = await app.inject({ method: 'GET', url: '/api/items' });
    expect(items.json().map((i: { path: string }) => i.path)).toContain('Markdown/note.md');

    mkdirSync(join(root, 'Privy Cloud', 'Images'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Images', 'pic.png'), 'x');
    const img = await app.inject({ method: 'GET', url: '/api/items?kind=image' });
    expect(img.json().map((i: { path: string }) => i.path)).toContain('Images/pic.png');
    expect(img.json().every((i: { kind: string }) => i.kind === 'image')).toBe(true);
    expect(img.json().map((i: { path: string }) => i.path)).not.toContain('Markdown/note.md');
    await app.close();
  });

  it('send text -> chat entry -> file readable and editable', async () => {
    const app = await boot();
    const sent = await app.inject({ method: 'POST', url: '/api/send/text', payload: { text: 'hello privy' } });
    expect(sent.statusCode).toBe(200);
    const entry = sent.json().entry as { path: string };
    expect(entry.path).toMatch(/^Markdown\//);

    const chat = await app.inject({ method: 'GET', url: '/api/chat' });
    expect(chat.json()[0].path).toBe(entry.path);

    const saved = await app.inject({ method: 'PUT', url: `/api/file?path=${encodeURIComponent(entry.path)}`, payload: { content: 'edited' } });
    expect(saved.statusCode).toBe(200);

    const got = await app.inject({ method: 'GET', url: `/api/file?path=${encodeURIComponent(entry.path)}` });
    expect(got.body).toBe('edited');
    await app.close();
  });

  it('rejects path traversal on file access', async () => {
    const app = await boot();
    const bad = await app.inject({ method: 'GET', url: '/api/file?path=' + encodeURIComponent('../secret.txt') });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('setRoot re-inits the new root', async () => {
    const app = await boot();
    const newRoot = mkdtempSync(join(tmpdir(), 'privy-new-'));
    const res = await app.inject({ method: 'PUT', url: '/api/settings/root', payload: { path: newRoot } });
    expect(res.statusCode).toBe(200);
    expect(res.json().root).toBe(newRoot);
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -w server`
Expected: FAIL — `buildApp({ root })` signature mismatch / routes missing.

- [ ] **Step 3: Write `server/src/api/routes.ts`**

```ts
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { ChatEntry } from '@privy/shared';
import { listItems, resolveSafe, initRootStructure, privyBase } from '../directory.js';
import { storeText, storeFile, storeFolder } from '../storage.js';
import { readEntries } from '../chatLog.js';
import { loadPermissions } from '../permissions.js';
import { detectKind } from '../kinds.js';

export type ServerEvent =
  | { type: 'items:changed'; path: string; change: 'created' | 'modified' | 'deleted' | 'renamed' }
  | { type: 'chat:new'; entry: ChatEntry };

export interface ApiContext {
  getRoot(): string;
  setRootPath(p: string): Promise<string>;
  emit(e: ServerEvent): void;
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', heic: 'image/heic',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  pdf: 'application/pdf', md: 'text/plain; charset=utf-8', markdown: 'text/plain; charset=utf-8', txt: 'text/plain; charset=utf-8',
  csv: 'text/csv', json: 'application/json', xml: 'text/xml',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

interface UploadPart {
  type: 'file' | 'field';
  fieldname?: string;
  filename?: string;
  value?: unknown;
  fields?: Record<string, { value: string } | undefined>;
  file: Readable;
}

/** Resolve an API path (relative to `Privy Cloud/`) to an absolute path, or null if it escapes. */
function privyResolve(ctx: ApiContext, rel: string): string | null {
  return resolveSafe(privyBase(ctx.getRoot()), rel ?? '');
}

function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

export async function registerRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/meta', async () => {
    const perms = await loadPermissions(ctx.getRoot());
    return { root: ctx.getRoot(), owner: perms.owner };
  });

  app.get('/api/settings/root', async () => ({ root: ctx.getRoot() }));

  app.put('/api/settings/root', async (req, reply) => {
    const { path } = (req.body ?? {}) as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path is required' });
    await initRootStructure(path);
    const root = await ctx.setRootPath(path);
    ctx.emit({ type: 'items:changed', path: '', change: 'created' });
    return { root };
  });

  app.get('/api/items', async (req) => {
    const kind = (req.query as { kind?: string }).kind;
    const all = await listItems(ctx.getRoot());
    return kind ? all.filter((i) => i.kind === kind) : all;
  });

  app.get('/api/file', async (req, reply) => {
    const rel = (req.query as { path: string }).path ?? '';
    const abs = privyResolve(ctx, rel);
    if (!abs) return reply.code(400).send({ error: 'unsafe path' });
    const name = rel.split('/').pop() ?? '';
    return reply.type(mimeFor(name)).send(createReadStream(abs));
  });

  app.put('/api/file', async (req, reply) => {
    const rel = (req.query as { path: string }).path ?? '';
    const abs = privyResolve(ctx, rel);
    if (!abs) return reply.code(400).send({ error: 'unsafe path' });
    const kind = detectKind(rel.split('/').pop() ?? '', false);
    if (kind !== 'markdown') return reply.code(400).send({ error: 'only text files are editable' });
    const { content } = (req.body ?? {}) as { content?: string };
    await writeFile(abs, content ?? '', 'utf8');
    ctx.emit({ type: 'items:changed', path: rel, change: 'modified' });
    return { ok: true, modifiedAt: new Date().toISOString() };
  });

  app.post('/api/send/text', async (req) => {
    const { text } = (req.body ?? {}) as { text?: string };
    const entry = await storeText(ctx.getRoot(), text ?? '');
    ctx.emit({ type: 'chat:new', entry });
    return { entry };
  });

  app.post('/api/send/file', async (req) => {
    const part = await (req as unknown as { file(): Promise<UploadPart> }).file();
    const entry = await storeFile(ctx.getRoot(), part.filename ?? 'upload.bin', part.file);
    ctx.emit({ type: 'chat:new', entry });
    return { entry };
  });

  app.post('/api/send/folder', async (req) => {
    const parts = (req as unknown as { parts(): AsyncIterable<UploadPart> }).parts();
    let folderName = 'folder';
    let pendingRel: string | undefined; // client sends `relativePath` immediately before each file part
    const files: Array<{ relativePath: string; data: Readable }> = [];
    for await (const part of parts) {
      if (part.type === 'file') {
        files.push({ relativePath: pendingRel ?? part.filename ?? '', data: part.file });
        pendingRel = undefined;
      } else if (part.fieldname === 'folderName') {
        folderName = String(part.value ?? 'folder');
      } else if (part.fieldname === 'relativePath') {
        pendingRel = String(part.value ?? '');
      }
    }
    const entry = await storeFolder(ctx.getRoot(), folderName, files);
    ctx.emit({ type: 'chat:new', entry });
    return { entry };
  });

  app.get('/api/chat', async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 50);
    return readEntries(ctx.getRoot(), limit);
  });
}
```

- [ ] **Step 4: Update `server/src/index.ts` to accept a root and register routes**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { loadConfig, setRoot } from './config.js';
import { initRootStructure } from './directory.js';
import { checkPermission } from './permissions.js';
import { registerRoutes, type ApiContext, type ServerEvent } from './api/routes.js';
import { attachSocket } from './api/socket.js';

export async function buildApp(opts?: { root?: string }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(multipart);
  await app.register(websocket);

  const cfg = opts?.root ? { root: opts.root } : await loadConfig();
  await initRootStructure(cfg.root);

  // Permission layer: every API request passes through checkPermission. v1 = single owner, always allows.
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api') && !(await checkPermission(cfg.root, 'read'))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
  });

  const listeners: Array<(e: ServerEvent) => void> = [];
  const ctx: ApiContext = {
    getRoot: () => cfg.root,
    setRootPath: async (p) => { const r = await setRoot(p); cfg.root = r; return r; },
    emit: (e) => { for (const l of listeners) l(e); },
  };

  await registerRoutes(app, ctx);
  await attachSocket(app, ctx, listeners);
  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const app = await buildApp();
  await app.listen({ port: Number(process.env.PRIVY_PORT ?? 5178) });
}
```

- [ ] **Step 5: Create `server/src/api/socket.ts` (minimal no-op for this task, full in Task 8)**

```ts
import type { FastifyInstance } from 'fastify';
import type { ApiContext, ServerEvent } from './routes.js';

export async function attachSocket(app: FastifyInstance, _ctx: ApiContext, listeners: Array<(e: ServerEvent) => void>): Promise<void> {
  // WebSocket broadcast added in Task 8.
}
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `npm run test -w server`
Expected: PASS (4 tests). The multipart `file()`/`parts()` methods are exercised only in Task 8's integration test; here route registration must not throw.

- [ ] **Step 7: Commit**

```bash
git add server/src server/test
git commit -m "feat: REST API — items, file get/save, send text/file/folder, chat, settings"
```

---

### Task 8: File watcher + WebSocket broadcast

**Files:**
- Create: `server/src/watcher.ts`, `server/test/watcher.test.ts`
- Modify: `server/src/api/socket.ts`, `server/src/index.ts` (api.test.ts needs no change — `app.close()` already stops the watcher via the onClose hook)

**Interfaces:**
- Consumes: `ApiContext`/`ServerEvent` from `api/routes.ts`.
- Produces: `createWatcher(root: string, onChange: (e: ServerEvent) => void): Promise<{ stop(): Promise<void> }>` — watches the whole root, debounced, emits `items:changed` for created/modified/deleted/renamed (paths relative to `Privy Cloud/`, or `''` for root-level). `attachSocket` registers a `/ws` endpoint that sends every `ServerEvent` as JSON to connected clients and registers `listeners.push((e) => broadcast(e))`.

- [ ] **Step 1: Write the failing test `server/test/watcher.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { createWatcher } from '../src/watcher.js';

let root: string;
let w: { stop(): Promise<void> } | undefined;
afterEach(async () => { if (w) await w.stop(); rmSync(root, { recursive: true, force: true }); });

function waitFor(fn: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (fn()) { clearInterval(t); resolve(); }
      else if (Date.now() - start > ms) { clearInterval(t); reject(new Error('timeout')); }
    }, 50);
  });
}

describe('watcher', () => {
  it('emits items:changed when a file is created on disk', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    const events: string[] = [];
    w = await createWatcher(root, (e) => { if (e.type === 'items:changed') events.push(e.path); });
    await waitFor(() => events.length >= 1); // initial sync
    events.length = 0;
    writeFileSync(join(root, 'Privy Cloud', 'Markdown', 'live.md'), '# live');
    await waitFor(() => events.some((p) => p.includes('live.md')));
    expect(events.some((p) => p.includes('live.md'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -w server`
Expected: FAIL — `createWatcher` undefined.

- [ ] **Step 3: Write `server/src/watcher.ts`**

```ts
import { watch, type FSWatcher } from 'chokidar';
import { relative, basename } from 'node:path';
import type { ServerEvent } from './api/routes.js';
import { listItems, privyBase } from './directory.js';

export async function createWatcher(root: string, onChange: (e: ServerEvent) => void): Promise<{ stop(): Promise<void> }> {
  const base = privyBase(root);
  const map = (abs: string): string => {
    if (abs.startsWith(base + '/')) return relative(base, abs);
    if (abs === base) return '';
    return relative(root, abs); // changes outside Privy Cloud (Hermes/, Coding/, root files)
  };

  let timer: NodeJS.Timeout | undefined;
  const debounce = (e: ServerEvent) => {
    clearTimeout(timer);
    timer = setTimeout(() => onChange(e), 120);
  };

  const w: FSWatcher = watch(root, {
    ignored: (p) => basename(p).startsWith('.'), // any hidden name (spec: "any name starting with .")
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  w.on('add', (p) => debounce({ type: 'items:changed', path: map(p), change: 'created' }));
  w.on('change', (p) => debounce({ type: 'items:changed', path: map(p), change: 'modified' }));
  w.on('unlink', (p) => debounce({ type: 'items:changed', path: map(p), change: 'deleted' }));
  w.on('unlinkDir', (p) => debounce({ type: 'items:changed', path: map(p), change: 'deleted' }));
  w.on('addDir', (p) => { if (map(p) !== 'Privy Cloud') debounce({ type: 'items:changed', path: map(p), change: 'created' }); });
  w.on('error', (err) => console.error('watcher error', err));

  // Periodic rescan: safety net for missed watcher events (spec §4.2). Diffs a snapshot
  // of the on-disk items every 30s and emits created/modified/deleted for the changes.
  let snapshot = new Map<string, { size: number; modifiedAt: string }>();
  const rescan = async () => {
    const items = await listItems(root).catch(() => []);
    const now = new Map(items.map((i) => [i.path, { size: i.size, modifiedAt: i.modifiedAt }]));
    for (const [p, cur] of now) {
      const prev = snapshot.get(p);
      if (!prev) debounce({ type: 'items:changed', path: p, change: 'created' });
      else if (prev.size !== cur.size || prev.modifiedAt !== cur.modifiedAt) debounce({ type: 'items:changed', path: p, change: 'modified' });
    }
    for (const p of snapshot.keys()) if (!now.has(p)) debounce({ type: 'items:changed', path: p, change: 'deleted' });
    snapshot = now;
  };
  void rescan();
  const interval = setInterval(() => void rescan(), 30_000);

  return {
    stop: async () => { clearTimeout(timer); clearInterval(interval); await w.close(); },
  };
}
```

- [ ] **Step 4: Update `server/src/api/socket.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { ApiContext, ServerEvent } from './routes.js';

export async function attachSocket(app: FastifyInstance, _ctx: ApiContext, listeners: Array<(e: ServerEvent) => void>): Promise<void> {
  const clients = new Set<WebSocket>();
  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
  });
  listeners.push((e) => {
    const msg = JSON.stringify(e);
    for (const c of clients) { if (c.readyState === c.OPEN) c.send(msg); }
  });
}
```

- [ ] **Step 5: Update `server/src/index.ts` to start the watcher and expose a stop for tests**

```ts
// inside buildApp, after attachSocket:
const watcher = await createWatcher(cfg.root, (e) => ctx.emit(e));
app.addHook('onClose', async () => { await watcher.stop(); });
```

Add the import: `import { createWatcher } from './watcher.js';`

- [ ] **Step 6: Run the backend test suite, then a live WS smoke test**

Run: `npm run test -w server`
Expected: PASS (the full suite, now including the watcher test).

Then, live smoke test in a separate terminal:
```bash
npm run dev -w server
# in another terminal:
node -e "
const ws = new (require('ws'))('ws://localhost:5178/ws');
ws.on('message', (d) => console.log('EVENT', d.toString()));
setTimeout(() => require('fs').writeFileSync(require('os').homedir() + '/PrivyCloud/Privy Cloud/Markdown/live.md', 'hi'), 500);
setTimeout(() => process.exit(0), 2500);
"
```
Expected: prints an `items:changed` event referencing `Markdown/live.md`.

- [ ] **Step 7: Commit**

```bash
git add server/src server/test
git commit -m "feat: file watcher and WebSocket live broadcasts"
```

---

### Task 9: Backend polish — bind frontend serving, wire everything, manual API walkthrough

**Files:**
- Modify: `server/src/index.ts`, root `package.json`

**Interfaces:**
- Produces: `GET /` serves the built `web/dist` (via `@fastify/static`) when present, so the same backend URL exposes UI + API (the "one UI, two entry points" goal). Env `PRIVY_PORT`, `PRIVY_ROOT`, `PRIVY_WEB_DIST` overrides.

- [ ] **Step 1: Add `@fastify/static` to `server/package.json` dependencies and install**

Run: `npm install -w server @fastify/static`
Expected: dependency added.

- [ ] **Step 2: Update `server/src/index.ts` to serve the web build when present**

```ts
import { existsSync } from 'node:fs';
// inside buildApp, before registering routes:
const webDist = process.env.PRIVY_WEB_DIST ?? new URL('../../../web/dist', import.meta.url).pathname;
if (existsSync(webDist)) {
  await app.register((await import('@fastify/static')).default, { root: webDist, prefix: '/' });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}
```

- [ ] **Step 3: Add a root convenience script and run a full manual walkthrough**

Add to root `package.json`: `"walkthrough": "npm run build -w shared && npm run build -w server && PRIVY_ROOT=/tmp/privy-walkthrough node server/dist/index.js"` (the `web` workspace does not exist until Task 10, so it is deliberately absent here; re-add `&& npm run build -w web` in Task 16 once `web/dist` can exist)

Then:
```bash
mkdir -p /tmp/privy-walkthrough
npm run walkthrough &
sleep 2
curl -s http://localhost:5178/api/meta
curl -s -X POST http://localhost:5178/api/send/text -H 'content-type: application/json' -d '{"text":"hello from curl"}'
curl -s 'http://localhost:5178/api/items?kind=markdown'
curl -s http://localhost:5178/api/chat
kill %1
```
Expected: meta returns the root; send text returns an entry; items shows `Markdown/hello-from-curl-<ts>.md`; chat returns the entry.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts package.json server/package.json package-lock.json
git commit -m "feat: serve web build from backend, add walkthrough script"
```

---

### Task 10: Web scaffold + design tokens

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/vitest.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/vite-env.d.ts`, `web/src/styles/theme.css`
- Modify: root `package.json` (nothing — already workspaces).

**Interfaces:**
- Produces: Vite + React 18 + TypeScript app rendering `App`; `styles/theme.css` defines tokens for `:root[data-theme="dark"]` and `:root[data-theme="light"]` (bg, panel, panel2, border, text, muted, accent, chipbg, bubble, inputbg, danger), plus layout utility classes `.tab-bar`, `.panel`, `.kind-chip`, `.tile`, `.tile-name`, `.tile-meta`, `.chat-entry`, `.send-input`, `.btn`, `.viewer`, `.editor` used by later tasks.

- [ ] **Step 1: Write `web/package.json`**

```json
{
  "name": "@privy/web", "private": true, "version": "0.0.0", "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@privy/shared": "*",
    "react": "^18.3.1", "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0", "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0", "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0", "jsdom": "^25.0.0",
    "vite": "^5.4.0", "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `web/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "noEmit": true },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Write `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { port: 5173, strictPort: true } });
```

- [ ] **Step 4: Write `web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], test: { environment: 'jsdom', setupFiles: ['./src/__tests__/setup.ts'], globals: true } });
```

- [ ] **Step 5: Write `web/index.html`**

```html
<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Privy Cloud</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Write `web/src/styles/theme.css`** (tokens + layout utilities)

```css
:root[data-theme='dark'] {
  --bg: #0c0e12; --panel: #11141a; --panel2: #171b23; --border: #242a36;
  --text: #e8ebf2; --muted: #8b92a6; --accent: #2dd4bf; --accent-ink: #0b0f14;
  --chipbg: #1b202b; --bubble: #141922; --inputbg: #0f1218; --danger: #f87171;
}
:root[data-theme='light'] {
  --bg: #f6f7f9; --panel: #ffffff; --panel2: #ffffff; --border: #e3e6ec;
  --text: #1d2433; --muted: #6b7486; --accent: #0d9488; --accent-ink: #ffffff;
  --chipbg: #eef1f6; --bubble: #f0f3f8; --inputbg: #ffffff; --danger: #dc2626;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font-family: -apple-system, 'Segoe UI', Inter, Roboto, sans-serif; }
button { font: inherit; cursor: pointer; }
.tab-bar { display: flex; gap: 6px; padding: 8px 12px; background: var(--panel); border-bottom: 1px solid var(--border); align-items: center; }
.tab { padding: 5px 12px; border-radius: 6px; background: transparent; border: 1px solid transparent; color: var(--muted); }
.tab.active { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
.tab-spacer { flex: 1; }
.app-body { display: flex; height: calc(100% - 48px); }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; }
.panel-title { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 600; margin-bottom: 8px; }
.kinds { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 10px; }
.kind-chip { font-size: 12px; padding: 3px 10px; border-radius: 20px; background: var(--chipbg); color: var(--muted); border: 1px solid transparent; }
.kind-chip.on { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
.tile { background: var(--panel2); border: 1px solid var(--border); border-radius: 8px; padding: 10px; text-align: left; }
.tile:hover { border-color: var(--accent); }
.tile-icon { font-size: 22px; }
.tile-name { font-size: 13px; margin-top: 6px; word-break: break-word; line-height: 1.2; }
.tile-meta { font-size: 11px; color: var(--muted); margin-top: 3px; }
.chat-entry { display: flex; gap: 8px; margin-bottom: 10px; align-items: flex-start; }
.chat-icon { font-size: 14px; background: var(--chipbg); border-radius: 5px; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.chat-bubble { background: var(--bubble); border: 1px solid var(--border); border-radius: 8px; padding: 6px 9px; font-size: 13px; line-height: 1.45; max-width: 100%; }
.chat-fname { color: var(--accent); font-weight: 600; }
.chat-time { color: var(--muted); font-size: 11px; display: block; margin-top: 3px; }
.send-input { margin-top: auto; display: flex; gap: 8px; align-items: center; background: var(--inputbg); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.send-input input { flex: 1; background: transparent; border: none; color: var(--text); outline: none; font: inherit; }
.btn { background: var(--chipbg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 5px 10px; font-size: 13px; }
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; font-weight: 600; }
.back-link { background: none; border: none; color: var(--accent); font-size: 13px; padding: 4px 0; }
.editor { display: flex; flex-direction: column; height: 100%; }
.editor-title { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--text); background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; margin-bottom: 8px; }
.editor textarea { flex: 1; background: var(--inputbg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: ui-monospace, Menlo, monospace; font-size: 14px; padding: 10px; resize: none; outline: none; }
.viewer { display: flex; flex-direction: column; height: 100%; }
.viewer-body { flex: 1; display: flex; align-items: center; justify-content: center; background: var(--inputbg); border: 1px solid var(--border); border-radius: 8px; overflow: auto; }
.viewer-body img, .viewer-body video { max-width: 100%; max-height: 100%; }
.placeholder-page { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 8px; color: var(--muted); }
.empty-state { color: var(--muted); font-size: 14px; padding: 30px; text-align: center; }
.toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--panel2); border: 1px solid var(--border); color: var(--text); padding: 10px 16px; border-radius: 8px; z-index: 10; }
```

- [ ] **Step 7: Write `web/src/vite-env.d.ts` and `web/src/main.tsx`**

```ts
/// <reference types="vite/client" />
```

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/theme.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
```

- [ ] **Step 8: Write a minimal `web/src/App.tsx` (expanded in Task 12)**

```tsx
export function App() {
  return <div className="placeholder-page"><div style={{ fontSize: 28 }}>☁️</div><div>Privy Cloud</div></div>;
}
```

- [ ] **Step 9: Write the vitest setup file `web/src/__tests__/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 10: Verify the scaffold builds**

Run: `npm install && npm run build -w web`
Expected: `dist/` produced with no type errors.

- [ ] **Step 11: Commit**

```bash
git add web/
git commit -m "chore: scaffold web app with design tokens and build setup"
```

---

### Task 11: Frontend API + WebSocket clients

**Files:**
- Create: `web/src/api.ts`, `web/src/ws.ts`, `web/src/__tests__/api.test.ts`

**Interfaces:**
- Consumes: `@privy/shared` types.
- Produces:
  - `const API_BASE: string` (default `http://localhost:5178`, overridable via `import.meta.env.VITE_API_BASE`).
  - `api.listItems(kind?: Kind): Promise<FileItem[]>`
  - `api.getFileText(path: string): Promise<string>`
  - `api.saveFileText(path: string, content: string): Promise<void>`
  - `api.sendText(text: string): Promise<ChatEntry>`
  - `api.sendFiles(files: File[]): Promise<ChatEntry[]>`
  - `api.sendFolder(files: File[]): Promise<ChatEntry>` (uses each file's `webkitRelativePath`)
  - `api.listChat(limit?: number): Promise<ChatEntry[]>`
  - `api.getMeta(): Promise<{ root: string; owner: string }>`
  - `api.setRoot(path: string): Promise<string>`
  - `ws.connect(callbacks: { onItemsChanged?: (e) => void; onChatNew?: (entry: ChatEntry) => void }): () => void` (auto-reconnects with backoff; returns a disconnect function).

- [ ] **Step 1: Write the failing test `web/src/__tests__/api.test.ts`**

```ts
import { describe, expect, it, vi, afterEach } from 'vitest';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => String(body) } as Response);
const fail = (status: number) => ({ ok: false, status, json: async () => ({ error: 'x' }) } as Response);

describe('api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('listItems hits /api/items and returns typed items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([{ name: 'a.png', path: 'Images/a.png', kind: 'image', size: 1, isDir: false, modifiedAt: 'x' }]));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('../api');
    const items = await api.listItems();
    expect(items[0].kind).toBe('image');
    expect(fetchMock.mock.calls[0][0]).toContain('/api/items');
  });

  it('sendFiles uploads each file as multipart', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ entry: { id: '1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('../api');
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await api.sendFiles([file]);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain('/api/send/file');
    expect(call[1].method).toBe('POST');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -w web`
Expected: FAIL — `../api` has no `listItems`/`sendFiles`.

- [ ] **Step 3: Write `web/src/api.ts`**

```ts
import type { ChatEntry, FileItem, Kind } from '@privy/shared';

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'http://localhost:5178';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listItems: (kind?: Kind): Promise<FileItem[]> => req(`/api/items${kind ? `?kind=${kind}` : ''}`),
  getFileText: (path: string): Promise<string> => fetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`).then((r) => r.text()),
  saveFileText: (path: string, content: string) =>
    req(`/api/file?path=${encodeURIComponent(path)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) }),
  sendText: (text: string): Promise<{ entry: ChatEntry }> =>
    req('/api/send/text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }),
  sendFiles: async (files: File[]): Promise<ChatEntry[]> => {
    const entries: ChatEntry[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const r = await req<{ entry: ChatEntry }>('/api/send/file', { method: 'POST', body: fd });
      entries.push(r.entry);
    }
    return entries;
  },
  sendFolder: async (files: File[]): Promise<ChatEntry> => {
    const folderName = files[0]?.webkitRelativePath?.split('/')[0] ?? 'folder';
    const fd = new FormData();
    fd.append('folderName', folderName);
    for (const file of files) {
      // webkitRelativePath is "folder/sub/file.ext"; the backend joins relativePath under Folders/<folderName>,
      // so strip the leading segment (the folder name) so the structure is preserved without doubling it.
      const rel = (file.webkitRelativePath || file.name).split('/').slice(1).join('/') || file.name;
      fd.append('relativePath', rel);
      fd.append('file', file, file.name);
    }
    const r = await req<{ entry: ChatEntry }>('/api/send/folder', { method: 'POST', body: fd });
    return r.entry;
  },
  listChat: (limit = 50): Promise<ChatEntry[]> => req(`/api/chat?limit=${limit}`),
  getMeta: (): Promise<{ root: string; owner: string }> => req('/api/meta'),
  setRoot: (path: string): Promise<{ root: string }> =>
    req('/api/settings/root', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }),
};
```

- [ ] **Step 4: Write `web/src/ws.ts`**

```ts
import type { ChatEntry } from '@privy/shared';
import { API_BASE } from './api';

export type ItemsEvent = { type: 'items:changed'; path: string; change: 'created' | 'modified' | 'deleted' | 'renamed' };
export interface WsCallbacks { onItemsChanged?: (e: ItemsEvent) => void; onChatNew?: (entry: ChatEntry) => void }

export function connect(callbacks: WsCallbacks): () => void {
  let ws: WebSocket | undefined;
  let closed = false;
  let retry = 500;
  const url = API_BASE.replace(/^http/, 'ws') + '/ws';

  const open = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => { retry = 500; };
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data as string) as ItemsEvent | { type: 'chat:new'; entry: ChatEntry };
      if (data.type === 'items:changed') callbacks.onItemsChanged?.(data);
      if (data.type === 'chat:new') callbacks.onChatNew?.(data.entry);
    };
    ws.onclose = () => { if (closed) return; setTimeout(open, retry); retry = Math.min(retry * 2, 10_000); };
    ws.onerror = () => ws?.close();
  };
  open();
  return () => { closed = true; ws?.close(); };
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npm run test -w web`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/api.ts web/src/ws.ts web/src/__tests__/api.test.ts
git commit -m "feat: frontend REST and WebSocket clients"
```

---

### Task 12: App shell — tab bar, placeholders, theme toggle

**Files:**
- Create: `web/src/theme.tsx`, `web/src/components/Placeholder.tsx`, `web/src/pages/HermesTab.tsx`, `web/src/pages/CodingAgentTab.tsx`, `web/src/__tests__/App.test.tsx`, `web/src/__tests__/theme.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Produces: `ThemeProvider` + `useTheme(): { theme: 'dark'|'light'; toggle(): void }` (persists to `localStorage['privy-theme']`, sets `data-theme` on `document.documentElement`); `<Placeholder name description icon />`; `<HermesTab />` and `<CodingAgentTab />` placeholder pages; `<App />` renders the tab bar (boots on `hermes`), a theme toggle button (🌙/☀️), and the active tab. Tab type: `'hermes' | 'coding' | 'privy'`.

- [ ] **Step 1: Write `web/src/theme.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light';
const Ctx = createContext<{ theme: Theme; toggle(): void }>({ theme: 'dark', toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('privy-theme') as Theme) || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('privy-theme', theme);
  }, [theme]);
  return <Ctx.Provider value={{ theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }}>{children}</Ctx.Provider>;
}

export function useTheme() { return useContext(Ctx); }
```

- [ ] **Step 2: Write `web/src/components/Placeholder.tsx`**

```tsx
export function Placeholder({ name, description, icon }: { name: string; description: string; icon: string }) {
  return (
    <div className="placeholder-page">
      <div style={{ fontSize: 44 }}>{icon}</div>
      <div style={{ fontSize: 20, color: 'var(--text)' }}>{name}</div>
      <div style={{ fontSize: 14, maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>{description}</div>
    </div>
  );
}
```

- [ ] **Step 3: Write `web/src/pages/HermesTab.tsx`**

```tsx
import { Placeholder } from '../components/Placeholder';
export function HermesTab() {
  return <Placeholder name="Hermes Agent" icon="🛰️"
    description="Your local Hermes agent interaction will live here. Slots into this tab in a later release." />;
}
```

- [ ] **Step 4: Write `web/src/pages/CodingAgentTab.tsx`**

```tsx
import { Placeholder } from '../components/Placeholder';
export function CodingAgentTab() {
  return <Placeholder name="Coding Agent" icon="🤖"
    description="Claude Code, Codex, and Opencode sessions will run here — pick an agent, pick a project, watch progress remotely." />;
}
```

- [ ] **Step 5: Rewrite `web/src/App.tsx`**

```tsx
import { useState } from 'react';
import { ThemeProvider, useTheme } from './theme';
import { HermesTab } from './pages/HermesTab';
import { CodingAgentTab } from './pages/CodingAgentTab';
import { PrivyCloudTab } from './pages/PrivyCloudTab';

type Tab = 'hermes' | 'coding' | 'privy';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'hermes', label: 'Hermes Agent' },
  { key: 'coding', label: 'Coding Agent' },
  { key: 'privy', label: 'Privy Cloud' },
];

function Shell() {
  const [tab, setTab] = useState<Tab>('hermes');
  const { theme, toggle } = useTheme();
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
        <span className="tab-spacer" />
        <button className="tab" onClick={toggle} aria-label="toggle theme">{theme === 'dark' ? '🌙' : '☀️'}</button>
      </div>
      <div className="app-body">
        {tab === 'hermes' && <HermesTab />}
        {tab === 'coding' && <CodingAgentTab />}
        {tab === 'privy' && <PrivyCloudTab />}
      </div>
    </div>
  );
}

export function App() {
  return <ThemeProvider><Shell /></ThemeProvider>;
}
```

- [ ] **Step 6: Write `web/src/pages/PrivyCloudTab.tsx` (minimal for now — full in Task 16)**

```tsx
export function PrivyCloudTab() {
  return <div className="placeholder-page"><div style={{ fontSize: 44 }}>☁️</div><div style={{ fontSize: 20 }}>Privy Cloud</div></div>;
}
```

- [ ] **Step 7: Write `web/src/__tests__/App.test.tsx`**

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../App';

describe('App', () => {
  it('boots into the Hermes tab', () => {
    render(<App />);
    // The placeholder body text is unique to the Hermes tab (the tab label shares the name).
    expect(screen.getByText(/Your local Hermes agent interaction will live here/)).toBeInTheDocument();
    expect(document.querySelector('.tab.active')?.textContent).toContain('Hermes Agent');
  });

  it('switches tabs and theme', () => {
    render(<App />);
    fireEvent.click(screen.getAllByText('Privy Cloud')[0]); // the tab bar button
    expect(document.querySelector('.tab.active')?.textContent).toContain('Privy Cloud');
    fireEvent.click(screen.getByLabelText('toggle theme'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
```

- [ ] **Step 8: Run tests, verify they pass**

Run: `npm run test -w web`
Expected: PASS (App renders, boots to Hermes, switches tab, toggles theme). Note: `PrivyCloudTab` renders before it's implemented — that's fine, the placeholder string matches.

- [ ] **Step 9: Commit**

```bash
git add web/src
git commit -m "feat: app shell with tab bar, placeholder pages, and theme toggle"
```

---

### Task 13: Sharing grid + kind filter

**Files:**
- Create: `web/src/components/KindFilter.tsx`, `web/src/components/SharingGrid.tsx`, `web/src/__tests__/SharingGrid.test.tsx`

**Interfaces:**
- Consumes: `KINDS`/`FileItem`/`Kind` from `@privy/shared`.
- Produces: `<KindFilter value: Kind | 'all' onChange(k: Kind | 'all') />` (renders "All" + one chip per kind from `KINDS`); `<SharingGrid items: FileItem[] selectedPath: string | null onSelect(item: FileItem) />` (grid of tiles: icon per kind, name, meta "size · label"; click calls `onSelect`; folder tiles display `📁` and `folder` meta; shows an empty-state message when no items).

- [ ] **Step 1: Write `web/src/components/KindFilter.tsx`**

```tsx
import { KINDS, type Kind } from '@privy/shared';

export type KindFilterValue = Kind | 'all';

export function KindFilter({ value, onChange }: { value: KindFilterValue; onChange: (k: KindFilterValue) => void }) {
  return (
    <div className="kinds">
      <button className={`kind-chip${value === 'all' ? ' on' : ''}`} onClick={() => onChange('all')}>All</button>
      {KINDS.map((k) => (
        <button key={k.key} className={`kind-chip${value === k.key ? ' on' : ''}`} onClick={() => onChange(k.key)}>{k.label}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write `web/src/components/SharingGrid.tsx`**

```tsx
import { KINDS, type FileItem, type Kind } from '@privy/shared';

const ICON: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.icon])) as Record<Kind, string>;
const LABEL: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.label])) as Record<Kind, string>;

function fmtSize(n: number): string {
  if (n === 0) return 'folder';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function SharingGrid({ items, onSelect }: { items: FileItem[]; onSelect: (item: FileItem) => void }) {
  if (items.length === 0) return <div className="empty-state">Nothing here yet — send something from the chat.</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
      {items.map((item) => (
        <button key={item.path} className="tile" onClick={() => onSelect(item)}>
          <div className="tile-icon">{ICON[item.kind]}</div>
          <div className="tile-name">{item.name}</div>
          <div className="tile-meta">{fmtSize(item.size)} · {LABEL[item.kind]}</div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write `web/src/__tests__/SharingGrid.test.tsx`**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SharingGrid } from '../components/SharingGrid';
import type { FileItem } from '@privy/shared';

const items: FileItem[] = [
  { name: 'note.md', path: 'Markdown/note.md', kind: 'markdown', size: 100, isDir: false, modifiedAt: '2026-08-09T00:00:00Z' },
  { name: 'pic.png', path: 'Images/pic.png', kind: 'image', size: 2048, isDir: false, modifiedAt: '2026-08-09T00:00:00Z' },
];

describe('SharingGrid', () => {
  it('renders tiles and reports selection', () => {
    const onSelect = vi.fn();
    render(<SharingGrid items={items} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('note.md'));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('shows an empty state', () => {
    render(<SharingGrid items={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm run test -w web`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/KindFilter.tsx web/src/components/SharingGrid.tsx web/src/__tests__/SharingGrid.test.tsx
git commit -m "feat: sharing grid with kind icons and filter chips"
```

---

### Task 14: Chat panel + send flows

**Files:**
- Create: `web/src/components/ChatPanel.tsx`, `web/src/__tests__/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `ChatEntry` from `@privy/shared`; `api` from `api.ts`.
- Produces: `<ChatPanel entries: ChatEntry[] onSendText(text: string): void onSendFiles(files: File[]): void onSendFolder(files: File[]): void onOpenFile(path: string): void />` — timeline (each `chat:new` entry rendered as a bubble: file/folder entries show the name in accent + path + time; text entries show the text + time; clicking a file/folder entry calls `onOpenFile(path)`), plus a send input row: text input (Enter or Send button → `onSendText`), a hidden file input (📎) and a hidden directory input (📁, `webkitdirectory`) whose change handlers call `onSendFiles`/`onSendFolder`.

- [ ] **Step 1: Write `web/src/components/ChatPanel.tsx`**

```tsx
import { useRef, useState, type ChangeEvent } from 'react';
import { KINDS, type ChatEntry, type Kind } from '@privy/shared';

const ICON: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.icon])) as Record<Kind, string>;

function Entry({ entry, onOpenFile }: { entry: ChatEntry; onOpenFile: (p: string) => void }) {
  const icon = entry.kind === 'text' ? '✏️' : ICON[entry.kind] ?? '📦';
  const body = entry.kind === 'text'
    ? <span>{entry.text}</span>
    : <span className="chat-fname" onClick={() => onOpenFile(entry.path!)}>{entry.name}</span>;
  return (
    <div className="chat-entry">
      <div className="chat-icon">{icon}</div>
      <div className="chat-bubble">
        {body}
        {entry.kind !== 'text' && <span style={{ color: 'var(--muted)', fontSize: 12 }}> → {entry.path}</span>}
        <span className="chat-time">{new Date(entry.ts).toLocaleString()} · {entry.sender}</span>
      </div>
    </div>
  );
}

export function ChatPanel(props: { entries: ChatEntry[]; onSendText(t: string): void; onSendFiles(f: File[]): void; onSendFolder(f: File[]): void; onOpenFile(p: string): void }) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => { props.onSendFiles([...e.target.files!]); e.target.value = ''; };
  const onDir = (e: ChangeEvent<HTMLInputElement>) => { props.onSendFolder([...e.target.files!]); e.target.value = ''; };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-title">Chat</div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {props.entries.length === 0 && <div className="empty-state">Send a message, file, or folder to get started.</div>}
        {props.entries.map((e) => <Entry key={e.id} entry={e} onOpenFile={props.onOpenFile} />)}
      </div>
      <div className="send-input">
        <input value={text} placeholder="Send message, file, folder…" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { props.onSendText(text.trim()); setText(''); } }} />
        <button className="btn" aria-label="attach file" onClick={() => fileRef.current?.click()}>📎</button>
        <button className="btn" aria-label="attach folder" onClick={() => dirRef.current?.click()}>📁</button>
        <button className="btn primary" disabled={!text.trim()} onClick={() => { props.onSendText(text.trim()); setText(''); }}>Send</button>
        <input ref={fileRef} type="file" multiple hidden onChange={onFile} />
        <input ref={dirRef} type="file" webkitdirectory="" multiple hidden onChange={onDir} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `web/src/__tests__/ChatPanel.test.tsx`**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from '../components/ChatPanel';
import type { ChatEntry } from '@privy/shared';

const entry: ChatEntry = { id: '1', ts: '2026-08-09T14:00:00Z', type: 'text', kind: 'text', name: 'hi.md', text: 'hello', sender: 'owner' };

describe('ChatPanel', () => {
  it('renders a text entry', () => {
    render(<ChatPanel entries={[entry]} onSendText={vi.fn()} onSendFiles={vi.fn()} onSendFolder={vi.fn()} onOpenFile={vi.fn()} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('sends text on Enter', () => {
    const onSendText = vi.fn();
    render(<ChatPanel entries={[]} onSendText={onSendText} onSendFiles={vi.fn()} onSendFolder={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/Send message/), { target: { value: 'ping' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Send message/), { key: 'Enter' });
    expect(onSendText).toHaveBeenCalledWith('ping');
  });
});
```

- [ ] **Step 3: Run tests, verify they pass**

Run: `npm run test -w web`
Expected: PASS (2 tests). If the `import { useState }` at the bottom causes a lint/compile complaint, move it to the top with the other imports.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ChatPanel.tsx web/src/__tests__/ChatPanel.test.tsx
git commit -m "feat: chat panel with text/file/folder send and timeline"
```

---

### Task 15: Full-width file viewer/editor

**Files:**
- Create: `web/src/components/MarkdownEditor.tsx`, `web/src/components/FileViewer.tsx`, `web/src/__tests__/FileViewer.test.tsx`

**Interfaces:**
- Consumes: `FileItem` from `@privy/shared`; `api.getFileText`, `api.saveFileText`.
- Produces: `<MarkdownEditor path initialText onSave(content): Promise<void> />` (textarea + Save button, disabled-while-saving, shows "Saved ✓" feedback); `<FileViewer item: FileItem onBack(): void onSaved(): void />` — full-width: header with "← Back to sharing", the filename, and for `markdown`/`text` renders the editor; for `image` renders `<img>`; for `video` renders `<video controls>`; for other kinds renders a "View not yet supported" notice with a download link. The content URL is `${API_BASE}/api/file?path=<enc>`.

- [ ] **Step 1: Write `web/src/components/MarkdownEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';

export function MarkdownEditor({ path, initialText, onSave }: { path: string; initialText: string; onSave: (c: string) => Promise<void> }) {
  const [content, setContent] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setContent(initialText), [path, initialText]);

  const save = async () => {
    setSaving(true);
    await onSave(content);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="editor">
      <div className="editor-title">
        <span>{path}</span>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}</button>
      </div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
    </div>
  );
}
```

- [ ] **Step 2: Write `web/src/components/FileViewer.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { FileItem } from '@privy/shared';
import { api, API_BASE } from '../api';
import { MarkdownEditor } from './MarkdownEditor';

export function FileViewer({ item, onBack, onSaved }: { item: FileItem; onBack(): void; onSaved(): void }) {
  const url = `${API_BASE}/api/file?path=${encodeURIComponent(item.path)}`;
  const [text, setText] = useState('');

  useEffect(() => {
    if (item.kind === 'markdown') api.getFileText(item.path).then(setText);
  }, [item.path, item.kind]);

  return (
    <div className="viewer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <button className="back-link" onClick={onBack}>← Back to sharing</button>
        <span style={{ fontWeight: 600 }}>{item.name}</span>
      </div>
      {item.kind === 'markdown' && (
        <MarkdownEditor path={item.path} initialText={text}
          onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); }} />
      )}
      {item.kind === 'image' && <div className="viewer-body"><img src={url} alt={item.name} /></div>}
      {item.kind === 'video' && <div className="viewer-body"><video src={url} controls /></div>}
      {item.kind === 'document' && item.name.toLowerCase().endsWith('.pdf') && (
        <div className="viewer-body"><iframe src={url} title={item.name} style={{ width: '100%', height: '100%', border: 'none' }} /></div>
      )}
      {((item.kind === 'document' && !item.name.toLowerCase().endsWith('.pdf')) || item.kind === 'slide' || item.kind === 'other') && (
        <div className="viewer-body">
          <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontSize: 40 }}>📄</div>
            <p>Inline preview for this type isn't ready yet.</p>
            <a className="btn" href={url} download={item.name}>Download</a>
          </div>
        </div>
      )}
      {item.kind === 'folder' && (
        <div className="viewer-body"><div style={{ color: 'var(--muted)' }}>Folders are shown in the sharing grid — browse them by opening files.</div></div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `web/src/__tests__/FileViewer.test.tsx`**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileViewer } from '../components/FileViewer';
import { api } from '../api';
import type { FileItem } from '@privy/shared';

vi.mock('../api', () => ({
  API_BASE: 'http://test',
  api: { getFileText: vi.fn(), saveFileText: vi.fn() },
}));

const md: FileItem = { name: 'n.md', path: 'Markdown/n.md', kind: 'markdown', size: 1, isDir: false, modifiedAt: 'x' };
const img: FileItem = { name: 'p.png', path: 'Images/p.png', kind: 'image', size: 1, isDir: false, modifiedAt: 'x' };

describe('FileViewer', () => {
  it('edits markdown and saves', async () => {
    (api.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue('# hi');
    const onSaved = vi.fn();
    render(<FileViewer item={md} onBack={vi.fn()} onSaved={onSaved} />);
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('# hi'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# bye' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(api.saveFileText).toHaveBeenCalledWith('Markdown/n.md', '# bye'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('renders an image with the file URL', () => {
    render(<FileViewer item={img} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://test/api/file?path=Images%2Fp.png');
  });
});
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm run test -w web`
Expected: PASS (2 tests). Move the trailing `import { api } from '../api';` to the top if needed.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/MarkdownEditor.tsx web/src/components/FileViewer.tsx web/src/__tests__/FileViewer.test.tsx
git commit -m "feat: full-width file viewer with markdown editor and media previews"
```

---

### Task 16: Privy Cloud tab — wire everything together

**Files:**
- Modify: `web/src/pages/PrivyCloudTab.tsx`

**Interfaces:**
- Consumes: all prior web components + `api` + `ws.connect`.
- Produces: `<PrivyCloudTab />` implementing the approved layout — default: sharing grid (left) + chat panel (right, 30%); clicking a file collapses to full-width `<FileViewer>` with "← Back to sharing". On mount: load `api.listItems()` + `api.listChat()`, connect WebSocket, and on `items:changed` refetch items; on `chat:new` prepend the entry. Send handlers call `api.sendText/sendFiles/sendFolder` and refetch both. Save in the editor triggers a chat-refresh + items-refresh.

- [ ] **Step 1: Write `web/src/pages/PrivyCloudTab.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { ChatEntry, FileItem, Kind } from '@privy/shared';
import { api } from '../api';
import { connect } from '../ws';
import { KindFilter, type KindFilterValue } from '../components/KindFilter';
import { SharingGrid } from '../components/SharingGrid';
import { ChatPanel } from '../components/ChatPanel';
import { FileViewer } from '../components/FileViewer';

export function PrivyCloudTab() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [kind, setKind] = useState<KindFilterValue>('all');
  const [selected, setSelected] = useState<FileItem | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [its, entries] = await Promise.all([api.listItems(kind === 'all' ? undefined : kind as Kind), api.listChat()]);
      setItems(its); setChat(entries);
    } catch (e) { setError((e as Error).message); }
  }, [kind]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const disconnect = connect({
      onItemsChanged: () => { void api.listItems(kind === 'all' ? undefined : kind as Kind).then(setItems); },
      onChatNew: (entry) => setChat((c) => [entry, ...c]),
    });
    return disconnect;
  }, [kind]);

  const sendText = async (text: string) => { await api.sendText(text); void refresh(); };
  const sendFiles = async (files: File[]) => { await api.sendFiles(files); void refresh(); };
  const sendFolder = async (files: File[]) => { await api.sendFolder(files); void refresh(); };
  const openFile = (path: string) => {
    const found = items.find((i) => i.path === path) ?? { name: path.split('/').pop() ?? path, path, kind: 'other' as Kind, size: 0, isDir: false, modifiedAt: '' };
    setSelected(found);
  };
  const onSaved = async () => { await Promise.all([api.listItems(kind === 'all' ? undefined : kind as Kind).then(setItems), api.listChat().then(setChat)]); };

  if (selected) {
    return <FileViewer item={selected} onBack={() => setSelected(null)} onSaved={onSaved} />;
  }

  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, width: '100%' }}>
      <div className="panel" style={{ flex: 1, padding: 12, minWidth: 0 }}>
        <div className="panel-title">Sharing</div>
        <KindFilter value={kind} onChange={(k) => setKind(k)} />
        <SharingGrid items={items} onSelect={(item) => setSelected(item)} />
      </div>
      <div className="panel" style={{ width: '30%', flexShrink: 0, padding: 12 }}>
        <ChatPanel entries={chat} onSendText={sendText} onSendFiles={sendFiles} onSendFolder={sendFolder} onOpenFile={openFile} />
      </div>
      {error && <div className="toast">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Run the web tests**

Run: `npm run test -w web`
Expected: PASS. `App.test.tsx` now renders the real Privy Cloud tab — it must not throw. `api.listItems` etc. call real `fetch`; in the test environment `fetch` is undefined, so the tab shows the error toast but does not crash. If `fetch` is missing, stub it in `setup.ts`:

```ts
globalThis.fetch ??= (() => Promise.reject(new Error('fetch not available in test'))) as typeof fetch;
// jsdom has no WebSocket; give PrivyCloudTab's live-update connect() a minimal fake so App tests can mount it.
class MockWebSocket {
  static readonly OPEN = 1; readonly OPEN = 1; readyState = 1;
  onopen: (() => void) | null = null; onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  close() { this.onclose?.(); }
}
globalThis.WebSocket ??= MockWebSocket as unknown as typeof WebSocket;
```

- [ ] **Step 3: Run the whole suite (server + web)**

Run: `npm test`
Expected: all backend + frontend tests PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/PrivyCloudTab.tsx web/src/__tests__/setup.ts
git commit -m "feat: wire Privy Cloud tab — grid, chat, live updates, full-width viewer"
```

---

### Task 17: Tauri desktop shell

**Files:**
- Create: `desktop/package.json`, `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/build.rs`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/capabilities/default.json`, `desktop/src-tauri/icons/icon.png`, `desktop/src-tauri/src/main.rs`, `desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Produces: a Tauri 2 app whose window loads the built `web/dist` (dev: `http://localhost:5173`), with a Rust setup hook that health-checks `http://localhost:5178/api/health` and, if down, spawns the backend (`node <server>/dist/index.js`, path from `PRIVY_BACKEND` env or resolved next to the binary) and kills it on window close. `npm run app` from the root starts it.

- [ ] **Step 1: Write `desktop/package.json`**

```json
{
  "name": "@privy/desktop", "private": true, "version": "0.0.0", "type": "module",
  "scripts": { "tauri": "tauri" },
  "dependencies": { "@tauri-apps/api": "^2.0.0" },
  "devDependencies": { "@tauri-apps/cli": "^2.0.0" }
}
```

- [ ] **Step 2: Write the app icon**

`tauri-build` requires at least one bundle icon even for `--no-bundle` cargo builds. Generate a minimal 1×1 PNG placeholder (replace with a real 32/128/256 px icon set before distributing):

```bash
mkdir -p desktop/src-tauri/icons
echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > desktop/src-tauri/icons/icon.png
```

Expected: `desktop/src-tauri/icons/icon.png` exists.

- [ ] **Step 3: Write `desktop/src-tauri/Cargo.toml`**

```toml
[package]
name = "privy-cloud-desktop"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
reqwest = { version = "0.12", default-features = false, features = ["json", "blocking"] }
serde_json = "1"
```

- [ ] **Step 4: Write `desktop/src-tauri/build.rs`**

```rust
fn main() { tauri_build::build() }
```

- [ ] **Step 5: Write `desktop/src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Privy Cloud",
  "version": "0.1.0",
  "identifier": "com.privy.cloud",
  "build": {
    "beforeDevCommand": "npm run dev -w web",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "npm run build -w web",
    "frontendDist": "../web/dist"
  },
  "app": { "windows": [{ "title": "Privy Cloud", "width": 1280, "height": 800, "minWidth": 960, "minHeight": 600 }], "security": { "csp": null } },
  "bundle": { "active": true, "targets": "all", "icon": ["icons/icon.png"] }
}
```

- [ ] **Step 6: Write `desktop/src-tauri/capabilities/default.json`**

```json
{ "identifier": "default", "description": "default capability", "windows": ["main"], "permissions": ["core:default"] }
```

- [ ] **Step 7: Write `desktop/src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() { privy_cloud_desktop_lib::run(); }
```

- [ ] **Step 8: Write `desktop/src-tauri/src/lib.rs`**

```rust
use std::process::{Child, Command};
use std::sync::Mutex;

struct Backend(Mutex<Option<Child>>);

fn backend_script() -> Option<String> {
    if let Ok(p) = std::env::var("PRIVY_BACKEND") { return Some(p); }
    // Resolve server/dist/index.js relative to this crate, falling back to the repo layout.
    for cand in [
        concat!(env!("CARGO_MANIFEST_DIR"), "/../../server/dist/index.js"),
        "server/dist/index.js".to_string(),
    ] {
        if std::path::Path::new(&cand).exists() { return Some(cand); }
    }
    None
}

fn backend_alive() -> bool {
    reqwest::blocking::Client::new()
        .get("http://localhost:5178/api/health")
        .timeout(std::time::Duration::from_millis(700))
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn spawn_backend() -> Option<Child> {
    let script = backend_script()?;
    Command::new("node")
        .arg(&script)
        .env("PRIVY_PORT", "5178")
        .spawn()
        .ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            if !backend_alive() {
                if let Some(child) = spawn_backend() {
                    let _ = _app.manage(Backend(Mutex::new(Some(child))));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.app_handle().try_state::<Backend>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 9: Build the backend and web first, then verify the Tauri dev flow**

Run:
```bash
npm run build -w shared && npm run build -w server && npm run build -w web
npm install -w desktop
npm run tauri -w desktop -- build --no-bundle
```
Expected: Rust compiles, the binary is produced at `desktop/src-tauri/target/release/privy-cloud-desktop`. (First build downloads crates — allow several minutes.)

- [ ] **Step 10: Manual smoke test**

Run: `npm run app`
Expected: a native "Privy Cloud" window opens, loads the frontend, the Hermes Agent tab is active, the backend is running (visit `http://localhost:5178/api/meta` in a browser), and switching to Privy Cloud shows the grid + chat. Closing the window exits the backend (verify `curl` fails afterwards).

- [ ] **Step 11: Commit**

```bash
git add desktop/
git commit -m "feat: Tauri desktop shell with auto-starting backend"
```

---

### Task 18: End-to-end verification + README

**Files:**
- Create: `README.md`
- Modify: root `package.json` (finalize scripts)

**Interfaces:**
- Produces: a runnable v1. A written walkthrough of the manual E2E checks below, plus a README documenting setup, run, and known limitations.

- [ ] **Step 1: Write `README.md`**

```markdown
# Privy Cloud

A desktop app with three tabs — **Hermes Agent**, **Coding Agent**, **Privy Cloud** — backed by a local server that owns a root directory and keeps everything in sync.

## Prerequisites
- Node ≥ 22, Rust ≥ 1.77, `webkit2gtk-4.1` + `gtk+-3.0` (Fedora: `sudo dnf install webkit2gtk4.1-devel gtk3-devel`)

## Run
```bash
npm install
npm run app        # Tauri window (auto-starts backend on :5178)
# or, backend + web only:
npm run dev        # http://localhost:5173
```

## What works in v1
- Three tabs; boots into Hermes Agent (Hermes & Coding Agent are placeholders).
- Privy Cloud: send text / files / folders from the chat; items are auto-categorized into `Images/ Videos/ Slides/ Documents/ Markdown/ Folders/ Other/` under `Privy Cloud/`.
- Sharing grid with kind filters; click any file for a full-width view; markdown/text editable inline; images & videos preview.
- Dark/light theme toggle.
- Backend watches the root directory; changes on disk appear live.

## Root directory
Default: `~/PrivyCloud` (created on first run). Override via `PRIVY_ROOT` or the config file `~/.privy-cloud/config.json`.

## Deferred (designed for)
Cloudflare Tunnel remote access + auth; multi-user sharing (read/write/edit permissions); Hermes agent integration; coding-agent integration; richer editors.
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all server + web tests PASS.

- [ ] **Step 3: Manual end-to-end check**

```bash
npm run app
```
Then in the window:
1. Hermes tab is active on launch.
2. Switch to Privy Cloud. Send "hello" in the chat → a `Markdown/hello-<ts>.md` file appears in the grid and the chat timeline shows the entry.
3. Attach a `.png` via 📎 → appears under `Images/`.
4. Attach a folder via 📁 → appears under `Folders/`.
5. Click the markdown file → full-width editor → edit → Save → Saved ✓ → back button returns to the grid.
6. Click an image → full-width preview.
7. Toggle 🌙/☀️ → whole UI re-themes; reopen the app → theme persists.
8. In a terminal, `echo hi >> ~/PrivyCloud/Privy\ Cloud/Markdown/external.md` → the grid updates live.
9. Close the window → `curl -s http://localhost:5178/api/health` fails (backend stopped).

- [ ] **Step 4: Push to GitHub (repo already created)**

```bash
git add README.md package.json
git commit -m "docs: v1 README and final scripts"
git push -u origin main
```

- [ ] **Step 5: Done — report back**

Summarize: what shipped, the E2E checklist results, and what's queued next (tunnel + auth, Hermes, coding agents).

---

## Self-Review Notes (resolved inline)

- **Spec coverage:** directory init (T3), file watching + periodic rescan (T8), send handling & kinds (T6/T7), chat log (T4/T7), sharing grid + filters (T13), full-width editor/viewers incl. PDF iframe (T15), chat panel (T14), theme toggle (T12), permission skeleton (T5), three tabs + placeholders (T12), backend-as-source-of-truth + serving UI (T9), Tauri shell + auto-start backend (T17). No spec requirement lacks a task.
- **Path-safety boundary fixed in self-review:** `resolveSafe` now guards against escaping the **`Privy Cloud/` base** (not the user root), so `Privy Cloud/../secret` is rejected. Storage, routes, and tests all resolve through `privyBase(root)`.
- **Streaming (spec §4.3):** `storeFile`/`storeFolder` accept `Buffer | Readable`; multipart uploads pass the request stream straight to disk via `pipeline` — no full buffering.
- **Type consistency:** `ChatEntry`/`FileItem`/`Kind` defined once in `@privy/shared` and consumed everywhere; `storeFile` returns `ChatEntry`; REST responses match the frontend `api.ts` signatures; `ServerEvent` shapes match `ws.ts`. `resolveSafe(base, rel)` signature is identical across all callers.
- **Deferred items are out of scope by design (documented in README):** Cloudflare Tunnel, auth, multi-user enforcement, Hermes/coding-agent integration, richer editors, upload progress bars, and the "file changed on disk" notice for concurrent edits (v1 is last-write-wins without the notice).

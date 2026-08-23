# Right-click Context Menu + Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OS-style right-click context menus to the Privy Cloud sharing view (background / item / trash menus) and the rename operation that powers them.

**Architecture:** A pure `buildMenu(context)` builder returns typed menu items; a dumb portal-based `ContextMenu` component renders them at the cursor and reports an `action` id; `PrivyCloudTab` maps action → existing/new handlers and owns inline-rename and delete-confirm state. Backend gains `renameItem` in `storage.ts` (same-parent atomic rename that also moves media proxies and rewrites chat-log paths) plus `POST /api/rename`.

**Tech Stack:** React 18 + Vite (web), Fastify 5 + TypeScript ESM (server), vitest + @testing-library/react on both sides. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-23-file-context-menu-design.md`

## Global Constraints

- **Zero new dependencies** in both workspaces.
- Reuse existing helpers: `sanitizeSegment`, `httpError` codes (`INVALID_NAME`, `UNSAFE`, `NOT_FOUND`, `EXISTS`), `resolveSafe`, `privyBase`, `proxyPathFor`/`pendingPathFor`, the `moveFile`-style `rename` import.
- API error responses never echo absolute server paths; unknown errors log server-side and return `{ error: 'operation failed' }`.
- Menu items carry an `action: MenuAction` id string, never a closure; `ContextMenu` is a dumb renderer.
- `Move to Trash` is instant (no confirm). `Delete Forever` always confirms via the dialog.
- Theme colors come from the existing CSS variables in `web/src/styles/theme.css` (`--panel2`, `--border`, `--chipbg`, `--muted`, `--danger`, `--inputbg`, `--accent`).
- Commit after every green test cycle.

---

### Task 1: `renameEntries` in chatLog.ts

**Files:**
- Modify: `server/src/chatLog.ts`
- Test: `server/test/chatLog.test.ts`

**Interfaces:**
- Produces: `renameEntries(root: string, oldRel: string, newRel: string): Promise<void>` — rewrites every chat entry whose `path` equals `oldRel` (file) or starts with `oldRel + '/'` (folder + descendants). No-op when nothing matches or the log file is missing.

- [ ] **Step 1: Write the failing test**

Append to `server/test/chatLog.test.ts` (add `renameEntries` to the import from `'../src/chatLog.js'`):

```ts
it('renameEntries rewrites an exact file path', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  createChatLog(root);
  await appendEntry(root, { type: 'file', kind: 'image', name: 'a.png', path: 'Images/a.png', sender: 'owner' });
  await renameEntries(root, 'Images/a.png', 'Images/b.png');
  expect((await readEntries(root))[0].path).toBe('Images/b.png');
});

it('renameEntries rewrites folder descendants but not siblings', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  createChatLog(root);
  await appendEntry(root, { type: 'folder', kind: 'folder', name: 'docs', path: 'Folders/docs', sender: 'owner' });
  await appendEntry(root, { type: 'file', kind: 'markdown', name: 'x.md', path: 'Folders/docs/notes/x.md', sender: 'owner' });
  await appendEntry(root, { type: 'file', kind: 'markdown', name: 's.md', path: 'Folders/docs2/notes/s.md', sender: 'owner' });
  await renameEntries(root, 'Folders/docs', 'Folders/guide');
  const byPath = Object.fromEntries((await readEntries(root)).map((e) => [e.path, e]));
  expect(byPath['Folders/guide']).toBeTruthy();
  expect(byPath['Folders/guide/notes/x.md']).toBeTruthy();
  expect(byPath['Folders/docs2/notes/s.md']).toBeTruthy();
});

it('renameEntries is a no-op when nothing matches', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  createChatLog(root);
  await appendEntry(root, { type: 'text', kind: 'text', name: 'hi.md', text: 'x', sender: 'owner' }); // no path
  await appendEntry(root, { type: 'file', kind: 'image', name: 'a.png', path: 'Images/a.png', sender: 'owner' });
  await renameEntries(root, 'Videos/missing.mp4', 'Videos/other.mp4');
  expect((await readEntries(root)).map((e) => e.path)).toContain('Images/a.png');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/chatLog.test.ts`
Expected: FAIL — `renameEntries is not defined`.

- [ ] **Step 3: Write the implementation**

Add to `server/src/chatLog.ts` (the file already imports `readFileSync`, `writeFileSync`, `existsSync`, and the `ChatEntry` type):

```ts
/**
 * Rewrite every chat entry whose path falls under `oldRel` so it points at `newRel`.
 * Exact match renames a file; prefix match (with a `/` boundary) renames a folder
 * and all of its descendants. No-op when the log is missing or nothing matches.
 */
export async function renameEntries(root: string, oldRel: string, newRel: string): Promise<void> {
  const file = chatLogPath(root);
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let changed = false;
  const out = lines.map((line) => {
    const entry = JSON.parse(line) as ChatEntry;
    if (!entry.path) return line;
    if (entry.path === oldRel) {
      changed = true;
      return JSON.stringify({ ...entry, path: newRel });
    }
    if (entry.path.startsWith(oldRel + '/')) {
      changed = true;
      return JSON.stringify({ ...entry, path: newRel + entry.path.slice(oldRel.length) });
    }
    return line;
  });
  if (changed) writeFileSync(file, out.join('\n') + '\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run test/chatLog.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/chatLog.ts server/test/chatLog.test.ts
git commit -m "feat(privy): chat-log path rewrite helper for rename"
```

---

### Task 2: `renameItem` in storage.ts

**Files:**
- Modify: `server/src/storage.ts`
- Test: `server/test/storage.test.ts`

**Interfaces:**
- Consumes: `renameEntries(root, oldRel, newRel)` from Task 1; `proxyPathFor`, `pendingPathFor` from `'./directory.js'`; existing `sanitizeSegment`, `httpError`, `resolveSafe`, `privyBase`, `detectKind`.
- Produces: `renameItem(root: string, path: string, newName: string): Promise<string>` — renames in place (same parent), moves the media proxy, clears the pending marker, rewrites chat-log paths; returns the new relative path. Throws `httpError` with codes `INVALID_NAME`, `UNSAFE`, `NOT_FOUND`, `EXISTS`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/storage.test.ts`. Add `renameItem, createDirectory` to the `'../src/storage.js'` import; add `proxyPathFor, pendingPathFor` to the `'../src/directory.js'` import; add `appendEntry` to the `'../src/chatLog.js'` import (`readEntries` is already imported):

```ts
it('renameItem renames a file in place', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  await createFile(root, '', 'old.md', Buffer.from('# hi'));
  const rel = await renameItem(root, 'old.md', 'new.md');
  expect(rel).toBe('new.md');
  expect(existsSync(join(root, 'Privy Cloud', 'old.md'))).toBe(false);
  expect(readFileSync(join(root, 'Privy Cloud', 'new.md'), 'utf8')).toBe('# hi');
});

it('renameItem renames a folder and its descendants', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  await createDirectory(root, '', 'docs');
  await createFile(root, 'docs', 'a.txt', Buffer.from('a'));
  const rel = await renameItem(root, 'docs', 'guide');
  expect(rel).toBe('guide');
  expect(existsSync(join(root, 'Privy Cloud', 'docs'))).toBe(false);
  expect(readFileSync(join(root, 'Privy Cloud', 'guide', 'a.txt'), 'utf8')).toBe('a');
});

it('renameItem same name is a no-op', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  await createFile(root, '', 'a.txt', Buffer.from('a'));
  expect(await renameItem(root, 'a.txt', 'a.txt')).toBe('a.txt');
});

it('renameItem rejects invalid names, missing items, and conflicts', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  await createFile(root, '', 'a.txt', Buffer.from('a'));
  await expect(renameItem(root, 'a.txt', '../evil')).rejects.toMatchObject({ code: 'INVALID_NAME' });
  await expect(renameItem(root, 'a.txt', '.hidden')).rejects.toMatchObject({ code: 'INVALID_NAME' });
  await expect(renameItem(root, 'missing.txt', 'b.txt')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await createFile(root, '', 'b.txt', Buffer.from('b'));
  await expect(renameItem(root, 'a.txt', 'b.txt')).rejects.toMatchObject({ code: 'EXISTS' });
});

it('renameItem moves a media proxy and clears pending', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  await createFile(root, '', 'clip.mov', Buffer.from('video'));
  mkdirSync(join(root, 'Privy Cloud', '.privy', 'proxies'), { recursive: true }); // the proxy dir does not exist yet
  writeFileSync(proxyPathFor(root, 'clip.mov', 'video'), 'PROXY');
  writeFileSync(pendingPathFor(root, 'clip.mov', 'video'), '');
  await renameItem(root, 'clip.mov', 'clip2.mov');
  expect(existsSync(proxyPathFor(root, 'clip.mov', 'video'))).toBe(false);
  expect(existsSync(proxyPathFor(root, 'clip2.mov', 'video'))).toBe(true);
  expect(existsSync(pendingPathFor(root, 'clip2.mov', 'video'))).toBe(false);
});

it('renameItem rewrites matching chat-log paths', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  await createFile(root, '', 'note.md', Buffer.from('# hi'));
  await appendEntry(root, { type: 'file', kind: 'markdown', name: 'note.md', path: 'note.md', sender: 'owner' });
  await renameItem(root, 'note.md', 'renamed.md');
  expect((await readEntries(root))[0].path).toBe('renamed.md');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/storage.test.ts`
Expected: FAIL — `renameItem is not defined`.

- [ ] **Step 3: Write the implementation**

In `server/src/storage.ts`:
- Extend the `'./directory.js'` import to `import { resolveSafe, privyBase, folderFor, proxyPathFor, pendingPathFor } from './directory.js';`
- Extend the `'./chatLog.js'` import to `import { appendEntry, renameEntries } from './chatLog.js';`
- Add (after `createFile`):

```ts
/**
 * Rename an item in place (same parent directory). Validates the new name,
 * refuses conflicts, moves any media proxy alongside, clears a stale pending
 * marker, and rewrites chat-log paths so history stays consistent. Returns the
 * new relative path. Same-parent rename only, so `rename` is atomic and EXDEV
 * cannot occur.
 */
export async function renameItem(root: string, path: string, newName: string): Promise<string> {
  const clean = sanitizeSegment(newName);
  if (!clean) throw httpError('INVALID_NAME', 'invalid name');
  const base = privyBase(root);
  const oldAbs = resolveSafe(base, path);
  if (!oldAbs) throw httpError('UNSAFE', 'unsafe path');
  if (!existsSync(oldAbs)) throw httpError('NOT_FOUND', 'not found');
  const isDir = statSync(oldAbs).isDirectory();
  const parent = dirname(path); // '.' when the item sits directly under Privy Cloud/
  const newRel = parent === '.' ? clean : join(parent, clean);
  const newAbs = resolveSafe(base, newRel);
  if (!newAbs) throw httpError('UNSAFE', 'unsafe path');
  if (newRel === path) return path; // same name — no-op (avoids self-conflict)
  if (existsSync(newAbs)) throw httpError('EXISTS', 'already exists');
  await rename(oldAbs, newAbs);
  const kind = detectKind(clean, isDir);
  if (kind === 'video' || kind === 'image') {
    const oldProxy = proxyPathFor(root, path, kind);
    if (existsSync(oldProxy)) await rename(oldProxy, proxyPathFor(root, newRel, kind));
    const pending = pendingPathFor(root, path, kind);
    if (existsSync(pending)) await rm(pending, { force: true });
  }
  await renameEntries(root, path, newRel);
  return newRel;
}
```

(`rename` and `rm` are already imported from `'node:fs/promises'`; `dirname`, `join` from `'node:path'`; `statSync`, `existsSync` from `'node:fs'`; `detectKind` from `'./kinds.js'`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run test/storage.test.ts`
Expected: PASS (existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/storage.ts server/test/storage.test.ts
git commit -m "feat(privy): renameItem storage op with proxy + chat-log preservation"
```

---

### Task 3: `POST /api/rename` route

**Files:**
- Modify: `server/src/api/routes.ts`
- Test: `server/test/api.test.ts`

**Interfaces:**
- Consumes: `renameItem` from Task 2.
- Produces: `POST /api/rename` — body `{ path, newName }`; 200 `{ path }` + emits `items:changed` (`change: 'renamed'`); 400 `'path and newName are required'` / invalid name / `'unsafe path'`; 404 `'not found'`; 409 `'already exists'`; 500 `'operation failed'`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/api.test.ts` (the file already imports `existsSync` and `join`):

```ts
it('POST /api/rename renames an item and emits items:changed', async () => {
  const app = await boot();
  await app.inject({ method: 'POST', url: '/api/items', payload: { name: 'a.txt', kind: 'file' }, headers: AUTH });
  const res = await app.inject({ method: 'POST', url: '/api/rename', payload: { path: 'a.txt', newName: 'b.txt' }, headers: AUTH });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ path: 'b.txt' });
  expect(existsSync(join(root, 'Privy Cloud', 'b.txt'))).toBe(true);
  expect(existsSync(join(root, 'Privy Cloud', 'a.txt'))).toBe(false);
  await app.close();
});

it('POST /api/rename rejects conflicts, bad names, and missing items', async () => {
  const app = await boot();
  await app.inject({ method: 'POST', url: '/api/items', payload: { name: 'a.txt', kind: 'file' }, headers: AUTH });
  await app.inject({ method: 'POST', url: '/api/items', payload: { name: 'b.txt', kind: 'file' }, headers: AUTH });

  const conflict = await app.inject({ method: 'POST', url: '/api/rename', payload: { path: 'a.txt', newName: 'b.txt' }, headers: AUTH });
  expect(conflict.statusCode).toBe(409);

  const bad = await app.inject({ method: 'POST', url: '/api/rename', payload: { path: 'a.txt', newName: '../x' }, headers: AUTH });
  expect(bad.statusCode).toBe(400);

  const missing = await app.inject({ method: 'POST', url: '/api/rename', payload: { path: 'zz.txt', newName: 'x.txt' }, headers: AUTH });
  expect(missing.statusCode).toBe(404);

  const noBody = await app.inject({ method: 'POST', url: '/api/rename', payload: { path: 'a.txt' }, headers: AUTH });
  expect(noBody.statusCode).toBe(400);
  await app.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/api.test.ts`
Expected: FAIL — `POST /api/rename` returns 404 (route not registered).

- [ ] **Step 3: Write the implementation**

In `server/src/api/routes.ts`:
- Extend the `'../storage.js'` import to `import { storeText, storeFile, stageFolderUpload, createDirectory, createFile, renameItem } from '../storage.js';`
- Insert this route right after the `app.post('/api/items', ...)` block (after line ~119):

```ts
app.post('/api/rename', async (req, reply) => {
  const { path, newName } = (req.body ?? {}) as { path?: string; newName?: string };
  if (!path || !newName) return reply.code(400).send({ error: 'path and newName are required' });
  try {
    const rel = await renameItem(ctx.getRoot(), path.trim(), newName.trim());
    ctx.emit({ type: 'items:changed', path: rel, change: 'renamed' });
    return { path: rel };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'INVALID_NAME') return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    if (code === 'UNSAFE') return reply.code(400).send({ error: 'unsafe path' });
    if (code === 'NOT_FOUND') return reply.code(404).send({ error: 'not found' });
    if (code === 'EXISTS') return reply.code(409).send({ error: 'already exists' });
    // Unknown fs errors may carry absolute paths — log server-side, stay generic.
    // eslint-disable-next-line no-console
    console.error('failed to rename item:', err);
    return reply.code(500).send({ error: 'operation failed' });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run test/api.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/api/routes.ts server/test/api.test.ts
git commit -m "feat(privy): POST /api/rename route"
```

---

### Task 4: `buildMenu` + menu types

**Files:**
- Create: `web/src/contextMenu.ts`
- Modify: `web/src/pages/PrivyCloudTab.tsx` (export `TrashItem` — one word)
- Test: `web/src/__tests__/contextMenu.test.ts`

**Interfaces:**
- Produces (used by Tasks 5 and 8):

```ts
export type MenuAction = 'new-folder' | 'new-file' | 'open' | 'download' | 'rename' | 'trash' | 'restore' | 'delete-forever' | 'share';
export type MenuContext =
  | { kind: 'background'; canCreate: boolean }
  | { kind: 'item'; item: FileItem }
  | { kind: 'trash'; item: TrashItem };
export interface MenuItem { id: string; label: string; icon?: string; action: MenuAction; disabled?: boolean; danger?: boolean; separatorBefore?: boolean }
export function buildMenu(ctx: MenuContext): MenuItem[]
```

- [ ] **Step 1: Write the failing test**

Create `web/src/__tests__/contextMenu.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildMenu } from '../contextMenu';
import type { FileItem } from '@privy/shared';
import type { TrashItem } from '../pages/PrivyCloudTab';

const file: FileItem = { name: 'note.md', path: 'Markdown/note.md', kind: 'markdown', size: 10, isDir: false, modifiedAt: 'x' };
const folder: FileItem = { name: 'docs', path: 'Folders/docs', kind: 'folder', size: 0, isDir: true, modifiedAt: 'x' };
const trash: TrashItem = { path: 'Images/a.png', name: 'a.png', isDir: false, size: 10, modifiedAt: 'x' };

describe('buildMenu', () => {
  it('background with canCreate offers New Folder then New File', () => {
    expect(buildMenu({ kind: 'background', canCreate: true }).map((i) => i.action)).toEqual(['new-folder', 'new-file']);
  });
  it('background without canCreate returns nothing', () => {
    expect(buildMenu({ kind: 'background', canCreate: false })).toEqual([]);
  });
  it('file menu: Open, Download, sep Rename, Trash, sep disabled Share', () => {
    const items = buildMenu({ kind: 'item', item: file });
    expect(items.map((i) => i.action)).toEqual(['open', 'download', 'rename', 'trash', 'share']);
    expect(items[0].separatorBefore).toBeUndefined();
    expect(items.find((i) => i.action === 'rename')?.separatorBefore).toBe(true);
    expect(items.find((i) => i.action === 'share')?.separatorBefore).toBe(true);
    expect(items.find((i) => i.action === 'share')?.disabled).toBe(true);
  });
  it('folder menu omits Download', () => {
    expect(buildMenu({ kind: 'item', item: folder }).map((i) => i.action)).toEqual(['open', 'rename', 'trash', 'share']);
  });
  it('trash menu: Restore and danger Delete Forever', () => {
    const items = buildMenu({ kind: 'trash', item: trash });
    expect(items.map((i) => i.action)).toEqual(['restore', 'delete-forever']);
    expect(items.find((i) => i.action === 'delete-forever')?.danger).toBe(true);
    expect(items.find((i) => i.action === 'delete-forever')?.separatorBefore).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/__tests__/contextMenu.test.ts`
Expected: FAIL — cannot resolve `../contextMenu`.

- [ ] **Step 3: Write the implementation**

In `web/src/pages/PrivyCloudTab.tsx`, change line 18 from `interface TrashItem {` to `export interface TrashItem {`.

Create `web/src/contextMenu.ts`:

```ts
import type { FileItem } from '@privy/shared';
import type { TrashItem } from './pages/PrivyCloudTab';

export type MenuAction = 'new-folder' | 'new-file' | 'open' | 'download' | 'rename' | 'trash' | 'restore' | 'delete-forever' | 'share';

export type MenuContext =
  | { kind: 'background'; canCreate: boolean }
  | { kind: 'item'; item: FileItem }
  | { kind: 'trash'; item: TrashItem };

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  action: MenuAction;
  disabled?: boolean;        // visible but greyed
  danger?: boolean;          // red styling (Delete Forever)
  separatorBefore?: boolean; // render a divider above this item
}

export function buildMenu(ctx: MenuContext): MenuItem[] {
  if (ctx.kind === 'background') {
    if (!ctx.canCreate) return [];
    return [
      { id: 'new-folder', label: 'New Folder', icon: '📁', action: 'new-folder' },
      { id: 'new-file', label: 'New File', icon: '📄', action: 'new-file' },
    ];
  }
  if (ctx.kind === 'trash') {
    return [
      { id: 'restore', label: 'Restore', icon: '↩️', action: 'restore' },
      { id: 'delete-forever', label: 'Delete Forever', icon: '🗑️', action: 'delete-forever', danger: true, separatorBefore: true },
    ];
  }
  const { item } = ctx;
  return [
    { id: 'open', label: 'Open', icon: item.isDir ? '📂' : '👁️', action: 'open' },
    ...(item.isDir
      ? []
      : [{ id: 'download', label: 'Download', icon: '⬇️', action: 'download' as MenuAction }]),
    { id: 'rename', label: 'Rename', icon: '✏️', action: 'rename', separatorBefore: true },
    { id: 'trash', label: 'Move to Trash', icon: '🗑️', action: 'trash' },
    { id: 'share', label: 'Share…', icon: '🔗', action: 'share', disabled: true, separatorBefore: true },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/__tests__/contextMenu.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/contextMenu.ts web/src/pages/PrivyCloudTab.tsx web/src/__tests__/contextMenu.test.ts
git commit -m "feat(privy): context-menu builder (background/item/trash)"
```

---

### Task 5: `ContextMenu` component

**Files:**
- Create: `web/src/components/ContextMenu.tsx`
- Modify: `web/src/styles/theme.css`
- Test: `web/src/__tests__/ContextMenu.test.tsx`

**Interfaces:**
- Consumes: `MenuAction`, `MenuItem` from Task 4.
- Produces: `ContextMenu({ x, y, items, onSelect, onClose })` — portal to `document.body`, fixed at cursor clamped to the viewport, `role="menu"`, closes on outside `pointerdown`/`Escape`/`scroll`/`resize`; calls `onSelect(item.action)` then `onClose` on item click.

- [ ] **Step 1: Write the failing test**

Create `web/src/__tests__/ContextMenu.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu } from '../components/ContextMenu';
import type { MenuItem } from '../contextMenu';

const items: MenuItem[] = [
  { id: 'open', label: 'Open', action: 'open' },
  { id: 'share', label: 'Share…', action: 'share', disabled: true },
];

describe('ContextMenu', () => {
  it('renders items, fires onSelect on click, then onClose', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items} onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByText('Open'));
    expect(onSelect).toHaveBeenCalledWith('open');
    expect(onClose).toHaveBeenCalled();
  });

  it('disabled items do not fire onSelect', () => {
    const onSelect = vi.fn();
    render(<ContextMenu x={10} y={10} items={items} onSelect={onSelect} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Share…'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on outside pointerdown and on Escape', () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items} onSelect={vi.fn()} onClose={onClose} />);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/__tests__/ContextMenu.test.tsx`
Expected: FAIL — cannot resolve `../components/ContextMenu`.

- [ ] **Step 3: Write the implementation**

Create `web/src/components/ContextMenu.tsx`:

```tsx
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MenuAction, MenuItem } from '../contextMenu';

export function ContextMenu({ x, y, items, onSelect, onClose }: {
  x: number; y: number; items: MenuItem[]; onSelect(action: MenuAction): void; onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Measure once laid out, then clamp so the menu never escapes the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const py = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    setPos({ x: px, y: py });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    const onResize = () => onClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} role="menu" className="ctx-menu" style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 1000 }}>
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.separatorBefore && <div role="separator" className="ctx-menu-sep" />}
          <div role="menuitem" aria-disabled={item.disabled || undefined}
            className={`ctx-menu-item${item.danger ? ' danger' : ''}`}
            onClick={item.disabled ? undefined : () => { onSelect(item.action); onClose(); }}>
            {item.icon && <span className="ctx-menu-icon">{item.icon}</span>}
            <span className="ctx-menu-label">{item.label}</span>
          </div>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
```

Append to `web/src/styles/theme.css`:

```css
.ctx-menu { min-width: 180px; background: var(--panel2); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.35); padding: 4px; z-index: 1000; }
.ctx-menu-item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 6px; font-size: 13px; cursor: pointer; user-select: none; }
.ctx-menu-item:hover:not([aria-disabled='true']) { background: var(--chipbg); }
.ctx-menu-item[aria-disabled='true'] { color: var(--muted); cursor: default; opacity: .6; }
.ctx-menu-icon { width: 18px; text-align: center; font-size: 14px; flex-shrink: 0; }
.ctx-menu-sep { border-top: 1px solid var(--border); margin: 4px 6px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/__tests__/ContextMenu.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ContextMenu.tsx web/src/styles/theme.css web/src/__tests__/ContextMenu.test.tsx
git commit -m "feat(privy): portal context menu component with clamping and dismissal"
```

---

### Task 6: `rename` API client

**Files:**
- Modify: `web/src/api.ts`
- Test: `web/src/__tests__/api.test.ts`

**Interfaces:**
- Produces: `api.rename(path: string, newName: string): Promise<{ path: string }>`.

- [ ] **Step 1: Write the failing test**

Append to `web/src/__tests__/api.test.ts`:

```ts
it('rename POSTs path and newName to /api/rename', async () => {
  const fetchMock = vi.fn().mockResolvedValue(ok({ path: 'b.txt' }));
  vi.stubGlobal('fetch', fetchMock);
  const { api } = await import('../api');
  const r = await api.rename('a.txt', 'b.txt');
  expect(r.path).toBe('b.txt');
  const call = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(call[0]).toContain('/api/rename');
  expect(call[1].method).toBe('POST');
  expect(JSON.parse(String(call[1].body))).toEqual({ path: 'a.txt', newName: 'b.txt' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/__tests__/api.test.ts`
Expected: FAIL — `api.rename is not a function`.

- [ ] **Step 3: Write the implementation**

In `web/src/api.ts`, add after `createFile` (inside the `api` object):

```ts
rename: (path: string, newName: string): Promise<{ path: string }> =>
  req('/api/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, newName }) }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/__tests__/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/__tests__/api.test.ts
git commit -m "feat(privy): api.rename client"
```

---

### Task 7: `SharingGrid` context-menu + inline-rename props

**Files:**
- Modify: `web/src/components/SharingGrid.tsx`
- Modify: `web/src/styles/theme.css`
- Test: `web/src/__tests__/SharingGrid.test.tsx`

**Interfaces:**
- Consumes: `FileItem`; `renaming?: string | null` (a path), `onCommitRename(item, newName)`, `onCancelRename()`.
- Produces: tiles fire `onTileContextMenu(e, item)` (default-prevented + propagation-stopped by the caller); the tile whose path equals `renaming` renders as a `<div>` with an inline rename input instead of name/meta.

- [ ] **Step 1: Write the failing test**

Append to `web/src/__tests__/SharingGrid.test.tsx`:

```tsx
it('fires onTileContextMenu with the item and lets the caller preventDefault', () => {
  const onTileContextMenu = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
  render(<SharingGrid items={items} onSelect={vi.fn()} onTileContextMenu={onTileContextMenu} />);
  fireEvent.contextMenu(screen.getByText('note.md'));
  expect(onTileContextMenu).toHaveBeenCalledTimes(1);
  const [e, item] = onTileContextMenu.mock.calls[0];
  expect(item).toBe(items[0]);
  expect(e.defaultPrevented).toBe(true);
});

it('renders a rename input for the renaming tile and commits on Enter', () => {
  const onCommitRename = vi.fn();
  render(<SharingGrid items={items} onSelect={vi.fn()} renaming="Markdown/note.md" onCommitRename={onCommitRename} onCancelRename={vi.fn()} />);
  const input = screen.getByDisplayValue('note.md') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'notes.md' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onCommitRename).toHaveBeenCalledWith(items[0], 'notes.md');
});

it('cancels rename on Escape', () => {
  const onCancelRename = vi.fn();
  render(<SharingGrid items={items} onSelect={vi.fn()} renaming="Markdown/note.md" onCommitRename={vi.fn()} onCancelRename={onCancelRename} />);
  fireEvent.keyDown(screen.getByDisplayValue('note.md'), { key: 'Escape' });
  expect(onCancelRename).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/__tests__/SharingGrid.test.tsx`
Expected: FAIL — prop `onTileContextMenu` / `renaming` doesn't exist (TypeScript/undefined handler).

- [ ] **Step 3: Write the implementation**

Replace the contents of `web/src/components/SharingGrid.tsx`:

```tsx
import { useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { KINDS, type FileItem, type Kind } from '@privy/shared';
import { api } from '../api';

const ICON: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.icon])) as Record<Kind, string>;
const LABEL: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.label])) as Record<Kind, string>;

/** Images get a real thumbnail (HEIC via its proxy, JPEG/PNG via the file URL). */
const thumbUrl = (item: FileItem): string => (item.hasProxy ? api.proxyUrl(item.path) : api.fileUrl(item.path));
const showThumb = (item: FileItem): boolean => item.kind === 'image';

function fmtSize(n: number): string {
  if (n === 0) return 'folder';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function RenameInput({ item, onCommit, onCancel }: { item: FileItem; onCommit(name: string): void; onCancel(): void }) {
  const done = useRef(false); // blur fires again on unmount after Enter/Escape — guard against double-fire
  const finish = (commit: boolean, value: string) => {
    if (done.current) return;
    done.current = true;
    const v = value.trim();
    if (commit && v && v !== item.name) onCommit(v); else onCancel();
  };
  return (
    <input
      className="tile-rename-input" autoFocus defaultValue={item.name}
      onFocus={(e) => {
        const i = item.isDir ? -1 : item.name.lastIndexOf('.');
        if (i > 0) e.target.setSelectionRange(0, i); else e.target.select();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true, e.currentTarget.value);
        else if (e.key === 'Escape') finish(false, '');
      }}
      onBlur={(e) => finish(true, e.currentTarget.value)}
    />
  );
}

export function SharingGrid({ items, onSelect, emptyMessage, onTileContextMenu, renaming, onCommitRename, onCancelRename }: {
  items: FileItem[]; onSelect: (item: FileItem) => void; emptyMessage?: string;
  onTileContextMenu?: (e: ReactMouseEvent<HTMLElement>, item: FileItem) => void;
  renaming?: string | null;
  onCommitRename?: (item: FileItem, newName: string) => void;
  onCancelRename?: () => void;
}) {
  if (items.length === 0) return <div className="empty-state">{emptyMessage ?? 'Nothing here yet — send something from the chat.'}</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
      {items.map((item) => {
        const isRenaming = renaming === item.path;
        const body = (
          <>
            <div className="tile-icon">{showThumb(item) ? <img src={thumbUrl(item)} alt="" className="tile-thumb" loading="lazy" /> : ICON[item.kind]}</div>
            {isRenaming
              ? <RenameInput item={item} onCommit={(v) => onCommitRename?.(item, v)} onCancel={() => onCancelRename?.()} />
              : (
                <>
                  <div className="tile-name">{item.name}{item.isDir ? ' ›' : ''}</div>
                  <div className="tile-meta">{fmtSize(item.size)} · {LABEL[item.kind]}</div>
                </>
              )}
          </>
        );
        if (isRenaming) {
          // An <input> cannot live inside a <button> — render a plain div while renaming.
          return <div key={item.path} className="tile">{body}</div>;
        }
        return (
          <button key={item.path} className="tile" title={item.isDir ? `Open ${item.name}` : item.name}
            onClick={() => onSelect(item)}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onTileContextMenu?.(e, item); }}>
            {body}
          </button>
        );
      })}
    </div>
  );
}
```

Append to `web/src/styles/theme.css`:

```css
.tile-rename-input { width: 100%; background: var(--inputbg); border: 1px solid var(--accent); border-radius: 6px; color: var(--text); font-size: 13px; padding: 4px 6px; margin-top: 6px; outline: none; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/__tests__/SharingGrid.test.tsx`
Expected: PASS (existing 2 + new 3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SharingGrid.tsx web/src/styles/theme.css web/src/__tests__/SharingGrid.test.tsx
git commit -m "feat(privy): grid tile context-menu hook and inline rename mode"
```

---

### Task 8: `PrivyCloudTab` wiring (menu state, actions, confirm dialog)

**Files:**
- Modify: `web/src/pages/PrivyCloudTab.tsx`
- Modify: `web/src/styles/theme.css`

**Interfaces:**
- Consumes: `buildMenu`, `MenuAction`, `MenuContext` (Task 4); `ContextMenu` (Task 5); `api.rename` (Task 6); `SharingGrid` new props (Task 7).
- Produces: full behavior — background/item/trash menus, inline rename with breadcrumb follow, instant trash, confirmed delete-forever.

- [ ] **Step 1: Modify imports and add state**

In `web/src/pages/PrivyCloudTab.tsx`:
- Add imports:

```tsx
import { ContextMenu } from '../components/ContextMenu';
import { buildMenu, type MenuAction, type MenuContext } from '../contextMenu';
```

- Add state next to the existing `const [newName, setNewName] = useState('');`:

```tsx
const [menu, setMenu] = useState<{ x: number; y: number; ctx: MenuContext } | null>(null);
const [renaming, setRenaming] = useState<FileItem | null>(null);
const [confirmDelete, setConfirmDelete] = useState<TrashItem | null>(null);
```

- [ ] **Step 2: Add handlers**

Add these after the existing `confirmCreate` function:

```tsx
const closeMenu = useCallback(() => setMenu(null), []);

const openMenu = useCallback((e: React.MouseEvent, ctx: MenuContext) => {
  e.preventDefault();
  e.stopPropagation();
  setMenu({ x: e.clientX, y: e.clientY, ctx });
}, []);

const handleMenuAction = async (action: MenuAction, ctx: MenuContext) => {
  closeMenu();
  if (action === 'new-folder') { setCreating('folder'); setNewName(''); return; }
  if (action === 'new-file') { setCreating('file'); setNewName(''); return; }
  if (ctx.kind === 'trash') {
    const t = ctx.item;
    if (action === 'restore') { await restoreItem(t.path); return; }
    if (action === 'delete-forever') { setConfirmDelete(t); return; }
    return;
  }
  const item = ctx.item;
  if (action === 'open') { handleTileSelect(item); return; }
  if (action === 'download' && !item.isDir) {
    const a = document.createElement('a');
    a.href = api.fileUrl(item.path);
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  if (action === 'rename') { setRenaming(item); return; }
  if (action === 'trash') { await trashFile(item.path); return; }
  // 'share' is disabled and never dispatched.
};

const commitRename = async (item: FileItem, newName: string) => {
  const value = newName.trim();
  if (!value || value === item.name) { setRenaming(null); return; }
  try {
    const res = await api.rename(item.path, value);
    setRenaming(null);
    if (loc.type === 'folder' && loc.path === item.path) {
      navigate({ type: 'folder', path: res.path });
    } else if (loc.type === 'folder' && loc.path.startsWith(item.path + '/')) {
      navigate({ type: 'folder', path: res.path + loc.path.slice(item.path.length) });
    }
    void refresh();
  } catch (e) { setError((e as Error).message); setRenaming(null); }
};
const cancelRename = useCallback(() => setRenaming(null), []);

const confirmDeleteForever = async () => {
  if (!confirmDelete) return;
  try { await api.deleteFromTrash(confirmDelete.path); void refreshTrash(); }
  catch (e) { setError((e as Error).message); }
  setConfirmDelete(null);
};
```

- Remove the now-unused `deleteItem` function (lines ~112–115) — the trash-row "Delete forever" button will open the confirm dialog instead. (`api` stays imported; it's used throughout the component.)

- [ ] **Step 3: Wire the grid container, tiles, and trash rows**

In the grid return, change the scroll container to:

```tsx
<div style={{ flex: 1, overflowY: 'auto' }} onContextMenu={(e) => openMenu(e, { kind: 'background', canCreate })}>
```

Change the `SharingGrid` usage to:

```tsx
<SharingGrid items={viewItems} onSelect={handleTileSelect}
  emptyMessage={loc.type === 'recent' ? 'Nothing here yet — send something from the chat.' : 'This folder is empty.'}
  onTileContextMenu={(e, item) => openMenu(e, { kind: 'item', item })}
  renaming={renaming?.path ?? null}
  onCommitRename={(item, name) => void commitRename(item, name)}
  onCancelRename={cancelRename} />
```

Change the trash-row rendering so the row opens a menu and "Delete forever" opens the confirm dialog:

```tsx
<trashItems.map((t) => (
  <div key={t.path} className="trash-row" onContextMenu={(e) => openMenu(e, { kind: 'trash', item: t })}>
    <span>{t.isDir ? '📁' : '📄'} {t.path}</span>
    <span style={{ flex: 1 }} />
    <button className="btn" onClick={() => restoreItem(t.path)}>Restore</button>
    <button className="btn" onClick={() => setConfirmDelete(t)}>Delete forever</button>
  </div>
))}
```

- [ ] **Step 4: Render the menu and confirm dialog**

Before the closing `</div>` of the grid return (near the existing `{error && <div className="toast">{error}</div>}`), add:

```tsx
{menu && buildMenu(menu.ctx).length > 0 && (
  <ContextMenu x={menu.x} y={menu.y} items={buildMenu(menu.ctx)}
    onSelect={(a) => void handleMenuAction(a, menu.ctx)} onClose={closeMenu} />
)}
{confirmDelete && (
  <div className="confirm-overlay" onClick={() => setConfirmDelete(null)}>
    <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
      <div className="confirm-title">Delete forever?</div>
      <div className="confirm-text">Permanently delete “{confirmDelete.path}”? This can’t be undone.</div>
      <div className="confirm-actions">
        <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
        <button className="btn danger" onClick={() => void confirmDeleteForever()}>Delete</button>
      </div>
    </div>
  </div>
)}
```

Append to `web/src/styles/theme.css`:

```css
.confirm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 1001; }
.confirm-dialog { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; max-width: 360px; box-shadow: 0 12px 32px rgba(0,0,0,.4); }
.confirm-title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
.confirm-text { font-size: 13px; color: var(--muted); margin-bottom: 16px; word-break: break-all; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.btn.danger { background: var(--danger); color: #fff; border-color: transparent; font-weight: 600; }
```

- [ ] **Step 5: Build to verify it compiles**

Run: `cd web && npm run build`
Expected: `tsc` and `vite build` both succeed with no type errors. (Full behavioral verification is Task 9.)

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/PrivyCloudTab.tsx web/src/styles/theme.css
git commit -m "feat(privy): wire context menus, inline rename, and delete-forever confirm"
```

---

### Task 9: End-to-end verification on the real app

**Files:** none (verification only).

- [ ] **Step 1: Rebuild and restart the service**

```bash
cd /home/jeffrey/Project/Privy-Cloud && npm run build -w @privy/server
systemctl --user restart privy-cloud.service
```

(Web `dist` is served live, but the server process runs compiled `server/dist` — it must be rebuilt and restarted to pick up `POST /api/rename`.)

- [ ] **Step 2: Smoke-test the new API**

```bash
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.privy-cloud/config.json','utf8')).token)")
# create, rename, conflict, then clean up
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"parentPath":"","name":"__ctx_test__","kind":"folder"}' http://127.0.0.1:5178/api/items
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"path":"__ctx_test__","newName":"__ctx_test2__"}' http://127.0.0.1:5178/api/rename
rm -rf "/home/jeffrey/PrivyCloud/Privy Cloud/__ctx_test2__"
```

Expected: create → 200 `{path}`, rename → 200 `{path:"__ctx_test2__"}`, then the folder is removed.

- [ ] **Step 3: Drive the UI**

Open http://127.0.0.1:5178 in the browser and verify:
1. Right-click empty area in Home → menu shows **New Folder / New File**; clicking New Folder opens the existing name dialog.
2. Right-click a file tile → **Open / Download · Rename / Move to Trash · Share… (greyed)**. Rename → inline input with basename pre-selected; Enter commits and the grid refreshes.
3. Right-click a folder tile → no Download; **Move to Trash** removes it instantly (check Trash).
4. Right-click a trash row → **Restore** works; **Delete Forever** shows the confirm dialog; Delete removes it permanently.
5. Rename a folder while inside it → breadcrumb follows the new name (not a stale path).
6. Create/rename/trash/restore a throwaway item, then delete it forever so the vault is untouched.

- [ ] **Step 4: Run the full test suites**

```bash
cd /home/jeffrey/Project/Privy-Cloud && npm run test -w @privy/server && npm run test -w @privy/web
```

Expected: all green (existing + new tests).

- [ ] **Step 5: Commit any residual fixes and report**

If the e2e pass surfaced no changes, there is nothing to commit (all code already committed per-task). Report the verification results.

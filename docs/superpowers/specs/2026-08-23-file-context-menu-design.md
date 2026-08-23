# Right-click Context Menu + Rename — Design Spec

**Date:** 2026-08-23
**Status:** Approved for design (pending written-spec review)
**Scope:** File-system context menus in the Privy Cloud sharing view + the backend rename operation they require.

## 1. Goal

Bring OS-style right-click context menus to the file-system sharing view (Home / folder / trash), and add the **rename** operation that today has no API or UI. Modeled on the conventions of Windows Explorer, macOS Finder, and GNOME Files: a background menu, an item menu, and a trash-row menu, driven by one reusable menu component.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Share | **Skip** — a disabled `Share…` placeholder entry only |
| Multi-select | **Skip** for now; menu built so bulk ops can be added later |
| Rename presentation | **Inline on the tile**, basename pre-selected |
| Delete confirmation | **Move to Trash is instant** (recoverable); **Delete Forever confirms** |
| Menu architecture | **A** — self-contained `ContextMenu` component + pure `buildMenu(context)` builder; zero new dependencies |
| Keyboard shortcuts | **Dropped** (no F2/Delete on tiles; tiles not focusable). Menu keeps Esc + click-outside close + click-to-select |
| `Open` in item menus | **Included** (first item) |
| Trash-row right-click menu | **Included** (Restore / Delete Forever) |

## 3. Menu model — `buildMenu(context)`

New file `web/src/contextMenu.ts`.

```ts
type MenuContext =
  | { kind: 'background'; canCreate: boolean } // right-click on empty area of Home/folder
  | { kind: 'item'; item: FileItem }           // right-click on a tile
  | { kind: 'trash'; item: TrashItem };        // right-click on a trash row

type MenuAction = 'new-folder' | 'new-file' | 'open' | 'download' | 'rename' | 'trash' | 'restore' | 'delete-forever' | 'share';

interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  action: MenuAction;
  disabled?: boolean;      // visible but greyed (OS convention — non-applicable ops stay visible)
  danger?: boolean;        // red styling (Delete Forever)
  separatorBefore?: boolean; // render a divider above this item
}
```

`buildMenu(ctx: MenuContext): MenuItem[]` — pure data, no React, no closures. The tab maps `action` → handler; `ContextMenu` is a dumb renderer (see §4). The `TrashItem` interface (currently local to `PrivyCloudTab.tsx`) is exported from the tab so `contextMenu.ts` can reference it.

| Context | Items (in order) |
|---|---|
| `background`, canCreate=true | `New Folder`, `New File` (open the existing top-bar create dialog) |
| `background`, canCreate=false | `[]` (Recent / Trash → no menu) |
| `item`, folder | `Open` · sep · `Rename`, `Move to Trash` · sep · `Share…` *(disabled)* |
| `item`, file | `Open`, `Download` · sep · `Rename`, `Move to Trash` · sep · `Share…` *(disabled)* |
| `trash` | `Restore` · sep · `Delete Forever` *(danger)* |

Grouping follows the OS convention: primary verbs (Open, Download) first, then file ops (Rename, Move to Trash), then Share/info last behind a separator. No Cut/Copy/Paste — nothing to paste into yet; natural future additions.

## 4. `ContextMenu` component

New file `web/src/components/ContextMenu.tsx`. Props: `{ x: number; y: number; items: MenuItem[]; onSelect(action: MenuAction): void; onClose(): void }`.

- **Portal:** `createPortal(…, document.body)` so the grid's `overflow:auto` and stacking can't clip it.
- **Positioning:** `position: fixed` at `{x, y}` (the right-click `clientX/clientY`). On mount, measure via ref and clamp: when the menu would overflow the right/bottom viewport edge, shift it left/up (with an 8px margin). Re-measure on resize.
- **ARIA:** container `role="menu"`, items `role="menuitem"`, `aria-disabled` on disabled items. No roving focus (deferred with arrow-key nav; see Out of scope).
- **Dismissal** (document-level listeners installed on mount, removed on unmount):
  - `pointerdown` outside the menu → close.
  - `keydown` `Escape` → close.
  - `scroll` (capture) → close.
  - `resize` → close.
  - item select → call `onSelect(item.action)` then close.
- Disabled items render greyed and ignore clicks (don't call `onSelect`).
- Source `onContextMenu` handlers call `preventDefault()` so the browser's native menu never appears.

## 5. Backend: rename

### 5.1 `renameItem(root, path, newName)` in `server/src/storage.ts`

Returns the new relative path. Same-parent rename only, so `node:fs/promises` `rename()` is atomic and EXDEV is impossible.

1. `sanitizeSegment(newName)` → null ⇒ `httpError('INVALID_NAME', 'invalid name')`.
2. `oldAbs = resolveSafe(privyBase(root), path)` → null ⇒ `httpError('UNSAFE', 'unsafe path')`; `!existsSync(oldAbs)` ⇒ `httpError('NOT_FOUND', 'not found')`.
3. `newRel` = same parent dir + cleaned name; `newAbs = resolveSafe(base, newRel)` → null ⇒ `UNSAFE`.
4. `newRel === path` (unchanged name) ⇒ return `path` (no-op success — avoids self-conflict 409).
5. `existsSync(newAbs)` ⇒ `httpError('EXISTS', 'already exists')`.
6. `await rename(oldAbs, newAbs)`.
7. **Media proxy:** if the item is a video/image (`detectKind(name, isDir)` from `statSync(oldAbs).isDirectory()`), move `.privy/proxies/<oldRel><.mp4|.jpg>` → `<newRel><ext>` when it exists, and remove the `<oldRel><ext>.pending` marker (`proxyPathFor` / `pendingPathFor` from `directory.ts`). Keeps a renamed media preview instead of forcing a re-transcode.
8. **Chat log:** `renameEntries(root, path, newRel)` (below).
9. Return `newRel`.

### 5.2 `renameEntries(root, oldRel, newRel)` in `server/src/chatLog.ts`

Read `.privy/chat-log.jsonl`, rewrite every entry whose `path` matches, preserving ids/ts/sender; write back only when something changed:

- `path === oldRel` → `newRel` (file rename)
- `path.startsWith(oldRel + '/')` → `newRel + path.slice(oldRel.length)` (folder rename rewrites descendants)

This keeps chat history consistent when a chat-sent file is renamed (otherwise `/api/chat`'s existence filter would silently drop the entry).

### 5.3 `POST /api/rename` in `server/src/api/routes.ts`

- Body `{ path?: string; newName?: string }`; missing either ⇒ 400 `'path and newName are required'`.
- Success: `ctx.emit({ type: 'items:changed', path: newRel, change: 'renamed' })`; return `{ path: newRel }`.
- Error mapping (mirrors `POST /api/items`): `INVALID_NAME`→400 (its message), `UNSAFE`→400 `'unsafe path'`, `NOT_FOUND`→404 `'not found'`, `EXISTS`→409 `'already exists'`, unknown→500 `'operation failed'` + `console.error` (never echo absolute paths).

## 6. Frontend wiring

### 6.1 `web/src/api.ts`

```ts
rename: (path: string, newName: string): Promise<{ path: string }> =>
  req('/api/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, newName }) }),
```

### 6.2 `web/src/pages/PrivyCloudTab.tsx`

New state:
- `menu: { x: number; y: number; ctx: MenuContext } | null`
- `renaming: FileItem | null` (inline-rename target)
- `confirmDelete: TrashItem | null` (Delete Forever dialog)

Handlers:
- `openMenu(e, ctx)` — `e.preventDefault()`; `setMenu({ x: e.clientX, y: e.clientY, ctx })`. Attach to:
  - the scroll container (`<div style={{ flex: 1, overflowY: 'auto' }}>`) → `{ kind: 'background', canCreate }` (this covers empty folders too);
  - each tile → `{ kind: 'item', item }` with `stopPropagation` so the tile menu wins;
  - each trash row → `{ kind: 'trash', item: t }` with `stopPropagation`.
- Item actions (all close the menu first):
  - `New Folder` / `New File` → `setCreating('folder'|'file')` (existing dialog).
  - `Open` → `handleTileSelect(item)`.
  - `Download` (files) → programmatic anchor click on `api.fileUrl(path)` with `download={name}` (same URL FileViewer uses).
  - `Rename` → `setRenaming(item)`.
  - `Move to Trash` → `api.trashPath(path)`, clear `selected`, `refresh()`, `refreshTrash()`. Instant, no confirm.
  - `Restore` → `api.restoreFromTrash(path)`, `refresh()`, `refreshTrash()`.
  - `Delete Forever` → `setConfirmDelete(item)` (confirm dialog opens; see below).
  - `Share…` → disabled, no-op.
- Render `<ContextMenu x={menu.x} y={menu.y} items={buildMenu(menu.ctx)} onSelect={(a) => handleMenuAction(a, menu.ctx)} onClose={() => setMenu(null)} />` when `menu` is set, where `handleMenuAction` is a switch over `MenuAction` dispatching to the item handlers below.

**Inline rename** (`renaming`):
- The renamed tile swaps its name for an auto-focused `<input>`; `onFocus` selects the **basename** (everything before the last `.`, for files; whole name for folders), the OS convention.
- `Enter` → `const res = await api.rename(item.path, value.trim())`; if the value is empty or unchanged, just cancel. Then:
  - if `loc.type === 'folder' && loc.path === item.path` → `navigate({ type: 'folder', path: res.path })`;
  - else if `loc.type === 'folder' && loc.path.startsWith(item.path + '/')` → `navigate({ type: 'folder', path: res.path + loc.path.slice(item.path.length) })` (keeps the breadcrumb pointing at the renamed folder);
  - else `refresh()`.
  - `setRenaming(null)`.
- `Esc` → `setRenaming(null)`.

**Delete Forever confirm** (`confirmDelete`):
- Fixed overlay + dialog: `Permanently delete '<path>'? This can't be undone.` with `Delete` (danger/red) and `Cancel`.
- Confirm → `api.deleteFromTrash(path)`, `refreshTrash()`, `setConfirmDelete(null)`.

### 6.3 `web/src/components/SharingGrid.tsx`

New props: `onTileContextMenu?: (e, item) => void`, `renaming?: string | null`, `onCommitRename?(item, newName)`, `onCancelRename?()`. Tiles keep their current `<button>` shell and gain `onContextMenu` (with `preventDefault`+`stopPropagation`). **Rename mode:** when `renaming === item.path`, the tile renders as a plain `<div className="tile">` (not a `<button>` — an `<input>` cannot be nested inside a `<button>`, invalid HTML) containing the rename input instead of the name text.

### 6.4 `web/src/styles/theme.css`

New classes: `.ctx-menu`, `.ctx-menu-item` (+ `.disabled`, `.danger`), `.ctx-menu-sep`, `.tile-rename-input`, `.confirm-overlay`, `.confirm-dialog`. Match the existing dark theme tokens.

## 7. Files touched

**New:** `web/src/components/ContextMenu.tsx`, `web/src/contextMenu.ts`
**Edit (web):** `web/src/pages/PrivyCloudTab.tsx`, `web/src/components/SharingGrid.tsx`, `web/src/api.ts`, `web/src/styles/theme.css`
**Edit (server):** `server/src/storage.ts`, `server/src/chatLog.ts`, `server/src/api/routes.ts`

## 8. Testing

- `web/src/__tests__/contextMenu.test.ts` — `buildMenu` per context: background (canCreate true/false), item folder, item file, trash; separator and disabled-Share placement.
- `web/src/__tests__/ContextMenu.test.tsx` — renders items at the given position; click calls `onSelect` then closes; outside `pointerdown` closes; `Escape` closes; disabled item does not fire.
- `server/test/storage.test.ts` — `renameItem`: happy file; happy folder (descendants follow); same-name no-op; `INVALID_NAME`; `EXISTS` conflict; `NOT_FOUND`; media proxy moved + pending cleared; chat-log entries rewritten (exact file + folder prefix).
- `server/test/api.test.ts` — `POST /api/rename`: 200 returns new path; 409 conflict; 400 invalid name; 404 not found; emits `items:changed` with `change: 'renamed'`.

## 9. Out of scope / future

Share (real link generation), multi-select + bulk ops, Cut/Copy/Paste, move/copy to another folder, folder download/zip, keyboard shortcuts (F2/Delete) and menu arrow-key navigation, drag-and-drop, sort-by inside the menu.

# Privy Cloud — Design Specification

**Date:** 2026-08-10
**Status:** Approved for v1 implementation
**Product vision:** A desktop app hosting three applications (Hermes Agent, Coding Agent, Privy Cloud) behind a browser-style tab bar, backed by a local server that owns a user-designated root directory and syncs its content. This spec covers v1 of the **Privy Cloud** application; Hermes Agent and Coding Agent are placeholder slots.

---

## 1. Overview & goals

- **Desktop app** with a top tab bar: **Hermes Agent · Coding Agent · Privy Cloud**. Boots into the Hermes Agent tab. Hermes and Coding Agent render "coming soon" placeholders in v1; the tab bar and routing are real so real views drop in later.
- **Local backend server** is the single source of truth. The user points it at an (empty) directory; it auto-creates three child directories and maintains/syncs them.
- **Privy Cloud** (built now): a chat box that sends text, images, video, slides, files, or whole directories, plus a sharing interface that displays recent items, auto-categorized, with click-to-open and inline markdown/text editing.
- **Remote access** (Cloudflare Tunnel) and **multi-user sharing** (permissioned read/write/edit) are explicitly designed-for but deferred; the architecture and permission skeleton anticipate them.
- **Personal-first, single-user** in v1.

## 2. Architecture

Three pieces, cleanly separated:

### 2.1 Node.js backend (`server/`)
- **TypeScript + Fastify + WebSocket**, runs as a standalone local process on `localhost`.
- **Source of truth** — owns the root directory, watches it, serves files, maintains the chat log, exposes a **REST + WebSocket API**.
- Target for Cloudflare Tunnel later (whole app reachable remotely). Future Hermes/coding-agent integrations plug in here.

### 2.2 Tauri desktop shell (`desktop/`)
- **Rust**, thin shell: native window + top tab bar + three tab views.
- Auto-starts the backend on launch (or connects if already running) and loads the React frontend.
- Loads the bundled frontend (served by the backend in dev; bundled assets in prod).

### 2.3 React frontend (`web/`)
- UI for all three tabs; talks to the backend over HTTP + WebSocket.
- The backend serves the same UI it exposes — one UI, two entry points (desktop window locally; browser via tunnel remotely).

### Data flow
Tauri window → loads frontend → frontend talks to backend on localhost → backend manages disk. Chat send → backend stores file in the right type folder + appends a chat-log entry → live update pushed over WebSocket → sharing interface refreshes instantly.

## 3. On-disk layout

```
<user-root>/
├── Hermes Agent/          # placeholder (v1)
├── Coding Project/        # placeholder (v1)
└── Privy Cloud/
    ├── Images/
    ├── Videos/
    ├── Slides/
    ├── Documents/
    ├── Markdown/          # text messages & chat text → timestamped .md files
    ├── Folders/           # whole directories sent via chat
    └── .privy/            # hidden app data (excluded from UI)
        ├── chat-log.jsonl # one line per send: time, type, saved path, kind
        └── permissions.json # owner entry; multi-user hooks (single-user today)
```

The backend creates this structure on first run (or when the root is changed). Existing user files are never deleted or moved; the three top-level folders are created alongside.

## 4. Backend responsibilities

1. **Directory init** — create the three top-level folders + Privy Cloud type folders. Handle non-existent roots (create them) and permission-denied roots (clear error).
2. **File watching** — recursive watch of the whole root (`chokidar`). Every disk change (create/edit/delete/rename) is pushed over WebSocket so the UI always mirrors the real disk. No separate database; disk is the single source of truth. A periodic rescan covers watcher edge cases.
3. **Send handling** — receive message + attachments → route each file into its type folder → append chat-log entry → broadcast live event. Text-only messages become a timestamped `.md` file in `Markdown/`. Stream large files to disk (no full-buffer). Directories are copied preserving structure.
4. **API** — REST + WebSocket:
   - list / categorize items
   - open file content (and serve/download files)
   - save edits
   - send text, upload file, upload directory (streamed, with progress)
   - live events (file changed, item sent, etc.)
   - Endpoints are organized so read/write/edit permissions can be attached per-user later.
5. **Permission skeleton** — `permissions.json` with a default "owner" entry. No auth enforced on localhost in v1, but every API call passes through a thin layer that will check permissions later (multi-user becomes a config change, not a rewrite).

### Kind detection
File extension → kind: **Images / Videos / Slides / Documents / Markdown / Folders / Other**. Kinds map to both the on-disk type folders and the UI filter. Hidden files (`.privy`, other dotfiles) are excluded from the UI.

## 5. UI design

### 5.1 Desktop shell
- Top tab bar: **Hermes Agent | Coding Agent | Privy Cloud** — boots into Hermes Agent.
- Hermes / Coding Agent tabs: "coming soon" placeholder pages (same design tokens as the rest).

### 5.2 Privy Cloud tab (approved layout)
- **Default view** — sharing grid on the **left**, chat panel on the **right** (~30% width).
- **Kind filter chips** above the grid: All | Images | Videos | Docs | Slides | Markdown (Folders).
- **Click any file** → the split collapses and the file opens **full-width** with a "← Back to sharing" control. Markdown/text is editable inline; images/videos/slides/PDFs render as view-only viewers.
- **Chat panel** — timeline of sends (each entry links to its stored file, or shows the text), plus the input bar: message text + attach file 📎 + attach folder 📁 + send.

### 5.3 Theme system
- **Dark + light themes** with a 🌙/☀️ toggle in the tab bar; choice persisted between launches.
- All colors come from **design tokens (CSS variables)** so every screen and both placeholder tabs follow the toggle automatically.
- Single teal accent, adapted per theme: dark `#2dd4bf`, light `#0d9488` (contrast). Dark palette: bg `#0c0e12`, panel `#11141a`, border `#242a36`, text `#e8ebf2`. Light palette: bg `#f6f7f9`, panel `#ffffff`, border `#e3e6ec`, text `#1d2433`.

## 6. Data model

- **Chat log** — `chat-log.jsonl`, append-only, one JSON object per line:
  ```json
  { "ts": "2026-08-09T14:02:00Z", "kind": "Markdown", "type": "file"|"text"|"folder",
    "path": "Privy Cloud/Markdown/meeting-notes.md", "name": "meeting-notes.md", "sender": "owner" }
  ```
  Provides the hybrid behavior: type folders on disk + a timeline of every send linking to its stored file.
- **Permissions** — `permissions.json`: `{ "owner": "<user>", "entries": [] }`. Single-user today; entries hold per-user read/write/edit grants in the future.

## 7. Error handling & edge cases

- **Root directory**: non-existent path → created; existing files untouched; permission-denied → clear error; changing root later → re-init (documented limitation: v1 supports one active root).
- **Name collisions**: duplicate send of `report.pdf` → `report-<timestamp>.pdf`; nothing overwritten.
- **Large sends**: streamed to disk with upload progress; no memory blow-up for multi-GB files.
- **Disk is the truth**: external add/edit/delete on disk reflected live via the watcher (+ periodic rescan).
- **Concurrent edits**: two clients editing the same `.md` → **last-write-wins** with a "file changed on disk" notice. True conflict resolution deferred.
- **Connection**: backend down → shell shows reconnect/retry; WebSocket auto-reconnects with backoff.
- **Safety**: path-traversal rejection on all API paths; filename sanitization; `.privy/` hidden from UI.

## 8. Testing

- **Backend unit**: directory init, kind detection, chat-log append/read, filename sanitization, path-traversal rejection.
- **Backend integration**: REST (send text / upload file / upload directory / list / open / save) + WebSocket event flow; file watcher → event assertions.
- **Frontend**: sharing grid, chat panel, markdown editor, theme toggle, kind filters.
- No full E2E in v1 (covered by backend + frontend tests).

## 9. v1 scope & deferred items

### v1 (built now)
- Local backend (TypeScript/Fastify + WebSocket): root-dir management, file watching, chat log, REST + WS API, permission skeleton.
- Tauri desktop shell: 3-tab bar; Hermes + Coding Agent placeholder pages.
- Privy Cloud tab: chat send (text/files/dirs), type folders, chat-log history, sharing grid + kind filters, full-width markdown/text editor, view-only image/video/pdf/slide viewers, dark/light toggle.
- Localhost only — no auth, no tunnel.

### Deferred (designed for, built later)
- Cloudflare Tunnel + authentication.
- Multi-user sharing (per-user read/write/edit) — permission layer already in place.
- Hermes Agent integration (native Hermes process → backend → UI).
- Coding Agent integration (Claude Code / Codex / Opencode: select agent, open in a directory, view task progress remotely).
- Richer editors (slides, docs, spreadsheets, images).

## 10. Integration points (future)

- **Hermes**: backend connects to the local Hermes process and exposes its interaction through the API; the Hermes tab swaps its placeholder for a real view.
- **Coding agents**: backend discovers installed CLIs (claude/codex/opencode), spawns them per-project-directory, and streams task progress over WebSocket.
- **Remote access**: Cloudflare Tunnel proxies to the backend; auth enforced at the API layer.
- **Multi-user**: permission checks enforced in the existing API layer; no architecture change required.

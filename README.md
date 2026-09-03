# Privy Cloud

A self-hosted personal cloud: a **file manager**, an **agent workspace**, and a
**desktop shell** — backed by a local server that owns a root directory and keeps
everything in sync as you edit files on disk.

Three tabs:

- **Privy Cloud** — browse and manage files under a root directory (default
  `~/PrivyCloud`). Auto-categorizes into `Images / Videos / Slides / Documents /
  Markdown / Folders / Other`. Grid or list view, sort, kind filters, create /
  rename / move / trash, drag-and-drop, and per-kind viewers and editors.
- **Hermes Agent** — chat with a local Hermes agent: message process view,
  streaming, session history, file/image attachments, approval & clarify dialogs,
  and a model/effort picker.
- **Coding Agent** — coding-agent workspace.

## What works

- Inline editing & preview: office documents (OnlyOffice Document Server),
  code with syntax highlighting, text, markdown, CSV, images, audio, and video.
- Dark/light theme, phone-responsive layout with a usable editor top bar,
  quick-access bookmarks, live file watching (changes on disk appear immediately).
- Frameless desktop window (Tauri 2) with single-instance launch; the shell
  starts the backend on `:5178` when none is already running.

## Prerequisites

- Node ≥ 22, Rust ≥ 1.77
- Linux (Fedora): `sudo dnf install webkit2gtk4.1-devel gtk3-devel`
- (Optional) a reachable OnlyOffice Document Server for office editing. On the
  free Community edition the desktop editor is fully editable; the mobile web
  editor is view-only.

## Run

```bash
npm install
npm run build          # shared → server → web (needed once)
npm run app            # Tauri desktop window (auto-starts backend on :5178)
# or, backend + web only:
npm run dev            # backend :5178, web dev server :5173
```

Build a production desktop bundle (deb + rpm — AppImage needs a working
linuxdeploy):

```bash
npm run tauri -w desktop build -- --bundles deb rpm
```

## Configuration

- **Root directory**: `PRIVY_ROOT`, or the config file `~/.privy-cloud/config.json`
  (default `~/PrivyCloud`, created on first run).
- **Backend host/port**: `PRIVY_HOST` / `PRIVY_PORT` (default `127.0.0.1:5178`).
- **Office engine**: `OFFICE_ENGINE_URL` (e.g. `https://doc.example.com`).
- Access to the web UI is gated by a configurable access token.

## Workspaces

| Package | What it is |
|---|---|
| `shared` | Types/helpers shared by server & web |
| `server` | Fastify backend: file API, auth, sync, office sessions, Hermes gateway |
| `web` | React + Vite frontend |
| `desktop` | Tauri 2 shell embedding `web/dist` |

## Tests

```bash
npm test               # server suite, then web suite (vitest, run from web/)
```

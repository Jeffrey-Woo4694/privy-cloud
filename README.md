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

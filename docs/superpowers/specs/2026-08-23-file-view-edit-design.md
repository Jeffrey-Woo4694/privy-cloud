# File View & Edit Across Common File Types — Design

> **Status:** Proposed (architectural path — spec for approval before implementation)
> **Date:** 2026-08-23
> **Scope:** Viewing *and editing* the file types people actually open in work/life — Office documents in full Microsoft-like fidelity, plus text/code, structured data, media, PDF, and archives — as a unified in-app experience.

---

## 1. Goal

Turn Privy Cloud's file viewer from "download-only for most types" into a real viewer/editor for the everyday file types. Centerpiece: **edit `.docx/.xlsx/.pptx` (and ODF variants) the way you would in Microsoft Office**, via a self-hosted document engine. Around it, give every other common type its *normal* tool — not a one-size-fits-all preview.

## 2. What "all normal file styles" means — tiered promise

We do **not** pretend to edit photos or videos in-app (that is a different class of tool). We do deliver the honest normal action for each type:

| Category | Representative types | In-app behavior |
|---|---|---|
| **Office documents** | doc, docx, odt, rtf, xls, xlsx, ods, ppt, pptx, odp | **Full edit** (Microsoft-like) via self-hosted engine |
| **Keynote / non-engine** | key ("Slides" kind today) | Download fallback — OnlyOffice cannot open `.key` |
| **Text / code** | txt, md, markdown, log, html, css, js, ts, jsx, tsx, py, sh, sql, yaml, yml, ini, toml, ... | **Edit as text** (native textarea). Markdown keeps its existing preview+edit editor. |
| **Structured data** | csv, json, xml | **Read view** (table / pretty-print) **and** edit as text (toggle) |
| **Markdown** | md, markdown | Existing `MarkdownEditor` (preview + edit) |
| **Images** | png, jpg, jpeg, gif, webp, bmp, svg, heic | Existing proxy viewer (HEIC->JPEG transcoded) — **view only** |
| **Video** | mp4, webm, mov, mkv, avi | Existing proxy viewer (HEVC->H.264) — **view only** |
| **Audio** (new kind) | mp3, wav, flac, ogg, aac, m4a | **Play** via native `<audio>` — **view only** |
| **PDF** | pdf | Existing in-frame viewer — **view only** |
| **Archives** (new kind) | zip, tar, tar.gz, gz | **View metadata + download** (extract happens in the OS — the normal place for it) |
| **Unknown / other** | anything else | Existing "download" fallback |

The tier boundary is deliberate: full *edit* is gated to formats with a format-aware editor (Office engine) or plain UTF-8 text (safe to edit as text). Everything is *viewable*.

## 3. Architecture overview

```
Browser (Privy Cloud web)
   │  opens file → frontend asks backend: what editor for this file?
   ▼
Backend  ──decides──▶  editorFor(rel) →  "office" | "text" | "structured" | "markdown"
   │                                |  "image" | "video" | "audio" | "pdf" | "archive" | "none"
   │
   ├─ office path:
   │    1. backend mints short-lived ONE-USE HMAC token for (rel path)
   │    2. backend returns editor config (engine URL + token + callbackUrl)
   │    3. browser loads engine page from PUBLIC tunnel host
   │    4. engine (container) fetches file bytes from backend over HOST-LOCAL bridge
   │    5. user edits in engine
   │    6. on Save, engine POSTs callback to backend over HOST-LOCAL bridge
   │        backend downloads the edited file, atomic-replaces the vault file,
   │        keeps a backup, emits items:changed
   │
   └─ other paths: frontend renders the native viewer/editor directly
        (text/structured/markdown/image/video/audio/pdf/archive)
```

**The load-bearing property:** the vault file bytes (initial + saved) travel **host-local** between the backend and the engine container. The public tunnel only carries the engine's editor UI + edit WebSocket — never the file content. This is what makes a self-hosted engine acceptable for a privacy-first file vault.

## 4. The document engine: OnlyOffice Document Server (recommended)

**Recommendation: OnlyOffice Document Server (Community, AGPL)**, integrated via its **classic Integrations API** (embed `api.js`, config with `document.url`, `callbackUrl`, `token`).

Why this over the alternatives:
- **Fidelity:** polished Microsoft-like editing for word/cell/slide; handles docx/xlsx/pptx and ODF/RTF.
- **Integration path:** the classic API is the most documented, battle-tested route — far more reliable than the WOPI storage plugin in community builds. (I earlier floated WOPI; on the actual code this is the better call. The provider seam hides which from callers.)
- **Single container, turnkey image, well-understood ops.**

**Collabora / CODE (MPL, LibreOffice-based)** is the documented alternative behind the same seam — interchangeable if licensing or AnyOffice behavior pushes us off OnlyOffice. The app never depends on which engine it is: the frontend consumes a `DocEditor` component and the backend's `office` provider; neither reveals engine identity.

> **Licensing note:** OnlyOffice Community is AGPL. For a personal/local single-user vault this is acceptable, but it is a real consideration — recorded here so the swap-to-Collabora path is intentional if this ever becomes a distributed product.

## 5. Deployment (the risky part, isolated as its own phase)

- **Rootless podman quadlet** systemd unit `privy-document-engine.service` — auto-starts, survives reboot, same pattern as the existing `privy-cloud.service`. No docker.
- **Port (8080) published to host loopback only** (`127.0.0.1:8080`) — reachable by `cloudflared` (also on the host) and by the backend's save-fetch. Never bound to a public interface.
- **Dedicated tunnel hostname** (e.g. `doc.<tunnel-domain>`) routed by **cloudflared** → `127.0.0.1:8080`. A dedicated hostname beats a path prefix for WebSocket/edge reliability.
- **Host-local bridge:** the backend tells the engine to fetch the file and POST the callback at `http://host.containers.internal:<backendPort>/api/office/...`, so both directions stay on the host network. The backend reaches the engine's save-download URL at `http://127.0.0.1:8080/...`.
- **Config via environment:** the backend reads `OFFICE_ENGINE_URL` (the public hostname) and `OFFICE_ENGINE_SECRET` (shared JWT secret). If `OFFICE_ENGINE_URL` is unset, the engine is treated as **unconfigured** and Office files fall back to download.

## 6. Security model

- **Short-lived, one-use HMAC token** minted per open/edit session, bound to `path + kind + ttl + nonce`. It is the auth boundary for *both* `GET /api/office/file` (stream bytes → engine) and `POST /api/office/callback` (accept save). No long-lived credential ever reaches the browser.
- **Known-text-only editing:** `PUT /api/file` is gated to an explicit `TEXT_EXTENSIONS` allowlist. A user cannot save an arbitrary binary as text and corrupt it. All other edits go through the format-aware engine or are view-only.
- **File bytes stay host-local** (see §3). The public tunnel sees only the editor UI/WS.
- **Server-side safety** (inherits existing vault rules): every `privyResolve`/`resolveSafe` call guards against path escape; `.privy` is never a target; errors never echo absolute server paths (existing convention).

## 7. Token handshake (office path)

1. Frontend calls `GET /api/office/session?path=<rel>`.
2. Backend validates `path` (safe resolve), confirms it is an Office-editable extension, checks the per-file edit lock (409 if already being edited), then mints `{ token, expiresAt, fileUrl, callbackUrl, engineUrl }`:
   - `fileUrl` = `http://host.containers.internal:<port>/api/office/file?token=<token>` (engine-side fetch)
   - `callbackUrl` = `http://host.containers.internal:<port>/api/office/callback?token=<token>` (engine-side save POST)
   - `engineUrl` = the public `OFFICE_ENGINE_URL` the browser loads
3. Backend registers the session in an in-memory store (token → { relPath, kind, expiresAt, locked }).
4. Frontend renders `DocEditor` → loads `engineUrl` and passes the config.

## 8. Save-back lifecycle (reliability-critical)

- Engine POSTs `{ status: 2, url: <temp download>, ... }` to `callbackUrl` with the token.
- Backend validates the token/session, then **downloads** the file from `<temp>` and **atomic-replaces** the vault file (write temp → `rename`), never leaving a partial file.
- **Backup per save:** copies the prior content to `.privy/backups/<rel>/<timestamp>` (pruned after N days). One bad save is recoverable.
- **Conflict handling:** single-user model, so the real risk is the file being renamed/moved/trashed while an editor is open. On save, the backend re-resolves the *current* path: if it moved, it writes to the intended new location (following the vault's canonical record) or returns a specific error the engine surfaces as "Save failed" rather than silently writing to a stale path.
- **Edit lock:** an in-memory `Set<String>` of locked rel paths; a second session on the same file gets 409 "already editing." Prevents double-save races.
- **Graceful degradation:** if the engine is unreachable, `GET /api/office/session` returns `{ enabled: false }`; the frontend falls back to the existing "download" branch — the vault is never blocked by the engine being down.

## 9. Frontend kind→editor router

Introduce a single `editorFor(rel)` mapper (in the web app) that returns `{ mode, ... }`; the router lives in the web, while a corresponding server-side allowlist lives in `kinds.ts`/routes. Mode drives the component:

- `office` → `DocEditor` (new), which handles the engine config + load. Fallback to `none` when `enabled:false`. **Office-editable extension set (exactly what the engine natively opens, not every office-looking extension):** `doc, docx, odt, rtf, xls, xlsx, ods, ppt, pptx, odp`. **Exclusions routed elsewhere:** `key` (Keynote — OnlyOffice cannot open it → `none`/download), `csv`/`json`/`xml`/`txt`/`md` (lightweight), `pdf` (iframe).
- `text` → a `TextFieldEditor` (native textarea, save via `PUT /api/file`), monospace.
- `structured` → `StructuredViewer` (native: JSON via `JSON.parse`, XML via `DOMParser`, CSV via a tiny parser) with an "Edit as text" toggle to the text editor.
- `markdown` → existing `MarkdownEditor`.
- `image` / `video` → existing proxy viewer.
- `audio` → native `<audio controls autoplay>` streaming from `/api/file`.
- `pdf` → existing `iframe` viewer.
- `archive` → `ArchiveInfo` (filename, size, entry count when cheaply available) + Download button.
- `none` → existing "Inline preview for this type isn't ready yet — download."

## 10. Kinds and folder routing

Extend `@privy/shared` KINDS with two new kinds and their storage folders (in `directory.js` `folderFor`):
- `audio` → stores under `Audio/` (ex. mp3, wav, flac, ogg, aac, m4a)
- `archive` → stores under `Archives/` (ex. zip, tar, gz, tgz)

Other types keep current kinds/folders (document → Documents, slide → Slides, markdown → Markdown, image → Images, video → Videos). Adding kinds is additive — existing files and `detectKind` behavior are unchanged apart from extension→kind mapping.

## 11. Backend changes (summary)

- **New module `server/src/office.ts`** — provider seam: `createSession(rel)`, `streamForSession(token)`, `acceptCallback(body, token)`, `isConfigured()`. All engine specifics are sealed here.
- **New routes** in `server/src/api/routes.ts`:
  - `GET /api/office/session?path=` → `{ enabled, token?, fileUrl?, callbackUrl?, engineUrl?, expiresAt? }`
  - `GET /api/office/file?token=` → stream vault bytes (validated session)
  - `POST /api/office/callback?token=` → accept save, atomic replace, backup, emit `items:changed`
- **Modify `PUT /api/file`** → relax the `kind !== 'markdown'` gate to a `TEXT_EXTENSIONS` allowlist (safe text-only editing). Move the gate to extension-based, not kind-based. **`TEXT_EXTENSIONS` (verbatim):** `md, markdown, txt, log, csv, json, xml, yaml, yml, html, css, js, jsx, ts, tsx, py, sh, sql, ini, toml, conf, env, gitignore, jsonl`. Only these may be saved as text; any other extension via `PUT /api/file` → 400.
- **Modify `GET /api/file`** MIME additions (audio, archive) so raw streaming serves correct content type.
- **Modify `kinds.ts`** → add `audio`/`archive` extension mappings.
- **Env/config** → read `OFFICE_ENGINE_URL` / `OFFICE_ENGINE_SECRET`; expose engine `enabled` in `/api/meta` (or a dedicated status endpoint).
- **Backups** → a small `.privy/backups/` writer + pruner (reuse existing storage helpers).

## 12. Frontend changes (summary)

- Refactor `FileViewer.tsx` to dispatch via `editorFor(rel)` instead of the current kind-branch (kind-branch still routes upload-folders).
- New `DocEditor.tsx`, `TextFieldEditor.tsx`, `StructuredViewer.tsx`, `AudioPlayer.tsx`, `ArchiveInfo.tsx`.
- Generalize `MarkdownEditor`'s save wiring or share a `saveText(rel, content)` helper.
- Query engine `enabled` once (via fetch/cache) so Office files render the editor when available and the download fallback otherwise.

## 13. Reliability & usability measures (the bar)

- **Never corrupt on save:** atomic write (temp + rename); backup per save; edit lock.
- **Graceful degradation:** engine down/absent → Office files do not error; they fall back to download. Engine status is discovered, not assumed.
- **No new JS runtime dependencies.** All client rendering uses native browser capabilities (`JSON.parse`, `DOMParser`, `<audio>`, `<video>`, `iframe`, textarea). The only new dependency is the optional, OS-level engine container, which is additive and switchable.
- **Bounded, testable I/O:** the engine speaks to the backend only through two token-scoped endpoints; those are independently testable with a stub engine.
- **Recoverability:** per-save backups under a pruned `.privy/backups/`.

## 14. Testing strategy

- **Backend:** unit tests for `office.ts` (token mint/validate/expiry, session lock, atomic-save + backup, `TEXT_EXTENSIONS` gate, safe path rejection). Route tests for `GET /api/office/session`, `GET /api/office/file`, `POST /api/office/callback`, modified `PUT /api/file`.
- **Frontend:** Vitest for `editorFor(rel)` mapping (each extension → correct mode), `StructuredViewer` rendering for sample JSON/XML/CSV, `TextFieldEditor` save.
- **Integration:** a "stub engine" test double — a tiny fake HTTP server that plays OnlyOffice's file-fetch + callback-save contract against the real backend, proving the provider seam works end-to-end without a real container.
- **Manual (deployment phase):** real engine container + tunnel — open a real `.docx`/`.xlsx`/`.pptx`, edit, save, reload, confirm the vault file is updated and a backup exists.

## 15. Phasing (the seam is the point)

The feature is split so the **app code is complete and testable independently of the engine**, and the dev-engine deployment is a separable, confirmed phase:

- **Phase A (app code):** kinds/folders, `editorFor` router, all native viewers/editors (text/structured/audio/archive/pdf/markdown/image/video), generalized `PUT /api/file`, `office.ts` provider seam + token/stream/callback endpoints, edit lock, backups, graceful `enabled` discovery, **stub-engine integration test**. Ships without a real container and is fully usable today (Office = download fallback).
- **Phase B (execution/deployment):** podman quadlet, `OFFICE_ENGINE_URL`/secret config, cloudflared dedicated hostname, real-engine end-to-end verification. **This phase touches host systemd + cloudflared config — confirmed with the user before execution.**

## 16. Decisions recorded / open items

- **Engine:** OnlyOffice (classic API) primary, Collabora documented-alternative behind the seam. (Ruling: fidelity + integration reliability; WOPI deferred as not needed for single-user.)
- **Token auth:** one-use HMAC per session as the auth boundary; OnlyOffice JWT optional addition. (Ruling: keep the security boundary in our code, not the engine's.)
- **Archives:** in-app view is metadata + download; extraction stays in the OS. (Ruling: avoids a fragile JS-unzip dep and matches user expectation.)
- **Audio:** added as an official kind/folder (`Audio/`).
- **Image/video editing:** out of scope for this feature (that's a different tool class); viewing retained and improved.
- **AGPL licensing:** accepted for a personal vault; swap-to-Collabora documented.

# File View & Edit — Phase B: OnlyOffice Deployment Plan

> **Status:** Proposed — for user confirmation before execution (this phase touches
> host systemd, podman, and the cloudflared tunnel).
> **Date:** 2026-08-24

**Goal:** Stand up the self-hosted OnlyOffice Document Server and wire it to the
already-shipped Phase A office seam, so `.docx/.xlsx/.pptx` (and ODF/RTF) edit
in-app with full fidelity.

**Architecture:** A rootless podman **quadlet** unit `privy-document-engine`
(runs the OnlyOffice container as a user systemd service, same pattern as the
existing `privy-cloud.service`), published to **host loopback only**
(`127.0.0.1:8080`), reachable by a **dedicated cloudflared hostname**
`doc.jeffreywoo.ggff.net`. The backend is told the engine's public URL via
`OFFICE_ENGINE_URL`; file bytes move host-local between backend and container via
the already-wired `host.containers.internal:5178` bridge.

**Tech stack:** podman 5.8 (rootless quadlet), systemd user units, cloudflared
named tunnel, OnlyOffice Document Server Community (AGPL).

**Spec:** `docs/superpowers/specs/2026-08-23-file-view-edit-design.md` (esp. §4, §5, §16).

---

## Global constraints (binding, carried from Phase A)

- No new JS runtime dependencies; the engine is an OS-level container, not an npm dep.
- `.privy` is never a client target; the office seam is gated by the one-use HMAC
  session token (not the bearer token), and `.privy` is now explicitly blocked in
  `createSession` (Phase A fix).
- File bytes stay host-local between backend and engine; the public tunnel carries
  editor UI + WebSocket only.
- Errors never echo absolute server paths.
- Engine unconfigured (`OFFICE_ENGINE_URL` unset) → Office files fall back to
  "Download original" — no broken editor.

## Verified preconditions (checked against this host on 2026-08-24)

- [x] podman 5.8.4 installed; `podman-user-generator` present (rootless quadlets work).
- [x] Logind **linger** enabled for `jeffrey` (services autostart without a login).
- [x] cloudflared named tunnel active; ingress routes `privy.jeffreywoo.ggff.net` → `localhost:5178`.
- [x] Backend already reads `OFFICE_ENGINE_URL` (index.ts:84) and auto-provisions
      `officeSecret` in `~/.privy-cloud/config.json` (config.ts:54-60).
- [ ] RAM: 15 GB total, ~6.8 GB available — OnlyOffice wants ~4 GB. Workable; a memory
      cap is set below to keep the host healthy.

---

## Task 1 — tiny web reconciliation: stop passing the misfit `token` to OnlyOffice

OnlyOffice's `editorConfig.token` is a *JWT config-secret* field, not our HMAC. We
choose to keep the engine's JWT **OFF** (the app's HMAC is the real boundary), so the
field is meaningless today and would be misinterpreted if JWT is later enabled. Drop it.

**Files:** `web/src/components/DocEditor.tsx`

- Remove the line `token: session.token,` from the `new window.DocsAPI.DocEditor(...)`
  config object.
- Remove `token?:` from the local `Session` interface (the only use of that field was
  the removed line).
- The backend's `OfficeSessionInfo.token` field is **kept** — it is still used
  server-side to build `fileUrl`/`callbackUrl` (`office.ts`). No backend change.

**Verify:** `cd web && npx tsc --noEmit && npx vitest run src/__tests__/DocEditor.test.tsx`
(1 test still passes). Commit: `chore(privy): drop misfit OnlyOffice editorConfig.token`.

> Cosmetic, not required for correctness (with JWT off the field was ignored). Included
> so the code doesn't appear to be doing JWT.

## Task 2 — deploy OnlyOffice as a rootless podman quadlet

**Step 2.1 — resolve and pin the current stable image tag** (don't trust `latest` for a
reliable deployment):

```bash
podman search --format '{{.Name}} {{.Tag}}' onlyoffice/documentserver
# or check Docker Hub for the newest community tag; pin it below (e.g. 8.3.1).
```

**Step 2.2 — create the quadlet** at `~/.config/containers/systemd/privy-document-engine.container`:

```ini
[Unit]
Description=OnlyOffice Document Server (self-hosted doc engine)
Wants=network-online.target
After=network-online.target

[Container]
Image=docker.io/onlyoffice/documentserver:<PINNED_TAG>
PublishPort=127.0.0.1:8080:80
Volume=%h/.privy-cloud/onlyoffice/data:/var/www/onlyoffice/Data:Z
Volume=%h/.privy-cloud/onlyoffice/logs:/var/log/onlyoffice:Z
PodmanArgs=--shm-size=1g

[Service]
Restart=on-failure
RestartSec=10
MemoryMax=6G

[Install]
WantedBy=default.target
```

- `PublishPort=127.0.0.1:8080:80` → loopback-only, per spec §5 (never a public bind).
- `:Z` on Volume mounts applies SELinux relabeling (Fedora enforces SELinux) — required.
- `--shm-size=1g` for the embedded Postgres/MQ; `MemoryMax=6G` caps it so it can't
  starve the host (15 GB total, ~6.8 GB free today).
- Pinning `<PINNED_TAG>` (not `latest`) is deliberate — "reliable and useable" means a
  reproducible image, no surprise major upgrades.

**Step 2.3 — start it:**

```bash
systemctl --user daemon-reload
systemctl --user enable --now privy-document-engine.service
```

**Step 2.4 — readiness** (the Document Server boots slowly — allow up to a few minutes):

```bash
# poll until "true"
curl -fsS http://127.0.0.1:8080/healthcheck
systemctl --user --no-pager --full status privy-document-engine.service
```

## Task 3 — cloudflared ingress for the editor hostname

**Step 3.1** — add an ingress rule to `~/.cloudflared/config.yml` (between the existing
`privy.` rule and the `404` fallback):

```yaml
ingress:
  - hostname: privy.jeffreywoo.ggff.net
    service: http://localhost:5178
  - hostname: doc.jeffreywoo.ggff.net
    service: http://127.0.0.1:8080
  - service: http_status:404
```

**Step 3.2** — ensure DNS routes `doc.jeffreywoo.ggff.net` to the tunnel. If
`*.jeffreywoo.ggff.net` is already CNAME'd to the tunnel, this is automatic; otherwise:

```bash
cloudflared tunnel route dns <TUNNEL_ID> doc.jeffreywoo.ggff.net
```

**Step 3.3** — reload the tunnel:

```bash
systemctl --user restart cloudflared.service
curl -fsS https://doc.jeffreywoo.ggff.net/healthcheck   # expect "true"
```

## Task 4 — point the backend at the engine

**Step 4.1** — add the env var to `~/.config/systemd/user/privy-cloud.service`
(under `[Service]`, beside the existing `Environment=` lines):

```ini
Environment=OFFICE_ENGINE_URL=https://doc.jeffreywoo.ggff.net
```

**Step 4.2** — reload + restart the backend:

```bash
systemctl --user daemon-reload
systemctl --user restart privy-cloud.service
```

The `officeSecret` is auto-provisioned into `~/.privy-cloud/config.json` on next start
(config.ts `getOfficeSecret`). No manual secret step.

## Task 5 — end-to-end verification (the real gate)

Open the app (desktop or `https://privy.jeffreywoo.ggff.net`), then:

1. Open an existing `.docx` (or upload one). Confirm the OnlyOffice editor loads
   **in place of** the "Download original" fallback.
2. Edit text, wait for the autosave/save, then **reload the file**. Confirm the vault
   file reflects the edit (and a backup appears under `.privy/backups/Documents/…`).
3. Repeat for one `.xlsx` and one `.pptx`.
4. **Save-path host-locality check** (spec §3): inspect the callback `url` the engine
   sends (via `journalctl --user -u privy-cloud.service` or a temporary log line in the
   office callback). It must be host-local (`host.containers.internal`/loopback), not
   the public `doc.…` hostname.
   - If it comes back as `https://doc.jeffreywoo.ggff.net/cache/…`, pin OnlyOffice's
     internal storage URL to host-local by mounting a `local.json` override
     (`files.docservice.url.internal = http://host.containers.internal:8080`), then
     restart the engine and re-verify. *(The exact `local.json` key is confirmed against
     the running image's default `local.json` during this step — it is the one item this
     plan deliberately leaves to the live engine to settle.)*
5. **Graceful-degradation check:** `systemctl --user stop privy-document-engine.service`,
   open an Office file → it must fall back to "Download original" (no error). Restart the
   engine afterward.

## Task 6 (optional) — carry-over minors from Phase A

- `AudioPlayer` omit `autoPlay` (spec §9 said `autoplay`; browsers block sound autoplay —
  either add `autoPlay`+`muted` or leave and document the omission).
- `streamFile` MIME map duplicates the routes MIME table — DRY (single source).

Both non-blocking; fold into a later cleanup if desired.

---

## Rollback

Everything is additive and reversible without touching the vault:

- `systemctl --user disable --now privy-document-engine.service` and delete the quadlet file → engine gone.
- Remove the `doc.…` ingress rule + the `OFFICE_ENGINE_URL` env → backend returns to
  "unconfigured" and Office files fall back to download (Phase A behavior).
- Vault files are never migrated or touched by these steps.

## Risks / open items

- **Resource:** OnlyOffice is RAM-heavy (~4 GB). With 6.8 GB currently free the cap
  (`MemoryMax=6G`) + swap should keep it healthy, but a 16 GB host running it alongside
  the Hermes gateway may feel tight if Hermes is also busy. Monitor with
  `systemd-cgtop` / `journalctl` after deploy.
- **AGPL license:** recorded in the spec (§4); fine for a personal self-hosted vault.
- **The `local.json` internal-URL key** is confirmed live during Task 5 (not guessed here).
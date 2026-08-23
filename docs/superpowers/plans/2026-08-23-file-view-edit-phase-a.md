# Phase A: File View & Edit — App Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the app-code half of "view and edit all common file types" — kinds, the kind/editor router, native viewers/editors (text, structured, audio, archive, markdown, pdf, image, video), the self-hosted-office engine **provider seam + token-scoped endpoints + backups + edit lock**, and a stub-engine integration test. Fully usable today; Office files gracefully fall back to download until Phase B adds the real engine container.

**Architecture:** Extend `Kind` with `audio`/`archive`. Introduce a server `fileModes` module (office-editable set + text allowlist), an `OfficeProvider` (HMAC one-use sessions, per-file edit lock, host-local file stream, callback save with atomic write + backup), three office routes (session/file/callback, the latter two exempt from the user bearer-token auth and gated by their own HMAC), and a generalized text-edit gate. On the web, a pure `editorFor(rel)` mapper dispatches `FileViewer` to a per-mode component; the engine seam is consumed by a `DocEditor` that degrades to download when the engine is unconfigured. No new JS runtime dependencies.

**Tech Stack:** Fastify (ESM TS), React 18 + Vite + Vitest, `node:crypto` HMAC, native browser `<audio>`/`<video>`/iframe/`JSON.parse`/`DOMParser`. Node 22 (global `fetch`). podman/cloudflared are Phase B only.

**Spec:** `docs/superpowers/specs/2026-08-23-file-view-edit-design.md`

## Global Constraints

- **No new JS runtime dependencies.** All client rendering uses native browser capabilities.
- **Never echo absolute server paths in API errors.** Keep the existing "log server-side, stay generic" convention.
- **Path safety:** every rel path passes through `privyResolve`/`resolveSafe` before hitting the filesystem; `.privy` is never a client target.
- **Auth boundary for the engine bridge is our one-use HMAC**, not the user bearer token. The two engine-facing endpoints are exempt from the global bearer hook.
- **Office-editable extension set (only what the engine natively opens, verbatim):** `doc, docx, odt, rtf, xls, xlsx, ods, ppt, pptx, odp`. Exclusions: `key` (download), `csv/json/xml/txt/md` (lightweight), `pdf` (iframe).
- **`TEXT_EXTENSIONS` (only these may be saved via `PUT /api/file`, verbatim):** `md, markdown, txt, log, csv, json, xml, yaml, yml, html, css, js, jsx, ts, tsx, py, sh, sql, ini, toml, conf, env, gitignore, jsonl`.
- **Audio extensions (new `audio` kind):** `mp3, wav, flac, ogg, aac, m4a` → folder `Audio/`. **Archive extensions (new `archive` kind):** `zip, tar, gz, tgz` → folder `Archives/`.
- **Theme:** reuse existing CSS variables (`--muted`, etc.) and `.btn`/`.back-link` classes; no new palette.

## File Structure (Phase A)

**Shared**
- `shared/src/index.ts` — `Kind` union + `KINDS` entries for `audio`/`archive`.

**Server**
- `server/src/fileModes.ts` (new) — `OFFICE_EDITABLE_EXT`, `TEXT_EXTENSIONS`, `isOfficeEditable`, `isTextEditable`, `officeFileType`.
- `server/src/config.ts` — add `getOfficeSecret()` (persist a stable HMAC secret in `~/.privy-cloud/config.json`).
- `server/src/backups.ts` (new) — `writeBackup(root, rel, data)`, `pruneBackups(root, rel)`.
- `server/src/office.ts` (new) — `OfficeProvider` class (HMAC sessions, lock, stream validation, callback save).
- `server/src/index.ts` — construct `OfficeProvider`, expose `ctx.office`, exempt the two engine routes from the bearer hook, add `officeSecret`/`officeEngineUrl` opts.
- `server/src/api/routes.ts` — `GET /api/office/session`, `GET /api/office/file`, `POST /api/office/callback`; generalize `PUT /api/file`; extend `MIME`.

**Web**
- `web/src/fileEditor.ts` (new) — `editorFor(name)` → mode, plus the editor-mode sets.
- `web/src/components/{TextFileEditor,StructuredViewer,AudioPlayer,ArchiveInfo}.tsx` (new).
- `web/src/components/DocEditor.tsx` (new) — engine seam consumer, download fallback when disabled.
- `web/src/components/FileViewer.tsx` (modify) — dispatch via `editorFor`/kind.
- `web/src/api.ts` (modify) — add `officeSession`.

**Tests**
- `server/test/fileModes.test.ts` (new), `server/test/office.test.ts` (new), `server/test/office-integration.test.ts` (new).
- `server/test/api.test.ts` (modify), `server/test/config.test.ts` (modify).
- `web/src/__tests__/fileEditor.test.ts` (new), plus `{TextFileEditor,StructuredViewer,AudioPlayer,ArchiveInfo,DocEditor}.test.tsx` (new), `FileViewer.test.tsx` (modify).

---

### Task 1: Add `audio` + `archive` kinds

**Files:**
- Modify: `shared/src/index.ts`
- Test: `server/test/api.test.ts` (extend), plus a new `server/test/kinds.test.ts` if you prefer a dedicated file — mirror existing `detectKind` coverage.

**Interfaces:**
- Produces: `Kind` now includes `'audio' | 'archive'`; `KINDS` gains `audio` (folder `Audio`) and `archive` (folder `Archives`). `detectKind('x.mp3', false)` → `'audio'`; `detectKind('x.zip', false)` → `'archive'`; `folderFor('audio')` → `'Audio'`; `folderFor('archive')` → `'Archives'`.

- [ ] **Step 1: Extend the `Kind` union**

In `shared/src/index.ts` line 1, change:

```ts
export type Kind = 'image' | 'video' | 'slide' | 'document' | 'markdown' | 'folder' | 'other';
```

to:

```ts
export type Kind = 'image' | 'video' | 'slide' | 'document' | 'markdown' | 'audio' | 'archive' | 'folder' | 'other';
```

- [ ] **Step 2: Add the two `KINDS` entries**

Append after the `document` entry (before `markdown`), using the existing shape:

```ts
  { key: 'audio',    label: 'Audio',     icon: '🎧', folder: 'Audio',     extensions: ['mp3','wav','flac','ogg','aac','m4a'] },
  { key: 'archive',  label: 'Archives',  icon: '🗜️', folder: 'Archives',  extensions: ['zip','tar','gz','tgz'] },
```

- [ ] **Step 3: Write the failing test**

In `server/test/storage.test.ts` (or a new `server/test/kinds.test.ts`), add:

Create `server/test/kinds.test.ts` with a top-level import (no top-level `await`):

```ts
import { describe, expect, it } from 'vitest';
import { detectKind } from '../src/kinds.js';

describe('kinds', () => {
  it('detectKind maps audio and archive extensions', () => {
    expect(detectKind('song.mp3', false)).toBe('audio');
    expect(detectKind('archive.zip', false)).toBe('archive');
    expect(detectKind('tape.tar', false)).toBe('archive');
    expect(detectKind('backup.tgz', false)).toBe('archive');
  });
});
```

- [ ] **Step 4: Run it to verify it fails (old KINDS lack these)**

Run: `npm test --workspace server` (or `npx vitest run test/kinds.test.ts` from `server/`).
Expected: FAIL — `undefined`/`'other'` for audio/archive.

- [ ] **Step 5: Commit**

```bash
git add shared/src/index.ts server/test/kinds.test.ts
git commit -m "feat(privy): add audio and archive kinds"
```

---

### Task 2: Server `fileModes` + generalized text-edit gate + MIME

**Files:**
- Create: `server/src/fileModes.ts`
- Modify: `server/src/api/routes.ts` (the `MIME` map at lines 33-42, and `PUT /api/file` at lines 161-171)
- Test: `server/test/api.test.ts` (extend), new `server/test/fileModes.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `OFFICE_EDITABLE_EXT: Set<string>` (verbatim set from Global Constraints).
  - `TEXT_EXTENSIONS: Set<string>` (verbatim set from Global Constraints).
  - `isOfficeEditable(name: string): boolean` — and of the filename's extension (base name, not full path).
  - `isTextEditable(name: string): boolean`.
  - `officeFileType(ext: string): 'word' | 'cell' | 'slide' | null`.

- [ ] **Step 1: Create `server/src/fileModes.ts`**

```ts
export const OFFICE_EDITABLE_EXT = new Set([
  'doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp',
]);

export const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'log', 'csv', 'json', 'xml', 'yaml', 'yml',
  'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'sql', 'ini', 'toml',
  'conf', 'env', 'gitignore', 'jsonl',
]);

export function extOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz')) return 'gz'; // treat compound archives by their final ext
  return lower.split('.').pop() ?? '';
}

export function isOfficeEditable(name: string): boolean {
  return OFFICE_EDITABLE_EXT.has(extOf(name));
}

export function isTextEditable(name: string): boolean {
  return TEXT_EXTENSIONS.has(extOf(name));
}

export function officeFileType(ext: string): 'word' | 'cell' | 'slide' | null {
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'word';
  if (['xls', 'xlsx', 'ods'].includes(ext)) return 'cell';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'slide';
  return null;
}
```

- [ ] **Step 2: Write `fileModes.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { isOfficeEditable, isTextEditable, officeFileType, extOf } from '../src/fileModes.js';

describe('fileModes', () => {
  it('office set is exactly the engine-native formats', () => {
    expect(isOfficeEditable('report.docx')).toBe(true);
    expect(isOfficeEditable('book.xlsx')).toBe(true);
    expect(isOfficeEditable('slides.pptx')).toBe(true);
    expect(isOfficeEditable('deck.key')).toBe(false); // Keynote: download fallback
    expect(isOfficeEditable('note.md')).toBe(false);
  });
  it('text allowlist covers the safe text formats and excludes binaries', () => {
    expect(isTextEditable('data.csv')).toBe(true);
    expect(isTextEditable('app.tsx')).toBe(true);
    expect(isTextEditable('config.json')).toBe(true);
    expect(isTextEditable('image.png')).toBe(false);
    expect(isTextEditable('movie.mp4')).toBe(false);
  });
  it('officeFileType maps ext to word/cell/slide', () => {
    expect(officeFileType('docx')).toBe('word');
    expect(officeFileType('xlsx')).toBe('cell');
    expect(officeFileType('pptx')).toBe('slide');
    expect(officeFileType('pdf')).toBeNull();
  });
  it('extOf treats compound archives by their final ext', () => {
    expect(extOf('a.tar.gz')).toBe('gz');
  });
});
```

- [ ] **Step 3: Extend the `MIME` map**

In `server/src/api/routes.ts`, after the `csv/json/xml` line, add:

```ts
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', aac: 'audio/aac', m4a: 'audio/x-m4a',
  zip: 'application/zip', tar: 'application/x-tar', gz: 'application/gzip', tgz: 'application/gzip',
```

- [ ] **Step 4: Generalize the text-edit gate**

Import `isTextEditable` at the top of `routes.ts`:

```ts
import { isTextEditable } from '../fileModes.js';
```

Replace the `PUT /api/file` body (currently lines 165-166):

```ts
    const kind = detectKind(rel.split('/').pop() ?? '', false);
    if (kind !== 'markdown') return reply.code(400).send({ error: 'only text files are editable' });
```

with:

```ts
    if (!isTextEditable(rel.split('/').pop() ?? '')) {
      return reply.code(400).send({ error: 'not an editable text file' });
    }
```

- [ ] **Step 5: Write the failing API tests**

In `server/test/api.test.ts`, after the existing `rejects path traversal on file access`, add:

```ts
  it('PUT /api/file edits any text extension and rejects binaries', async () => {
    const app = await boot();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'data.csv'), 'a,b\n1,2');
    const csv = await app.inject({ method: 'PUT', url: '/api/file?path=' + encodeURIComponent('Documents/data.csv'), payload: { content: 'x,y' }, headers: AUTH });
    expect(csv.statusCode).toBe(200);
    const got = await app.inject({ method: 'GET', url: '/api/file?path=' + encodeURIComponent('Documents/data.csv'), headers: AUTH });
    expect(got.body).toBe('x,y');

    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'pic.png'), 'x');
    const png = await app.inject({ method: 'PUT', url: '/api/file?path=' + encodeURIComponent('Documents/pic.png'), payload: { content: 'boom' }, headers: AUTH });
    expect(png.statusCode).toBe(400);
    // the PNG bytes are untouched
    const img = await app.inject({ method: 'GET', url: '/api/file?path=' + encodeURIComponent('Documents/pic.png'), headers: AUTH });
    expect(img.body).toBe('x');
    await app.close();
  });
```

- [ ] **Step 6: Run the suite**

Run: `npx vitest run test/fileModes.test.ts test/api.test.ts` from `server/`.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/fileModes.ts server/src/api/routes.ts server/test/fileModes.test.ts server/test/api.test.ts
git commit -m "feat(privy): office/text file-mode gate on the server; widen text editing + MIME"
```

---

### Task 3: `backups.ts` (per-save, pruned)

**Files:**
- Create: `server/src/backups.ts`
- Test: `server/test/backups.test.ts` (new)

**Interfaces:**
- Consumes: `privyBase` from `./directory.js`.
- Produces: `writeBackup(root: string, rel: string, data: Buffer): Promise<void>` (writes `.privy/backups/<rel>/<ts>-<base>` with `data` = the pre-overwrite bytes, then prunes); `pruneBackups(root: string, rel: string, opts?): Promise<void>`.

- [ ] **Step 1: Create `server/src/backups.ts`**

```ts
import { mkdirSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { privyBase } from './directory.js';

// rel must be a relative, dot-free, slash-separated path naming a file. Reject
// absolutes, `..`, bare `.`, empty segments, backslashes, and NULs so the computed
// backup dir can never escape `.privy/backups` — this module is the enforcement
// point for the path-safety constraint (review fix #2).
function assertSafeRel(rel: string): void {
  if (rel.startsWith('/') || rel.includes('\\') || rel.includes('\0')) {
    throw new Error('unsafe backup rel');
  }
  if (rel.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error('unsafe backup rel');
  }
}

function backupDir(root: string, rel: string): string {
  // Keep the pointer file's own directory structure under .privy/backups, stripped of
  // the filename segment, so we never clash with the live tree or escape the root.
  assertSafeRel(rel);
  return join(privyBase(root), '.privy', 'backups', rel.split('/').slice(0, -1).join('/'));
}

const MAX_PER_REL = 20;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${d.getMilliseconds()}`;
}

export async function writeBackup(root: string, rel: string, data: Buffer): Promise<void> {
  const dir = backupDir(root, rel);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${stamp()}-${basename(rel)}`);
  await writeFile(target, data);
  await pruneBackups(root, rel);
}

export async function pruneBackups(root: string, rel: string): Promise<void> {
  const dir = backupDir(root, rel);
  if (!existsSync(dir)) return;
  const now = Date.now();
  const files = readdirSync(dir).map((f) => ({ f, stat: statSync(join(dir, f)) }));
  // Keep only the newest MAX_PER_REL backups that are also younger than MAX_AGE_MS;
  // delete everything else (age-expired, or beyond the per-rel count) so the backup
  // dir stays bounded over a file's lifetime (review fix #1).
  const keep = new Set(
    files
      .filter((x) => now - x.stat.mtimeMs < MAX_AGE_MS)
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      .slice(0, MAX_PER_REL)
      .map((x) => x.f),
  );
  for (const x of files) {
    if (!keep.has(x.f)) rmSync(join(dir, x.f), { force: true });
  }
}
```

- [ ] **Step 2: Write `backups.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readdirSync, statSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { writeBackup } from '../src/backups.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

const backupsDir = () => join(root, 'Privy Cloud', '.privy', 'backups', 'Documents');

describe('backups', () => {
  it('writes a pruned backup under .privy/backups', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    await writeBackup(root, 'Documents/report.docx', Buffer.from('old bytes'));
    const dir = backupsDir();
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    // the backup holds the pre-overwrite bytes
    expect(statSync(join(dir, files[0])).size).toBe('old bytes'.length);
  });

  it('prunes backups older than the age horizon', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    await writeBackup(root, 'Documents/report.docx', Buffer.from('fresh'));
    const dir = backupsDir();
    const stale = join(dir, 'stale.docx');
    writeFileSync(stale, Buffer.from('stale'));
    const longAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(stale, longAgo, longAgo);
    await writeBackup(root, 'Documents/report.docx', Buffer.from('fresh2'));
    expect(existsSync(stale)).toBe(false);
  });

  it('rejects a rel that would escape .privy/backups', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    await expect(writeBackup(root, 'Documents/../../secret.docx', Buffer.from('x'))).rejects.toThrow();
    await expect(writeBackup(root, '/abs/secret.docx', Buffer.from('x'))).rejects.toThrow();
    // nothing escaped into the live tree
    expect(existsSync(join(root, 'Privy Cloud', 'Documents', 'secret.docx'))).toBe(false);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run test/backups.test.ts` from `server/`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/backups.ts server/test/backups.test.ts
git commit -m "feat(privy): per-save pruned backups under .privy/backups"
```

---

### Task 4: `OfficeProvider` (HMAC one-use sessions, lock, callback save)

**Files:**
- Create: `server/src/office.ts`
- Test: `server/test/office.test.ts` (new)

**Interfaces:**
- Consumes: `privyBase`, `resolveSafe` from `./directory.js`; `detectKind` from `./kinds.js`; `isOfficeEditable`, `officeFileType` from `./fileModes.js`; `writeBackup` from `./backups.js`.
- Produces (public API of `OfficeProvider`):
  - `constructor(cfg: OfficeConfig)` where `OfficeConfig = { secret: string; engineUrl: string; getRoot(): string; emit(e: ServerEvent): void }`.
  - `isConfigured(): boolean`
  - `createSession(rel: string): OfficeSessionInfo`
  - `validateToken(token: string): ServerSession | null`
  - `handleCallback(token: string, body: Record<string, unknown>): Promise<{ error: number }>`
  - `streamFile(token: string): { rel: string; mime: string } | null` (route reads bytes from `rel`)

- [ ] **Step 1: Create `server/src/office.ts`**

```ts
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { privyBase, resolveSafe } from './directory.js';
import { isOfficeEditable, officeFileType } from './fileModes.js';
import { writeBackup } from './backups.js';
import type { ServerEvent } from './api/routes.js';

const SESSION_TTL_MS = 30 * 60 * 1000;

export interface OfficeConfig {
  secret: string;
  engineUrl: string;
  getRoot(): string;
  emit(e: ServerEvent): void;
}

export interface ServerSession {
  rel: string;
  fileType: 'word' | 'cell' | 'slide';
  key: string;
  expiresAt: number;
  saved: boolean;
}

export interface OfficeSessionInfo {
  enabled: boolean;
  token?: string;
  key?: string;
  fileUrl?: string;
  callbackUrl?: string;
  engineUrl?: string;
  fileType?: 'word' | 'cell' | 'slide';
  title?: string;
  expiresAt?: string;
}

const isLoopbackOrPrivate = (host: string): boolean =>
  host === 'host.containers.internal' || host === 'localhost' ||
  /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '::1' || host === '[::1]';

export class OfficeProvider {
  private readonly secret: string;
  private readonly engineUrl: string;
  private readonly getRoot: () => string;
  private readonly emit: (e: ServerEvent) => void;
  private readonly sessions = new Map<string, ServerSession>();
  private readonly locked = new Set<string>();

  constructor(cfg: OfficeConfig) {
    this.secret = cfg.secret;
    this.engineUrl = cfg.engineUrl;
    this.getRoot = cfg.getRoot;
    this.emit = cfg.emit;
  }

  isConfigured(): boolean {
    return this.engineUrl !== '';
  }

  /** A stable per-document cache key for the engine, keyed on content so an edit
   *  makes a new key (forcing the engine to reload fresh) without every open changing it. */
  private docKey(rel: string): string {
    const abs = resolveSafe(privyBase(this.getRoot()), rel);
    let mtimeMs = 0;
    if (abs && existsSync(abs)) mtimeMs = statSync(abs).mtimeMs;
    return createHash('sha1').update(`${rel}|${mtimeMs}`).digest('hex');
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('hex');
  }

  /** Sign only the expiry + a random nonce. The rel/fileType/key the original
   *  payload carried are never read (validateToken/streamFile/handleCallback all
   *  source those from the in-memory session map; only `valid` is consulted), and
   *  embedding them forced a `|`-delimited rel that parseToken later split —
   *  corrupting any filename containing `|` (reachable: sanitizeSegment allows it,
   *  and uploads use basename(fileName) unchecked). Expiry is still enforced via
   *  the session map's expiresAt, so the token need not carry it. */
  private mintToken(expiresAt: number): string {
    const nonce = randomBytes(8).toString('hex');
    const payload = `${expiresAt}|${nonce}`;
    return `${this.sign(payload)}.${Buffer.from(payload).toString('base64url')}`;
  }

  private parseToken(token: string): { valid: boolean } {
    const idx = token.indexOf('.');
    if (idx < 0) return { valid: false };
    const mac = token.slice(0, idx);
    const b64 = token.slice(idx + 1);
    let payload: string;
    try { payload = Buffer.from(b64, 'base64url').toString('utf8'); }
    catch { return { valid: false }; }
    return this.sign(payload) === mac ? { valid: true } : { valid: false };
  }

  /** Drop sessions past TTL and release their locks. Called on each session touch
   *  (createSession + validateToken) so an abandoned or already-saved session never
   *  leaves the map growing unboundedly or a file permanently locked: a rel whose
   *  session expired can be reopened. Bounds the map to the TTL window. */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [token, s] of this.sessions) {
      if (now > s.expiresAt) {
        this.sessions.delete(token);
        this.locked.delete(s.rel);
      }
    }
  }

  createSession(rel: string): OfficeSessionInfo {
    if (!this.isConfigured()) return { enabled: false };
    this.sweepExpired(); // release any abandoned lock before the LOCKED check
    const name = basename(rel);
    if (!isOfficeEditable(name)) throw httpError('NOT_OFFICE', 'not an office document');
    if (this.locked.has(rel)) throw httpError('LOCKED', 'already being edited');
    const abs = resolveSafe(privyBase(this.getRoot()), rel);
    if (!abs || !existsSync(abs)) throw httpError('NOT_FOUND', 'not found');
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const fileType = officeFileType(ext);
    if (!fileType) throw httpError('NOT_OFFICE', 'not an office document');
    const key = this.docKey(rel);
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const token = this.mintToken(expiresAt);
    this.sessions.set(token, { rel, fileType, key, expiresAt, saved: false });
    this.locked.add(rel);
    const port = process.env.PRIVY_PORT ?? '5178';
    const origin = `http://host.containers.internal:${port}`;
    return {
      enabled: true, token, key, fileType,
      fileUrl: `${origin}/api/office/file?token=${encodeURIComponent(token)}`,
      callbackUrl: `${origin}/api/office/callback?token=${encodeURIComponent(token)}`,
      engineUrl: this.engineUrl,
      title: name,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /** Validate a token without consuming it (the engine fetches the file, then POSTs a
   *  save with the same token). Returns the session or null when unknown/expired/saved. */
  validateToken(token: string): ServerSession | null {
    this.sweepExpired();
    const parsed = this.parseToken(token);
    if (!parsed.valid) return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    if (Date.now() > s.expiresAt) { this.sessions.delete(token); this.locked.delete(s.rel); return null; }
    if (s.saved) return null; // a save already landed — don't allow a second write
    return s;
  }

  streamFile(token: string): { rel: string; mime: string } | null {
    const s = this.validateToken(token);
    if (!s) return null;
    const ext = s.rel.split('.').pop()?.toLowerCase() ?? '';
    const MIME: Record<string, string> = {
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ods: 'application/vnd.oasis.opendocument.spreadsheet',
      ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      odp: 'application/vnd.oasis.opendocument.presentation',
    };
    return { rel: s.rel, mime: MIME[ext] ?? 'application/octet-stream' };
  }

  private async fetchSave(url: string): Promise<Buffer> {
    const host = new URL(url).hostname;
    const engineHost = this.engineUrl ? new URL(this.engineUrl).hostname : '';
    if (!isLoopbackOrPrivate(host) && host !== engineHost) {
      throw httpError('BAD_ORIGIN', 'save origin not allowed');
    }
    const res = await fetch(url);
    if (!res.ok) throw httpError('SAVE_FETCH_FAILED', 'could not fetch edited file');
    return Buffer.from(await res.arrayBuffer());
  }

  async handleCallback(token: string, body: Record<string, unknown>): Promise<{ error: number }> {
    const s = this.validateToken(token);
    if (!s) return { error: 1 };
    const status = Number(body?.status ?? 0);
    // Only status 2 (content saved) and 6 (force save) carry a downloadable url.
    if ((status === 2 || status === 6) && typeof body?.url === 'string' && body.url) {
      try {
        const data = await this.fetchSave(body.url as string);
        const abs = resolveSafe(privyBase(this.getRoot()), s.rel);
        if (!abs) return { error: 1 };
        // Backup the pre-overwrite bytes, then atomic-replace (temp + rename).
        if (existsSync(abs)) await writeBackup(this.getRoot(), s.rel, readFileSync(abs));
        mkdirSync(dirname(abs), { recursive: true });
        const tmp = join(dirname(abs), `.tmp-${randomBytes(6).toString('hex')}-${basename(s.rel)}`);
        await writeFile(tmp, data);
        renameSync(tmp, abs);
        const record = this.sessions.get(token);
        if (record) record.saved = true;
        this.locked.delete(s.rel);
        this.emit({ type: 'items:changed', path: s.rel, change: 'modified' });
      } catch {
        // A disallowed save origin or a fetch failure is a recoverable reject,
        // never a crash: report error 1 so the engine shows "Save failed".
        return { error: 1 };
      }
    }
    return { error: 0 };
  }
}

function httpError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
```

- [ ] **Step 2: Write `office.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { OfficeProvider } from '../src/office.js';

let root: string;
const noop = () => {};
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function makeProvider(engineUrl = 'http://docs.example') {
  root = mkdtempSync(join(tmpdir(), 'privy-off-'));
  await initRootStructure(root);
  return new OfficeProvider({ secret: 's', engineUrl, getRoot: () => root, emit: noop as never });
}

describe('office provider', () => {
  it('isConfigured reflects the engine url', async () => {
    expect((await makeProvider('')).isConfigured()).toBe(false);
    expect((await makeProvider('http://docs.example')).isConfigured()).toBe(true);
  });

  it('createSession mints a one-use token and locks the file', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'a.docx'), 'x');
    const info = p.createSession('Documents/a.docx');
    expect(info.enabled).toBe(true);
    expect(info.token).toBeTruthy();
    expect(info.fileUrl).toContain('token=');
    expect(() => p.createSession('Documents/a.docx')).toThrow(); // locked
    expect(p.validateToken(info.token!)).toBeTruthy();
  });

  it('rejects non-office and unknown paths', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Other'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Other', 'b.key'), 'x');
    expect(() => p.createSession('Other/b.key')).toThrow(); // Keynote not openable
    expect(() => p.createSession('missing.docx')).toThrow();
  });

  it('callback rejects a save from a disallowed origin (SSRF guard)', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'c.docx'), 'ORIGINAL');
    const info = p.createSession('Documents/c.docx');
    // A data: URL has no hostname → the guard rejects it; handleCallback returns
    // error 1 rather than throwing. The happy path (loopback fetch + write-back)
    // is proven end-to-end in the Task 5 integration test, not here.
    const result = await p.handleCallback(info.token!, { status: 2, url: 'data:text/plain,EDITED' });
    expect(result.error).toBe(1);
  });

  it('handles a rel containing a pipe (|) — tokens are not split on it', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'a|b.docx'), 'x');
    const info = p.createSession('Documents/a|b.docx');
    expect(info.enabled).toBe(true);
    const s = p.validateToken(info.token!);
    expect(s).toBeTruthy();
    expect(s!.rel).toBe('Documents/a|b.docx');
  });

  it('releases a lock after its session expires (abandoned edit must not permanently lock)', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'd.docx'), 'x');
    const info1 = p.createSession('Documents/d.docx');
    expect(info1.enabled).toBe(true);
    expect(() => p.createSession('Documents/d.docx')).toThrow(); // locked
    // Force the session past its TTL. The next touch runs the sweep, deletes the
    // expired session and releases the lock, so a fresh session succeeds. (Casting
    // to reach the private session map — a real 30-minute wait is infeasible in a
    // unit test.)
    const sessions = (p as unknown as { sessions: Map<string, { rel: string; expiresAt: number }> }).sessions;
    sessions.get(info1.token!)!.expiresAt = Date.now() - 1;
    expect(p.createSession('Documents/d.docx').enabled).toBe(true);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run test/office.test.ts` from `server/`. Expected: PASS. The last test relies on `handleCallback` never throwing: a disallowed save origin (here a `data:` URL, whose hostname is empty) makes `fetchSave` throw `BAD_ORIGIN`, which is caught by the try/catch inside `handleCallback` and returned as `{ error: 1 }`. If you change `handleCallback` to let `fetchSave` propagate, the test would need `await expect(...).rejects` instead — keep it returning `{ error: 1 }`.

- [ ] **Step 4: Commit**

```bash
git add server/src/office.ts server/test/office.test.ts
git commit -m "feat(privy): office provider — HMAC sessions, edit lock, loopback-guarded save"
```

---

### Task 5: Office routes + auth exemption + stub-engine integration test

**Files:**
- Modify: `server/src/index.ts` (construct provider, exempt engine routes from bearer hook, add opts)
- Modify: `server/src/api/routes.ts` (three office routes)
- Modify: `server/src/config.ts` (`getOfficeSecret`)
- Test: `server/test/api.test.ts` (office session disabled/enabled), new `server/test/office-integration.test.ts`

**Interfaces:**
- Consumes: `OfficeProvider` from `./office.js`; `getOfficeSecret` from `./config.js`.
- Produces: `GET /api/office/session` → `OfficeSessionInfo`; `GET /api/office/file?token=` → stream; `POST /api/office/callback?token=` → `{ error: number }`. `ctx.office?: OfficeProvider`. `buildApp` opts gain `officeSecret?`, `officeEngineUrl?`.

- [ ] **Step 1: Add `getOfficeSecret` to `config.ts`**

```ts
export function getOfficeSecret(): string {
  const raw = readConfig();
  if (typeof raw.officeSecret === 'string' && raw.officeSecret.length > 0) return raw.officeSecret;
  const s = randomBytes(32).toString('hex');
  writeFileSync(CONFIG_FILE(), JSON.stringify({ ...raw, officeSecret: s }, null, 2));
  return s;
}
```

- [ ] **Step 2: Wire the provider + exemption in `index.ts`**

Add to the imports (near line 14):

```ts
import { randomBytes } from 'node:crypto';
import { OfficeProvider } from './office.js';
import { getOfficeSecret } from './config.js';
```

Add `officeSecret?` and `officeEngineUrl?` to the `buildApp` opts type (line 16).

Compute the engine config **after** the block that declares `const listeners = []` (line 76) — the provider's `emit` closure needs `listeners` in scope — and **before** the `const ctx: ApiContext = { ... }` literal (line 77). For an ephemeral test root (`opts.root` is set) fall back to a **random** secret so the real `~/.privy-cloud/config.json` is never read or written:

```ts
  const officeSecret = opts?.officeSecret ?? (ephemeral ? randomBytes(32).toString('hex') : getOfficeSecret());
  const officeEngineUrl = opts?.officeEngineUrl ?? process.env.OFFICE_ENGINE_URL ?? '';
  const office = new OfficeProvider({
    secret: officeSecret,
    engineUrl: officeEngineUrl,
    getRoot: () => cfg.root,
    emit: (e) => { for (const l of listeners) l(e); },
  });
```

Then attach it to the context by adding `office,` to the `ctx` literal (line 77-82):

```ts
  const ctx: ApiContext = {
    getRoot: () => cfg.root,
    setRootPath: async (p) => { const r = ephemeral ? resolve(p) : await setRoot(p); cfg.root = r; return r; },
    emit: (e) => { for (const l of listeners) l(e); },
    hermes,
    office,
  };
```

In the bearer-token `onRequest` hook, add the exemption right after the `/api/health` check (line 56):

```ts
    // Engine-facing endpoints authenticate with their one-use HMAC token (the
    // engine has no user bearer), so exempt them from the bearer check.
    if (path === '/api/office/file' || path === '/api/office/callback') return;
```

> Do NOT exempt `/api/office/session` — the browser calls it with the user's bearer token.

- [ ] **Step 3: BuildAppOpts + route additions**

`buildApp`'s opts type (line 16 of `index.ts`) gains `officeSecret?: string; officeEngineUrl?: string;`. `ApiContext` (line 26 of `routes.ts`) gains `office?: OfficeProvider`.

In `routes.ts`, import the provider type and add it to the context interface:

```ts
import type { OfficeProvider } from '../office.js';
```

```ts
export interface ApiContext {
  getRoot(): string;
  setRootPath(p: string): Promise<string>;
  emit(e: ServerEvent): void;
  hermes?: HermesManager;
  office?: OfficeProvider;
}
```

Add routes inside `registerRoutes` (e.g. after `/api/rename`):

```ts
  app.get('/api/office/session', async (req, reply) => {
    const office = ctx.office;
    if (!office || !office.isConfigured()) return { enabled: false };
    const rel = (req.query as { path?: string }).path ?? '';
    if (!privyResolve(ctx, rel)) return reply.code(400).send({ error: 'unsafe path' });
    try {
      const info = office.createSession(rel);
      if ('enabled' in info && !info.enabled) return { enabled: false };
      return info;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_OFFICE') return reply.code(400).send({ error: 'not an office document' });
      if (code === 'LOCKED') return reply.code(409).send({ error: 'already being edited' });
      if (code === 'NOT_FOUND') return reply.code(404).send({ error: 'not found' });
      // eslint-disable-next-line no-console
      console.error('office session failed:', err);
      return reply.code(500).send({ error: 'operation failed' });
    }
  });

  app.get('/api/office/file', async (req, reply) => {
    const office = ctx.office;
    const token = (req.query as { token?: string }).token ?? '';
    const s = office?.streamFile(token);
    if (!s) return reply.code(401).send({ error: 'unauthorized' });
    const abs = privyResolve(ctx, s.rel);
    if (!abs) return reply.code(400).send({ error: 'unsafe path' });
    return reply.type(s.mime).send(createReadStream(abs));
  });

  app.post('/api/office/callback', async (req, reply) => {
    const office = ctx.office;
    const token = (req.query as { token?: string }).token ?? '';
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const result = await office?.handleCallback(token, body) ?? { error: 1 };
      return result;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('office callback failed:', err);
      return { error: 1 };
    }
  });
```

- [ ] **Step 4: Write route tests (disabled + enabled flow)**

In `server/test/api.test.ts`, add:

```ts
  it('office session reports disabled when no engine is configured', async () => {
    const app = await boot();
    const sess = await app.inject({ method: 'GET', url: '/api/office/session?path=' + encodeURIComponent('Documents/a.docx'), headers: AUTH });
    expect(sess.json()).toEqual({ enabled: false });
    await app.close();
  });
```

And enable the provider in `boot` when an engine is set, by extending `buildApp({ root, token, officeSecret, officeEngineUrl })`. For the enabled flow, rather than a second `buildApp` path, the integration test (next step) arms the real provider with a stub engine.

- [ ] **Step 5: Stub-engine integration test**

Create `server/test/office-integration.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { buildApp } from '../src/index.js';
import { initRootStructure } from '../src/directory.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('office integration (stub engine)', () => {
  it('fetches the file via the session and writes a save back through the callback', async () => {
    process.env.HERMES_ENABLED = '0';
    root = mkdtempSync(join(tmpdir(), 'privy-int-'));
    await initRootStructure(root);
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'r.docx'), 'ORIGINAL_BYTES');

    // Stub "engine": serves the edited bytes on any GET. It is allowed as the
    // save origin because it is loopback (127.0.0.1) — the provider's fetchSave
    // guard permits loopback/private hosts.
    const engineUrl = await new Promise<string>((res) => {
      const server = createServer((_req, res2) => {
        res2.setHeader('content-type', 'application/octet-stream');
        res2.end('EDITED_BYTES');
      });
      server.listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${(server.address() as { port: number }).port}`));
    });

    const app = await buildApp({
      root, token: 'test-token',
      officeSecret: 'office-secret',
      officeEngineUrl: engineUrl,
    });

    const AUTH = { authorization: 'Bearer test-token' };
    const sess = await app.inject({ method: 'GET', url: '/api/office/session?path=' + encodeURIComponent('Documents/r.docx'), headers: AUTH });
    expect(sess.json().enabled).toBe(true);
    const { token, fileUrl, callbackUrl } = sess.json();

    // Engine fetches the ORIGINAL bytes via the session token. Inject the full
    // `fileUrl` directly: Fastify routes by pathname + query and ignores the
    // host:port, so production's host.containers.internal:5178 needs no rewrite.
    const fetched = await app.inject({ method: 'GET', url: fileUrl });
    expect(fetched.body).toBe('ORIGINAL_BYTES');

    // Engine saves edited content through the callback (stub engine's loopback).
    const cb = await app.inject({ method: 'POST', url: callbackUrl, payload: { status: 2, url: `${engineUrl}/save` } });
    expect(cb.json()).toEqual({ error: 0 });

    // The vault file is updated and a backup exists.
    expect(readFileSync(join(root, 'Privy Cloud', 'Documents', 'r.docx'), 'utf8')).toBe('EDITED_BYTES');
    const backups = join(root, 'Privy Cloud', '.privy', 'backups', 'Documents');
    expect(existsSync(backups) && readdirSync(backups).length > 0).toBe(true);
    await app.close();
  });
});
```

> **Reliability note:** `fileUrl`/`callbackUrl` are built by the provider against `host.containers.internal:<PRIVY_PORT>` — the production host-local bridge. The test injects those full URLs directly: Fastify's `inject` parses the pathname and query and routes on them, ignoring the host and port, so no host/port rewriting is needed and no `officeOrigin` config option is required. The provider keeps its PRIVY_PORT-based origin unchanged.

- [ ] **Step 6: Run the suite**

Run: `npx vitest run` from `server/`. Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add server/src/index.ts server/src/api/routes.ts server/src/config.ts server/test/api.test.ts server/test/office-integration.test.ts
git commit -m "feat(privy): office routes with engine host exemption + stub-engine integration proof"
```

---

### Task 6: Web `editorFor` mapper + native components

**Files:**
- Create: `web/src/fileEditor.ts`
- Create: `web/src/components/{TextFileEditor,StructuredViewer,AudioPlayer,ArchiveInfo}.tsx`
- Test: `web/src/__tests__/fileEditor.test.ts`, `{TextFileEditor,StructuredViewer,AudioPlayer,ArchiveInfo}.test.tsx` (new)

**Interfaces:**
- Produces:
  - `type EditorMode = 'office' | 'text' | 'structured' | 'markdown' | 'audio' | 'archive' | 'pdf' | 'none'`.
  - `editorFor(name: string): EditorMode`.
- Consumes: `saveFileText` from `../api`.

- [ ] **Step 1: Create `web/src/fileEditor.ts`**

```ts
export type EditorMode = 'office' | 'text' | 'structured' | 'markdown' | 'audio' | 'archive' | 'pdf' | 'none';

const OFFICE = new Set(['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp']);
const TEXT = new Set(['txt', 'log', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'sql', 'ini', 'toml', 'conf', 'env', 'gitignore', 'jsonl']);
const STRUCTURED = new Set(['csv', 'json', 'xml', 'yaml', 'yml']);
const AUDIO = new Set(['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a']);
const ARCHIVE = new Set(['zip', 'tar', 'gz', 'tgz']);

export function editorFor(name: string): EditorMode {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'archive';
  const ext = lower.split('.').pop() ?? '';
  if (OFFICE.has(ext)) return 'office';
  if (AUDIO.has(ext)) return 'audio';
  if (ARCHIVE.has(ext)) return 'archive';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (STRUCTURED.has(ext)) return 'structured';
  if (TEXT.has(ext)) return 'text';
  return 'none';
}
```

- [ ] **Step 2: `fileEditor.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { editorFor } from '../fileEditor';

describe('editorFor', () => {
  it('routes office extensions (and not Keynote)', () => {
    expect(editorFor('report.DOCX')).toBe('office');
    expect(editorFor('book.xlsx')).toBe('office');
    expect(editorFor('deck.ppt')).toBe('office');
    expect(editorFor('slide.key')).toBe('none'); // Keynote: download fallback
  });
  it('routes text, structured, markdown', () => {
    expect(editorFor('a.tsx')).toBe('text');
    expect(editorFor('data.csv')).toBe('structured');
    expect(editorFor('config.yaml')).toBe('structured');
    expect(editorFor('note.md')).toBe('markdown');
  });
  it('routes media, archive, pdf', () => {
    expect(editorFor('song.mp3')).toBe('audio');
    expect(editorFor('bundle.zip')).toBe('archive');
    expect(editorFor('a.tar.gz')).toBe('archive');
    expect(editorFor('doc.pdf')).toBe('pdf');
  });
});
```

- [ ] **Step 3: Native components**

`TextFileEditor.tsx` (reuses the MarkdownEditor save pattern, but plain textarea):

```tsx
import { useEffect, useRef, useState } from 'react';

export function TextFileEditor({ path, initialText, onSave }: { path: string; initialText: string; onSave: (c: string) => Promise<void> }) {
  const [content, setContent] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Re-sync when async-loaded text arrives: the parent fetches text on mount, so
  // initialText is '' on the first render, then fills in — the editor must pick it
  // up. A dependency on `initialText` only refires when the value actually changes
  // (the parent's `text` state is set once, not on every keystroke), so this never
  // clobbers in-progress typing.
  useEffect(() => { setContent(initialText); }, [initialText]);

  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try { await onSave(content); setSaved(true); setTimeout(() => setSaved(false), 1500); }
    catch (e) { setError((e as Error).message || 'Save failed'); }
    finally { setSaving(false); }
  };
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="editor">
      <div className="editor-title">
        <span>{path}</span>
        <button className="btn primary" onClick={save} disabled={saving} title="Ctrl+S">{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}</button>
      </div>
      {error && <div className="editor-error">{error}</div>}
      <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} style={{ fontFamily: 'monospace' }} />
    </div>
  );
}
```

`StructuredViewer.tsx`:

```tsx
export function StructuredViewer({ name, text, onEdit }: { name: string; text: string; onEdit: () => void }) {
  const lower = name.toLowerCase();
  let body: React.ReactNode = <pre>{text}</pre>;
  if (lower.endsWith('.json')) {
    try { body = <pre>{JSON.stringify(JSON.parse(text), null, 2)}</pre>; } catch { body = <pre>{text}</pre>; }
  } else if (lower.endsWith('.csv')) {
    const rows = text.trim().split('\n').map((r) => r.split(','));
    body = <table className="structured-table">{rows.map((r, i) => (<tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>))}</table>;
  } else if (lower.endsWith('.xml')) {
    try { const doc = new DOMParser().parseFromString(text, 'application/xml'); body = <pre>{doc.documentElement.outerHTML.replace(/></g, '>\n<')}</pre>; } catch { body = <pre>{text}</pre>; }
  }
  return (
    <div className="viewer-body">
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className="btn" onClick={onEdit}>Edit as text</button>
      </div>
      <div className="structured scroll">{body}</div>
    </div>
  );
}
```

`AudioPlayer.tsx`:

```tsx
import { api } from '../api';
export function AudioPlayer({ path, name }: { path: string; name: string }) {
  return <div className="viewer-body"><audio controls src={api.fileUrl(path)} style={{ width: '100%' }}>Your browser does not support audio.</audio></div>;
}
```

`ArchiveInfo.tsx`:

```tsx
import { api } from '../api';
export function ArchiveInfo({ item }: { item: FileItem }) {
  return (
    <div className="viewer-body">
      <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
        <div style={{ fontSize: 40 }}>🗜️</div>
        <p>{item.name} — {formatSize(item.size)}. Archives open in your system's extractor.</p>
        <a className="btn" href={api.fileUrl(item.path)} download={item.name}>Download</a>
      </div>
    </div>
  );
}
function formatSize(n: number) { return `${(n / 1024).toFixed(1)} KB`; }
```

> Add `import type { FileItem } from '@privy/shared';` to `ArchiveInfo.tsx`. Add a small `.structured-table` style to `web/src/theme.css` (or a `<style>` block) so the CSV table lays out borderless with `--muted` borders.

- [ ] **Step 4: Component tests**

`StructuredViewer.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StructuredViewer } from '../components/StructuredViewer';

describe('StructuredViewer', () => {
  it('renders a CSV as a table', () => {
    render(<StructuredViewer name="a.csv" text="x,y\n1,2" onEdit={() => {}} />);
    expect(screen.getByText('x')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test --workspace web` (or `npx vitest run` from `web/`). Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/fileEditor.ts web/src/components/TextFileEditor.tsx web/src/components/StructuredViewer.tsx web/src/components/AudioPlayer.tsx web/src/components/ArchiveInfo.tsx web/src/__tests__/fileEditor.test.ts web/src/__tests__/StructuredViewer.test.tsx web/src/theme.css
git commit -m "feat(privy): file-mode mapper + native text/structured/audio/archive viewers"
```

---

### Task 7: `DocEditor` + refactor `FileViewer` to dispatch

**Files:**
- Create: `web/src/components/DocEditor.tsx`
- Modify: `web/src/components/FileViewer.tsx`
- Modify: `web/src/api.ts`
- Test: `web/src/__tests__/DocEditor.test.tsx` (new), `FileViewer.test.tsx` (modify)

**Interfaces:**
- Consumes: `api.officeSession`, `api.saveFileText`, `api.getFileText`, `editorFor`; `OfficeSession` type; existing proxy/viewer logic.
- Produces: `DocEditor({ path, name, onSaved })`; `api.officeSession(path)`.

- [ ] **Step 1: `api.ts` — add `officeSession`**

```ts
  officeSession: (path: string): Promise<{ enabled: boolean; token?: string; key?: string; fileUrl?: string; callbackUrl?: string; engineUrl?: string; fileType?: string; title?: string; expiresAt?: string }> =>
    req(`/api/office/session?path=${encodeURIComponent(path)}`),
```

- [ ] **Step 2: `DocEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api, API_BASE } from '../api';
import { getToken } from '../auth';

interface Session { enabled: boolean; token?: string; key?: string; fileUrl?: string; callbackUrl?: string; engineUrl?: string; fileType?: string; title?: string }

declare global { interface Window { DocsAPI?: { DocEditor: new (id: string, cfg: unknown) => unknown } } }

export function DocEditor({ path, name, onSaved, onTrash }: { path: string; name: string; onSaved(): void; onTrash?: (p: string) => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.officeSession(path)
      .then((s) => { if (cancelled) return; setSession(s); setState(s.enabled ? 'ready' : 'unavailable'); })
      .catch(() => !cancelled && setState('unavailable'));
    return () => { cancelled = true; };
  }, [path]);

  useEffect(() => {
    if (state !== 'ready' || !session?.engineUrl) return;
    const script = document.createElement('script');
    script.src = `${session.engineUrl}/web-apps/apps/api/documents/api.js`;
    script.onload = () => {
      // fileType comes straight from the session (the backend's officeFileType),
      // not a DOM attribute. OnlyOffice needs to know word/cell/slide upfront.
      const fileType = (session.fileType as 'word' | 'cell' | 'slide' | undefined) ?? 'word';
      if (!window.DocsAPI) { setError('Editor failed to load'); return; }
      new window.DocsAPI.DocEditor('placeholder', {
        document: { fileType, key: session.key, title: name, url: session.fileUrl },
        editorConfig: { callbackUrl: session.callbackUrl, lang: 'en', custom: { autosave: true } },
        height: '100%', width: '100%', events: { onSave: () => onSaved() },
        type: 'desktop', token: session.token,
      } as unknown);
    };
    script.onerror = () => setError('Editor unavailable');
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [state, session]);

  if (state === 'unavailable') {
    return (
      <div className="viewer-body">
        <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 40 }}>📄</div>
          <p>Editor unavailable. Use "Download original".</p>
          <a className="btn" href={`${API_BASE}/api/file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getToken() ?? '')}`} download={name}>Download</a>
        </div>
        {onTrash && <button className="btn" onClick={() => onTrash(path)}>🗑️ Trash</button>}
      </div>
    );
  }
  if (error) return <div className="viewer-body" style={{ color: 'var(--danger)' }}>{error}</div>;
  return <div className="viewer-body"><div id="placeholder" style={{ width: '100%', height: '100%' }} /></div>;
}
```

- [ ] **Step 3: Refactor `FileViewer.tsx` to dispatch**

Import `editorFor` and the new components, then replace the content section. Keep the header, download/trash bar, and the existing **image/video proxy branches** (`item.kind === 'image'` / `item.kind === 'video'`) — `editorFor` returns `'none'` for members of those kinds, so they must stay as kind branches and the 'none' dispatch must skip them. **Remove** the existing `item.kind === 'markdown'` branch (lines ~28-31) — the new dispatch covers markdown via `mode === 'markdown'`. Replace the pdf/document-other/slide/other/folder blocks with a single dispatch:

```tsx
import { editorFor } from '../fileEditor';
import { DocEditor } from './DocEditor';
import { TextFileEditor } from './TextFileEditor';
import { StructuredViewer } from './StructuredViewer';
import { AudioPlayer } from './AudioPlayer';
import { ArchiveInfo } from './ArchiveInfo';
```

Add a `useState` for the structured→text toggle and text loading (FileViewer already imports `useState`/`useEffect` for markdown):

```tsx
  const [editingText, setEditingText] = useState(false);
  const mode = editorFor(item.name);
  useEffect(() => {
    if (mode === 'text' || mode === 'structured' || mode === 'markdown') api.getFileText(item.path).then(setText);
  }, [item.path, mode]);
```

Replace the content JSX (the `item.kind === 'markdown'`, the `pdf` block, and the `document-other/slide/other` fallback) with:

```tsx
      {mode === 'markdown' && <MarkdownEditor path={item.path} initialText={text} onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); }} />}
      {mode === 'text' && <TextFileEditor path={item.path} initialText={text} onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); }} />}
      {mode === 'structured' && (editingText
        ? <TextFileEditor path={item.path} initialText={text} onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); setEditingText(false); }} />
        : <StructuredViewer name={item.name} text={text} onEdit={() => setEditingText(true)} />)}
      {mode === 'audio' && <AudioPlayer path={item.path} name={item.name} />}
      {mode === 'archive' && <ArchiveInfo item={item} />}
      {mode === 'pdf' && <div className="viewer-body"><iframe src={url} title={item.name} style={{ width: '100%', height: '100%', border: 'none' }} /></div>}
      {mode === 'office' && <DocEditor path={item.path} name={item.name} onSaved={onSaved} onTrash={onTrash} />}
      {mode === 'none' && item.kind !== 'image' && item.kind !== 'video' && item.kind !== 'folder' && (
        <div className="viewer-body">
          <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontSize: 40 }}>📄</div>
            <p>Inline preview for this type isn't ready yet.</p>
            <a className="btn" href={url} download={item.name}>Download</a>
          </div>
        </div>
      )}
      {item.kind === 'folder' && <div className="viewer-body"><div style={{ color: 'var(--muted)' }}>Folders are shown in the sharing grid — browse them by opening files.</div></div>}
```

> `editorFor` returns `'none'` for image/video/folder names, so the 'none' branch is gated on `item.kind` to avoid double-rendering beside the retained image/video proxy branches and the folder message. Add one `FileViewer.test.tsx` case: a `.docx` shows `DocEditor` (or its fallback), a `.csv` shows `StructuredViewer`, an `mp3` shows `AudioPlayer`.

- [ ] **Step 4: Tests**

`DocEditor.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocEditor } from '../components/DocEditor';
import { api } from '../api';

vi.mock('../api', async () => {
  const actual = await vi.importActual('../api');
  return { api: { ...actual.api, officeSession: vi.fn() }, API_BASE: actual.API_BASE };
});
import { getToken } from '../auth';
vi.mock('../auth', () => ({ getToken: () => '' }));

describe('DocEditor', () => {
  it('shows a download fallback when the engine is disabled', async () => {
    (api.officeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ enabled: false });
    render(<DocEditor path="Documents/a.docx" name="a.docx" onSaved={() => {}} />);
    expect(await screen.findByText(/Editor unavailable/)).toBeTruthy();
  });
});
```

Modify `FileViewer.test.tsx` to assert a `.docx` renders `DocEditor` (or the fallback), a `.csv` renders the structured viewer, and an `mp3` renders the audio player. Use `vi.mock` for `DocEditor`/`AudioPlayer` where a real engine/audio is not needed.

- [ ] **Step 5: Run it**

Run: `npm test --workspace web`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/DocEditor.tsx web/src/components/FileViewer.tsx web/src/api.ts web/src/__tests__/DocEditor.test.tsx web/src/__tests__/FileViewer.test.tsx
git commit -m "feat(privy): dispatch FileViewer per editor; office seam via DocEditor"
```

---

### Task 8: Whole-branch review + finish (via SDD)

**Files:** the whole Phase A branch.

**Interfaces:** all of the above; confirm `editorFor` ↔ `fileModes` sets stay in sync (office set and text allowlist are duplicated across server and web by design — they must match exactly).

- [ ] Final code review (SDD broad review), fix loop, adjudicate.
- [ ] Confirm spec coverage: all §10-§12 items implemented; office set + text allowlist verbatim; audio/archive kinds present.
- [ ] `git status` clean; all tests green in both workspaces.

---

## Self-Review (run against the spec)

**1. Spec coverage:**
- §10 Kinds (audio/archive) → Task 1. ✓
- §11 backend: `office.ts` provider (Task 4), routes + auth exemption + `officeSecret` (Task 5), generalized `PUT /api/file` (Task 2), MIME additions (Task 2), backups (Task 3). ✓
- §12 frontend: `editorFor` router + native viewers (Task 6), FileViewer dispatch + DocEditor + api (Task 7). ✓
- §9 router coverage matrix (office/text/structured/markdown/image/video/audio/pdf/archive/none) — all present except image/video which retain their existing kind branches in FileViewer (unchanged). ✓
- §14 testing — unit (2,3,4,6), route (2,5), stub-engine integration (5). ✓

**2. Placeholder scan:** No TBD/TODO. §7 requires an explicit `officeOrigin`/`officeEngineUrl` path to avoid brittle string rewriting — incorporated as a directed adjustment (see Task 5 note).

**3. Type consistency:** `editorFor` (web) and `fileModes.isOfficeEditable` (server) use the same office set; `TEXT_EXTENSIONS` on the server matches the web `TEXT`/`STRUCTURED` union — note the web's `structured` set (csv/json/xml/yaml/yml) is a subset of server `TEXT_EXTENSIONS`, so saving works for both. `OfficeProvider` method signatures match route usage. `buildApp` opts (`officeSecret`, `officeEngineUrl`) match `index.ts` wiring. ✓

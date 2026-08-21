import { createReadStream, createWriteStream, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { ChatEntry } from '@privy/shared';
import { listItems, resolveSafe, initRootStructure, privyBase, proxyPathFor } from '../directory.js';
import { storeText, storeFile, stageFolderUpload } from '../storage.js';
import { readEntries } from '../chatLog.js';
import { loadPermissions } from '../permissions.js';
import { detectKind } from '../kinds.js';
import { ensureProxy } from '../transcode.js';
import type { AgentEvent } from '../hermes/events.js';
import type { HermesManager, HermesStatus } from '../hermes/manager.js';
import { getHermesHome } from '../hermes/serve.js';
import { listTrash, trashPath, restoreTrashPath, deleteTrashPath } from '../trash.js';

export type ServerEvent =
  | { type: 'items:changed'; path: string; change: 'created' | 'modified' | 'deleted' | 'renamed' }
  | { type: 'chat:new'; entry: ChatEntry }
  | { type: 'hermes:event'; event: AgentEvent; sessionId: string | null }
  | { type: 'hermes:status'; status: HermesStatus };

export interface ApiContext {
  getRoot(): string;
  setRootPath(p: string): Promise<string>;
  emit(e: ServerEvent): void;
  hermes?: HermesManager;
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

  // Playable proxy for a video (HEVC→H.264) or image (HEIC→JPEG) whose original isn't
  // browser-decodable. The proxy filename is derived from `rel` (never raw user input).
  app.get('/api/proxy', async (req, reply) => {
    const rel = (req.query as { path: string }).path ?? '';
    if (!privyResolve(ctx, rel)) return reply.code(400).send({ error: 'unsafe path' });
    const kind = detectKind(rel.split('/').pop() ?? '', false);
    if (kind !== 'video' && kind !== 'image') return reply.code(404).send({ error: 'not a media file' });
    const proxy = proxyPathFor(ctx.getRoot(), rel, kind);
    if (!existsSync(proxy)) return reply.code(404).send({ error: 'proxy not ready' });
    return reply.type(kind === 'video' ? 'video/mp4' : 'image/jpeg').send(createReadStream(proxy));
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
    if ((entry.kind === 'video' || entry.kind === 'image') && entry.path) void ensureProxy(ctx.getRoot(), entry.path, entry.kind, ctx.emit);
    return { entry };
  });

  app.post('/api/send/folder', async (req) => {
    const parts = (req as unknown as { parts(): AsyncIterable<UploadPart> }).parts();
    let folderName = 'folder';
    let pendingRel: string | undefined; // client sends `relativePath` immediately before each file part
    // Drain each part.file to a temp file OUTSIDE the watched root as it is
    // iterated. Collecting the streams and only reading them after the loop lets
    // busboy's ~16 KB per-file buffer fill, stalling the iterator on any file
    // larger than that. The temp dir also keeps the watcher from firing on the
    // staging writes; files are moved into the root only after the loop ends.
    const tmpDir = mkdtempSync(join(tmpdir(), 'privy-upload-'));
    const files: Array<{ relativePath: string; tmpPath: string }> = [];
    try {
      for await (const part of parts) {
        if (part.type === 'file') {
          const rel = pendingRel ?? part.filename ?? '';
          const tmpPath = join(tmpDir, `${files.length}-${basename(rel) || 'part'}`);
          await pipeline(part.file, createWriteStream(tmpPath));
          files.push({ relativePath: rel, tmpPath });
          pendingRel = undefined;
        } else if (part.fieldname === 'folderName') {
          folderName = String(part.value ?? 'folder');
        } else if (part.fieldname === 'relativePath') {
          pendingRel = String(part.value ?? '');
        }
      }
      const { entry, fileRels } = await stageFolderUpload(ctx.getRoot(), folderName, files, tmpDir);
      ctx.emit({ type: 'chat:new', entry });
      for (const rel of fileRels) {
        const kind = detectKind(rel.split('/').pop() ?? '', false);
        if (kind === 'video' || kind === 'image') void ensureProxy(ctx.getRoot(), rel, kind, ctx.emit);
      }
      return { entry };
    } catch (err) {
      // Safety net for failures before/around stageFolderUpload (which cleans up
      // files it already moved): never leave temp litter behind.
      rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    }
  });

  app.get('/api/chat', async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 50);
    const entries = await readEntries(ctx.getRoot(), limit);
    // Keep the chat synced with reality: drop entries whose underlying file or
    // folder was deleted on disk (e.g. by Hermes) so the chat box doesn't show
    // messages whose content no longer exists. Plain entries without a path stay.
    const base = privyBase(ctx.getRoot());
    return entries.filter((e) => {
      if (!e.path) return true;
      const abs = resolveSafe(base, e.path);
      return !!abs && existsSync(abs);
    });
  });

  // Recycle bin. `path` is a relative path under `Privy Cloud/` — both for
  // trashing an existing item and for operating on a mirrored path in the trash.
  app.get('/api/trash', async () => ({ items: await listTrash(ctx.getRoot()) }));

  app.post('/api/trash', async (req, reply) => {
    const { path } = (req.body ?? {}) as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path is required' });
    try {
      await trashPath(ctx.getRoot(), path);
      ctx.emit({ type: 'items:changed', path, change: 'deleted' });
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/trash/restore', async (req, reply) => {
    const { path } = (req.body ?? {}) as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path is required' });
    try {
      await restoreTrashPath(ctx.getRoot(), path);
      ctx.emit({ type: 'items:changed', path, change: 'created' });
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/trash', async (req, reply) => {
    const { path } = (req.body ?? {}) as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path is required' });
    try {
      await deleteTrashPath(ctx.getRoot(), path);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // The Hermes roles available to @-mention in the chat: the default agent
  // plus any profiles under this gateway's HERMES_HOME. Data-driven so new
  // roles show up without a code change.
  app.get('/api/hermes/roles', async () => {
    const roles = [{ id: 'hermes', label: 'Hermes' }];
    try {
      const profilesDir = join(getHermesHome(), 'profiles');
      if (existsSync(profilesDir)) {
        for (const name of readdirSync(profilesDir)) {
          if (name.startsWith('.')) continue;
          roles.push({ id: name, label: name });
        }
      }
    } catch {
      /* best-effort — the default role always remains */
    }
    return { roles };
  });

  app.post('/api/hermes/call', async (req, reply) => {
    const { method, params } = (req.body ?? {}) as { method?: string; params?: unknown };
    const hermes = ctx.hermes;
    // "Not connected" is a distinct, deterministic outcome: no manager, or a
    // manager whose lifecycle hasn't reached 'connected' (spawn/connect in
    // progress, or down). Any *other* rejection from call() is the call itself
    // failing, and is surfaced as-is (502) rather than conflated with a
    // connectivity problem.
    if (!hermes) return reply.code(503).send({ error: 'hermes not connected' });
    if (hermes.getStatus() !== 'connected') return reply.code(503).send({ error: 'hermes not connected' });
    try {
      const result = await hermes.call(method ?? '', params);
      return { result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: message });
    }
  });
}

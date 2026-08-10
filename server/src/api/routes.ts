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

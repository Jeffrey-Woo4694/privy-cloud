import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { loadConfig, setRoot } from './config.js';
import { initRootStructure } from './directory.js';
import { checkPermission } from './permissions.js';
import { registerRoutes, type ApiContext, type ServerEvent } from './api/routes.js';
import { attachSocket } from './api/socket.js';
import { createWatcher } from './watcher.js';
import { backfillProxies, cleanupOrphanedProxies } from './transcode.js';

export async function buildApp(opts?: { root?: string }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // CORS allowlist so BOTH documented launch paths work cross-origin:
  // the dev Vite origin (:5173), the same-origin backend-served UI (:5178),
  // and the two Tauri 2 webview origins (tauri://localhost, https://tauri.localhost).
  // Allowlist only — never origin: true / '*'. Registered before the permission
  // hook and routes so preflight/403 responses still carry the CORS headers.
  await app.register(cors, {
    origin: [
      'http://localhost:5173',
      'http://localhost:5178',
      'tauri://localhost',
      'https://tauri.localhost',
    ],
    // @fastify/cors defaults methods to GET,HEAD,POST, which omits PUT/PATCH/DELETE.
    // The markdown save is a PUT, so allow the full standard set.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  // No per-file size cap: @fastify/multipart defaults fileSize to Fastify's
  // bodyLimit (1 MiB), which silently truncates any larger upload (photos,
  // videos) at exactly 1 MiB. Restore busboy's native unlimited default.
  await app.register(multipart, { limits: { fileSize: Infinity } });
  await app.register(websocket);

  // An injected root (tests, PRIVY_ROOT walkthrough) is an ephemeral override:
  // changing it must not persist to the real ~/.privy-cloud/config.json.
  const ephemeral = Boolean(opts?.root);
  const cfg = opts?.root ? { root: opts.root } : await loadConfig();
  await initRootStructure(cfg.root);

  // Permission layer: every API request passes through checkPermission. v1 = single owner, always allows.
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api') && !(await checkPermission(cfg.root, 'read'))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
  });

  const listeners: Array<(e: ServerEvent) => void> = [];
  const ctx: ApiContext = {
    getRoot: () => cfg.root,
    setRootPath: async (p) => { const r = ephemeral ? resolve(p) : await setRoot(p); cfg.root = r; return r; },
    emit: (e) => { for (const l of listeners) l(e); },
  };

  // Serve the built web frontend (web/dist) when present, so one URL exposes UI + API.
  // Dormant until Task 10 creates web/; guarded by existsSync.
  const webDist = process.env.PRIVY_WEB_DIST ?? new URL('../../web/dist', import.meta.url).pathname;
  if (existsSync(webDist)) {
    await app.register((await import('@fastify/static')).default, { root: webDist, prefix: '/' });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  await registerRoutes(app, ctx);
  await attachSocket(app, ctx, listeners);

  // Watch the root and emit filesystem changes as ServerEvents broadcast over /ws.
  const watcher = await createWatcher(cfg.root, (e) => ctx.emit(e));
  app.addHook('onClose', async () => { await watcher.stop(); });

  // Remove proxies for videos deleted on-disk, then backfill proxies for HEVC videos already
  // in the vault (and recover interrupted transcodes). Fire-and-forget; new uploads trigger
  // transcoding inline instead. The interval keeps orphans cleaned without a server restart.
  void cleanupOrphanedProxies(cfg.root);
  void backfillProxies(cfg.root, ctx.emit);
  const cleanupTimer = setInterval(() => { void cleanupOrphanedProxies(cfg.root); }, 60_000);
  app.addHook('onClose', async () => { clearInterval(cleanupTimer); });

  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const app = await buildApp();
  await app.listen({ port: Number(process.env.PRIVY_PORT ?? 5178), host: process.env.PRIVY_HOST ?? '127.0.0.1' });
}

import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { loadConfig, setRoot } from './config.js';
import { initRootStructure } from './directory.js';
import { checkPermission } from './permissions.js';
import { registerRoutes, type ApiContext, type ServerEvent } from './api/routes.js';
import { attachSocket } from './api/socket.js';
import { createWatcher } from './watcher.js';

export async function buildApp(opts?: { root?: string }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(multipart);
  await app.register(websocket);

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
    setRootPath: async (p) => { const r = await setRoot(p); cfg.root = r; return r; },
    emit: (e) => { for (const l of listeners) l(e); },
  };

  // Serve the built web frontend (web/dist) when present, so one URL exposes UI + API.
  // Dormant until Task 10 creates web/; guarded by existsSync.
  const webDist = process.env.PRIVY_WEB_DIST ?? new URL('../../../web/dist', import.meta.url).pathname;
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

  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const app = await buildApp();
  await app.listen({ port: Number(process.env.PRIVY_PORT ?? 5178) });
}

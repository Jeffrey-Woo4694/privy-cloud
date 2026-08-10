import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { loadConfig, setRoot } from './config.js';
import { initRootStructure } from './directory.js';
import { checkPermission } from './permissions.js';
import { registerRoutes, type ApiContext, type ServerEvent } from './api/routes.js';
import { attachSocket } from './api/socket.js';

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

  await registerRoutes(app, ctx);
  await attachSocket(app, ctx, listeners);
  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const app = await buildApp();
  await app.listen({ port: Number(process.env.PRIVY_PORT ?? 5178) });
}

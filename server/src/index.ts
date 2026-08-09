import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({ logger: true });
  app.get('/api/health', async () => ({ ok: true }));
  return app;
}

// started only when run directly (`tsx src/index.ts`)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const app = buildApp();
  await app.listen({ port: Number(process.env.PRIVY_PORT ?? 5178) });
}

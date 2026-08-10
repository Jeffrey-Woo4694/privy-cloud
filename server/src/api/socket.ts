import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { ApiContext, ServerEvent } from './routes.js';

export async function attachSocket(app: FastifyInstance, _ctx: ApiContext, listeners: Array<(e: ServerEvent) => void>): Promise<void> {
  const clients = new Set<WebSocket>();
  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
  });
  listeners.push((e) => {
    const msg = JSON.stringify(e);
    for (const c of clients) { if (c.readyState === c.OPEN) c.send(msg); }
  });
}

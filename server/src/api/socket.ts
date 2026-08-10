import type { FastifyInstance } from 'fastify';
import type { ApiContext, ServerEvent } from './routes.js';

export async function attachSocket(app: FastifyInstance, _ctx: ApiContext, listeners: Array<(e: ServerEvent) => void>): Promise<void> {
  // WebSocket broadcast added in Task 8.
}

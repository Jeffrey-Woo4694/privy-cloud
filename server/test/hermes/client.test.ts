import { describe, expect, it } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { connectHermes, type ClientEvent, type HermesClient } from '../../src/hermes/client.js';

// Mock Hermes gateway: a `ws` WebSocketServer on an ephemeral port. The client
// under test connects to `ws://127.0.0.1:{port}/api/ws?token={token}`.
async function startMockServer() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  const port = (wss.address() as AddressInfo).port;
  const sockets = new Set<WebSocket>();
  wss.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return { wss, port, sockets };
}

describe('hermes client', () => {
  it('calls session.create and forwards message.delta events', async () => {
    const { wss, port, sockets } = await startMockServer();
    const methods: string[] = [];
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const frame = JSON.parse(data.toString());
        if (frame.method !== 'session.create') return;
        methods.push(frame.method);
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { session_id: 'abc12345' } }));
        socket.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'event',
          params: { type: 'message.delta', session_id: 'abc12345', payload: { text: 'hel' } },
        }));
      });
    });

    const received: ClientEvent[] = [];
    let resolveEvent!: (e: ClientEvent) => void;
    const eventArrived = new Promise<ClientEvent>((resolve) => {
      resolveEvent = resolve;
    });

    let client: HermesClient | undefined;
    try {
      client = await connectHermes(port, 'test-token', (e) => {
        received.push(e);
        if (e.kind === 'event') resolveEvent(e);
      });

      const result = await client.call('session.create', {});
      expect(result).toEqual({ session_id: 'abc12345' });

      const ev = await eventArrived;
      expect(ev).toEqual({
        kind: 'event',
        event: { type: 'message.delta', text: 'hel' },
        sessionId: 'abc12345',
      });
      expect(methods).toEqual(['session.create']);
    } finally {
      client?.shutdown();
      for (const s of sockets) s.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  });

  it('rejects pending calls and fires disconnected when the server closes', async () => {
    const { wss, port, sockets } = await startMockServer();
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const frame = JSON.parse(data.toString());
        if (frame.method === 'session.create') socket.close(1000, 'server going away');
      });
    });

    const received: ClientEvent[] = [];
    let client: HermesClient | undefined;
    try {
      client = await connectHermes(port, 'test-token', (e) => received.push(e));

      const callPromise = client.call('session.create', {});
      await expect(callPromise).rejects.toThrow();

      // Disconnected must have been emitted (poll; the close is async).
      await new Promise<void>((resolve) => {
        const check = () => {
          if (received.some((e) => e.kind === 'disconnected')) resolve();
          else setTimeout(check, 5);
        };
        check();
      });
      expect(received.some((e) => e.kind === 'disconnected')).toBe(true);
    } finally {
      client?.shutdown();
      for (const s of sockets) s.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  });
});

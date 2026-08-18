import { describe, expect, it } from 'vitest';
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { createHermesManager } from '../../src/hermes/manager.js';
import type { ClientEvent } from '../../src/hermes/client.js';

// Mock Hermes gateway: a `ws` WebSocketServer on an ephemeral port. The
// manager's connectHermes will dial `ws://127.0.0.1:{port}/api/ws?token=...`.
// It answers `session.create` (a fresh session) and `session.resume` (replays
// a stored session's messages, recording each resume call for assertions).
async function startMockServer() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  const port = (wss.address() as AddressInfo).port;
  const sockets = new Set<WebSocket>();
  const resumeCalls: { session_id: string }[] = [];
  wss.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.method === 'session.create') {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { session_id: 'abc12345' } }));
      } else if (frame.method === 'session.resume') {
        resumeCalls.push(frame.params);
        socket.send(JSON.stringify({
          jsonrpc: '2.0',
          id: frame.id,
          result: {
            session_id: 'live1',
            session_key: frame.params.session_id,
            messages: [{ role: 'user', text: 'hello from stored session' }],
          },
        }));
      }
    });
  });
  return { wss, port, sockets, resumeCalls };
}

/// Retry `fn` (which throws on failure) until it passes or the deadline hits.
async function poll(fn: () => void, timeoutMs = 5000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      fn();
      return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw lastErr;
}

/// A fake `hermes serve` that prints a ready line for `port`, records its own
/// PID to `pidfile`, then idles (so the manager owns its lifecycle).
function writeFakeHermes(port: number): { path: string; pidfile: string } {
  const pidfile = join(tmpdir(), `fake-hermes-pid-${process.pid}-${Date.now()}.pid`);
  const path = join(tmpdir(), `fake-hermes-mgr-${process.pid}.sh`);
  const script = `#!/bin/sh\necho $$ > ${pidfile}\nprintf 'HERMES_BACKEND_READY port=${port}\\n'\nwhile :; do sleep 1; done\n`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return { path, pidfile };
}

describe('hermes manager', () => {
  it('spawns, connects, calls, and tears down on stop', async () => {
    const { wss, port, sockets } = await startMockServer();
    const { path, pidfile } = writeFakeHermes(port);

    const mgr = createHermesManager(path, { reconnectDelayMs: 50 });
    try {
      mgr.start();
      // Poll a few times until the fake hermes is spawned and the WS dial lands.
      await poll(() => { expect(mgr.getStatus()).toBe('connected'); });

      const result = await mgr.call('session.create', {});
      expect(result).toEqual({ session_id: 'abc12345' });
    } finally {
      await mgr.stop();
      expect(mgr.getStatus()).toBe('disconnected');
      for (const s of sockets) s.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      rmSync(path, { force: true });
    }

    // stop() must kill the fake hermes child (the process exits). The fake
    // script records its own PID on startup, so read it before cleanup.
    const pid = Number(readFileSync(pidfile, 'utf8').trim());
    await poll(() => {
      let alive = true;
      try { process.kill(pid, 0); } catch { alive = false; }
      if (alive) throw new Error(`hermes child pid ${pid} still alive`);
    });
    rmSync(pidfile, { force: true });
  }, 10000);

  it('never throws when the hermes binary is missing', async () => {
    const mgr = createHermesManager('/nonexistent/hermes-xyz', { reconnectDelayMs: 50 });
    mgr.start();
    expect(mgr.getStatus()).toBe('connecting'); // it starts attempting
    // The spawn fails, the loop catches it and settles on 'disconnected'.
    await poll(() => { expect(mgr.getStatus()).toBe('disconnected'); });
    await expect(mgr.call('session.create', {})).rejects.toThrow('hermes not connected');
    await mgr.stop();
    expect(mgr.getStatus()).toBe('disconnected');
  }, 10000);

  it('resume on reconnect re-resumes the bound session', async () => {
    const { wss, port, sockets, resumeCalls } = await startMockServer();
    const { path, pidfile } = writeFakeHermes(port);

    const mgr = createHermesManager(path, { reconnectDelayMs: 50 });
    const events: ClientEvent[] = [];
    mgr.onEvent((e) => events.push(e));
    try {
      mgr.start();
      await poll(() => { expect(mgr.getStatus()).toBe('connected'); });

      mgr.setResume('stored1');

      // Force a disconnect from the server side. The manager's reconnect loop
      // should respawn + reconnect, then re-resume the bound session.
      for (const s of sockets) s.terminate();

      await poll(() => { expect(resumeCalls.some((c) => c.session_id === 'stored1')).toBe(true); });
      // The resynced history must be forwarded only after a successful resume.
      await poll(() => { expect(events.some((e) => e.kind === 'resynced')).toBe(true); });
      const resynced = events.find((e) => e.kind === 'resynced');
      expect(resynced).toEqual({
        kind: 'resynced',
        messages: [{ role: 'user', text: 'hello from stored session' }],
      });
    } finally {
      await mgr.stop();
      expect(mgr.getStatus()).toBe('disconnected');
      for (const s of sockets) s.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      rmSync(path, { force: true });
      rmSync(pidfile, { force: true });
    }
  }, 10000);
});

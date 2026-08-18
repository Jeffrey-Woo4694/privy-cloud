// Guarded end-to-end smoke test for the real `hermes` gateway.
//
// Unlike the unit tests in this directory (which mock the gateway with a fake
// script or a `ws` server), this test spawns the real `hermes serve` binary and
// connects to it with the real WebSocket client, then asserts the very first
// event the gateway broadcasts — `gateway.ready`.
//
// It is GUARDED: when the `hermes` binary is unavailable (no `HERMES_BIN` set,
// not on PATH, or not runnable) the test SKIPS instead of failing, so CI
// without the binary stays green. A hung gateway is bounded by an explicit
// timeout and the spawned child is always killed in `finally`.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { spawnServe } from '../../src/hermes/serve.js';
import { connectHermes, type ClientEvent, type HermesClient } from '../../src/hermes/client.js';

/// How long to wait, after the WebSocket connects, for `gateway.ready`.
const READY_WINDOW_MS = 15_000;
/// Hard cap for the whole test (spawnServe boot + connect + ready window).
const TEST_TIMEOUT_MS = 90_000;

/// The event this smoke test asserts on: the gateway's startup broadcast, which
/// carries no session (`sessionId: null`).
function isGatewayReady(e: ClientEvent): boolean {
  return e.kind === 'event' && e.event.type === 'gateway.ready' && e.sessionId === null;
}

/// Resolve the `hermes` binary and verify it is runnable. Returns the binary
/// name/path, or `null` when unavailable (so the caller can `skipIf`).
function resolveHermesBin(): string | null {
  const bin = process.env.HERMES_BIN ?? 'hermes';
  const res = spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 5_000 });
  if (res.error || res.status !== 0) return null;
  return bin;
}

// Evaluated at module load, so the `skipIf` decision is made before the test
// body ever runs.
const hermesBin = resolveHermesBin();

describe('hermes smoke', () => {
  it.skipIf(hermesBin === null)(
    'spawns the real gateway and receives gateway.ready',
    async () => {
      const events: ClientEvent[] = [];
      let child: ChildProcess | undefined;
      let client: HermesClient | undefined;

      try {
        const served = await spawnServe(hermesBin!, { timeoutMs: 60_000 });
        child = served.child;

        client = await connectHermes(served.info.port, served.info.token, (e) => {
          events.push(e);
        });

        // Poll (not a fixed sleep) so we assert the moment it arrives and don't
        // waste wall-clock time. `gateway.ready` is broadcast at startup, so it
        // should already be in `events`; the window covers any race.
        const deadline = Date.now() + READY_WINDOW_MS;
        while (Date.now() < deadline && !events.some(isGatewayReady)) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        expect(events.some(isGatewayReady)).toBe(true);
      } finally {
        // Always release the WebSocket and kill the spawned gateway, so a
        // failure can't leak a process or a socket.
        client?.shutdown();
        if (child) child.kill('SIGKILL');
      }
    },
    TEST_TIMEOUT_MS,
  );
});

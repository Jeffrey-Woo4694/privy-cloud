// Hermes manager (lifecycle) for the Hermes Agent integration.
// Ties spawnServe (Task 6) and connectHermes/HermesClient (Task 7) into a
// supervised lifecycle: start() spawns + connects and keeps reconnecting on
// disconnect; call() delegates to the live client; stop() tears down the
// client and kills the child. Failures never propagate out of start() or the
// reconnect loop — a missing or broken `hermes` binary just leaves the manager
// in 'disconnected' and retries, so the rest of the server is unaffected.

import type { ChildProcess } from 'node:child_process';
import { spawnServe } from './serve.js';
import { connectHermes, type ClientEvent, type HermesClient } from './client.js';

export type HermesStatus = 'disconnected' | 'connecting' | 'connected';

export interface HermesManager {
  start(): void; // spawn+connect; reconnect loop on disconnect
  call(method: string, params: unknown): Promise<unknown>;
  getStatus(): HermesStatus;
  stop(): Promise<void>; // shutdown client + kill child
  onEvent(cb: (e: ClientEvent) => void): void; // forward client events
  // Record the durable session key to re-resume on every reconnect. A null
  // key (fresh draft) disables re-resume.
  setResume(sessionKey: string | null): void;
}

/// How long the reconnect loop waits between attempts when serve/connect
/// fails or drops.
const RECONNECT_DELAY_MS = 2_000;

interface Session {
  client: HermesClient;
  child: ChildProcess;
  port: number;
  token: string;
}

export function createHermesManager(
  hermesBin: string,
  opts: { reconnectDelayMs?: number } = {},
): HermesManager {
  const reconnectDelayMs = opts.reconnectDelayMs ?? RECONNECT_DELAY_MS;

  let status: HermesStatus = 'disconnected';
  let running = false;
  let current: Session | undefined;
  let loopPromise: Promise<void> | undefined;
  // Durable session key to re-resume after each reconnect (null = fresh draft).
  let resumeKey: string | null = null;
  // Lets stop() cut a pending reconnect backoff short instead of waiting it out.
  let wakeSleep: (() => void) | undefined;
  const listeners = new Set<(e: ClientEvent) => void>();

  function setStatus(s: HermesStatus): void {
    status = s;
  }

  function forward(e: ClientEvent): void {
    for (const cb of listeners) {
      try {
        cb(e);
      } catch (err) {
        // A throwing consumer must not break the reconnect loop.
        // eslint-disable-next-line no-console
        console.error('hermes manager onEvent threw', err);
      }
    }
  }

  function killChild(child: ChildProcess | undefined): void {
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null) return; // already gone
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.(); // never keep the process alive on its own
      wakeSleep = () => {
        clearTimeout(timer);
        wakeSleep = undefined;
        resolve();
      };
    });
  }

  async function runLoop(): Promise<void> {
    while (running) {
      setStatus('connecting');
      let child: ChildProcess | undefined;
      let client: HermesClient | undefined;
      let resolveDisconnect: (() => void) | undefined;
      try {
        const { info, child: spawned } = await spawnServe(hermesBin);
        if (!running) {
          killChild(spawned);
          return;
        }
        child = spawned;

        // Two independent reasons the session ends: the gateway drops the
        // WebSocket (client fires `disconnected`) or the spawned child exits.
        const disconnected = new Promise<void>((resolve) => { resolveDisconnect = resolve; });
        const childExit = new Promise<void>((resolve) => {
          spawned.once('exit', () => resolve());
        });

        client = await connectHermes(info.port, info.token, (e) => {
          forward(e);
          if (e.kind === 'disconnected') resolveDisconnect?.();
        });
        if (!running) {
          client.shutdown();
          killChild(spawned);
          return;
        }

        current = { client, child: spawned, port: info.port, token: info.token };
        if (!running) {
          client.shutdown();
          killChild(spawned);
          current = undefined;
          return;
        }
        setStatus('connected');

        // Best-effort re-resume of the bound session. A fresh serve leaves
        // the session unregistered on the gateway (live session_id goes stale
        // on reconnect), so re-running `session.resume` re-registers it and
        // replays its history. Failure is swallowed: the session still works
        // for `prompt.submit`, just without the resynced transcript.
        if (resumeKey !== null) {
          try {
            const result = (await client.call('session.resume', { session_id: resumeKey })) as {
              messages?: unknown[];
            };
            const messages = Array.isArray(result?.messages) ? result.messages : [];
            forward({ kind: 'resynced', messages });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              '[hermes] session.resume failed (best-effort):',
              err instanceof Error ? err.message : String(err),
            );
          }
        }

        await Promise.race([disconnected, childExit]);
      } catch (err) {
        if (running) {
          // R3: never break the backend — log and retry after the backoff.
          // eslint-disable-next-line no-console
          console.error('[hermes] failed to connect:', err instanceof Error ? err.message : String(err));
        }
      } finally {
        client?.shutdown();
        killChild(child);
        current = undefined;
        setStatus('disconnected');
      }
      if (!running) return;
      await sleep(reconnectDelayMs);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      loopPromise = runLoop();
    },
    call(method, params) {
      if (!current) return Promise.reject(new Error('hermes not connected'));
      return current.client.call(method, params);
    },
    getStatus() {
      return status;
    },
    async stop() {
      running = false;
      const session = current;
      current = undefined;
      if (session) {
        session.client.shutdown();
        killChild(session.child);
      }
      wakeSleep?.();
      setStatus('disconnected');
      await loopPromise;
    },
    onEvent(cb) {
      listeners.add(cb);
    },
    setResume(sessionKey) {
      resumeKey = sessionKey;
    },
  };
}

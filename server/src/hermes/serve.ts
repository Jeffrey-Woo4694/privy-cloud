// `hermes serve` spawner for the Hermes Agent integration.
// Ported from the Rust reference implementation (`hermes_client::serve` in
// Native-Hermes). Spawns `hermes serve --port 0` (OS-assigned), hands it a
// session token we own, strips Claude Code's leaked `ANTHROPIC_*` provider env
// so Hermes uses only its own config.yaml credentials, and blocks until the
// ready line is seen on stdout (or the timeout fires).

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';

/// How long to wait for `hermes serve` to announce its port before failing.
const SERVE_READY_TIMEOUT_MS = 30_000;

/// The backend's OWN Hermes home. Two `hermes serve` processes sharing one home
/// (the same `sessions/sessions.json` + `state.db`) deadlock each other — the
/// Privy Cloud gateway and the Native-Hermes desktop app each spawn one. Point
/// this gateway at its own copy so they never touch the same files. Override
/// via `PRIVY_HERMES_HOME`.
const HERMES_HOME = process.env.PRIVY_HERMES_HOME ?? join(homedir(), '.privy-cloud', 'hermes-home');

/// Provision the isolated home: create the dir and seed `config.yaml` + `.env`
/// from the standard `~/.hermes` when the isolated copies don't exist yet, so a
/// fresh setup has a working model/provider config. Best-effort — a failure
/// (R3) must never break the backend; hermes simply won't start until it's fixed.
function ensureHermesHome(): void {
  try {
    mkdirSync(HERMES_HOME, { recursive: true });
    const srcHome = join(homedir(), '.hermes');
    for (const f of ['config.yaml', '.env']) {
      const src = join(srcHome, f);
      const dst = join(HERMES_HOME, f);
      if (!existsSync(dst) && existsSync(src)) copyFileSync(src, dst);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[hermes] failed to provision isolated HERMES_HOME:', err instanceof Error ? err.message : String(err));
  }
}

// Claude Code (via cc-switch) exports `ANTHROPIC_*` env vars to route its own
// provider traffic. If they leak into the spawned `hermes serve` — and from
// there into the HermesCLI children it spawns — the Anthropic SDK reads
// `ANTHROPIC_AUTH_TOKEN` into its `auth_token` and sends
// `Authorization: Bearer <leaked key>` *alongside* the correctly-resolved
// `x-api-key`. Bearer-validating endpoints (e.g. DeepSeek's `/anthropic`
// route) then reject on the leaked key with a 401 naming that key — even
// though Hermes resolved the right one. Strip them so Hermes uses only its own
// config.yaml credentials.
export const HERMES_ENV_STRIP: readonly string[] = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_ENDPOINT',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
];

export interface ServeInfo {
  port: number;
  token: string;
}

/// "HERMES_BACKEND_READY port=12345" (also accept the legacy DASHBOARD tag).
export function parseReadyLine(line: string): number | null {
  const parts = line.trim().split(/\s+/);
  const tag = parts[0];
  if (tag !== 'HERMES_BACKEND_READY' && tag !== 'HERMES_DASHBOARD_READY') return null;
  const portField = parts[1];
  if (portField === undefined || !portField.startsWith('port=')) return null;
  const digits = portField.slice('port='.length);
  if (!/^[0-9]+$/.test(digits)) return null;
  const port = Number(digits);
  if (port > 0xffff) return null; // u16 range, matching the Rust parse
  return port;
}

/// Spawn `hermes serve` with `--port 0` (OS-assigned), a token we own, and
/// `--skip-build` (avoid the web-UI npm build). Resolves with the announced
/// port and token once the ready line is seen on stdout; kills the child and
/// rejects if the ready line is not seen within `opts.timeoutMs`.
export function spawnServe(
  hermesBin: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ info: ServeInfo; child: ChildProcess }> {
  const timeoutMs = opts.timeoutMs ?? SERVE_READY_TIMEOUT_MS;
  const token = randomBytes(16).toString('hex');

  ensureHermesHome();
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of HERMES_ENV_STRIP) delete env[name];
  env.HERMES_DASHBOARD_SESSION_TOKEN = token;
  env.HERMES_HOME = HERMES_HOME;

  const child = spawn(
    hermesBin,
    ['serve', '--host', '127.0.0.1', '--port', '0', '--skip-build'],
    { env, stdio: ['ignore', 'pipe', 'ignore'] },
  );

  return new Promise((resolve, reject) => {
    const stdout = child.stdout;
    if (!stdout) {
      child.kill('SIGKILL');
      reject(new Error('spawnServe: `hermes serve` stdout is not piped'));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill('SIGKILL');
      reject(new Error(`timed out waiting for \`hermes serve\` to announce a port (${timeoutMs}ms)`));
    }, timeoutMs);

    const rl = createInterface({ input: stdout });

    // A pipe read error must not become an unhandled 'error' crash (which would
    // take down the whole backend). Readline forwards input-stream errors here,
    // but attach a listener on both so either surface is covered. A read error
    // before the ready line is treated like any other stall: the ready-timeout
    // below fires and rejects.
    rl.on('error', () => { /* ignore — the ready timeout owns the outcome */ });
    stdout.on('error', () => { /* ignore — the ready timeout owns the outcome */ });

    function cleanup() {
      clearTimeout(timer);
      rl.close();
    }

    rl.on('line', (line) => {
      const port = parseReadyLine(line);
      if (port === null || settled) return;
      settled = true;
      cleanup();
      resolve({ info: { port, token }, child });
    });

    rl.on('close', () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('`hermes serve` exited before announcing a port'));
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`spawning \`hermes serve\`: ${err.message}`));
    });
  });
}

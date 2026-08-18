import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const CONFIG_DIR = () => join(homedir(), '.privy-cloud');
const CONFIG_FILE = () => join(CONFIG_DIR(), 'config.json');
export const DEFAULT_ROOT = () => join(homedir(), 'PrivyCloud');
export const OWNER = 'owner';

export interface AppConfig { root: string; owner: string; token: string }

export function ensureHomeConfig(): void {
  mkdirSync(CONFIG_DIR(), { recursive: true });
  if (!existsSync(CONFIG_FILE())) {
    writeFileSync(CONFIG_FILE(), JSON.stringify({ root: DEFAULT_ROOT() }, null, 2));
  }
}

function ensureToken(): string {
  const raw = JSON.parse(readFileSync(CONFIG_FILE(), 'utf8')) as { token?: string };
  if (raw.token && /^[0-9a-f]{64}$/.test(raw.token)) return raw.token;
  const token = randomBytes(32).toString('hex');
  writeFileSync(CONFIG_FILE(), JSON.stringify({ ...raw, token }, null, 2));
  return token;
}

export async function loadConfig(): Promise<AppConfig> {
  ensureHomeConfig();
  const token = ensureToken();
  const env = process.env.PRIVY_ROOT;
  if (env) return { root: resolve(env), owner: OWNER, token };
  const raw = JSON.parse(readFileSync(CONFIG_FILE(), 'utf8')) as { root?: string };
  return { root: resolve(raw.root ?? DEFAULT_ROOT()), owner: OWNER, token };
}

export async function setRoot(path: string): Promise<string> {
  ensureHomeConfig();
  const abs = resolve(path);
  // Merge into the existing JSON so a persisted token (or other fields) is never clobbered.
  const raw = JSON.parse(readFileSync(CONFIG_FILE(), 'utf8')) as Record<string, unknown>;
  writeFileSync(CONFIG_FILE(), JSON.stringify({ ...raw, root: abs }, null, 2));
  return abs;
}

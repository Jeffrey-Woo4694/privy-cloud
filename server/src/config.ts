import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const CONFIG_DIR = () => join(homedir(), '.privy-cloud');
const CONFIG_FILE = () => join(CONFIG_DIR(), 'config.json');
export const DEFAULT_ROOT = () => join(homedir(), 'PrivyCloud');
export const OWNER = 'owner';

export interface AppConfig { root: string; owner: string }

export function ensureHomeConfig(): void {
  mkdirSync(CONFIG_DIR(), { recursive: true });
  if (!existsSync(CONFIG_FILE())) {
    writeFileSync(CONFIG_FILE(), JSON.stringify({ root: DEFAULT_ROOT() }, null, 2));
  }
}

export async function loadConfig(): Promise<AppConfig> {
  ensureHomeConfig();
  const env = process.env.PRIVY_ROOT;
  if (env) return { root: resolve(env), owner: OWNER };
  const raw = JSON.parse(readFileSync(CONFIG_FILE(), 'utf8')) as { root?: string };
  return { root: resolve(raw.root ?? DEFAULT_ROOT()), owner: OWNER };
}

export async function setRoot(path: string): Promise<string> {
  ensureHomeConfig();
  const abs = resolve(path);
  writeFileSync(CONFIG_FILE(), JSON.stringify({ root: abs }, null, 2));
  return abs;
}

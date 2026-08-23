import { mkdirSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { privyBase } from './directory.js';

function backupDir(root: string, rel: string): string {
  // Keep the pointer file's own directory structure under .privy/backups, but strip
  // path segments so we never clash with the live tree or escape the root.
  return join(privyBase(root), '.privy', 'backups', rel.split('/').slice(0, -1).join('/'));
}

const MAX_PER_REL = 20;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${d.getMilliseconds()}`;
}

export async function writeBackup(root: string, rel: string, data: Buffer): Promise<void> {
  const dir = backupDir(root, rel);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${stamp()}-${basename(rel)}`);
  await writeFile(target, data);
  await pruneBackups(root, rel);
}

export async function pruneBackups(root: string, rel: string): Promise<void> {
  const dir = backupDir(root, rel);
  if (!existsSync(dir)) return;
  const now = Date.now();
  const files = readdirSync(dir)
    .map((f) => ({ f, stat: statSync(join(dir, f)) }))
    .filter((x) => now - x.stat.mtimeMs < MAX_AGE_MS);
  files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  files.slice(MAX_PER_REL).forEach((x) => rmSync(join(dir, x.f), { force: true }));
}

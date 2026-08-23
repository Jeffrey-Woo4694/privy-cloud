import { mkdirSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { privyBase } from './directory.js';

// rel must be a relative, dot-free, slash-separated path naming a file. Reject
// absolutes, `..`, bare `.`, empty segments, backslashes, and NULs so the computed
// backup dir can never escape `.privy/backups` — this module is the enforcement
// point for the path-safety constraint.
function assertSafeRel(rel: string): void {
  if (rel.startsWith('/') || rel.includes('\\') || rel.includes('\0')) {
    throw new Error('unsafe backup rel');
  }
  if (rel.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error('unsafe backup rel');
  }
}

function backupDir(root: string, rel: string): string {
  // Keep the pointer file's own directory structure under .privy/backups, stripped of
  // the filename segment, so we never clash with the live tree or escape the root.
  assertSafeRel(rel);
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
  const files = readdirSync(dir).map((f) => ({ f, stat: statSync(join(dir, f)) }));
  // Keep only the newest MAX_PER_REL backups that are also younger than MAX_AGE_MS;
  // delete everything else (age-expired, or beyond the per-rel count) so the backup
  // dir stays bounded over a file's lifetime.
  const keep = new Set(
    files
      .filter((x) => now - x.stat.mtimeMs < MAX_AGE_MS)
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      .slice(0, MAX_PER_REL)
      .map((x) => x.f),
  );
  for (const x of files) {
    if (!keep.has(x.f)) rmSync(join(dir, x.f), { force: true });
  }
}

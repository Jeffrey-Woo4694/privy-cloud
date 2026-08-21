// Recycle bin for the Privy Cloud sharing view. Trashed files/folders move into a
// hidden `.privy/trash/` directory that mirrors their original path, so restoring
// is a simple move back. A small `index.json` records exactly what was trashed
// (so the trash view lists real items, not the container dirs that hold them).
// App-initiated deletes only — an external `rm` (e.g. by Hermes) bypasses this
// and stays permanent.

import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { rename, copyFile, rm } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { privyBase, resolveSafe } from './directory.js';

/** The hidden trash directory (dot-prefixed, so the grid/watcher ignore it). */
export function trashDir(root: string): string {
  return join(privyBase(root), '.privy', 'trash');
}

const INDEX_FILE = 'index.json';

export interface TrashItem {
  /** Relative path within the trash dir — mirrors the item's original path under `Privy Cloud/`. */
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  modifiedAt: string;
}

/** Resolve `rel` strictly inside `base` (no escaping), or null when unsafe. */
function resolveIn(base: string, rel: string): string | null {
  if (rel.includes('\0')) return null;
  const abs = resolve(base, rel);
  if (abs === base) return base;
  if (!abs.startsWith(base + '/')) return null;
  return abs;
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

function readIndex(root: string): string[] {
  const p = join(trashDir(root), INDEX_FILE);
  if (!existsSync(p)) return [];
  try {
    const v = JSON.parse(readFileSync(p, 'utf8')) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(root: string, paths: string[]): void {
  mkdirSync(trashDir(root), { recursive: true });
  writeFileSync(join(trashDir(root), INDEX_FILE), JSON.stringify(paths, null, 2));
}

/** The trashed items (from the index; drift-safe — missing files are skipped). */
export async function listTrash(root: string): Promise<TrashItem[]> {
  const out: TrashItem[] = [];
  for (const rel of readIndex(root)) {
    const abs = resolveIn(trashDir(root), rel);
    if (!abs || !existsSync(abs)) continue;
    const st = statSync(abs);
    out.push({
      path: rel,
      name: basename(rel),
      isDir: st.isDirectory(),
      size: st.isDirectory() ? 0 : st.size,
      modifiedAt: st.mtime.toISOString(),
    });
  }
  return out;
}

/** Move a file/folder (rel, relative to `Privy Cloud/`) into the trash. */
export async function trashPath(root: string, rel: string): Promise<void> {
  const abs = resolveSafe(privyBase(root), rel);
  if (!abs || !existsSync(abs)) throw new Error('item not found');
  const to = resolveIn(trashDir(root), rel);
  if (!to) throw new Error('unsafe path');
  mkdirSync(dirname(to), { recursive: true });
  await moveFile(abs, to);
  const idx = readIndex(root);
  if (!idx.includes(rel)) { idx.push(rel); writeIndex(root, idx); }
}

/** Restore a trashed item back to its original location. */
export async function restoreTrashPath(root: string, rel: string): Promise<void> {
  const from = resolveIn(trashDir(root), rel);
  if (!from || !existsSync(from)) throw new Error('trash item not found');
  const to = resolveSafe(privyBase(root), rel);
  if (!to) throw new Error('unsafe path');
  mkdirSync(dirname(to), { recursive: true });
  await moveFile(from, to);
  writeIndex(root, readIndex(root).filter((p) => p !== rel));
}

/** Permanently delete a trashed item. */
export async function deleteTrashPath(root: string, rel: string): Promise<void> {
  const abs = resolveIn(trashDir(root), rel);
  if (!abs) throw new Error('unsafe path');
  rmSync(abs, { recursive: true, force: true });
  writeIndex(root, readIndex(root).filter((p) => p !== rel));
}

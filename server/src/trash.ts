// Recycle bin for the Privy Cloud sharing view. Trashed files/folders move into a
// hidden `.privy/trash/` directory. `index.json` records each item's original rel
// plus the actual path it was stored under, so the trash view lists real items (not
// the containers that hold them) and restoring works even when two same-named items
// were trashed at different times (the second gets a uniquified trash path).
// App-initiated deletes only — an external `rm` (e.g. by Hermes) bypasses this and
// stays permanent.

import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { rename, copyFile, rm } from 'node:fs/promises';
import { join, dirname, resolve, basename, extname } from 'node:path';
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

interface IndexedTrash { rel: string; path: string }

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
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

function readIndex(root: string): IndexedTrash[] {
  const p = join(trashDir(root), INDEX_FILE);
  if (!existsSync(p)) return [];
  try {
    const v = JSON.parse(readFileSync(p, 'utf8')) as unknown;
    if (!Array.isArray(v)) return [];
    // Back-compat: the old format was plain rel strings; treat them as rel === path.
    return v.map((x): IndexedTrash | null => {
      if (typeof x === 'string') return { rel: x, path: x };
      if (x && typeof (x as IndexedTrash).rel === 'string' && typeof (x as IndexedTrash).path === 'string') return x as IndexedTrash;
      return null;
    }).filter((x): x is IndexedTrash => x !== null);
  } catch {
    return [];
  }
}

function writeIndex(root: string, entries: IndexedTrash[]): void {
  mkdirSync(trashDir(root), { recursive: true });
  writeFileSync(join(trashDir(root), INDEX_FILE), JSON.stringify(entries, null, 2));
}

/** A trash-relative path for `rel` that doesn't collide with an already-trashed item. */
function freeTrashRel(root: string, rel: string): string {
  const base = basename(rel, extname(rel));
  const ext = extname(rel);
  const candidate = (name: string) => (dirname(rel) === '.' ? name : join(dirname(rel), name));
  const free = (relPath: string) => {
    const abs = resolveIn(trashDir(root), relPath);
    return !!abs && !existsSync(abs);
  };
  if (free(rel)) return rel;
  for (let n = 0; ; n++) {
    const cand = candidate(`${base}-${n === 0 ? stamp() : `${stamp()}-${n}`}${ext}`);
    if (free(cand)) return cand;
  }
}

/** The trashed items (from the index; drift-safe — missing files are skipped). */
export async function listTrash(root: string): Promise<TrashItem[]> {
  const out: TrashItem[] = [];
  for (const e of readIndex(root)) {
    const abs = resolveIn(trashDir(root), e.path);
    if (!abs || !existsSync(abs)) continue;
    const st = statSync(abs);
    out.push({
      path: e.rel, // display/restore keyed by the original rel
      name: basename(e.rel),
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
  const trashRel = freeTrashRel(root, rel);
  const to = resolveIn(trashDir(root), trashRel);
  if (!to) throw new Error('unsafe path');
  mkdirSync(dirname(to), { recursive: true });
  await moveFile(abs, to);
  const idx = readIndex(root);
  if (!idx.some((e) => e.rel === rel && e.path === trashRel)) idx.push({ rel, path: trashRel });
  writeIndex(root, idx);
}

/** Restore a trashed item back to its original location. */
export async function restoreTrashPath(root: string, rel: string): Promise<void> {
  const idx = readIndex(root);
  const entry = [...idx].reverse().find((e) => e.rel === rel); // most recent first
  if (!entry) throw new Error('trash item not found');
  const from = resolveIn(trashDir(root), entry.path);
  if (!from || !existsSync(from)) throw new Error('trash item not found');
  const to = resolveSafe(privyBase(root), rel);
  if (!to) throw new Error('unsafe path');
  mkdirSync(dirname(to), { recursive: true });
  await moveFile(from, to);
  writeIndex(root, idx.filter((e) => e !== entry));
}

/** Permanently delete a trashed item. */
export async function deleteTrashPath(root: string, rel: string): Promise<void> {
  const idx = readIndex(root);
  const entry = [...idx].reverse().find((e) => e.rel === rel);
  const abs = entry ? resolveIn(trashDir(root), entry.path) : null;
  if (!entry || !abs) throw new Error('unsafe path');
  rmSync(abs, { recursive: true, force: true });
  writeIndex(root, idx.filter((e) => e !== entry));
}

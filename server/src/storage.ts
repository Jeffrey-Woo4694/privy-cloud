import { mkdirSync, createWriteStream, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { rename, copyFile, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, dirname, basename, extname } from 'node:path';
import type { ChatEntry } from '@privy/shared';
import { resolveSafe, privyBase, folderFor, proxyPathFor, pendingPathFor } from './directory.js';
import { detectKind } from './kinds.js';
import { appendEntry, renameEntries } from './chatLog.js';

export type UploadData = Buffer | Readable;

export function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'message';
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function uniquePath(root: string, folder: string, name: string): string {
  const ext = extname(name);
  const base = basename(name, ext);
  const free = (rel: string) => !existsSync(resolveSafe(privyBase(root), rel)!);
  const plain = `${folder}/${name}`;
  if (free(plain)) return plain;
  // The stamped name is itself a candidate, so re-check it and append an
  // incrementing nonce when it is also taken (same-second collisions). This
  // guarantees a free path, never silently overwriting an existing file.
  for (let n = 0; ; n++) {
    const suffix = n === 0 ? stamp() : `${stamp()}-${n}`;
    const cand = `${folder}/${base}-${suffix}${ext}`;
    if (free(cand)) return cand;
  }
}

/** Sanitize a single path segment (folder or file name). Returns null when invalid. */
export function sanitizeSegment(name: string): string | null {
  const clean = name.trim();
  if (!clean) return null;
  if (clean === '.' || clean === '..') return null;
  if (clean.startsWith('.')) return null; // hidden files are excluded from the view
  if (clean.includes('/') || clean.includes('\\') || clean.includes('\0')) return null;
  if (basename(clean) !== clean) return null;
  if (Buffer.byteLength(clean, 'utf8') > 255) return null; // ext4 caps a name at 255 bytes, not chars
  return clean;
}

async function writeAbs(root: string, rel: string, data: UploadData, exclusive = false): Promise<void> {
  const abs = resolveSafe(privyBase(root), rel);
  if (!abs) throw new Error('unsafe path');
  mkdirSync(dirname(abs), { recursive: true });
  if (data instanceof Readable) {
    // stream large files, never full-buffer
    await pipeline(data, createWriteStream(abs, exclusive ? { flags: 'wx' } : undefined));
  } else if (exclusive) {
    writeFileSync(abs, data, { flag: 'wx' }); // atomic create — throws EEXIST rather than overwriting
  } else {
    writeFileSync(abs, data);
  }
}

export async function storeText(root: string, text: string): Promise<ChatEntry> {
  const name = `${slugify(text)}-${stamp()}.md`;
  const path = uniquePath(root, 'Markdown', name);
  await writeAbs(root, path, Buffer.from(text, 'utf8'));
  return appendEntry(root, { type: 'text', kind: 'text', name, path, text, sender: 'owner' });
}

export async function storeFile(root: string, fileName: string, data: UploadData): Promise<ChatEntry> {
  const safeName = basename(fileName); // strip any directory separators from the filename
  const kind = detectKind(safeName, false);
  const folder = folderFor(kind);
  const path = uniquePath(root, folder, safeName);
  await writeAbs(root, path, data);
  return appendEntry(root, { type: 'file', kind, name: safeName, path, sender: 'owner' });
}

export async function storeFolder(root: string, folderName: string, files: Array<{ relativePath: string; data: UploadData }>): Promise<ChatEntry> {
  const base = uniquePath(root, 'Folders', folderName);
  for (const f of files) {
    const rel = join(base, f.relativePath);
    if (!resolveSafe(privyBase(root), rel)) throw new Error('unsafe folder path');
    await writeAbs(root, rel, f.data);
  }
  return appendEntry(root, { type: 'folder', kind: 'folder', name: folderName, path: base, sender: 'owner' });
}

/** An error carrying a structured code that the API route maps to an HTTP status. */
function httpError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** Validate a create target — name, parent directory, and free target — returning its rel + abs paths. */
function resolveCreateTarget(root: string, parentRel: string, name: string): { rel: string; abs: string } {
  const clean = sanitizeSegment(name);
  if (!clean) throw httpError('INVALID_NAME', 'invalid name');
  const base = privyBase(root);
  const parentAbs = parentRel === '' ? base : resolveSafe(base, parentRel);
  if (!parentAbs) throw httpError('UNSAFE_PARENT', 'unsafe parent path');
  // `.privy` is backend-internal (proxies, trash, chat log) — never let a client create inside it.
  const internal = join(base, '.privy');
  if (parentAbs === internal || parentAbs.startsWith(internal + '/')) throw httpError('UNSAFE_PARENT', 'unsafe parent path');
  if (!existsSync(parentAbs)) throw httpError('PARENT_NOT_FOUND', 'parent not found');
  if (!statSync(parentAbs).isDirectory()) throw httpError('PARENT_NOT_DIR', 'parent is not a directory');
  const rel = parentRel === '' ? clean : join(parentRel, clean);
  const abs = resolveSafe(base, rel);
  if (!abs) throw httpError('UNSAFE', 'unsafe path');
  if (existsSync(abs)) throw httpError('EXISTS', 'already exists');
  return { rel, abs };
}

/** Create an empty directory inside `parentRel` ('' = Privy Cloud root). Returns the new rel path. */
export async function createDirectory(root: string, parentRel: string, dirName: string): Promise<string> {
  const { rel, abs } = resolveCreateTarget(root, parentRel, dirName);
  mkdirSync(abs, { recursive: false }); // throws EEXIST on a race → route maps it to 409
  return rel;
}

/** Create a file with `data` inside `parentRel`. Returns the new rel path. */
export async function createFile(root: string, parentRel: string, fileName: string, data: UploadData): Promise<string> {
  const { rel } = resolveCreateTarget(root, parentRel, fileName);
  await writeAbs(root, rel, data, true); // exclusive — never silently overwrite
  return rel;
}

/**
 * Rename an item in place (same parent directory). Validates the new name,
 * refuses conflicts, moves any media proxy alongside, clears a stale pending
 * marker, and rewrites chat-log paths so history stays consistent. Returns the
 * new relative path. Same-parent rename only, so `rename` is atomic and EXDEV
 * cannot occur.
 */
export async function renameItem(root: string, path: string, newName: string): Promise<string> {
  const clean = sanitizeSegment(newName);
  if (!clean) throw httpError('INVALID_NAME', 'invalid name');
  const base = privyBase(root);
  const oldAbs = resolveSafe(base, path);
  if (!oldAbs) throw httpError('UNSAFE', 'unsafe path');
  // `.privy` is backend-internal (proxies, trash, chat log) — never let a client rename inside it.
  const internal = join(base, '.privy');
  if (oldAbs === internal || oldAbs.startsWith(internal + '/')) throw httpError('UNSAFE', 'unsafe path');
  if (!existsSync(oldAbs)) throw httpError('NOT_FOUND', 'not found');
  const isDir = statSync(oldAbs).isDirectory();
  const parent = dirname(path); // '.' when the item sits directly under Privy Cloud/
  const newRel = parent === '.' ? clean : join(parent, clean);
  const newAbs = resolveSafe(base, newRel);
  if (!newAbs) throw httpError('UNSAFE', 'unsafe path');
  if (newRel === path) return path; // same name — no-op (avoids self-conflict)
  if (existsSync(newAbs)) throw httpError('EXISTS', 'already exists');
  await rename(oldAbs, newAbs);
  const kind = detectKind(basename(path), isDir); // kind from the OLD name — a rename never changes the media encoding
  if (kind === 'video' || kind === 'image') {
    const oldProxy = proxyPathFor(root, path, kind);
    if (existsSync(oldProxy)) await rename(oldProxy, proxyPathFor(root, newRel, kind));
    const pending = pendingPathFor(root, path, kind);
    if (existsSync(pending)) await rm(pending, { force: true });
  }
  await renameEntries(root, path, newRel);
  return newRel;
}

/** Cross-device-safe move: rename, falling back to copy+remove when EXDEV. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

/**
 * Move already-staged temp files (written outside the watched root) into
 * Folders/<folderName>/<relativePath>, append a folder chat entry, and clean up
 * the staging dir. On any failure it removes the files already moved in (and the
 * folder itself when we created it) so no partial folder or temp litter remains.
 */
export async function stageFolderUpload(
  root: string,
  folderName: string,
  files: Array<{ relativePath: string; tmpPath: string }>,
  tmpDir: string,
): Promise<{ entry: ChatEntry; fileRels: string[] }> {
  const base = uniquePath(root, 'Folders', folderName);
  const baseAbs = resolveSafe(privyBase(root), base);
  if (!baseAbs) throw new Error('unsafe folder path');
  const baseExisted = existsSync(baseAbs);
  const moved: string[] = [];
  const fileRels: string[] = [];
  try {
    for (const f of files) {
      const rel = join(base, f.relativePath);
      const abs = resolveSafe(privyBase(root), rel);
      if (!abs) throw new Error('unsafe folder path');
      mkdirSync(dirname(abs), { recursive: true });
      await moveFile(f.tmpPath, abs);
      moved.push(abs);
      fileRels.push(rel);
    }
    const entry = await appendEntry(root, { type: 'folder', kind: 'folder', name: folderName, path: base, sender: 'owner' });
    return { entry, fileRels };
  } catch (err) {
    for (const abs of moved) rmSync(abs, { force: true });
    if (!baseExisted) rmSync(baseAbs, { recursive: true, force: true });
    throw err;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

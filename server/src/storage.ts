import { mkdirSync, createWriteStream, writeFileSync, existsSync, rmSync } from 'node:fs';
import { rename, copyFile, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, dirname, basename, extname } from 'node:path';
import type { ChatEntry } from '@privy/shared';
import { resolveSafe, privyBase, folderFor } from './directory.js';
import { detectKind } from './kinds.js';
import { appendEntry } from './chatLog.js';

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

async function writeAbs(root: string, rel: string, data: UploadData): Promise<void> {
  const abs = resolveSafe(privyBase(root), rel);
  if (!abs) throw new Error('unsafe path');
  mkdirSync(dirname(abs), { recursive: true });
  if (data instanceof Readable) {
    await pipeline(data, createWriteStream(abs)); // stream large files, never full-buffer
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
): Promise<ChatEntry> {
  const base = uniquePath(root, 'Folders', folderName);
  const baseAbs = resolveSafe(privyBase(root), base);
  if (!baseAbs) throw new Error('unsafe folder path');
  const baseExisted = existsSync(baseAbs);
  const moved: string[] = [];
  try {
    for (const f of files) {
      const rel = join(base, f.relativePath);
      const abs = resolveSafe(privyBase(root), rel);
      if (!abs) throw new Error('unsafe folder path');
      mkdirSync(dirname(abs), { recursive: true });
      await moveFile(f.tmpPath, abs);
      moved.push(abs);
    }
    return appendEntry(root, { type: 'folder', kind: 'folder', name: folderName, path: base, sender: 'owner' });
  } catch (err) {
    for (const abs of moved) rmSync(abs, { force: true });
    if (!baseExisted) rmSync(baseAbs, { recursive: true, force: true });
    throw err;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

import { mkdirSync, createWriteStream, writeFileSync, existsSync } from 'node:fs';
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
  const rel = `${folder}/${name}`;
  if (!existsSync(resolveSafe(privyBase(root), rel)!)) return rel;
  const ext = extname(name);
  const base = basename(name, ext);
  return `${folder}/${base}-${stamp()}${ext}`;
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

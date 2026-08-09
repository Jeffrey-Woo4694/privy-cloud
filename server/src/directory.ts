import { join, relative, isAbsolute, resolve } from 'node:path';
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { KIND_FOLDER, type FileItem, type Kind } from '@privy/shared';
import { detectKind } from './kinds.js';
import { createChatLog } from './chatLog.js';
import { ensurePermissions } from './permissions.js';

export const ROOT_CHILDREN = ['Hermes Agent', 'Coding Project', 'Privy Cloud'];
export const TYPE_FOLDERS = [...new Set(Object.values(KIND_FOLDER))]; // Images Videos Slides Documents Markdown Folders Other

export async function initRootStructure(root: string): Promise<void> {
  for (const child of ROOT_CHILDREN) mkdirSync(join(root, child), { recursive: true });
  for (const folder of TYPE_FOLDERS) mkdirSync(join(root, 'Privy Cloud', folder), { recursive: true });
  mkdirSync(join(root, 'Privy Cloud', '.privy'), { recursive: true });
  createChatLog(root);
  ensurePermissions(root);
}

export function privyBase(root: string): string {
  return join(root, 'Privy Cloud');
}

/** Resolves `rel` under `base`, rejecting anything that escapes `base` (relative or absolute). */
export function resolveSafe(base: string, rel: string): string | null {
  if (isAbsolute(rel)) return null;
  const norm = resolve(base, rel);
  if (norm === base) return base;
  if (!norm.startsWith(resolve(base) + '/')) return null;
  return norm;
}

export async function listItems(root: string): Promise<FileItem[]> {
  const base = join(root, 'Privy Cloud');
  const out: FileItem[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      const rel = relative(base, abs);
      const isDir = st.isDirectory();
      out.push({
        name, path: rel, isDir,
        kind: detectKind(name, isDir),
        size: isDir ? 0 : st.size,
        modifiedAt: st.mtime.toISOString(),
      });
      if (isDir) walk(abs);
    }
  };
  walk(base);
  return out;
}

export function folderFor(kind: Kind): string {
  return KIND_FOLDER[kind];
}

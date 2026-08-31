import type { FileItem } from '@privy/shared';
import type { KindFilterValue } from './components/KindFilter';

/** The parent path of a directory ('' when already at the root of Privy Cloud/). */
export function parentPath(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

/**
 * The items shown while browsing `currentPath` ('' = root of Privy Cloud/):
 * direct children only (not nested deeper). Directories are always shown so the
 * user can keep navigating; files are filtered by the kind chip.
 */
export function directChildren(items: FileItem[], currentPath: string, kind: KindFilterValue): FileItem[] {
  const prefix = currentPath ? currentPath + '/' : '';
  return items.filter((i) => {
    if (!i.path.startsWith(prefix)) return false;
    const rest = i.path.slice(prefix.length);
    if (rest.includes('/')) return false; // not a direct child
    if (i.isDir) return true; // folders always visible for navigation
    return kind === 'all' || i.kind === kind;
  });
}

/**
 * Re-resolve the open viewer's item against freshly-listed items so live flags
 * (proxyPending/hasProxy after a transcode, modifiedAt, size) update the editor
 * while it is open. If the path isn't in `items` — hidden, or a chat-card item
 * synthesized by openFile — the previous object is kept untouched.
 */
export function syncSelected<T extends { path: string }>(selected: T | null, items: T[]): T | null {
  if (!selected) return null;
  return items.find((i) => i.path === selected.path) ?? selected;
}

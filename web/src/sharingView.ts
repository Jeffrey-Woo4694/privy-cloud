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

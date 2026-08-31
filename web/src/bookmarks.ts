// User bookmarks: folders dragged into the sidebar's Quick-access section.
// Pure helpers here so the drag/drop/reorder logic is unit-testable; persistence
// lives in localStorage (desktop-shell app settings, like view/sort prefs).

export interface Bookmark { path: string; label: string }

const KEY = 'privy-bookmarks';

/** The folder name shown as the default bookmark label. */
export function bookmarkLabel(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

export function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((b): b is Bookmark =>
      !!b && typeof (b as Bookmark).path === 'string' && typeof (b as Bookmark).label === 'string');
  } catch { return []; }
}

export function saveBookmarks(list: Bookmark[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable — in-session only */ }
}

/** Add a folder bookmark; no-ops when the path is already present (dedupe by path). */
export function addBookmark(list: Bookmark[], path: string): Bookmark[] {
  if (list.some((b) => b.path === path)) return list;
  return [...list, { path, label: bookmarkLabel(path) }];
}

export function removeBookmark(list: Bookmark[], path: string): Bookmark[] {
  return list.filter((b) => b.path !== path);
}

/** Move a bookmark from index `from` to index `to` (insertion position, 0..len). */
export function moveBookmark(list: Bookmark[], from: number, to: number): Bookmark[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [b] = next.splice(from, 1);
  // Removing the item shifts later insertion points left by one.
  const target = to > from ? to - 1 : to;
  next.splice(Math.max(0, Math.min(next.length, target)), 0, b);
  return next;
}

/** After the directory itself was renamed on disk, point the bookmark at its new path. */
export function renameBookmark(list: Bookmark[], oldPath: string, newPath: string, newLabel: string): Bookmark[] {
  return list.map((b) => (b.path === oldPath ? { path: newPath, label: newLabel } : b));
}

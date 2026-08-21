// The sharing view's file-system "locations": virtual places (Home / Recent /
// Trash) plus the real category folders. Models the GNOME Files style navigation.

import type { FileItem } from '@privy/shared';
import { directChildren } from './sharingView';

export type Location =
  | { type: 'home' }
  | { type: 'recent' }
  | { type: 'trash' }
  | { type: 'folder'; path: string };

export function locationKey(loc: Location): string {
  return loc.type === 'folder' ? `folder:${loc.path}` : loc.type;
}

export interface Place { id: string; label: string; icon: string; location: Location }

/** The real category folders shown in the sidebar (Pictures maps to the Images folder). */
export const CATEGORY_PLACES: Place[] = [
  { id: 'Documents', label: 'Documents', icon: '📄', location: { type: 'folder', path: 'Documents' } },
  { id: 'Pictures',  label: 'Pictures',  icon: '🖼️', location: { type: 'folder', path: 'Images' } },
  { id: 'Videos',    label: 'Videos',    icon: '🎬', location: { type: 'folder', path: 'Videos' } },
  { id: 'Slides',    label: 'Slides',    icon: '📑', location: { type: 'folder', path: 'Slides' } },
  { id: 'Markdown',  label: 'Markdown',  icon: '📝', location: { type: 'folder', path: 'Markdown' } },
  { id: 'Folders',   label: 'Folders',   icon: '📂', location: { type: 'folder', path: 'Folders' } },
  { id: 'Other',     label: 'Other',     icon: '📦', location: { type: 'folder', path: 'Other' } },
];

const CATEGORY_DISPLAY: Record<string, string> = { Images: 'Pictures' };

/** Display label for a folder path segment in the breadcrumb. */
export function folderLabel(path: string): string {
  return CATEGORY_DISPLAY[path] ?? path.split('/').pop() ?? path;
}

/** Breadcrumb segments for a location: Home ▸ Pictures ▸ sub. */
export function pathSegments(loc: Location): Array<{ key: string; label: string; location: Location }> {
  if (loc.type !== 'folder') {
    const label = loc.type === 'home' ? 'Home' : loc.type === 'recent' ? 'Recent' : 'Trash';
    return [{ key: loc.type, label, location: loc }];
  }
  const parts = loc.path.split('/').filter(Boolean);
  const segments = [{ key: 'home', label: 'Home', location: { type: 'home' } as Location }];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    segments.push({ key: acc, label: folderLabel(acc), location: { type: 'folder', path: acc } });
  }
  return segments;
}

/** The grid items shown for a location. Recent = files, newest-modified first. */
export function itemsForLocation(loc: Location, items: FileItem[]): FileItem[] {
  if (loc.type === 'recent') {
    return items
      .filter((i) => !i.isDir)
      .slice()
      .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
      .slice(0, 100);
  }
  if (loc.type === 'trash') return [];
  return directChildren(items, loc.type === 'home' ? '' : loc.path, 'all');
}

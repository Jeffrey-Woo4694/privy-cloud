import { KINDS } from '@privy/shared';

export type SortKey = 'name' | 'size' | 'modified' | 'type';
export type Sort = { key: SortKey; dir: 'asc' | 'desc' };

/** Clicking a column header: a different column sorts ascending; the same column flips direction. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

/** Named sort presets shown in the view-options popover, mapped to {key, dir}. */
export interface SortPreset { id: string; label: string; sort: Sort }
export const SORT_PRESETS: SortPreset[] = [
  { id: 'az', label: 'A-Z', sort: { key: 'name', dir: 'asc' } },
  { id: 'za', label: 'Z-A', sort: { key: 'name', dir: 'desc' } },
  { id: 'last-modified', label: 'Last Modified', sort: { key: 'modified', dir: 'desc' } },
  { id: 'first-modified', label: 'First Modified', sort: { key: 'modified', dir: 'asc' } },
  { id: 'size', label: 'Size', sort: { key: 'size', dir: 'asc' } },
  { id: 'type', label: 'Type', sort: { key: 'type', dir: 'asc' } },
];

/** The preset id matching a current sort (or null if none — e.g. size descending). */
export function presetIdFor(sort: Sort): string | null {
  return SORT_PRESETS.find((p) => p.sort.key === sort.key && p.sort.dir === sort.dir)?.id ?? null;
}

const nameCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const kindLabel = (kind?: string) => KINDS.find((k) => k.key === kind)?.label ?? kind ?? '';

/** Sort file items by a column. Folders and files sort together ("mixed"); the
 *  comparator is natural for names (file2 < file10), numeric for size, by
 *  timestamp for modified, and by the item's kind label for type. Ties break on
 *  name so the order is stable. */
export function sortItems<T extends { name: string; size?: number; modifiedAt?: string; kind?: string }>(items: T[], sort: Sort): T[] {
  const arr = [...items];
  arr.sort((a, b) => {
    let c = 0;
    if (sort.key === 'name') c = nameCompare(a.name, b.name);
    else if (sort.key === 'size') c = (a.size ?? 0) - (b.size ?? 0);
    else if (sort.key === 'modified') c = (a.modifiedAt ? Date.parse(a.modifiedAt) : 0) - (b.modifiedAt ? Date.parse(b.modifiedAt) : 0);
    else c = nameCompare(kindLabel(a.kind), kindLabel(b.kind));
    if (c === 0) c = nameCompare(a.name, b.name);
    return sort.dir === 'asc' ? c : -c;
  });
  return arr;
}

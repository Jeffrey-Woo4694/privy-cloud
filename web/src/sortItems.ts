export type SortKey = 'name' | 'size' | 'modified';
export type Sort = { key: SortKey; dir: 'asc' | 'desc' };

/** Clicking a column header: a different column sorts ascending; the same column flips direction. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

/** Sort file items by a column. Folders and files sort together ("mixed"); the
 *  comparator is natural for names (file2 < file10), numeric for size, and by
 *  timestamp for modified. Ties break on name so the order is stable. */
export function sortItems<T extends { name: string; size?: number; modifiedAt?: string }>(items: T[], sort: Sort): T[] {
  const arr = [...items];
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  arr.sort((a, b) => {
    let c = 0;
    if (sort.key === 'name') c = byName(a, b);
    else if (sort.key === 'size') c = (a.size ?? 0) - (b.size ?? 0);
    else c = (a.modifiedAt ? Date.parse(a.modifiedAt) : 0) - (b.modifiedAt ? Date.parse(b.modifiedAt) : 0);
    if (c === 0) c = byName(a, b);
    return sort.dir === 'asc' ? c : -c;
  });
  return arr;
}

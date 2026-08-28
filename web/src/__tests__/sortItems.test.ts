import { describe, expect, it } from 'vitest';
import { sortItems, nextSort, presetIdFor } from '../sortItems';

const item = (name: string, size = 0, modifiedAt = '2026-01-01', kind?: string) => ({ name, size, modifiedAt, kind });

describe('sortItems', () => {
  it('sorts by name ascending with natural numeric ordering', () => {
    const a = item('file10'), b = item('file2'), c = item('file1');
    expect(sortItems([a, b, c], { key: 'name', dir: 'asc' }).map((i) => i.name)).toEqual(['file1', 'file2', 'file10']);
  });

  it('sorts by name descending', () => {
    const a = item('a'), b = item('b'), c = item('c');
    expect(sortItems([a, b, c], { key: 'name', dir: 'desc' }).map((i) => i.name)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by size ascending and descending', () => {
    const s1 = item('a', 5), s2 = item('b', 1), s3 = item('c', 10);
    expect(sortItems([s1, s2, s3], { key: 'size', dir: 'asc' }).map((i) => i.name)).toEqual(['b', 'a', 'c']);
    expect(sortItems([s1, s2, s3], { key: 'size', dir: 'desc' }).map((i) => i.name)).toEqual(['c', 'a', 'b']);
  });

  it('sorts by modified date', () => {
    const a = item('a', 0, '2026-03-01'), b = item('b', 0, '2026-01-01'), c = item('c', 0, '2026-02-01');
    expect(sortItems([a, b, c], { key: 'modified', dir: 'asc' }).map((i) => i.name)).toEqual(['b', 'c', 'a']);
    expect(sortItems([a, b, c], { key: 'modified', dir: 'desc' }).map((i) => i.name)).toEqual(['a', 'c', 'b']);
  });

  it('mixes folders and files together (both sort by the same column)', () => {
    const f = item('folder', 0), sm = item('small.txt', 5), big = item('big.txt', 100);
    expect(sortItems([big, f, sm], { key: 'size', dir: 'asc' }).map((i) => i.name)).toEqual(['folder', 'small.txt', 'big.txt']);
  });

  it('is stable (ties break on name)', () => {
    const x = item('b', 10), y = item('a', 10);
    expect(sortItems([x, y], { key: 'size', dir: 'asc' }).map((i) => i.name)).toEqual(['a', 'b']);
  });

  it('nextSort: first click ascending, same key flips, new key resets to asc', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'size')).toEqual({ key: 'size', dir: 'asc' });
  });

  it('sorts by type (kind label)', () => {
    const img = item('z.png', 0, '2026-01-01', 'image');
    const doc = item('a.docx', 0, '2026-01-01', 'document');
    const folder = item('m', 0, '2026-01-01', 'folder');
    // Ascending by kind label: Documents, Folders, Images.
    expect(sortItems([img, doc, folder], { key: 'type', dir: 'asc' }).map((i) => i.name)).toEqual(['a.docx', 'm', 'z.png']);
  });

  it('presetIdFor maps a sort to its named preset', () => {
    expect(presetIdFor({ key: 'name', dir: 'asc' })).toBe('az');
    expect(presetIdFor({ key: 'name', dir: 'desc' })).toBe('za');
    expect(presetIdFor({ key: 'modified', dir: 'desc' })).toBe('last-modified');
    expect(presetIdFor({ key: 'type', dir: 'asc' })).toBe('type');
    expect(presetIdFor({ key: 'size', dir: 'desc' })).toBeNull(); // no preset for descending size
  });
});

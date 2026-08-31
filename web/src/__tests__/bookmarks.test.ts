import { describe, expect, it, beforeEach } from 'vitest';
import { addBookmark, bookmarkLabel, loadBookmarks, moveBookmark, removeBookmark, renameBookmark, saveBookmarks } from '../bookmarks';

describe('bookmarks', () => {
  beforeEach(() => localStorage.clear());

  it('labels a bookmark by its folder name (nested or root)', () => {
    expect(bookmarkLabel('Project')).toBe('Project');
    expect(bookmarkLabel('Folders/File Provider Storage')).toBe('File Provider Storage');
  });

  it('adds once and dedupes by path', () => {
    let b = addBookmark([], 'Project');
    expect(b).toEqual([{ path: 'Project', label: 'Project' }]);
    b = addBookmark(b, 'Temp');
    expect(b.map((x) => x.path)).toEqual(['Project', 'Temp']);
    expect(addBookmark(b, 'Project')).toBe(b); // unchanged → same array (no churn)
  });

  it('removes by path', () => {
    const b = addBookmark(addBookmark([], 'Project'), 'Temp');
    expect(removeBookmark(b, 'Project')).toEqual([{ path: 'Temp', label: 'Temp' }]);
  });

  it('moves with insertion semantics (the drop gap between rows)', () => {
    const b = [{ path: 'a', label: 'a' }, { path: 'b', label: 'b' }, { path: 'c', label: 'c' }];
    expect(moveBookmark(b, 0, 3).map((x) => x.path)).toEqual(['b', 'c', 'a']); // a → after last
    expect(moveBookmark(b, 2, 0).map((x) => x.path)).toEqual(['c', 'a', 'b']); // c → front
    expect(moveBookmark(b, 1, 1)).toBe(b);                                     // no-op
    expect(moveBookmark(b, 0, 0)).toBe(b);
    expect(moveBookmark(b, 5, 1)).toBe(b);                                     // out of range
  });

  it('repoints a bookmark after the directory is renamed on disk', () => {
    const b = [{ path: 'Old Name', label: 'Old Name' }];
    expect(renameBookmark(b, 'Old Name', 'New Name', 'New Name')).toEqual([{ path: 'New Name', label: 'New Name' }]);
  });

  it('persists to and restores from localStorage, dropping malformed entries', () => {
    saveBookmarks([{ path: 'Project', label: 'Project' }]);
    expect(loadBookmarks()).toEqual([{ path: 'Project', label: 'Project' }]);
    localStorage.setItem('privy-bookmarks', 'not json');
    expect(loadBookmarks()).toEqual([]);
    localStorage.setItem('privy-bookmarks', '[{"path":"ok"},42,{"nope":true},{"path":"keep","label":"keep"}]');
    expect(loadBookmarks()).toEqual([{ path: 'keep', label: 'keep' }]); // only well-formed entries survive
  });
});

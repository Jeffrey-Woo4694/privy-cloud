import { describe, expect, it } from 'vitest';
import type { FileItem } from '@privy/shared';
import { directChildren, parentPath } from '../sharingView';

const items: FileItem[] = [
  { name: 'Images', path: 'Images', kind: 'folder', size: 0, isDir: true, modifiedAt: '' },
  { name: 'Videos', path: 'Videos', kind: 'folder', size: 0, isDir: true, modifiedAt: '' },
  { name: 'Folders', path: 'Folders', kind: 'folder', size: 0, isDir: true, modifiedAt: '' },
  { name: 'a.png', path: 'Images/a.png', kind: 'image', size: 1, isDir: false, modifiedAt: '' },
  { name: 'sub', path: 'Images/sub', kind: 'folder', size: 0, isDir: true, modifiedAt: '' },
  { name: 'deep.txt', path: 'Images/sub/deep.txt', kind: 'document', size: 1, isDir: false, modifiedAt: '' },
  { name: 'b.mp4', path: 'Videos/b.mp4', kind: 'video', size: 1, isDir: false, modifiedAt: '' },
];

describe('parentPath', () => {
  it('returns the parent of a nested path and "" at the root', () => {
    expect(parentPath('Folders/sub')).toBe('Folders');
    expect(parentPath('Images')).toBe('');
  });
});

describe('directChildren', () => {
  it('shows only the top-level directories at the root', () => {
    const out = directChildren(items, '', 'all');
    expect(out.map((i) => i.path)).toEqual(['Images', 'Videos', 'Folders']);
  });

  it('shows direct children of a folder, not nested items', () => {
    const out = directChildren(items, 'Images', 'all');
    expect(out.map((i) => i.path)).toEqual(['Images/a.png', 'Images/sub']);
  });

  it('filters files by kind but always shows folders (for navigation)', () => {
    const out = directChildren(items, 'Images', 'video');
    expect(out.map((i) => i.path)).toEqual(['Images/sub']); // folder shown, no video files
  });

  it('returns nothing for an empty/missing folder', () => {
    expect(directChildren(items, 'Documents', 'all')).toEqual([]);
  });
});

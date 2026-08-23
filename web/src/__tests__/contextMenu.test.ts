import { describe, expect, it } from 'vitest';
import { buildMenu } from '../contextMenu';
import type { FileItem } from '@privy/shared';
import type { TrashItem } from '../pages/PrivyCloudTab';

const file: FileItem = { name: 'note.md', path: 'Markdown/note.md', kind: 'markdown', size: 10, isDir: false, modifiedAt: 'x' };
const folder: FileItem = { name: 'docs', path: 'Folders/docs', kind: 'folder', size: 0, isDir: true, modifiedAt: 'x' };
const trash: TrashItem = { path: 'Images/a.png', name: 'a.png', isDir: false, size: 10, modifiedAt: 'x' };

describe('buildMenu', () => {
  it('background with canCreate offers New Folder then New File', () => {
    expect(buildMenu({ kind: 'background', canCreate: true }).map((i) => i.action)).toEqual(['new-folder', 'new-file']);
  });
  it('background without canCreate returns nothing', () => {
    expect(buildMenu({ kind: 'background', canCreate: false })).toEqual([]);
  });
  it('file menu: Open, Download, sep Rename, Trash, sep disabled Share', () => {
    const items = buildMenu({ kind: 'item', item: file });
    expect(items.map((i) => i.action)).toEqual(['open', 'download', 'rename', 'trash', 'share']);
    expect(items[0].separatorBefore).toBeUndefined();
    expect(items.find((i) => i.action === 'rename')?.separatorBefore).toBe(true);
    expect(items.find((i) => i.action === 'share')?.separatorBefore).toBe(true);
    expect(items.find((i) => i.action === 'share')?.disabled).toBe(true);
  });
  it('folder menu omits Download', () => {
    expect(buildMenu({ kind: 'item', item: folder }).map((i) => i.action)).toEqual(['open', 'rename', 'trash', 'share']);
  });
  it('trash menu: Restore and danger Delete Forever', () => {
    const items = buildMenu({ kind: 'trash', item: trash });
    expect(items.map((i) => i.action)).toEqual(['restore', 'delete-forever']);
    expect(items.find((i) => i.action === 'delete-forever')?.danger).toBe(true);
    expect(items.find((i) => i.action === 'delete-forever')?.separatorBefore).toBe(true);
  });
});

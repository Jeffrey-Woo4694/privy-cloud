import { describe, expect, it } from 'vitest';
import { parseDrop, partitionDrop, type EntryLike, type ItemLike } from '../dropPayload';

// Minimal fakes matching the EntryLike/ItemLike shapes parseDrop accepts.
function fileEntry(name: string, content = name): EntryLike {
  return {
    isFile: true, isDirectory: false, name,
    file(cb) { cb(new File([content], name)); },
  };
}
function dirEntry(name: string, children: EntryLike[]): EntryLike {
  let served = false;
  return {
    isFile: false, isDirectory: true, name,
    createReader() {
      return {
        readEntries(cb) {
          // Real readers yield entries in batches ending with an empty array.
          if (served) return cb([]);
          served = true;
          cb(children);
        },
      };
    },
  };
}
function item(entry: EntryLike | null, file?: File): ItemLike {
  return {
    kind: 'file',
    webkitGetAsEntry: entry ? () => entry : undefined,
    getAsFile: file ? () => file : undefined,
  };
}

describe('parseDrop', () => {
  it('treats a dropped entry file as a loose file (base empty)', async () => {
    const f = new File(['x'], 'photo.png');
    const items = await parseDrop({ items: [item(null, f)], files: [] });
    expect(items).toEqual([{ base: '', rel: 'photo.png', file: f }]);
  });

  it('walks a dropped directory and preserves structure + webkitRelativePath', async () => {
    const out = await parseDrop({
      items: [item(dirEntry('MyFolder', [fileEntry('a.txt', 'A'), dirEntry('sub', [fileEntry('b.txt', 'B')])]))],
      files: [],
    });
    expect(out).toHaveLength(2);
    const a = out.find((d) => d.rel === 'a.txt')!;
    const b = out.find((d) => d.rel === 'sub/b.txt')!;
    expect(a.base).toBe('MyFolder');
    expect(b.base).toBe('MyFolder');
    expect(a.file.name).toBe('a.txt');
    expect(a.file.size).toBe(1);
    expect(b.file.name).toBe('b.txt');
    expect(b.file.size).toBe(1);
    // webkitRelativePath is what sendFolder uses to rebuild the folder tree.
    expect(a.file.webkitRelativePath).toBe('MyFolder/a.txt');
    expect(b.file.webkitRelativePath).toBe('MyFolder/sub/b.txt');
  });

  it('falls back to getAsFile per item when webkitGetAsEntry is unavailable', async () => {
    const f = new File(['y'], 'doc.txt');
    const items = await parseDrop({ items: [item(null, f)], files: [] });
    expect(items.map((d) => d.rel)).toEqual(['doc.txt']);
  });

  it('falls back to DataTransfer.files when there are no usable items', async () => {
    const f = new File(['z'], 'a.md');
    const items = await parseDrop({ items: [], files: [f] });
    expect(items).toEqual([{ base: '', rel: 'a.md', file: f }]);
  });

  it('partitionDrop splits loose files from directory groups', () => {
    const f1 = new File(['a'], 'a.png');
    const f2 = new File(['b'], 'b.txt');
    const f3 = new File(['c'], 'c.txt');
    const { files, folders } = partitionDrop([
      { base: '', rel: 'a.png', file: f1 },
      { base: 'MyFolder', rel: 'b.txt', file: f2 },
      { base: 'MyFolder', rel: 'c.txt', file: f3 },
    ]);
    expect(files).toEqual([f1]);
    expect(folders).toEqual([[f2, f3]]);
  });
});

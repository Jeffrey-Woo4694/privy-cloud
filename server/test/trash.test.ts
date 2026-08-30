import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { trashDir, listTrash, trashPath, restoreTrashPath, deleteTrashPath } from '../src/trash.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

function boot() {
  root = mkdtempSync(join(tmpdir(), 'privy-trash-'));
  initRootStructure(root);
  const privy = join(root, 'Privy Cloud');
  mkdirSync(join(privy, 'Images'), { recursive: true });
  writeFileSync(join(privy, 'Images', 'a.jpg'), 'pic');
  writeFileSync(join(privy, 'Markdown', 'note.md'), '# hi');
  return privy;
}

describe('trash', () => {
  it('moves a file into the mirrored trash path and lists it', async () => {
    const privy = boot();
    await trashPath(root, 'Images/a.jpg');
    expect(existsSync(join(privy, 'Images', 'a.jpg'))).toBe(false);
    const inTrash = join(trashDir(root), 'Images', 'a.jpg');
    expect(existsSync(inTrash)).toBe(true);
    expect(readFileSync(inTrash, 'utf8')).toBe('pic');
    const items = await listTrash(root);
    expect(items.some((i) => i.path === 'Images/a.jpg' && !i.isDir)).toBe(true);
  });

  it('restores a trashed item back to its original location', async () => {
    const privy = boot();
    await trashPath(root, 'Markdown/note.md');
    await restoreTrashPath(root, 'Markdown/note.md');
    expect(existsSync(join(privy, 'Markdown', 'note.md'))).toBe(true);
    expect(existsSync(join(trashDir(root), 'Markdown', 'note.md'))).toBe(false);
  });

  it('permanently deletes a trashed item', async () => {
    boot();
    await trashPath(root, 'Images/a.jpg');
    await deleteTrashPath(root, 'Images/a.jpg');
    expect(existsSync(join(trashDir(root), 'Images', 'a.jpg'))).toBe(false);
    expect(await listTrash(root)).toEqual([]);
  });

  it('uniquifies a trash path when a same-named item is already in the trash (no EISDIR)', async () => {
    const privy = boot();
    mkdirSync(join(privy, 'x'), { recursive: true }); // folder "x"
    await trashPath(root, 'x'); // trash/x becomes a directory
    writeFileSync(join(privy, 'x'), 'content'); // new FILE also named "x"
    // Must not throw EISDIR — the file gets a uniquified trash path.
    await expect(trashPath(root, 'x')).resolves.not.toThrow();
    const items = await listTrash(root);
    const x = items.filter((i) => i.name === 'x');
    expect(x.length).toBe(2); // the folder and the file both trashed
    expect(x.some((i) => !i.isDir)).toBe(true); // the file is not reported as a dir
  });

  it('rejects paths that escape the trash dir', async () => {
    await expect(deleteTrashPath(root, '../../etc/passwd')).rejects.toThrow('unsafe path');
    await expect(trashPath(root, '../outside.txt')).rejects.toThrow();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatLog, appendEntry, readEntries, renameEntries } from '../src/chatLog.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('chatLog', () => {
  it('appends and reads entries newest-first', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    createChatLog(root);
    const a = await appendEntry(root, { type: 'text', kind: 'text', name: 'hi.md', text: 'hello', sender: 'owner' });
    const b = await appendEntry(root, { type: 'file', kind: 'image', name: 'a.png', path: 'Images/a.png', sender: 'owner' });
    const all = await readEntries(root);
    expect(all.map((e) => e.id)).toEqual([b.id, a.id]);
    expect(all[0].path).toBe('Images/a.png');
    expect(a.id.length).toBeGreaterThan(0);
  });

  it('readEntries respects limit', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    createChatLog(root);
    for (let i = 0; i < 5; i++) await appendEntry(root, { type: 'text', kind: 'text', name: `m${i}.md`, text: 'x', sender: 'owner' });
    expect((await readEntries(root, 2)).length).toBe(2);
  });

  it('renameEntries rewrites an exact file path', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    createChatLog(root);
    await appendEntry(root, { type: 'file', kind: 'image', name: 'a.png', path: 'Images/a.png', sender: 'owner' });
    await renameEntries(root, 'Images/a.png', 'Images/b.png');
    expect((await readEntries(root))[0].path).toBe('Images/b.png');
  });

  it('renameEntries rewrites folder descendants but not siblings', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    createChatLog(root);
    await appendEntry(root, { type: 'folder', kind: 'folder', name: 'docs', path: 'Folders/docs', sender: 'owner' });
    await appendEntry(root, { type: 'file', kind: 'markdown', name: 'x.md', path: 'Folders/docs/notes/x.md', sender: 'owner' });
    await appendEntry(root, { type: 'file', kind: 'markdown', name: 's.md', path: 'Folders/docs2/notes/s.md', sender: 'owner' });
    await renameEntries(root, 'Folders/docs', 'Folders/guide');
    const byPath = Object.fromEntries((await readEntries(root)).map((e) => [e.path, e]));
    expect(byPath['Folders/guide']).toBeTruthy();
    expect(byPath['Folders/guide/notes/x.md']).toBeTruthy();
    expect(byPath['Folders/docs2/notes/s.md']).toBeTruthy();
  });

  it('renameEntries is a no-op when nothing matches', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    createChatLog(root);
    await appendEntry(root, { type: 'text', kind: 'text', name: 'hi.md', text: 'x', sender: 'owner' }); // no path
    await appendEntry(root, { type: 'file', kind: 'image', name: 'a.png', path: 'Images/a.png', sender: 'owner' });
    await renameEntries(root, 'Videos/missing.mp4', 'Videos/other.mp4');
    expect((await readEntries(root)).map((e) => e.path)).toContain('Images/a.png');
  });
});

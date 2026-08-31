import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure, proxyPathFor, pendingPathFor } from '../src/directory.js';
import { storeText, storeFile, storeFolder, uniquePath, createDirectory, createFile, sanitizeSegment, renameItem } from '../src/storage.js';
import { readEntries, appendEntry } from '../src/chatLog.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('storage', () => {
  it('storeText writes a markdown file and a text chat entry', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    const entry = await storeText(root, 'hello world');
    expect(entry.type).toBe('text');
    expect(entry.path).toMatch(/^Markdown\//);
    expect(entry.path).toMatch(/\.md$/);
    expect(existsSync(join(root, 'Privy Cloud', entry.path!))).toBe(true);
    expect(readFileSync(join(root, 'Privy Cloud', entry.path!), 'utf8')).toBe('hello world');
  });

  it('storeFile routes by kind and appends a chat entry', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    const entry = await storeFile(root, 'photo.png', Buffer.from('png'));
    expect(entry.kind).toBe('image');
    expect(entry.path).toBe('Pictures/photo.png');
    const entries = await readEntries(root);
    expect(entries[0].path).toBe('Pictures/photo.png');
  });

  it('uniquePath adds a timestamp suffix on collision', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    const first = uniquePath(root, 'Documents', 'report.pdf');
    expect(first).toBe('Documents/report.pdf');
    // create the file on disk so the second call collides
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'report.pdf'), 'x');
    const second = uniquePath(root, 'Documents', 'report.pdf');
    expect(second).toMatch(/^Documents\/report-\d{8}-\d{6}\.pdf$/);
  });

  it('uniquePath re-checks collisions so same-second uploads never overwrite', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    // Freeze the clock so all three writes land in the same stamp() second — the
    // old code returns the same -<stamp> path for the 2nd and 3rd collision.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-02T03:04:05Z'));
    try {
      const a = await storeFile(root, 'burst.png', Buffer.from('aaaa'));
      const b = await storeFile(root, 'burst.png', Buffer.from('bbbb'));
      const c = await storeFile(root, 'burst.png', Buffer.from('cccc'));
      const paths = [a.path, b.path, c.path];
      expect(new Set(paths).size).toBe(3);
      expect(readFileSync(join(root, 'Privy Cloud', a.path!), 'utf8')).toBe('aaaa');
      expect(readFileSync(join(root, 'Privy Cloud', b.path!), 'utf8')).toBe('bbbb');
      expect(readFileSync(join(root, 'Privy Cloud', c.path!), 'utf8')).toBe('cccc');
    } finally {
      vi.useRealTimers();
    }
  });

  it('storeFolder preserves structure under Folders/<name>', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    const entry = await storeFolder(root, 'assets', [
      { relativePath: 'css/app.css', data: Buffer.from('body{}') },
      { relativePath: 'img/logo.png', data: Buffer.from('png') },
    ]);
    expect(entry.type).toBe('folder');
    expect(existsSync(join(root, 'Privy Cloud', 'Folders', 'assets', 'css', 'app.css'))).toBe(true);
    expect(existsSync(join(root, 'Privy Cloud', 'Folders', 'assets', 'img', 'logo.png'))).toBe(true);
  });
});

describe('create', () => {
  it('createDirectory makes a folder at the root and returns its rel path', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    const rel = await createDirectory(root, '', 'New Folder');
    expect(rel).toBe('New Folder');
    expect(statSync(join(root, 'Privy Cloud', rel)).isDirectory()).toBe(true);
  });

  it('createDirectory makes a nested folder under a parent', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    const rel = await createDirectory(root, 'Documents', 'notes');
    expect(rel).toBe('Documents/notes');
    expect(statSync(join(root, 'Privy Cloud', rel)).isDirectory()).toBe(true);
  });

  it('createFile writes content and returns its rel path', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    const rel = await createFile(root, 'Markdown', 'note.md', Buffer.from('# hi', 'utf8'));
    expect(rel).toBe('Markdown/note.md');
    expect(readFileSync(join(root, 'Privy Cloud', rel), 'utf8')).toBe('# hi');
  });

  it('create throws EXISTS on a collision and never overwrites', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    await createDirectory(root, '', 'dup');
    await expect(createDirectory(root, '', 'dup')).rejects.toMatchObject({ code: 'EXISTS' });
    await createFile(root, 'Markdown', 'note.md', Buffer.from('a'));
    await expect(createFile(root, 'Markdown', 'note.md', Buffer.from('b'))).rejects.toMatchObject({ code: 'EXISTS' });
    expect(readFileSync(join(root, 'Privy Cloud', 'Markdown', 'note.md'), 'utf8')).toBe('a');
  });

  it('create rejects unsafe names', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    for (const bad of ['../evil', '.privy', 'a/b', 'a\\b', '..', '']) {
      await expect(createDirectory(root, '', bad)).rejects.toMatchObject({ code: 'INVALID_NAME' });
    }
  });

  it('create rejects parents inside the internal .privy dir', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    mkdirSync(join(root, 'Privy Cloud', '.privy', 'trash'), { recursive: true });
    await expect(createDirectory(root, '.privy', 'x')).rejects.toMatchObject({ code: 'UNSAFE_PARENT' });
    await expect(createFile(root, '.privy/trash', 'x.txt', Buffer.from('x'))).rejects.toMatchObject({ code: 'UNSAFE_PARENT' });
  });

  it('createDirectory rejects a parent that is a file', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    await createFile(root, 'Markdown', 'note.md', Buffer.from('x'));
    await expect(createDirectory(root, 'Markdown/note.md', 'sub')).rejects.toMatchObject({ code: 'PARENT_NOT_DIR' });
  });

  it('sanitizeSegment caps names at 255 bytes, not 255 characters', () => {
    expect(sanitizeSegment('x'.repeat(255))).toBe('x'.repeat(255));
    expect(sanitizeSegment('x'.repeat(256))).toBeNull();
    // 100 emoji = 400 UTF-8 bytes, even though .length is only 100.
    expect(sanitizeSegment('💾'.repeat(100))).toBeNull();
  });
});

it('renameItem renames a file in place', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  await createFile(root, '', 'old.md', Buffer.from('# hi'));
  const rel = await renameItem(root, 'old.md', 'new.md');
  expect(rel).toBe('new.md');
  expect(existsSync(join(root, 'Privy Cloud', 'old.md'))).toBe(false);
  expect(readFileSync(join(root, 'Privy Cloud', 'new.md'), 'utf8')).toBe('# hi');
});

it('renameItem renames a folder and its descendants', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  await createDirectory(root, '', 'docs');
  await createFile(root, 'docs', 'a.txt', Buffer.from('a'));
  const rel = await renameItem(root, 'docs', 'guide');
  expect(rel).toBe('guide');
  expect(existsSync(join(root, 'Privy Cloud', 'docs'))).toBe(false);
  expect(readFileSync(join(root, 'Privy Cloud', 'guide', 'a.txt'), 'utf8')).toBe('a');
});

it('renameItem same name is a no-op', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  await createFile(root, '', 'a.txt', Buffer.from('a'));
  expect(await renameItem(root, 'a.txt', 'a.txt')).toBe('a.txt');
});

it('renameItem rejects invalid names, missing items, and conflicts', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  await createFile(root, '', 'a.txt', Buffer.from('a'));
  await expect(renameItem(root, 'a.txt', '../evil')).rejects.toMatchObject({ code: 'INVALID_NAME' });
  await expect(renameItem(root, 'a.txt', '.privy')).rejects.toMatchObject({ code: 'INVALID_NAME' });
  await expect(renameItem(root, 'missing.txt', 'b.txt')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await createFile(root, '', 'b.txt', Buffer.from('b'));
  await expect(renameItem(root, 'a.txt', 'b.txt')).rejects.toMatchObject({ code: 'EXISTS' });
});

it('renameItem moves a media proxy and clears pending', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  await createFile(root, '', 'clip.mov', Buffer.from('video'));
  mkdirSync(join(root, 'Privy Cloud', '.privy', 'proxies'), { recursive: true }); // the proxy dir does not exist yet
  writeFileSync(proxyPathFor(root, 'clip.mov', 'video'), 'PROXY');
  writeFileSync(pendingPathFor(root, 'clip.mov', 'video'), '');
  await renameItem(root, 'clip.mov', 'clip2.mov');
  expect(existsSync(proxyPathFor(root, 'clip.mov', 'video'))).toBe(false);
  expect(existsSync(proxyPathFor(root, 'clip2.mov', 'video'))).toBe(true);
  expect(existsSync(pendingPathFor(root, 'clip.mov', 'video'))).toBe(false);
});

it('renameItem rewrites matching chat-log paths', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  await createFile(root, '', 'note.md', Buffer.from('# hi'));
  await appendEntry(root, { type: 'file', kind: 'markdown', name: 'note.md', path: 'note.md', sender: 'owner' });
  await renameItem(root, 'note.md', 'renamed.md');
  expect((await readEntries(root))[0].path).toBe('renamed.md');
});

it('renameItem refuses the Privy Cloud root itself', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  // `.` and `''` normalize to the root. The storage layer receives the already-trimmed
  // value in production (the route passes `path.trim()`); the whitespace-`path` → 400
  // case is covered at the API layer, where `path.trim()` turns `' '` into `''`.
  await expect(renameItem(root, '.', 'x')).rejects.toMatchObject({ code: 'UNSAFE' });
  await expect(renameItem(root, '', 'x')).rejects.toMatchObject({ code: 'UNSAFE' });
});

it('renameItem refuses files inside the internal .privy dir', async () => {
  root = mkdtempSync(join(tmpdir(), 'privy-'));
  await initRootStructure(root);
  mkdirSync(join(root, 'Privy Cloud', '.privy', 'proxies'), { recursive: true });
  await expect(renameItem(root, '.privy/chat-log.jsonl', 'x')).rejects.toMatchObject({ code: 'UNSAFE' });
});

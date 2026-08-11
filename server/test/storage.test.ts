import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { storeText, storeFile, storeFolder, uniquePath } from '../src/storage.js';
import { readEntries } from '../src/chatLog.js';

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
    expect(entry.path).toBe('Images/photo.png');
    const entries = await readEntries(root);
    expect(entries[0].path).toBe('Images/photo.png');
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

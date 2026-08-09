import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure, resolveSafe, listItems, privyBase } from '../src/directory.js';
import { createChatLog } from '../src/chatLog.js';
import { ensurePermissions } from '../src/permissions.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

function makeRoot() {
  root = mkdtempSync(join(tmpdir(), 'privy-root-'));
  mkdirSync(join(root, 'Privy Cloud', 'Markdown'), { recursive: true });
  mkdirSync(join(root, 'Privy Cloud', 'Images'), { recursive: true });
  createChatLog(root);
  ensurePermissions(root);
}

describe('directory', () => {
  it('initRootStructure creates the three top-level dirs and all type folders', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-root-'));
    await initRootStructure(root);
    for (const d of ['Hermes Agent', 'Coding Project', 'Privy Cloud']) {
      expect(existsSync(join(root, d))).toBe(true);
    }
    for (const sub of ['Images','Videos','Slides','Documents','Markdown','Folders','Other']) {
      expect(existsSync(join(root, 'Privy Cloud', sub))).toBe(true);
    }
  });

  it('resolveSafe rejects traversal and absolute paths against the Privy Cloud base', () => {
    makeRoot();
    const base = privyBase(root);
    expect(resolveSafe(base, 'Markdown/a.md')).toBe(join(root, 'Privy Cloud', 'Markdown', 'a.md'));
    expect(resolveSafe(base, '../escape')).toBeNull();
    expect(resolveSafe(base, '/etc/passwd')).toBeNull();
    expect(resolveSafe(base, 'Markdown/../../x')).toBeNull();
    expect(resolveSafe(base, 'Markdown/../../../x')).toBeNull();
  });

  it('listItems walks Privy Cloud, excludes .privy and dotfiles, detects kinds', async () => {
    makeRoot();
    writeFileSync(join(root, 'Privy Cloud', 'Markdown', 'note.md'), '# hi');
    writeFileSync(join(root, 'Privy Cloud', 'Images', 'a.png'), 'img');
    writeFileSync(join(root, 'Privy Cloud', 'Markdown', '.hidden'), 'x');
    const items = await listItems(root);
    const names = items.map((i) => i.path);
    expect(names).toContain('Markdown/note.md');
    expect(names).toContain('Images/a.png');
    expect(names.some((p) => p.includes('.privy'))).toBe(false);
    expect(names.some((p) => p.endsWith('.hidden'))).toBe(false);
  });
});

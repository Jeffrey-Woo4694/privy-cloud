import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatLog, appendEntry, readEntries } from '../src/chatLog.js';

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
});

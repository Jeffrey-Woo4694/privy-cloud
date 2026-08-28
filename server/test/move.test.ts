import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { moveItems } from '../src/storage.js';

let root: string;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

async function setup() {
  root = mkdtempSync(join(tmpdir(), 'privy-mv-'));
  await initRootStructure(root);
  return root;
}

describe('moveItems', () => {
  it('moves a file into another folder (source removed)', async () => {
    await setup();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    mkdirSync(join(root, 'Privy Cloud', 'Images'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'a.txt'), 'A');
    const created = await moveItems(root, 'Images', ['Documents/a.txt']);
    expect(created).toEqual(['Images/a.txt']);
    expect(existsSync(join(root, 'Privy Cloud', 'Documents', 'a.txt'))).toBe(false);
    expect(readFileSync(join(root, 'Privy Cloud', 'Images', 'a.txt'), 'utf8')).toBe('A');
  });

  it('moves a folder and keeps its children intact', async () => {
    await setup();
    mkdirSync(join(root, 'Privy Cloud', 'Docs', 'sub'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Docs', 'x.txt'), 'X');
    writeFileSync(join(root, 'Privy Cloud', 'Docs', 'sub', 'y.txt'), 'Y');
    const created = await moveItems(root, 'Documents', ['Docs']);
    expect(created).toEqual(['Documents/Docs']);
    expect(readFileSync(join(root, 'Privy Cloud', 'Documents', 'Docs', 'x.txt'), 'utf8')).toBe('X');
    expect(readFileSync(join(root, 'Privy Cloud', 'Documents', 'Docs', 'sub', 'y.txt'), 'utf8')).toBe('Y');
    expect(existsSync(join(root, 'Privy Cloud', 'Docs'))).toBe(false);
  });

  it('uses a unique name when a file of that name already exists in the target', async () => {
    await setup();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    mkdirSync(join(root, 'Privy Cloud', 'other'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'b.txt'), 'ORIGINAL');
    writeFileSync(join(root, 'Privy Cloud', 'other', 'b.txt'), 'B');
    const created = await moveItems(root, 'Documents', ['other/b.txt']);
    expect(created[0]).toMatch(/^Documents\/b-\d{8}-\d{6}(-\d+)?\.txt$/);
    expect(readFileSync(join(root, 'Privy Cloud', 'Documents', 'b.txt'), 'utf8')).toBe('ORIGINAL');
    expect(readFileSync(join(root, 'Privy Cloud', created[0]), 'utf8')).toBe('B');
  });

  it('rejects escaping, .privy, and moving a folder into itself', async () => {
    await setup();
    mkdirSync(join(root, 'Privy Cloud', 'A', 'sub'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'A', 'f.txt'), 'F');
    await expect(moveItems(root, 'Documents', ['../evil'])).rejects.toThrow();
    await expect(moveItems(root, 'Documents', ['.privy/x'])).rejects.toThrow();
    await expect(moveItems(root, 'A', ['A'])).rejects.toThrow();
    await expect(moveItems(root, 'A/sub', ['A'])).rejects.toThrow();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { copyInto } from '../src/storage.js';

let root: string;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

async function setup() {
  root = mkdtempSync(join(tmpdir(), 'privy-copy-'));
  await initRootStructure(root);
  return root;
}

describe('copyInto', () => {
  it('copies a file into a target folder with a unique name (no overwrite)', async () => {
    await setup();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'a.txt'), 'ORIGINAL');
    const created = await copyInto(root, 'Documents', ['Documents/a.txt']);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatch(/^Documents\/a-\d{8}-\d{6}(-\d+)?\.txt$/); // a-<stamp>.txt
    expect(created[0]).not.toBe('Documents/a.txt');
    // The original is untouched; the copy holds the same bytes under a new name.
    expect(readFileSync(join(root, 'Privy Cloud', 'Documents', 'a.txt'), 'utf8')).toBe('ORIGINAL');
    expect(readFileSync(join(root, 'Privy Cloud', created[0]), 'utf8')).toBe('ORIGINAL');
  });

  it('copies into the Privy Cloud root when target is empty', async () => {
    await setup();
    writeFileSync(join(root, 'Privy Cloud', 'b.txt'), 'B');
    const created = await copyInto(root, '', ['b.txt']);
    expect(created[0]).toMatch(/^b-\d{8}-\d{6}(-\d+)?\.txt$/);
    expect(existsSync(join(root, 'Privy Cloud', created[0]))).toBe(true);
    expect(readFileSync(join(root, 'Privy Cloud', created[0]), 'utf8')).toBe('B');
  });

  it('recursively copies a folder tree', async () => {
    await setup();
    mkdirSync(join(root, 'Privy Cloud', 'Docs', 'sub'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Docs', 'x.txt'), 'X');
    writeFileSync(join(root, 'Privy Cloud', 'Docs', 'sub', 'y.txt'), 'Y');
    const created = await copyInto(root, 'Documents', ['Docs']);
    const destTop = created[0]; // Documents/Docs-<nonce>
    expect(destTop.startsWith('Documents/Docs')).toBe(true);
    expect(readFileSync(join(root, 'Privy Cloud', destTop, 'x.txt'), 'utf8')).toBe('X');
    expect(readFileSync(join(root, 'Privy Cloud', destTop, 'sub', 'y.txt'), 'utf8')).toBe('Y');
  });

  it('rejects escaping paths and the internal .privy area', async () => {
    await setup();
    const tmp = join(root, 'Privy Cloud', '.privy');
    writeFileSync(join(tmp, 'secret.txt'), 'S');
    await expect(copyInto(root, 'Documents', ['../evil'])).rejects.toThrow();
    await expect(copyInto(root, 'Documents', ['.privy/secret.txt'])).rejects.toThrow();
    await expect(copyInto(root, '.privy', ['Documents'])).rejects.toThrow();
  });

  it('refuses to copy a folder into itself or its descendant', async () => {
    await setup();
    mkdirSync(join(root, 'Privy Cloud', 'A', 'sub'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'A', 'f.txt'), 'F');
    await expect(copyInto(root, 'A', ['A'])).rejects.toThrow();
    await expect(copyInto(root, 'A/sub', ['A'])).rejects.toThrow();
  });
});

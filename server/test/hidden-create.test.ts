import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { createDirectory, createFile, uploadInto } from '../src/storage.js';

let root: string;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

async function setup() {
  root = mkdtempSync(join(tmpdir(), 'privy-hid-'));
  await initRootStructure(root);
  return root;
}

describe('hidden items', () => {
  it('creates a dot-prefixed directory (e.g. .demo)', async () => {
    await setup();
    const rel = await createDirectory(root, '', '.demo');
    expect(rel).toBe('.demo');
    expect(existsSync(join(root, 'Privy Cloud', '.demo'))).toBe(true);
  });

  it('creates a dot-prefixed file (e.g. .env)', async () => {
    await setup();
    const rel = await createFile(root, '', '.env', Buffer.from('SECRET'));
    expect(rel).toBe('.env');
    expect(readFileSync(join(root, 'Privy Cloud', '.env'), 'utf8')).toBe('SECRET');
  });

  it('still rejects the internal .privy name', async () => {
    await setup();
    await expect(createDirectory(root, '', '.privy')).rejects.toThrow();
    await expect(createFile(root, '', '.privy', Buffer.from('x'))).rejects.toThrow();
  });

  it('uploads a dot-prefixed file into a folder', async () => {
    await setup();
    const tmp = join(tmpdir(), `privy-hid-v-${Date.now()}`);
    writeFileSync(tmp, 'DATA');
    const created = await uploadInto(root, 'Documents', [{ base: '', rel: '.cfg', tmpPath: tmp }]);
    expect(created).toEqual(['Documents/.cfg']);
    expect(readFileSync(join(root, 'Privy Cloud', 'Documents', '.cfg'), 'utf8')).toBe('DATA');
  });
});

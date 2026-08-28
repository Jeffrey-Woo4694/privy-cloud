import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { uploadInto } from '../src/storage.js';
import { buildApp } from '../src/index.js';

let root: string;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

let n = 0;
function tmpFile(content: string): string {
  const p = join(tmpdir(), `privy-up-${Date.now()}-${n++}`);
  writeFileSync(p, content);
  return p;
}

async function setup() {
  root = mkdtempSync(join(tmpdir(), 'privy-up-test-'));
  await initRootStructure(root);
  return root;
}

describe('uploadInto', () => {
  it('places a loose file into the target folder', async () => {
    await setup();
    const created = await uploadInto(root, 'Documents', [{ base: '', rel: 'note.txt', tmpPath: tmpFile('HELLO') }]);
    expect(created).toEqual(['Documents/note.txt']);
    expect(readFileSync(join(root, 'Privy Cloud', 'Documents', 'note.txt'), 'utf8')).toBe('HELLO');
  });

  it('places into the Privy Cloud root when the target is empty', async () => {
    await setup();
    const created = await uploadInto(root, '', [{ base: '', rel: 'top.txt', tmpPath: tmpFile('X') }]);
    expect(created).toEqual(['top.txt']);
    expect(existsSync(join(root, 'Privy Cloud', 'top.txt'))).toBe(true);
  });

  it('unpacks a directory preserving nested structure', async () => {
    await setup();
    const created = await uploadInto(root, 'Documents', [{ base: 'MyFolder', rel: 'sub/deep/b.txt', tmpPath: tmpFile('SUB') }]);
    expect(created).toEqual(['Documents/MyFolder/sub/deep/b.txt']);
    expect(readFileSync(join(root, 'Privy Cloud', 'Documents', 'MyFolder', 'sub', 'deep', 'b.txt'), 'utf8')).toBe('SUB');
  });

  it('never silently overwrites an existing file', async () => {
    await setup();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'a.txt'), 'ORIGINAL');
    const c1 = await uploadInto(root, 'Documents', [{ base: '', rel: 'a.txt', tmpPath: tmpFile('ONE') }]);
    expect(c1[0]).not.toBe('Documents/a.txt');
    expect(readFileSync(join(root, 'Privy Cloud', c1[0]), 'utf8')).toBe('ONE');
    expect(readFileSync(join(root, 'Privy Cloud', 'Documents', 'a.txt'), 'utf8')).toBe('ORIGINAL');
  });

  it('rejects escaping paths (.. segments)', async () => {
    await setup();
    const tmp = tmpFile('X');
    await expect(uploadInto(root, 'Documents', [{ base: '..', rel: 'x.txt', tmpPath: tmp }])).rejects.toThrow();
    await expect(uploadInto(root, 'Documents', [{ base: '', rel: '../x.txt', tmpPath: tmp }])).rejects.toThrow();
    await expect(uploadInto(root, 'Documents', [{ base: '.hidden', rel: 'x.txt', tmpPath: tmp }])).rejects.toThrow();
  });

  it('rejects writes into the backend-internal .privy area', async () => {
    await setup();
    const tmp = tmpFile('X');
    await expect(uploadInto(root, '.privy', [{ base: '', rel: 'x.txt', tmpPath: tmp }])).rejects.toThrow();
    await expect(uploadInto(root, 'Documents', [{ base: '.privy', rel: 'x.txt', tmpPath: tmp }])).rejects.toThrow();
  });

  it('POST /api/upload writes dropped files into the target folder (integration)', async () => {
    process.env.HERMES_ENABLED = '0';
    await setup();
    const app = await buildApp({ root, token: 'test-token' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;

    const fd = new FormData();
    fd.append('base', '');
    fd.append('rel', 'photo.png');
    fd.append('file', new Blob(['PNGDATA'], { type: 'image/png' }), 'photo.png');
    const res = await fetch(`http://127.0.0.1:${port}/api/upload?path=Images`, {
      method: 'POST', headers: { authorization: 'Bearer test-token' }, body: fd,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { created: string[] };
    expect(body.created).toEqual(['Images/photo.png']);
    expect(readFileSync(join(root, 'Privy Cloud', 'Images', 'photo.png'), 'utf8')).toBe('PNGDATA');
    await app.close();
  });
});

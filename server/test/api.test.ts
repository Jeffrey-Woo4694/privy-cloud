import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/index.js';
import { initRootStructure } from '../src/directory.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function boot() {
  root = mkdtempSync(join(tmpdir(), 'privy-api-'));
  await initRootStructure(root);
  const app = await buildApp({ root });
  return app;
}

describe('api', () => {
  it('health + meta + items', async () => {
    const app = await boot();
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toEqual({ ok: true });

    const meta = await app.inject({ method: 'GET', url: '/api/meta' });
    expect(meta.json().root).toBe(root);

    mkdirSync(join(root, 'Privy Cloud', 'Markdown'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Markdown', 'note.md'), '# hi');
    const items = await app.inject({ method: 'GET', url: '/api/items' });
    expect(items.json().map((i: { path: string }) => i.path)).toContain('Markdown/note.md');

    mkdirSync(join(root, 'Privy Cloud', 'Images'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Images', 'pic.png'), 'x');
    const img = await app.inject({ method: 'GET', url: '/api/items?kind=image' });
    expect(img.json().map((i: { path: string }) => i.path)).toContain('Images/pic.png');
    expect(img.json().every((i: { kind: string }) => i.kind === 'image')).toBe(true);
    expect(img.json().map((i: { path: string }) => i.path)).not.toContain('Markdown/note.md');
    await app.close();
  });

  it('send text -> chat entry -> file readable and editable', async () => {
    const app = await boot();
    const sent = await app.inject({ method: 'POST', url: '/api/send/text', payload: { text: 'hello privy' } });
    expect(sent.statusCode).toBe(200);
    const entry = sent.json().entry as { path: string };
    expect(entry.path).toMatch(/^Markdown\//);

    const chat = await app.inject({ method: 'GET', url: '/api/chat' });
    expect(chat.json()[0].path).toBe(entry.path);

    const saved = await app.inject({ method: 'PUT', url: `/api/file?path=${encodeURIComponent(entry.path)}`, payload: { content: 'edited' } });
    expect(saved.statusCode).toBe(200);

    const got = await app.inject({ method: 'GET', url: `/api/file?path=${encodeURIComponent(entry.path)}` });
    expect(got.body).toBe('edited');
    await app.close();
  });

  it('rejects path traversal on file access', async () => {
    const app = await boot();
    const bad = await app.inject({ method: 'GET', url: '/api/file?path=' + encodeURIComponent('../secret.txt') });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('folder upload streams per-part and survives files beyond the backpressure threshold', async () => {
    const app = await boot();
    const BOUNDARY = '----privy-test';
    const CRLF = '\r\n';
    const mkPart = (head: string, body: Buffer): Buffer =>
      Buffer.concat([Buffer.from(`--${BOUNDARY}${CRLF}${head}${CRLF}${CRLF}`), body, Buffer.from(CRLF)]);
    const mkField = (name: string, value: string): Buffer =>
      Buffer.from(`--${BOUNDARY}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`);
    // 200 KB of a known repeating byte pattern per file — far beyond the ~16 KB
    // busboy backpressure threshold that stalls the old collect-all handler.
    const bigPayload = (seed: number): Buffer => {
      const b = Buffer.alloc(200 * 1024);
      for (let i = 0; i < b.length; i++) b[i] = (seed + i) % 251;
      return b;
    };
    const css = bigPayload(1);
    const png = bigPayload(200);
    const body = Buffer.concat([
      mkField('folderName', 'assets'),
      mkField('relativePath', 'css/app.css'),
      mkPart(`Content-Disposition: form-data; name="file"; filename="app.css"${CRLF}Content-Type: text/css`, css),
      mkField('relativePath', 'img/logo.png'),
      mkPart(`Content-Disposition: form-data; name="file"; filename="logo.png"${CRLF}Content-Type: image/png`, png),
      Buffer.from(`--${BOUNDARY}--${CRLF}`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/send/folder',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { entry: { type: string } }).entry.type).toBe('folder');
    const cssPath = join(root, 'Privy Cloud', 'Folders', 'assets', 'css', 'app.css');
    const pngPath = join(root, 'Privy Cloud', 'Folders', 'assets', 'img', 'logo.png');
    expect(existsSync(cssPath)).toBe(true);
    expect(existsSync(pngPath)).toBe(true);
    expect(readFileSync(cssPath)).toEqual(css);
    expect(readFileSync(pngPath)).toEqual(png);
    await app.close();
  });

  it('setRoot re-inits the new root', async () => {
    const app = await boot();
    const newRoot = mkdtempSync(join(tmpdir(), 'privy-new-'));
    const res = await app.inject({ method: 'PUT', url: '/api/settings/root', payload: { path: newRoot } });
    expect(res.statusCode).toBe(200);
    expect(res.json().root).toBe(newRoot);
    await app.close();
  });

  it('serves the web build from PRIVY_WEB_DIST and keeps /api 404s as JSON', async () => {
    const webDist = mkdtempSync(join(tmpdir(), 'privy-web-'));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>privy</title>');
    const prev = process.env.PRIVY_WEB_DIST;
    process.env.PRIVY_WEB_DIST = webDist;
    try {
      const app = await boot();
      const page = await app.inject({ method: 'GET', url: '/' });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<title>privy</title>');
      const missing = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ error: 'not found' });
      await app.close();
    } finally {
      if (prev === undefined) delete process.env.PRIVY_WEB_DIST; else process.env.PRIVY_WEB_DIST = prev;
      rmSync(webDist, { recursive: true, force: true });
    }
  });
});

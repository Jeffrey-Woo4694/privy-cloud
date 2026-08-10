import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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

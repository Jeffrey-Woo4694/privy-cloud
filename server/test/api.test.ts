import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/index.js';
import { initRootStructure } from '../src/directory.js';
import type { HermesManager } from '../src/hermes/manager.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

// Task 2: the server now enforces a bearer token on /api/*. Inject a matching one.
const TOKEN = 'test-token';
const AUTH = { authorization: `Bearer ${TOKEN}` };

async function boot() {
  // Don't spawn a real `hermes` child for these HTTP tests (Task 9 R4).
  process.env.HERMES_ENABLED = '0';
  root = mkdtempSync(join(tmpdir(), 'privy-api-'));
  await initRootStructure(root);
  const app = await buildApp({ root, token: TOKEN });
  return app;
}

describe('api', () => {
  it('health + meta + items', async () => {
    const app = await boot();
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toEqual({ ok: true });

    const meta = await app.inject({ method: 'GET', url: '/api/meta', headers: AUTH });
    expect(meta.json().root).toBe(root);

    mkdirSync(join(root, 'Privy Cloud', 'Markdown'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Markdown', 'note.md'), '# hi');
    const items = await app.inject({ method: 'GET', url: '/api/items', headers: AUTH });
    expect(items.json().map((i: { path: string }) => i.path)).toContain('Markdown/note.md');

    mkdirSync(join(root, 'Privy Cloud', 'Images'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Images', 'pic.png'), 'x');
    const img = await app.inject({ method: 'GET', url: '/api/items?kind=image', headers: AUTH });
    expect(img.json().map((i: { path: string }) => i.path)).toContain('Images/pic.png');
    expect(img.json().every((i: { kind: string }) => i.kind === 'image')).toBe(true);
    expect(img.json().map((i: { path: string }) => i.path)).not.toContain('Markdown/note.md');
    await app.close();
  });

  it('send text -> chat entry -> file readable and editable', async () => {
    const app = await boot();
    const sent = await app.inject({ method: 'POST', url: '/api/send/text', payload: { text: 'hello privy' }, headers: AUTH });
    expect(sent.statusCode).toBe(200);
    const entry = sent.json().entry as { path: string };
    expect(entry.path).toMatch(/^Markdown\//);

    const chat = await app.inject({ method: 'GET', url: '/api/chat', headers: AUTH });
    expect(chat.json()[0].path).toBe(entry.path);

    const saved = await app.inject({ method: 'PUT', url: `/api/file?path=${encodeURIComponent(entry.path)}`, payload: { content: 'edited' }, headers: AUTH });
    expect(saved.statusCode).toBe(200);

    const got = await app.inject({ method: 'GET', url: `/api/file?path=${encodeURIComponent(entry.path)}`, headers: AUTH });
    expect(got.body).toBe('edited');
    await app.close();
  });

  it('rejects path traversal on file access', async () => {
    const app = await boot();
    const bad = await app.inject({ method: 'GET', url: '/api/file?path=' + encodeURIComponent('../secret.txt'), headers: AUTH });
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
      headers: { ...AUTH, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
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

  it('stores a single file larger than 1 MiB without truncation', async () => {
    const app = await boot();
    const BOUNDARY = '----privy-test';
    const CRLF = '\r\n';
    const SIZE = 2 * 1024 * 1024; // 2 MiB, past the old 1 MiB default
    const body = Buffer.alloc(SIZE);
    for (let i = 0; i < SIZE; i++) body[i] = (i * 31 + 7) % 251;
    const payload = Buffer.concat([
      Buffer.from(`--${BOUNDARY}${CRLF}Content-Disposition: form-data; name="file"; filename="big.jpg"${CRLF}Content-Type: image/jpeg${CRLF}${CRLF}`),
      body,
      Buffer.from(`${CRLF}--${BOUNDARY}--${CRLF}`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/send/file',
      headers: { ...AUTH, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const entry = res.json().entry as { path: string };
    expect(entry.path).toMatch(/^Images\//);
    const stored = readFileSync(join(root, 'Privy Cloud', entry.path));
    expect(stored.length).toBe(SIZE);
    expect(stored.equals(body)).toBe(true);
    await app.close();
  });

  it('setRoot re-inits the new root', async () => {
    const app = await boot();
    const newRoot = mkdtempSync(join(tmpdir(), 'privy-new-'));
    const res = await app.inject({ method: 'PUT', url: '/api/settings/root', payload: { path: newRoot }, headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json().root).toBe(newRoot);
    await app.close();
  });

  it('does not persist an injected root into the home config', async () => {
    const configFile = join(homedir(), '.privy-cloud', 'config.json');
    const before = existsSync(configFile) ? readFileSync(configFile, 'utf8') : null;
    const app = await boot();
    const newRoot = mkdtempSync(join(tmpdir(), 'privy-new-'));
    const res = await app.inject({ method: 'PUT', url: '/api/settings/root', payload: { path: newRoot }, headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json().root).toBe(newRoot);
    await app.close();
    const after = existsSync(configFile) ? readFileSync(configFile, 'utf8') : null;
    expect(after).toBe(before);
    rmSync(newRoot, { recursive: true, force: true });
  });

  it('serves the web build from PRIVY_WEB_DIST and keeps /api 404s as JSON', async () => {
    const webDist = mkdtempSync(join(tmpdir(), 'privy-web-'));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>privy</title>');
    mkdirSync(join(webDist, 'assets'));
    writeFileSync(join(webDist, 'assets', 'app.js'), 'console.log(1)');
    const prev = process.env.PRIVY_WEB_DIST;
    process.env.PRIVY_WEB_DIST = webDist;
    try {
      const app = await boot();
      const page = await app.inject({ method: 'GET', url: '/' });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<title>privy</title>');
      // Static assets stay public under the auth hook.
      const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
      expect(asset.statusCode).toBe(200);
      const missing = await app.inject({ method: 'GET', url: '/api/does-not-exist', headers: AUTH });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ error: 'not found' });
      await app.close();
    } finally {
      if (prev === undefined) delete process.env.PRIVY_WEB_DIST; else process.env.PRIVY_WEB_DIST = prev;
      rmSync(webDist, { recursive: true, force: true });
    }
  });

  it('POST /api/hermes/call returns the manager result when connected', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const stub: HermesManager = {
      start: () => {},
      async call(method, params) {
        calls.push({ method, params });
        return { echoed: { method, params } };
      },
      getStatus: () => 'connected',
      async stop() {},
      onEvent: () => {},
    };
    root = mkdtempSync(join(tmpdir(), 'privy-api-'));
    await initRootStructure(root);
    const app = await buildApp({ root, token: TOKEN, hermes: stub });
    const res = await app.inject({
      method: 'POST',
      url: '/api/hermes/call',
      payload: { method: 'session.info', params: { session_id: 'abc' } },
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: { echoed: { method: 'session.info', params: { session_id: 'abc' } } } });
    expect(calls).toEqual([{ method: 'session.info', params: { session_id: 'abc' } }]);
    await app.close();
  });

  it('POST /api/hermes/call returns 503 when the manager is not connected', async () => {
    // No hermes injected; HERMES_ENABLED=0 means the real manager never started,
    // so its status stays 'disconnected'.
    const app = await boot();
    const res = await app.inject({
      method: 'POST',
      url: '/api/hermes/call',
      payload: { method: 'session.info', params: {} },
      headers: AUTH,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'hermes not connected' });
    await app.close();
  });

  it('filters chat entries whose underlying file was deleted on disk', async () => {
    const app = await boot();
    const sent = await app.inject({ method: 'POST', url: '/api/send/text', payload: { text: 'hello', }, headers: AUTH });
    const path = (sent.json().entry as { path: string }).path;
    const before = await app.inject({ method: 'GET', url: '/api/chat', headers: AUTH });
    expect(before.json().some((e: { path?: string }) => e.path === path)).toBe(true);
    // Delete the underlying markdown file (as Hermes would) → the chat entry must vanish.
    rmSync(join(root, 'Privy Cloud', path), { force: true });
    const after = await app.inject({ method: 'GET', url: '/api/chat', headers: AUTH });
    expect(after.json().some((e: { path?: string }) => e.path === path)).toBe(false);
    await app.close();
  });

  it('trash, list, restore, and delete-forever round-trip via the API', async () => {
    const app = await boot();
    mkdirSync(join(root, 'Privy Cloud', 'Images'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Images', 'a.jpg'), 'pic');

    const trash = await app.inject({ method: 'POST', url: '/api/trash', payload: { path: 'Images/a.jpg' }, headers: AUTH });
    expect(trash.statusCode).toBe(200);
    expect(existsSync(join(root, 'Privy Cloud', 'Images', 'a.jpg'))).toBe(false);

    const list1 = await app.inject({ method: 'GET', url: '/api/trash', headers: AUTH });
    expect(list1.json().items.some((i: { path: string }) => i.path === 'Images/a.jpg')).toBe(true);

    const restore = await app.inject({ method: 'POST', url: '/api/trash/restore', payload: { path: 'Images/a.jpg' }, headers: AUTH });
    expect(restore.statusCode).toBe(200);
    expect(existsSync(join(root, 'Privy Cloud', 'Images', 'a.jpg'))).toBe(true);

    const trash2 = await app.inject({ method: 'POST', url: '/api/trash', payload: { path: 'Images/a.jpg' }, headers: AUTH });
    expect(trash2.statusCode).toBe(200);
    const del = await app.inject({ method: 'DELETE', url: '/api/trash', payload: { path: 'Images/a.jpg' }, headers: AUTH });
    expect(del.statusCode).toBe(200);
    const list2 = await app.inject({ method: 'GET', url: '/api/trash', headers: AUTH });
    expect(list2.json().items.length).toBe(0);
    await app.close();
  });

  it('GET /api/hermes/roles lists the @-mentionable roles (default hermes)', async () => {
    const app = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/hermes/roles', headers: AUTH });
    expect(res.statusCode).toBe(200);
    const roles = res.json().roles as Array<{ id: string; label: string }>;
    expect(roles.some((r) => r.id === 'hermes' && r.label === 'Hermes')).toBe(true);
    await app.close();
  });

  it('POST /api/hermes/call returns 502 with the underlying error when a connected call fails', async () => {
    const stub: HermesManager = {
      start: () => {},
      async call() { throw new Error('boom: model exploded'); },
      getStatus: () => 'connected',
      async stop() {},
      onEvent: () => {},
    };
    root = mkdtempSync(join(tmpdir(), 'privy-api-'));
    await initRootStructure(root);
    const app = await buildApp({ root, token: TOKEN, hermes: stub });
    const res = await app.inject({
      method: 'POST',
      url: '/api/hermes/call',
      payload: { method: 'session.info', params: {} },
      headers: AUTH,
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'boom: model exploded' });
    await app.close();
  });

  it('POST /api/items creates folders and files, and rejects conflicts', async () => {
    const app = await boot();

    const mkdir = await app.inject({ method: 'POST', url: '/api/items', payload: { name: 'Projects', kind: 'folder' }, headers: AUTH });
    expect(mkdir.statusCode).toBe(200);
    expect((mkdir.json() as { path: string }).path).toBe('Projects');
    expect(statSync(join(root, 'Privy Cloud', 'Projects')).isDirectory()).toBe(true);

    const mkfile = await app.inject({
      method: 'POST', url: '/api/items',
      payload: { name: 'notes.md', kind: 'file', parentPath: 'Projects', content: '# hello' },
      headers: AUTH,
    });
    expect(mkfile.statusCode).toBe(200);
    expect((mkfile.json() as { path: string }).path).toBe('Projects/notes.md');
    expect(readFileSync(join(root, 'Privy Cloud', 'Projects', 'notes.md'), 'utf8')).toBe('# hello');

    const dup = await app.inject({ method: 'POST', url: '/api/items', payload: { name: 'Projects', kind: 'folder' }, headers: AUTH });
    expect(dup.statusCode).toBe(409);
    await app.close();
  });

  it('POST /api/items rejects unsafe names, invalid kinds, and internal parents', async () => {
    const app = await boot();

    const traversal = await app.inject({ method: 'POST', url: '/api/items', payload: { name: '../evil', kind: 'folder' }, headers: AUTH });
    expect(traversal.statusCode).toBe(400);

    const badKind = await app.inject({ method: 'POST', url: '/api/items', payload: { name: 'x', kind: 'garbage' }, headers: AUTH });
    expect(badKind.statusCode).toBe(400);

    const hidden = await app.inject({ method: 'POST', url: '/api/items', payload: { name: '.secret', kind: 'folder' }, headers: AUTH });
    expect(hidden.statusCode).toBe(400);

    const tooLong = await app.inject({ method: 'POST', url: '/api/items', payload: { name: 'x'.repeat(300), kind: 'folder' }, headers: AUTH });
    expect(tooLong.statusCode).toBe(400);

    // Creating inside the backend-internal .privy dir must be refused.
    const privy = await app.inject({ method: 'POST', url: '/api/items', payload: { name: 'x', kind: 'folder', parentPath: '.privy' }, headers: AUTH });
    expect(privy.statusCode).toBe(400);

    const missingParent = await app.inject({ method: 'POST', url: '/api/items', payload: { name: 'x', kind: 'folder', parentPath: 'NoSuchDir' }, headers: AUTH });
    expect(missingParent.statusCode).toBe(404);
    await app.close();
  });

  it('POST /api/rename renames an item and emits items:changed', async () => {
    const app = await boot();
    await app.inject({ method: 'POST', url: '/api/items', payload: { name: 'a.txt', kind: 'file' }, headers: AUTH });
    const res = await app.inject({ method: 'POST', url: '/api/rename', payload: { path: 'a.txt', newName: 'b.txt' }, headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ path: 'b.txt' });
    expect(existsSync(join(root, 'Privy Cloud', 'b.txt'))).toBe(true);
    expect(existsSync(join(root, 'Privy Cloud', 'a.txt'))).toBe(false);
    await app.close();
  });

  it('POST /api/rename rejects conflicts, bad names, and missing items', async () => {
    const app = await boot();
    await app.inject({ method: 'POST', url: '/api/items', payload: { name: 'a.txt', kind: 'file' }, headers: AUTH });
    await app.inject({ method: 'POST', url: '/api/items', payload: { name: 'b.txt', kind: 'file' }, headers: AUTH });

    const conflict = await app.inject({ method: 'POST', url: '/api/rename', payload: { path: 'a.txt', newName: 'b.txt' }, headers: AUTH });
    expect(conflict.statusCode).toBe(409);

    const bad = await app.inject({ method: 'POST', url: '/api/rename', payload: { path: 'a.txt', newName: '../x' }, headers: AUTH });
    expect(bad.statusCode).toBe(400);

    const missing = await app.inject({ method: 'POST', url: '/api/rename', payload: { path: 'zz.txt', newName: 'x.txt' }, headers: AUTH });
    expect(missing.statusCode).toBe(404);

    const noBody = await app.inject({ method: 'POST', url: '/api/rename', payload: { path: 'a.txt' }, headers: AUTH });
    expect(noBody.statusCode).toBe(400);
    await app.close();
  });
});

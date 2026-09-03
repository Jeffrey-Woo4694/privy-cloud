import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { buildApp } from '../src/index.js';
import { initRootStructure } from '../src/directory.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('office integration (stub engine)', () => {
  it('fetches the file via the session and writes a save back through the callback', async () => {
    process.env.HERMES_ENABLED = '0';
    root = mkdtempSync(join(tmpdir(), 'privy-int-'));
    await initRootStructure(root);
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'r.docx'), 'ORIGINAL_BYTES');

    // Stub "engine": serves the edited bytes on any GET. It is allowed as the
    // save origin because it is loopback (127.0.0.1) — the provider's fetchSave
    // guard permits loopback/private hosts.
    const engineUrl = await new Promise<string>((res) => {
      const server = createServer((_req, res2) => {
        res2.setHeader('content-type', 'application/octet-stream');
        res2.end('EDITED_BYTES');
      });
      server.listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${(server.address() as { port: number }).port}`));
    });

    const app = await buildApp({
      root, token: 'test-token',
      officeSecret: 'office-secret',
      officeEngineUrl: engineUrl,
    });

    const AUTH = { authorization: 'Bearer test-token' };
    const sess = await app.inject({ method: 'GET', url: '/api/office/session?path=' + encodeURIComponent('Documents/r.docx'), headers: AUTH });
    expect(sess.json().enabled).toBe(true);
    const { token, fileUrl, callbackUrl } = sess.json();

    // Engine fetches the ORIGINAL bytes via the session token. Inject the full
    // `fileUrl` directly: Fastify routes by pathname + query and ignores the
    // host:port, so production's host.containers.internal:5178 needs no rewrite.
    const fetched = await app.inject({ method: 'GET', url: fileUrl });
    expect(fetched.body).toBe('ORIGINAL_BYTES');

    // Engine saves edited content through the callback (stub engine's loopback).
    const cb = await app.inject({ method: 'POST', url: callbackUrl, payload: { status: 2, url: `${engineUrl}/save` } });
    expect(cb.json()).toEqual({ error: 0 });

    // The vault file is updated and a backup exists.
    expect(readFileSync(join(root, 'Privy Cloud', 'Documents', 'r.docx'), 'utf8')).toBe('EDITED_BYTES');
    const backups = join(root, 'Privy Cloud', '.privy', 'backups', 'Documents');
    expect(existsSync(backups) && readdirSync(backups).length > 0).toBe(true);
    await app.close();
  });

  it('force=1 evicts a stale lock so the file can be reopened without waiting for the TTL', async () => {
    process.env.HERMES_ENABLED = '0';
    root = mkdtempSync(join(tmpdir(), 'privy-int-'));
    await initRootStructure(root);
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 's.docx'), 'x');
    const app = await buildApp({ root, token: 'test-token', officeEngineUrl: 'http://127.0.0.1:9' });
    const AUTH = { authorization: 'Bearer test-token' };
    const url = (suffix: string) => '/api/office/session?path=' + encodeURIComponent('Documents/s.docx') + suffix;
    const s1 = await app.inject({ method: 'GET', url: url(''), headers: AUTH });
    expect(s1.json().enabled).toBe(true);
    const tok1 = s1.json().token as string;
    // A second {non-force} open of the still-locked file is rejected.
    const locked = await app.inject({ method: 'GET', url: url(''), headers: AUTH });
    expect(locked.statusCode).toBe(409);
    // force=1 evicts the stale session and mints a fresh, authoritative one.
    const s2 = await app.inject({ method: 'GET', url: url('&force=1'), headers: AUTH });
    expect(s2.statusCode).toBe(200);
    expect(s2.json().enabled).toBe(true);
    expect(s2.json().token).not.toBe(tok1);
    await app.close();
  });

  // The web app warms the engine's loader at launch, which needs the engine origin
  // before any document is chosen. Reusing /api/office/session for that would mint a
  // token and take a lock on a file nobody opened, so this route reports the origin
  // and nothing else.
  it('reports the engine origin without minting a session or locking a file', async () => {
    process.env.HERMES_ENABLED = '0';
    root = mkdtempSync(join(tmpdir(), 'privy-engine-'));
    await initRootStructure(root);
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'w.docx'), 'x');
    const app = await buildApp({ root, token: 'test-token', officeEngineUrl: 'https://doc.example' });
    const AUTH = { authorization: 'Bearer test-token' };

    const res = await app.inject({ method: 'GET', url: '/api/office/engine', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, engineUrl: 'https://doc.example' });
    expect(res.json().token).toBeUndefined();

    // Nothing was locked: a real open of any document still succeeds first time.
    const sess = await app.inject({
      method: 'GET', headers: AUTH,
      url: '/api/office/session?path=' + encodeURIComponent('Documents/w.docx'),
    });
    expect(sess.statusCode).toBe(200);
    await app.close();
  });

  it('reports the engine as disabled when no engine is configured', async () => {
    process.env.HERMES_ENABLED = '0';
    root = mkdtempSync(join(tmpdir(), 'privy-noengine-'));
    await initRootStructure(root);
    const app = await buildApp({ root, token: 'test-token' });
    const res = await app.inject({
      method: 'GET', url: '/api/office/engine',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(res.json()).toEqual({ enabled: false });
    await app.close();
  });
});

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
});

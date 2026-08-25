import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { OfficeProvider } from '../src/office.js';

let root: string;
const noop = () => {};
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.unstubAllGlobals(); });

async function makeProvider(engineUrl = 'http://docs.example') {
  root = mkdtempSync(join(tmpdir(), 'privy-off-'));
  await initRootStructure(root);
  return new OfficeProvider({ secret: 's', engineUrl, getRoot: () => root, emit: noop as never });
}

describe('office provider', () => {
  it('isConfigured reflects the engine url', async () => {
    expect((await makeProvider('')).isConfigured()).toBe(false);
    expect((await makeProvider('http://docs.example')).isConfigured()).toBe(true);
  });

  it('createSession mints a one-use token and locks the file', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'a.docx'), 'x');
    const info = p.createSession('Documents/a.docx');
    expect(info.enabled).toBe(true);
    expect(info.token).toBeTruthy();
    expect(info.fileUrl).toContain('token=');
    // The engine's `document.fileType` wants the real extension (docx), not the
    // editor-type tag (word) — the tag rides along separately as `fileType`.
    expect(info.fileType).toBe('word');
    expect(info.fileExt).toBe('docx');
    expect(() => p.createSession('Documents/a.docx')).toThrow(); // locked
    expect(p.validateToken(info.token!)).toBeTruthy();
  });

  it('rejects non-office and unknown paths', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Other'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Other', 'b.key'), 'x');
    expect(() => p.createSession('Other/b.key')).toThrow(); // Keynote not openable
    expect(() => p.createSession('missing.docx')).toThrow();
  });

  it('callback rejects a save from a disallowed origin (SSRF guard)', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'c.docx'), 'ORIGINAL');
    const info = p.createSession('Documents/c.docx');
    // A data: URL has no hostname → the guard rejects it; handleCallback returns
    // error 1 rather than throwing. The happy path (loopback fetch + write-back)
    // is proven end-to-end in the Task 5 integration test, not here.
    const result = await p.handleCallback(info.token!, { status: 2, url: 'data:text/plain,EDITED' });
    expect(result.error).toBe(1);
  });

  it('endSession releases a lock so the same file can be reopened (navigate-away bug)', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'f.docx'), 'x');
    const info1 = p.createSession('Documents/f.docx');
    expect(() => p.createSession('Documents/f.docx')).toThrow(); // locked while open
    p.endSession(info1.token!); // editor unmounted → release the lock
    const info2 = p.createSession('Documents/f.docx'); // reopen now succeeds
    expect(info2.enabled).toBe(true);
    expect(info2.token).not.toBe(info1.token);
    // The fresh session is authoritative: a stale close-save on the old token is rejected.
    expect(p.validateToken(info1.token!)).toBeNull();
    expect(p.validateToken(info2.token!)).toBeTruthy();
  });

  it('a status-0 callback (editor closed) releases the lock so the file can be reopened', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'g.docx'), 'x');
    const info = p.createSession('Documents/g.docx');
    await p.handleCallback(info.token!, { status: 0 });
    expect(p.createSession('Documents/g.docx').enabled).toBe(true);
  });

  it('acknowledges a stale status-0 (closed) callback as ok so the engine does not hold a recovery copy', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'h.docx'), 'x');
    const info1 = p.createSession('Documents/h.docx');
    p.endSession(info1.token!);             // editor unmounted → release the lock
    const info2 = p.createSession('Documents/h.docx'); // reopen → evicts info1's session
    expect(info2.token).not.toBe(info1.token);
    // The old session's engine posts status:0 (closed) with the now-stale token. With
    // the fix this is harmless (error 0); without it, the engine is told the document
    // failed to handle → it retains a recovery copy (slow reopen + "backup copy" warning).
    const result = await p.handleCallback(info1.token!, { status: 0 });
    expect(result.error).toBe(0);
  });

  it('handles a rel containing a pipe (|) — tokens are not split on it', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'a|b.docx'), 'x');
    const info = p.createSession('Documents/a|b.docx');
    expect(info.enabled).toBe(true);
    const s = p.validateToken(info.token!);
    expect(s).toBeTruthy();
    expect(s!.rel).toBe('Documents/a|b.docx');
  });

  it('releases a lock after its session expires (abandoned edit must not permanently lock)', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'd.docx'), 'x');
    const info1 = p.createSession('Documents/d.docx');
    expect(info1.enabled).toBe(true);
    expect(() => p.createSession('Documents/d.docx')).toThrow(); // locked
    // Force the session past its TTL. The next touch runs the sweep, deletes the
    // expired session and releases the lock, so a fresh session succeeds. (Casting
    // to reach the private session map — a real 30-minute wait is infeasible in a
    // unit test.)
    const sessions = (p as unknown as { sessions: Map<string, { rel: string; expiresAt: number }> }).sessions;
    sessions.get(info1.token!)!.expiresAt = Date.now() - 1;
    expect(p.createSession('Documents/d.docx').enabled).toBe(true);
  });

  it('fails a save whose file was moved/trashed mid-edit (no stale-path write)', async () => {
    const p = await makeProvider();
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    writeFileSync(join(root, 'Privy Cloud', 'Documents', 'e.docx'), 'ORIGINAL');
    const info = p.createSession('Documents/e.docx');
    rmSync(join(root, 'Privy Cloud', 'Documents', 'e.docx')); // moved/trashed while open
    // Stub fetch so the engine's save delivery succeeds. Without the fix the stale
    // path would then be recreated (this test would FAIL); with the fix the early
    // existsSync return prevents both the fetch and the write.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.from('EDITED').buffer })));
    const result = await p.handleCallback(info.token!, { status: 2, url: 'http://127.0.0.1:1/e.docx' });
    expect(result.error).toBe(1);
    // The stale path must not be recreated.
    expect(existsSync(join(root, 'Privy Cloud', 'Documents', 'e.docx'))).toBe(false);
  });

  it('refuses to open an office session for a .privy-backed path', async () => {
    const p = await makeProvider();
    const backups = join(root, 'Privy Cloud', '.privy', 'backups', 'Documents');
    mkdirSync(backups, { recursive: true });
    writeFileSync(join(backups, 'a.docx'), 'x'); // a real .docx backup file
    expect(() => p.createSession('.privy/backups/Documents/a.docx')).toThrow();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { OfficeProvider } from '../src/office.js';

let root: string;
const noop = () => {};
afterEach(() => rmSync(root, { recursive: true, force: true }));

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
});

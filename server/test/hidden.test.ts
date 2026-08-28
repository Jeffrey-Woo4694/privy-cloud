import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure, listItems } from '../src/directory.js';
import { buildApp } from '../src/index.js';

let root: string;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

async function setup() {
  root = mkdtempSync(join(tmpdir(), 'privy-hidden-'));
  await initRootStructure(root);
  writeFileSync(join(root, 'Privy Cloud', '.env'), 'SECRET');
  mkdirSync(join(root, 'Privy Cloud', '.config'), { recursive: true });
  writeFileSync(join(root, 'Privy Cloud', '.config', 'app.ini'), 'x');
  writeFileSync(join(root, 'Privy Cloud', 'notes.txt'), 'hi');
  return root;
}

describe('listItems hidden', () => {
  it('hides dotfiles by default and includes them when asked, except .privy', async () => {
    await setup();
    const names = (await listItems(root)).map((i) => i.name);
    expect(names).toContain('notes.txt');
    expect(names).not.toContain('.env');
    expect(names).not.toContain('.config');
    const shown = (await listItems(root, { includeHidden: true })).map((i) => i.name);
    expect(shown).toContain('.env');
    expect(shown).toContain('.config');
    expect(shown).not.toContain('.privy'); // backend-internal stays hidden
  });

  it('GET /api/items?hidden=1 includes dotfiles', async () => {
    process.env.HERMES_ENABLED = '0';
    await setup();
    const app = await buildApp({ root, token: 't' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const AUTH = { authorization: 'Bearer t' };
    const r1 = await fetch(`http://127.0.0.1:${port}/api/items`, { headers: AUTH });
    const n1 = (await r1.json() as Array<{ name: string }>).map((i) => i.name);
    const r2 = await fetch(`http://127.0.0.1:${port}/api/items?hidden=1`, { headers: AUTH });
    const n2 = (await r2.json() as Array<{ name: string }>).map((i) => i.name);
    expect(n1).not.toContain('.env');
    expect(n2).toContain('.env');
    await app.close();
  });
});

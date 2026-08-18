import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/index.js';
import { initRootStructure } from '../src/directory.js';
import { loadConfig } from '../src/config.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function boot() {
  // Don't spawn a real `hermes` child for these HTTP tests (Task 9 R4).
  process.env.HERMES_ENABLED = '0';
  root = mkdtempSync(join(tmpdir(), 'privy-auth-'));
  await initRootStructure(root);
  return buildApp({ root, token: 'test-token-123' });
}

describe('auth', () => {
  it('rejects /api without a token', async () => {
    const app = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/items' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
  it('rejects /api with a wrong token', async () => {
    const app = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/items', headers: { authorization: 'Bearer nope' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
  it('allows /api with the correct token', async () => {
    const app = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/items', headers: { authorization: 'Bearer test-token-123' } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
  it('keeps /api/health public', async () => {
    const app = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
  it('rejects the /ws handshake without a token query', async () => {
    const app = await boot();
    const res = await app.inject({ method: 'GET', url: '/ws' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
  it('passes the /ws handshake when the token is provided as a query param', async () => {
    const app = await boot();
    const res = await app.inject({ method: 'GET', url: '/ws?token=test-token-123' });
    // The auth hook must NOT 401 here; the WebSocket plugin handles the (non-upgrade) inject request.
    expect(res.statusCode).not.toBe(401);
    await app.close();
  });
});

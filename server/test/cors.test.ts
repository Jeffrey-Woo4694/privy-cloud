import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/index.js';
import { initRootStructure } from '../src/directory.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

// Task 2: the server enforces a bearer token on /api/*. /api/health stays public
// and OPTIONS preflights are answered by @fastify/cors before the auth hook, but
// pass the token anyway so these tests stay green regardless of hook ordering.
const AUTH = { authorization: 'Bearer test-token' };

async function boot() {
  // Don't spawn a real `hermes` child for these HTTP tests (Task 9 R4).
  process.env.HERMES_ENABLED = '0';
  root = mkdtempSync(join(tmpdir(), 'privy-cors-'));
  await initRootStructure(root);
  const app = await buildApp({ root, token: 'test-token' });
  return app;
}

const ALLOWED = [
  'http://localhost:5173',
  'http://localhost:5178',
  'tauri://localhost',
  'https://tauri.localhost',
];

describe('cors allowlist', () => {
  it.each(ALLOWED)('echoes access-control-allow-origin for allowed origin %s', async (origin) => {
    const app = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { ...AUTH, origin } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    await app.close();
  });

  it('does not set access-control-allow-origin for a disallowed origin', async () => {
    const app = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { ...AUTH, origin: 'http://evil.example' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('answers the CORS preflight with the allowlist (OPTIONS /api/health)', async () => {
    const app = await boot();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: { ...AUTH, origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    await app.close();
  });

  it('allows PUT in the preflight (markdown save)', async () => {
    const app = await boot();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/file',
      headers: { ...AUTH, origin: 'http://localhost:5173', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('PUT');
    await app.close();
  });
});

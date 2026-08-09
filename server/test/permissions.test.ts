import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePermissions, loadPermissions, checkPermission, permissionsPath } from '../src/permissions.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('permissions', () => {
  it('ensurePermissions creates owner default and is idempotent', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    ensurePermissions(root);
    expect(existsSync(permissionsPath(root))).toBe(true);
    ensurePermissions(root);
    expect((await loadPermissions(root)).owner).toBe('owner');
  });

  it('checkPermission always allows in v1', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    ensurePermissions(root);
    expect(await checkPermission(root, 'write')).toBe(true);
  });
});

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface PermissionEntry { user: string; read: boolean; write: boolean; edit: boolean }
export interface Permissions { owner: string; entries: PermissionEntry[] }

export function permissionsPath(root: string): string {
  return join(root, 'Privy Cloud', '.privy', 'permissions.json');
}

export function ensurePermissions(root: string): void {
  if (existsSync(permissionsPath(root))) return;
  mkdirSync(dirname(permissionsPath(root)), { recursive: true });
  writeFileSync(permissionsPath(root), JSON.stringify({ owner: 'owner', entries: [] } satisfies Permissions, null, 2));
}

export async function loadPermissions(root: string): Promise<Permissions> {
  ensurePermissions(root);
  return JSON.parse(readFileSync(permissionsPath(root), 'utf8')) as Permissions;
}

export async function checkPermission(_root: string, _action: 'read' | 'write' | 'edit'): Promise<boolean> {
  return true; // v1: single-owner, localhost only. Multi-user enforcement deferred.
}

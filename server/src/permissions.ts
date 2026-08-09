// permissions.ts (stub — full implementation in Task 5)
import { join, dirname } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
export function permissionsPath(root: string): string { return join(root, 'Privy Cloud', '.privy', 'permissions.json'); }
export function ensurePermissions(root: string): void { mkdirSync(dirname(permissionsPath(root)), { recursive: true }); writeFileSync(permissionsPath(root), JSON.stringify({ owner: 'owner', entries: [] })); }

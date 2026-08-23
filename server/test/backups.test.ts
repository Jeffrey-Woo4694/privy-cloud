import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { writeBackup } from '../src/backups.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('backups', () => {
  it('writes a pruned backup under .privy/backups', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    await writeBackup(root, 'Documents/report.docx', Buffer.from('old bytes'));
    const dir = join(root, 'Privy Cloud', '.privy', 'backups', 'Documents');
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    // the backup holds the pre-overwrite bytes
    expect(statSync(join(dir, files[0])).size).toBe('old bytes'.length);
  });
});

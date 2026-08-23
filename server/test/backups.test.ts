import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readdirSync, statSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { writeBackup } from '../src/backups.js';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

const backupsDir = () => join(root, 'Privy Cloud', '.privy', 'backups', 'Documents');

describe('backups', () => {
  it('writes a pruned backup under .privy/backups', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    mkdirSync(join(root, 'Privy Cloud', 'Documents'), { recursive: true });
    await writeBackup(root, 'Documents/report.docx', Buffer.from('old bytes'));
    const dir = backupsDir();
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    // the backup holds the pre-overwrite bytes
    expect(statSync(join(dir, files[0])).size).toBe('old bytes'.length);
  });

  it('prunes backups older than the age horizon', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    await writeBackup(root, 'Documents/report.docx', Buffer.from('fresh'));
    const dir = backupsDir();
    const stale = join(dir, 'stale.docx');
    writeFileSync(stale, Buffer.from('stale'));
    const longAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(stale, longAgo, longAgo);
    await writeBackup(root, 'Documents/report.docx', Buffer.from('fresh2'));
    expect(existsSync(stale)).toBe(false);
  });

  it('rejects a rel that would escape .privy/backups', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    await expect(writeBackup(root, 'Documents/../../secret.docx', Buffer.from('x'))).rejects.toThrow();
    await expect(writeBackup(root, '/abs/secret.docx', Buffer.from('x'))).rejects.toThrow();
    // nothing escaped into the live tree
    expect(existsSync(join(root, 'Privy Cloud', 'Documents', 'secret.docx'))).toBe(false);
  });
});

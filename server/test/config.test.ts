import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, setRoot } from '../src/config.js';

const HOME = process.env.HOME ?? '';
let dirs: string[] = [];
const fakeHome = () => { const d = mkdtempSync(join(tmpdir(), 'privy-home-')); dirs.push(d); return d; };

afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

describe('config', () => {
  it('loadConfig defaults to ~/PrivyCloud when no config file exists', async () => {
    const home = fakeHome();
    process.env.HOME = home;
    process.env.PRIVY_ROOT = '';
    const cfg = await loadConfig();
    expect(cfg.root).toBe(join(home, 'PrivyCloud'));
  });

  it('setRoot persists the root and returns the normalized absolute path', async () => {
    const home = fakeHome(); process.env.HOME = home; process.env.PRIVY_ROOT = '';
    const target = join(tmpdir(), 'my-data-dir');
    const got = await setRoot(target);
    expect(got).toBe(target);
    const cfgFile = join(home, '.privy-cloud', 'config.json');
    expect(existsSync(cfgFile)).toBe(true);
    expect(JSON.parse(readFileSync(cfgFile, 'utf8')).root).toBe(target);
  });

  it('loadConfig generates and persists a 64-hex-char token', async () => {
    const home = fakeHome(); process.env.HOME = home; process.env.PRIVY_ROOT = '';
    const cfg = await loadConfig();
    expect(cfg.token).toMatch(/^[0-9a-f]{64}$/);
    const raw = JSON.parse(readFileSync(join(home, '.privy-cloud', 'config.json'), 'utf8'));
    expect(raw.token).toBe(cfg.token);
    // A second load returns the same token (idempotent).
    const again = await loadConfig();
    expect(again.token).toBe(cfg.token);
  });

  it('honors a user-set custom token instead of regenerating it', async () => {
    const home = fakeHome(); process.env.HOME = home; process.env.PRIVY_ROOT = '';
    const cfgFile = join(home, '.privy-cloud', 'config.json');
    mkdirSync(join(home, '.privy-cloud'), { recursive: true });
    writeFileSync(cfgFile, JSON.stringify({ root: join(home, 'PrivyCloud'), token: '123qwe' }));
    const cfg = await loadConfig();
    expect(cfg.token).toBe('123qwe');
    // Idempotent — a second load must not regenerate a random token over the user's.
    const again = await loadConfig();
    expect(again.token).toBe('123qwe');
  });

  it('recovers from a corrupt config file instead of crashing', async () => {
    const home = fakeHome(); process.env.HOME = home; process.env.PRIVY_ROOT = '';
    const cfgFile = join(home, '.privy-cloud', 'config.json');
    mkdirSync(join(home, '.privy-cloud'), { recursive: true });
    writeFileSync(cfgFile, '{not valid json');
    const cfg = await loadConfig();
    expect(cfg.token).toMatch(/^[0-9a-f]{64}$/);
    expect(cfg.root).toBe(join(home, 'PrivyCloud'));
    // A subsequent corrupt file also survives setRoot (falls back to {} and
    // merges only the new root in).
    writeFileSync(cfgFile, 'also not json');
    const target = join(tmpdir(), 'my-data-dir');
    const got = await setRoot(target);
    expect(got).toBe(target);
    expect(JSON.parse(readFileSync(cfgFile, 'utf8')).root).toBe(target);
  });
});

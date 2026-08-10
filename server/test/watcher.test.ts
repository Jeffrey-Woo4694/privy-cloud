import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRootStructure } from '../src/directory.js';
import { createWatcher } from '../src/watcher.js';

let root: string;
let w: { stop(): Promise<void> } | undefined;
afterEach(async () => { if (w) await w.stop(); rmSync(root, { recursive: true, force: true }); });

function waitFor(fn: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (fn()) { clearInterval(t); resolve(); }
      else if (Date.now() - start > ms) { clearInterval(t); reject(new Error('timeout')); }
    }, 50);
  });
}

describe('watcher', () => {
  it('emits items:changed when a file is created on disk', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-'));
    await initRootStructure(root);
    const events: string[] = [];
    w = await createWatcher(root, (e) => { if (e.type === 'items:changed') events.push(e.path); });
    await waitFor(() => events.length >= 1); // initial sync
    events.length = 0;
    writeFileSync(join(root, 'Privy Cloud', 'Markdown', 'live.md'), '# live');
    await waitFor(() => events.some((p) => p.includes('live.md')));
    expect(events.some((p) => p.includes('live.md'))).toBe(true);
  });
});

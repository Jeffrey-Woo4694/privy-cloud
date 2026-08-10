import { watch, type FSWatcher } from 'chokidar';
import { relative, basename } from 'node:path';
import type { ServerEvent } from './api/routes.js';
import { listItems, privyBase } from './directory.js';

export async function createWatcher(root: string, onChange: (e: ServerEvent) => void): Promise<{ stop(): Promise<void> }> {
  const base = privyBase(root);
  const map = (abs: string): string => {
    if (abs.startsWith(base + '/')) return relative(base, abs);
    if (abs === base) return '';
    return relative(root, abs); // changes outside Privy Cloud (Hermes/, Coding/, root files)
  };

  let timer: NodeJS.Timeout | undefined;
  const debounce = (e: ServerEvent) => {
    clearTimeout(timer);
    timer = setTimeout(() => onChange(e), 120);
  };

  const w: FSWatcher = watch(root, {
    ignored: (p) => basename(p).startsWith('.'), // any hidden name (spec: "any name starting with .")
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  w.on('add', (p) => debounce({ type: 'items:changed', path: map(p), change: 'created' }));
  w.on('change', (p) => debounce({ type: 'items:changed', path: map(p), change: 'modified' }));
  w.on('unlink', (p) => debounce({ type: 'items:changed', path: map(p), change: 'deleted' }));
  w.on('unlinkDir', (p) => debounce({ type: 'items:changed', path: map(p), change: 'deleted' }));
  w.on('addDir', (p) => { if (map(p) !== 'Privy Cloud') debounce({ type: 'items:changed', path: map(p), change: 'created' }); });
  w.on('error', (err) => console.error('watcher error', err));

  // Periodic rescan: safety net for missed watcher events (spec §4.2). Diffs a snapshot
  // of the on-disk items every 30s and emits created/modified/deleted for the changes.
  let snapshot = new Map<string, { size: number; modifiedAt: string }>();
  const rescan = async () => {
    const items = await listItems(root).catch(() => []);
    const now = new Map(items.map((i) => [i.path, { size: i.size, modifiedAt: i.modifiedAt }]));
    for (const [p, cur] of now) {
      const prev = snapshot.get(p);
      if (!prev) debounce({ type: 'items:changed', path: p, change: 'created' });
      else if (prev.size !== cur.size || prev.modifiedAt !== cur.modifiedAt) debounce({ type: 'items:changed', path: p, change: 'modified' });
    }
    for (const p of snapshot.keys()) if (!now.has(p)) debounce({ type: 'items:changed', path: p, change: 'deleted' });
    snapshot = now;
  };
  void rescan();
  const interval = setInterval(() => void rescan(), 30_000);

  return {
    stop: async () => { clearTimeout(timer); clearInterval(interval); await w.close(); },
  };
}

import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ChatEntry } from '@privy/shared';

export function chatLogPath(root: string): string {
  return join(root, 'Privy Cloud', '.privy', 'chat-log.jsonl');
}

export function createChatLog(root: string): void {
  const file = chatLogPath(root);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '');
  }
}

export async function appendEntry(root: string, entry: Omit<ChatEntry, 'id' | 'ts'>): Promise<ChatEntry> {
  createChatLog(root);
  const full: ChatEntry = {
    ...entry,
    id: randomBytes(8).toString('hex'),
    ts: new Date().toISOString(),
  };
  appendFileSync(chatLogPath(root), JSON.stringify(full) + '\n');
  return full;
}

export async function readEntries(root: string, limit = 50): Promise<ChatEntry[]> {
  if (!existsSync(chatLogPath(root))) return [];
  const lines = readFileSync(chatLogPath(root), 'utf8').split('\n').filter(Boolean);
  const entries = lines.map((l) => JSON.parse(l) as ChatEntry);
  return entries.reverse().slice(0, limit);
}

/**
 * Rewrite every chat entry whose path falls under `oldRel` so it points at `newRel`.
 * Exact match renames a file; prefix match (with a `/` boundary) renames a folder
 * and all of its descendants. No-op when the log is missing or nothing matches.
 */
export async function renameEntries(root: string, oldRel: string, newRel: string): Promise<void> {
  const file = chatLogPath(root);
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let changed = false;
  const out = lines.map((line) => {
    const entry = JSON.parse(line) as ChatEntry;
    if (!entry.path) return line;
    if (entry.path === oldRel) {
      changed = true;
      return JSON.stringify({ ...entry, path: newRel });
    }
    if (entry.path.startsWith(oldRel + '/')) {
      changed = true;
      return JSON.stringify({ ...entry, path: newRel + entry.path.slice(oldRel.length) });
    }
    return line;
  });
  if (changed) writeFileSync(file, out.join('\n') + '\n');
}

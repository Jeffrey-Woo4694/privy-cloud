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

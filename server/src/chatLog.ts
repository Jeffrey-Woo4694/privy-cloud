// chatLog.ts (stub — full implementation in Task 5)
import { join, dirname } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
export function chatLogPath(root: string): string { return join(root, 'Privy Cloud', '.privy', 'chat-log.jsonl'); }
export function createChatLog(root: string): void { mkdirSync(dirname(chatLogPath(root)), { recursive: true }); writeFileSync(chatLogPath(root), ''); }

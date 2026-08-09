import { KINDS, type Kind } from '@privy/shared';

export function detectKind(name: string, isDir: boolean): Kind {
  if (isDir) return 'folder';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return KINDS.find((k) => k.extensions.includes(ext))?.key ?? 'other';
}

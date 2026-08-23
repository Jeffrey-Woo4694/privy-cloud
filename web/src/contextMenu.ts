import type { FileItem } from '@privy/shared';
import type { TrashItem } from './pages/PrivyCloudTab';

export type MenuAction = 'new-folder' | 'new-file' | 'open' | 'download' | 'rename' | 'trash' | 'restore' | 'delete-forever' | 'share';

export type MenuContext =
  | { kind: 'background'; canCreate: boolean }
  | { kind: 'item'; item: FileItem }
  | { kind: 'trash'; item: TrashItem };

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  action: MenuAction;
  disabled?: boolean;        // visible but greyed
  danger?: boolean;          // red styling (Delete Forever)
  separatorBefore?: boolean; // render a divider above this item
}

export function buildMenu(ctx: MenuContext): MenuItem[] {
  if (ctx.kind === 'background') {
    if (!ctx.canCreate) return [];
    return [
      { id: 'new-folder', label: 'New Folder', icon: '📁', action: 'new-folder' },
      { id: 'new-file', label: 'New File', icon: '📄', action: 'new-file' },
    ];
  }
  if (ctx.kind === 'trash') {
    return [
      { id: 'restore', label: 'Restore', icon: '↩️', action: 'restore' },
      { id: 'delete-forever', label: 'Delete Forever', icon: '🗑️', action: 'delete-forever', danger: true, separatorBefore: true },
    ];
  }
  const { item } = ctx;
  return [
    { id: 'open', label: 'Open', icon: item.isDir ? '📂' : '👁️', action: 'open' },
    ...(item.isDir
      ? []
      : [{ id: 'download', label: 'Download', icon: '⬇️', action: 'download' as MenuAction }]),
    { id: 'rename', label: 'Rename', icon: '✏️', action: 'rename', separatorBefore: true },
    { id: 'trash', label: 'Move to Trash', icon: '🗑️', action: 'trash' },
    { id: 'share', label: 'Share…', icon: '🔗', action: 'share', disabled: true, separatorBefore: true },
  ];
}

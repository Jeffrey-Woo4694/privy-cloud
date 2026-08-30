import type { FileItem } from '@privy/shared';
import type { TrashItem } from './pages/PrivyCloudTab';
import type { IconName } from './components/icons';

export type MenuAction = 'new-folder' | 'new-file' | 'open' | 'download' | 'rename' | 'trash' | 'restore' | 'delete-forever' | 'share';

export type MenuContext =
  | { kind: 'background'; canCreate: boolean }
  | { kind: 'item'; item: FileItem }
  | { kind: 'trash'; item: TrashItem };

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  action: MenuAction;
  disabled?: boolean;        // visible but greyed
  danger?: boolean;          // red styling (Delete Forever)
  separatorBefore?: boolean; // render a divider above this item
}

export function buildMenu(ctx: MenuContext): MenuItem[] {
  if (ctx.kind === 'background') {
    if (!ctx.canCreate) return [];
    return [
      { id: 'new-folder', label: 'New Folder', icon: 'folderPlus', action: 'new-folder' },
      { id: 'new-file', label: 'New File', icon: 'filePlus', action: 'new-file' },
    ];
  }
  if (ctx.kind === 'trash') {
    return [
      { id: 'restore', label: 'Restore', icon: 'undo', action: 'restore' },
      { id: 'delete-forever', label: 'Delete Forever', icon: 'trash', action: 'delete-forever', danger: true, separatorBefore: true },
    ];
  }
  const { item } = ctx;
  const menu: MenuItem[] = [
    { id: 'open', label: 'Open', icon: item.isDir ? 'folder' : 'eye', action: 'open' },
  ];
  if (!item.isDir) menu.push({ id: 'download', label: 'Download', icon: 'download', action: 'download' });
  menu.push(
    { id: 'rename', label: 'Rename', icon: 'pencil', action: 'rename', separatorBefore: true },
    { id: 'trash', label: 'Move to Trash', icon: 'trash', action: 'trash' },
    { id: 'share', label: 'Share…', icon: 'link', action: 'share', disabled: true, separatorBefore: true },
  );
  return menu;
}

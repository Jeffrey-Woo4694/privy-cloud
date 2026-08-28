import { useState } from 'react';
import type { FileItem } from '@privy/shared';
import type { MouseEvent as ReactMouseEvent, DragEvent as ReactDragEvent } from 'react';

/** The file-manager interaction handlers shared by the grid tiles and the list rows:
 *  single-click selects, double-click opens, drag-to-move onto a folder, and Shift is
 *  passed through for range selection. Keeps the two views behaving identically. */
export function useItemInteraction(opts: {
  onSelect(item: FileItem, shiftKey: boolean): void;
  onOpen?: (item: FileItem) => void;
  onMoveTo?(from: string, to: string): void;
  selected?: Set<string>;
  singleClickOpens?: boolean;
}) {
  const { onSelect, onOpen, onMoveTo, selected, singleClickOpens } = opts;
  const [dragPath, setDragPath] = useState<string | null>(null);

  const isDropTarget = (item: FileItem): boolean => !!onMoveTo && item.isDir && dragPath !== null && dragPath !== item.path;

  const interactionFor = (item: FileItem) => ({
    draggable: true,
    onClick: (e: ReactMouseEvent) => (singleClickOpens ? onOpen?.(item) : onSelect(item, e.shiftKey)),
    onDoubleClick: () => onOpen?.(item),
    onDragStart: (e: ReactDragEvent) => { setDragPath(item.path); e.dataTransfer.setData('text/plain', item.path); e.dataTransfer.effectAllowed = 'move'; },
    onDragEnd: () => setDragPath(null),
    onDragOver: (e: ReactDragEvent) => { if (item.isDir && dragPath && dragPath !== item.path) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } },
    onDrop: (e: ReactDragEvent) => { e.preventDefault(); const from = e.dataTransfer.getData('text/plain') || dragPath; setDragPath(null); if (item.isDir && from && from !== item.path) onMoveTo?.(from, item.path); },
  });

  /** Compose a tile/row class name (base + selected + drop-target). */
  const cls = (base: string, item: FileItem): string =>
    `${base}${selected?.has(item.path) ? ' selected' : ''}${isDropTarget(item) ? ' drop-target' : ''}`;

  return { interactionFor, isDropTarget, cls };
}

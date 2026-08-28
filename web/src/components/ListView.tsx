import { KINDS, type FileItem, type Kind } from '@privy/shared';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useItemInteraction } from '../useItemInteraction';
import type { Sort, SortKey } from '../sortItems';

const ICON: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.icon])) as Record<Kind, string>;

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** List view of the sharing grid: a Name|Size|Modified table with sortable headers.
 *  Rows carry the same interactions as the grid tiles (select / double-click to open /
 *  drag-to-move / shift-range / context menu) via the shared interaction hook. */
export function ListView({ items, selected, singleClickOpens, onSelect, onOpen, onMoveTo, onTileContextMenu, sort, onSort, emptyMessage }: {
  items: FileItem[]; selected?: Set<string>; singleClickOpens?: boolean;
  onSelect: (item: FileItem, shiftKey: boolean) => void; onOpen: (item: FileItem) => void;
  onMoveTo?: (from: string, to: string) => void;
  onTileContextMenu?: (e: ReactMouseEvent<HTMLElement>, item: FileItem) => void;
  sort: Sort; onSort: (key: SortKey) => void; emptyMessage?: string;
}) {
  const { interactionFor, cls } = useItemInteraction({ onSelect, onOpen, onMoveTo, selected, singleClickOpens });
  if (items.length === 0) return <div className="empty-state">{emptyMessage ?? 'Nothing here yet — send something from the chat.'}</div>;

  const header = (key: SortKey, label: string) => (
    <th className={`sortable${sort.key === key ? ' active' : ''}`} onClick={() => onSort(key)} title={`Sort by ${label}`}>
      {label}{sort.key === key && <span className="sort-arrow">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
    </th>
  );

  return (
    <table className="list-table">
      <thead><tr>{header('name', 'Name')}{header('size', 'Size')}{header('modified', 'Modified')}</tr></thead>
      <tbody>
        {items.map((item) => {
          const h = interactionFor(item);
          return (
            <tr key={item.path} className={cls('list-row', item)} draggable={h.draggable}
              onClick={h.onClick} onDoubleClick={h.onDoubleClick}
              onDragStart={h.onDragStart} onDragEnd={h.onDragEnd} onDragOver={h.onDragOver} onDrop={h.onDrop}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onTileContextMenu?.(e, item); }}>
              <td className="list-name">{ICON[item.kind]} {item.name}</td>
              <td className="list-size">{item.isDir ? '—' : fmtSize(item.size)}</td>
              <td className="list-modified">{new Date(item.modifiedAt).toLocaleString()}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

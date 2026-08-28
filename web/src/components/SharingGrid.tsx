import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { KINDS, type FileItem, type Kind } from '@privy/shared';
import { api } from '../api';

const ICON: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.icon])) as Record<Kind, string>;
const LABEL: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.label])) as Record<Kind, string>;

/** Images get a real thumbnail (HEIC via its proxy, JPEG/PNG via the file URL). */
const thumbUrl = (item: FileItem): string => (item.hasProxy ? api.proxyUrl(item.path) : api.fileUrl(item.path));
const showThumb = (item: FileItem): boolean => item.kind === 'image';

function fmtSize(n: number): string {
  if (n === 0) return 'folder';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function RenameInput({ item, onCommit, onCancel }: { item: FileItem; onCommit(name: string): void; onCancel(): void }) {
  const done = useRef(false); // blur fires again on unmount after Enter/Escape — guard against double-fire
  const finish = (commit: boolean, value: string) => {
    if (done.current) return;
    done.current = true;
    const v = value.trim();
    if (commit && v && v !== item.name) onCommit(v); else onCancel();
  };
  return (
    <input
      className="tile-rename-input" autoFocus defaultValue={item.name}
      onFocus={(e) => {
        const i = item.isDir ? -1 : item.name.lastIndexOf('.');
        if (i > 0) e.target.setSelectionRange(0, i); else e.target.select();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true, e.currentTarget.value);
        else if (e.key === 'Escape') finish(false, '');
      }}
      onBlur={(e) => finish(true, e.currentTarget.value)}
    />
  );
}

export function SharingGrid({ items, onSelect, onOpen, selected, singleClickOpens, onMoveTo, emptyMessage, onTileContextMenu, renaming, onCommitRename, onCancelRename }: {
  items: FileItem[]; onSelect: (item: FileItem, shiftKey: boolean) => void; onOpen?: (item: FileItem) => void;
  selected?: Set<string>; singleClickOpens?: boolean;
  onMoveTo?: (from: string, toFolder: string) => void; emptyMessage?: string;
  onTileContextMenu?: (e: ReactMouseEvent<HTMLElement>, item: FileItem) => void;
  renaming?: string | null;
  onCommitRename?: (item: FileItem, newName: string) => void;
  onCancelRename?: () => void;
}) {
  // The tile being dragged (so a folder tile can offer to accept a move drop).
  const [dragPath, setDragPath] = useState<string | null>(null);
  if (items.length === 0) return <div className="empty-state">{emptyMessage ?? 'Nothing here yet — send something from the chat.'}</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
      {items.map((item) => {
        const isRenaming = renaming === item.path;
        const body = (
          <>
            <div className="tile-icon">{showThumb(item) ? <img src={thumbUrl(item)} alt="" className="tile-thumb" loading="lazy" /> : ICON[item.kind]}</div>
            {isRenaming
              ? <RenameInput item={item} onCommit={(v) => onCommitRename?.(item, v)} onCancel={() => onCancelRename?.()} />
              : (
                <>
                  <div className="tile-name">{item.name}{item.isDir ? ' ›' : ''}</div>
                  <div className="tile-meta">{fmtSize(item.size)} · {LABEL[item.kind]}</div>
                </>
              )}
          </>
        );
        if (isRenaming) {
          // An <input> cannot live inside a <button> — render a plain div while renaming.
          return <div key={item.path} className="tile">{body}</div>;
        }
        return (
          <button key={item.path} className={`tile${selected?.has(item.path) ? ' selected' : ''}${item.isDir && dragPath && dragPath !== item.path && onMoveTo ? ' drop-target' : ''}`}
            title={item.isDir ? `Open ${item.name}` : item.name} draggable
            onClick={(e) => (singleClickOpens ? onOpen?.(item) : onSelect(item, e.shiftKey))}
            onDoubleClick={() => onOpen?.(item)}
            onDragStart={(e) => { setDragPath(item.path); e.dataTransfer.setData('text/plain', item.path); e.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={() => setDragPath(null)}
            onDragOver={(e) => { if (item.isDir && dragPath && dragPath !== item.path) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
            onDrop={(e) => { e.preventDefault(); const from = e.dataTransfer.getData('text/plain') || dragPath; setDragPath(null); if (from && from !== item.path) onMoveTo?.(from, item.path); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onTileContextMenu?.(e, item); }}>
            {body}
          </button>
        );
      })}
    </div>
  );
}

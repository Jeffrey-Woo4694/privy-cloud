import { useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { FileItem } from '@privy/shared';
import { api } from '../api';
import { FolderIcon, FilePageIcon } from './icons';
import { useItemInteraction } from '../useItemInteraction';

/** A tile name may be capped at 3 lines; keep the truncation ending with the file
    type so a long name reads "…word.md" instead of cutting the type off. The "…"
    already carries the trailing punctuation, so the suffix is the bare type (no dot).
    Only truncate when the whole name exceeds the ~3-line budget. */
function displayName(name: string, isDir: boolean): string {
  // Hidden files (".gitignore") and directories have no trailing type.
  const dot = name.lastIndexOf('.');
  const hasType = !isDir && dot > 0;
  const type = hasType ? name.slice(dot + 1) : ''; // "md" — no leading dot
  const base = hasType ? name.slice(0, dot) : name;
  const MAX = 40; // ~3 lines at the default tile width
  if (name.length > MAX) {
    const cap = Math.max(MAX - type.length - 1, 0); // leave room for "…" + type
    return base.slice(0, cap) + '…' + type;
  }
  return name;
}

/** Images get a real thumbnail (HEIC via its proxy, JPEG/PNG via the file URL). */
const thumbUrl = (item: FileItem): string => (item.hasProxy ? api.proxyUrl(item.path) : api.fileUrl(item.path));
const showThumb = (item: FileItem): boolean => item.kind === 'image';

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
  const { interactionFor, cls } = useItemInteraction({ onSelect, onOpen, onMoveTo, selected, singleClickOpens });
  if (items.length === 0) return <div className="empty-state">{emptyMessage ?? 'Nothing here yet — send something from the chat.'}</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(calc(140px * var(--icon-scale, 1)), 1fr))', gap: 6 }}>
      {items.map((item) => {
        const isRenaming = renaming === item.path;
        const body = (
          <>
            <div className="tile-icon">{showThumb(item) ? <img src={thumbUrl(item)} alt="" className="tile-thumb" loading="lazy" /> : (item.isDir ? <FolderIcon /> : <FilePageIcon kind={item.kind} />)}</div>
            {isRenaming
              ? <RenameInput item={item} onCommit={(v) => onCommitRename?.(item, v)} onCancel={() => onCancelRename?.()} />
              : (
                <>
                  <div className="tile-name">{displayName(item.name, item.isDir)}</div>
                </>
              )}
          </>
        );
        if (isRenaming) {
          // An <input> cannot live inside a <button> — render a plain div while renaming.
          return <div key={item.path} className="tile">{body}</div>;
        }
        const handler = interactionFor(item);
        return (
          <button key={item.path} className={cls('tile', item)} title={item.isDir ? `Open ${item.name}` : item.name}
            draggable={handler.draggable} onClick={handler.onClick} onDoubleClick={handler.onDoubleClick}
            onDragStart={handler.onDragStart} onDragEnd={handler.onDragEnd} onDragOver={handler.onDragOver} onDrop={handler.onDrop}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onTileContextMenu?.(e, item); }}>
            {body}
          </button>
        );
      })}
    </div>
  );
}

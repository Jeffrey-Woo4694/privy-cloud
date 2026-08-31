import { useRef, useState } from 'react';
import { CATEGORY_PLACES, locationKey, type Location } from '../sharingLocation';
import { ShapeIcon, type IconName } from './icons';
import { ContextMenu } from './ContextMenu';
import { bookmarkLabel, type Bookmark } from '../bookmarks';

const VIRTUAL_PLACES: Array<{ label: string; icon: IconName; location: Location }> = [
  { label: 'Home', icon: 'home', location: { type: 'home' } },
  { label: 'Recent', icon: 'recent', location: { type: 'recent' } },
  { label: 'Trash', icon: 'trash', location: { type: 'trash' } },
];

// Marker type the bookmark rows put on their own drags, so a reorder-drop inside
// this list is never mistaken for a folder dragged in from the grid ('text/plain').
const BOOKMARK_MIME = 'application/x-privy-bookmark';

export function SharingSidebar({ location, onSelect, bookmarks = [], onDropFolder, onReorder, onRemove, onRename }: {
  location: Location;
  onSelect: (loc: Location) => void;
  bookmarks?: Bookmark[];
  onDropFolder?: (path: string) => void;
  onReorder?: (from: number, to: number) => void;
  onRemove?: (path: string) => void;
  onRename?: (bookmark: Bookmark, newName: string) => void;
}) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<number | null>(null); // index of the bookmark being moved
  const [gap, setGap] = useState<number | null>(null); // insertion position 0..len
  const [accepting, setAccepting] = useState(false); // a grid folder hovers over the zone
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // path whose label is inline-editing
  const editCommitted = useRef(false);

  const isOwnDrag = (types: readonly string[]) => types.includes(BOOKMARK_MIME);
  // The insertion gap under the pointer: before the first row whose midpoint is
  // below it, else at the end. Recomputed on every dragover → the line tracks the
  // cursor precisely while rows keep their transitions (the "fluid" reorder feel).
  const gapAt = (clientY: number) => {
    const rows = zoneRef.current?.querySelectorAll<HTMLElement>('[data-bookmark-row]') ?? [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return rows.length;
  };
  const onZoneDragOver = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types ?? []);
    if (isOwnDrag(types)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setGap(gapAt(e.clientY)); return; }
    if (types.includes('text/plain')) { e.preventDefault(); setAccepting(true); }
  };
  const onZoneDrop = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types ?? []);
    e.preventDefault();
    setAccepting(false);
    if (isOwnDrag(types) && dragFrom.current !== null) {
      onReorder?.(dragFrom.current, gap ?? bookmarks.length);
    } else {
      const path = e.dataTransfer.getData('text/plain');
      if (path) onDropFolder?.(path);
    }
    dragFrom.current = null;
    setGap(null);
  };
  const endDrag = () => { dragFrom.current = null; setGap(null); };

  const commitEdit = (bm: Bookmark, value: string, viaKey: boolean) => {
    if (editCommitted.current && !viaKey) return;
    editCommitted.current = true;
    setEditing(null);
    const t = value.trim();
    if (t && t !== bookmarkLabel(bm.path)) onRename?.(bm, t);
  };

  return (
    <div className="sharing-sidebar">
      {VIRTUAL_PLACES.map((p) => (
        <button key={p.label} className={`sidebar-item${locationKey(p.location) === locationKey(location) ? ' active' : ''}`}
          onClick={() => onSelect(p.location)}>
          <span className="sidebar-icon"><ShapeIcon name={p.icon} size={16} /></span>{p.label}
        </button>
      ))}
      <div className="sidebar-divider" />
      {CATEGORY_PLACES.map((p) => (
        <button key={p.id} className={`sidebar-item${locationKey(p.location) === locationKey(location) ? ' active' : ''}`}
          onClick={() => onSelect(p.location)}>
          <span className="sidebar-icon"><ShapeIcon name={p.icon} size={16} /></span>{p.label}
        </button>
      ))}
      <div className="sidebar-divider" />
      <div className="sidebar-section-label">Quick access</div>
      <div
        ref={zoneRef}
        className={`bookmark-zone${accepting ? ' accepting' : ''}`}
        onDragOver={onZoneDragOver}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setAccepting(false); }}
        onDrop={onZoneDrop}
      >
        {bookmarks.length === 0 && (
          <div className="bookmark-empty">Drag a folder here for quick access</div>
        )}
        {bookmarks.map((b, i) => {
          const active = locationKey({ type: 'folder', path: b.path }) === locationKey(location);
          if (editing === b.path) {
            return (
              <div key={b.path} data-bookmark-row className="sidebar-item bookmark-row">
                <span className="sidebar-icon"><ShapeIcon name="folder" size={16} /></span>
                <input
                  className="bookmark-rename-input" autoFocus defaultValue={b.label}
                  onFocus={(e) => { editCommitted.current = false; e.target.select(); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit(b, e.currentTarget.value, true);
                    else if (e.key === 'Escape') { editCommitted.current = true; setEditing(null); }
                  }}
                  onBlur={(e) => commitEdit(b, e.currentTarget.value, false)}
                />
              </div>
            );
          }
          return (
            <div key={b.path} data-bookmark-row draggable
              className={`sidebar-item bookmark-row${active ? ' active' : ''}${gap === i ? ' gap-before' : ''}${gap === bookmarks.length && i === bookmarks.length - 1 ? ' gap-after' : ''}`}
              onClick={() => onSelect({ type: 'folder', path: b.path })}
              onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.setData(BOOKMARK_MIME, String(i)); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnd={endDrag}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, index: i }); }}
              title={b.path}
            >
              <span className="sidebar-icon"><ShapeIcon name="folder" size={16} /></span>{b.label}
            </div>
          );
        })}
      </div>
      {menu && bookmarks[menu.index] && (
        <ContextMenu x={menu.x} y={menu.y}
          items={[
            { id: 'rename', label: 'Rename', icon: 'pencil', action: 'rename-bookmark' },
            { id: 'remove', label: 'Remove from bookmarks', icon: 'trash', action: 'remove-bookmark', danger: true, separatorBefore: true },
          ]}
          onSelect={(a) => {
            const bm = bookmarks[menu.index];
            if (a === 'remove-bookmark') onRemove?.(bm.path);
            else if (a === 'rename-bookmark') setEditing(bm.path);
            setMenu(null);
          }}
          onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
